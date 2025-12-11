import pyodbc
import pymysql
import sys
import logging
import warnings
from tqdm import tqdm
from config_manager import config_manager

# Suppress warnings
warnings.filterwarnings("ignore")

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("full_import_log.txt", encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

# Configuration
ACCESS_DB_OS = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb"
ACCESS_DB_PAPELARIA = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb"

SHARED_TABLES = ['tabAndamento', 'tabProtocolos', 'tabDetalhesServico']

# --- OPTIMIZATION MAP ---
# Define specific types for known columns to override default text
TYPE_MAP = {
    # Integers
    'NroProtocolo': 'INT',
    'AnoProtocolo': 'INT',
    'NroProtocoloLink': 'INT',
    'AnoProtocoloLink': 'INT',
    'NroProtocoloLinkDet': 'INT',
    'AnoProtocoloLinkDet': 'INT',
    'CotaRepro': 'INT',
    'CotaCartao': 'INT',
    'Tiragem': 'INT',
    'Pags': 'INT',
    'UltimoStatus': 'TINYINT',
    'CodStatus': 'VARCHAR(20)', # Keep text but optimize length
    
    # Dates
    'DataEntrada': 'DATE',
    'EntregData': 'DATE',
    'Data': 'DATETIME',
}

def get_mysql_conn():
    return pymysql.connect(
        host=config_manager.get("db_host", "127.0.0.1"),
        port=int(config_manager.get("db_port", 3306)),
        user=config_manager.get("db_user", "root"),
        password=config_manager.get("db_password", ""),
        database=config_manager.get("db_name", "sagrafulldb"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        charset='utf8mb4'
    )

def get_access_conn(db_path):
    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={db_path};"
    )
    return pyodbc.connect(conn_str)

def get_access_tables(conn):
    cursor = conn.cursor()
    tables = []
    for row in cursor.tables():
        if row.table_type == 'TABLE':
            tables.append(row.table_name)
    return tables

def clean_val(val, target_type):
    if val is None: return None
    
    if 'INT' in target_type or 'TINYINT' in target_type:
        try:
            return int(float(val))
        except:
            return 0 # Default to 0 for bad ints? Or None? Let's use None for safety or 0 for logic. 
                     # Sagra logic often expects numbers.
            return None
            
    if 'DATE' in target_type:
        # Pymysql handles datetime objects fine, Access returns them.
        # If string, we might have issues.
        return val
        
    if isinstance(val, str):
        return val.strip()
        
    return val

def create_table_dynamic(mysql_conn, access_cursor, table_name):
    logging.info(f"Generating schema for {table_name}...")
    
    # Analyze Access Colums
    # access_cursor.description is set after a select
    access_cursor.execute(f"SELECT TOP 1 * FROM [{table_name}]")
    columns_desc = access_cursor.description
    
    col_defs = []
    col_names = []
    
    for col in columns_desc:
        name = col[0]
        col_names.append(name)
        
        # Determine Type
        sql_type = "TEXT" # Default fallback
        
        # Check Optimization Map
        if name in TYPE_MAP:
            sql_type = TYPE_MAP[name]
        else:
            # Heuristic based on Access Type code?
            # 3=Decimal, 4=Int, 7=Double, 8=String, 11=Boolean, 93=Date/Time
            t_code = col[1] 
            if t_code == int: sql_type = "INT"
            elif t_code == float: sql_type = "DOUBLE"
            elif t_code == str: sql_type = "TEXT" 
            # Note: Access drivers vary, map lookup is safer for critical cols.
            pass

        col_defs.append(f"`{name}` {sql_type}")
    
    # Build Query
    cols_sql = ",\n    ".join(col_defs)
    
    # Try to determine a primary key?
    # For now, let's create without PK if not obvious, and add INDEXES later via script.
    # MySQL InnoDB requires a PK for performance often, but will handle it.
    
    query = f"CREATE TABLE IF NOT EXISTS `{table_name}` (\n    {cols_sql}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
    
    with mysql_conn.cursor() as cur:
        # Drop first to ensure clean state? 
        # User said "created empty DB", so IF NOT EXISTS is fine.
        cur.execute(f"DROP TABLE IF EXISTS `{table_name}`")
        cur.execute(query)
        logging.info(f"Table {table_name} created.")
        
    return col_names

def import_table_data(access_cursor, mysql_conn, table_name, col_names):
    logging.info(f"Fetching data for {table_name}...")
    access_cursor.execute(f"SELECT * FROM [{table_name}]")
    rows = access_cursor.fetchall()
    
    if not rows:
        return

    # Prepare Insert
    placeholders = ', '.join(['%s'] * len(col_names))
    cols_str = ', '.join([f"`{c}`" for c in col_names])
    insert_sql = f"INSERT INTO `{table_name}` ({cols_str}) VALUES ({placeholders})"
    
    batch = []
    batch_size = 1000
    
    mysql_cur = mysql_conn.cursor()
    
    logging.info(f"Importing {len(rows)} rows...")
    
    for row in tqdm(rows, desc=table_name):
        # Process Row values based on target types
        clean_row = []
        for i, val in enumerate(row):
            col_name = col_names[i]
            target_type = TYPE_MAP.get(col_name, "TEXT")
            clean_row.append(clean_val(val, target_type))
            
        batch.append(clean_row)
        
        if len(batch) >= batch_size:
            try:
                mysql_cur.executemany(insert_sql, batch)
            except Exception as e:
                logging.error(f"Batch Error: {e}")
            batch = []
            
    if batch:
        mysql_cur.executemany(insert_sql, batch)
        
    logging.info("Done.")

def run_aux_scripts(mysql_conn):
    logging.info("Running Auxiliary Setup (Indexes, Permissions, Extra Tables)...")
    
    # 1. Indexes (from add_indices.py and others)
    sqls = [
        # Indexes
        "ALTER TABLE tabProtocolos ADD UNIQUE INDEX idx_proto_unique (NroProtocolo, AnoProtocolo)",
        "ALTER TABLE tabDetalhesServico ADD UNIQUE INDEX idx_detalhes_unique (NroProtocoloLinkDet, AnoProtocoloLinkDet)",
        "ALTER TABLE tabAndamento ADD UNIQUE INDEX idx_andamento_unique (CodStatus)",
        "CREATE INDEX idx_andamento_protocolo ON tabAndamento (NroProtocoloLink, AnoProtocoloLink)",
        "CREATE INDEX idx_panel_opt ON tabAndamento (UltimoStatus, SituacaoLink(20), SetorLink(10))",
        
        # Permissions Table
        """CREATE TABLE IF NOT EXISTS tabPermissoes (
            Nivel INT PRIMARY KEY,
            Nome VARCHAR(50) NOT NULL,
            PermCriarOS BOOLEAN DEFAULT FALSE,
            PermEditarOS BOOLEAN DEFAULT FALSE,
            PermPapelaria BOOLEAN DEFAULT FALSE,
            PermAnalise BOOLEAN DEFAULT FALSE,
            PermEmail BOOLEAN DEFAULT FALSE,
            PermAdmin BOOLEAN DEFAULT FALSE
        )""",
        
        # Analise Tables
        """CREATE TABLE IF NOT EXISTS tabAnalises (
            ID INT AUTO_INCREMENT PRIMARY KEY,
            OS INT NOT NULL,
            Ano INT NOT NULL,
            Versao VARCHAR(50),
            Componente VARCHAR(100),
            Usuario VARCHAR(100),
            DataCriacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_os_analise (OS, Ano)
        )""",
        """CREATE TABLE IF NOT EXISTS tabAnaliseItens (
            ID INT AUTO_INCREMENT PRIMARY KEY,
            ID_Analise INT NOT NULL,
            ID_ProblemaPadrao INT,
            Obs TEXT,
            HTML_Snapshot LONGTEXT,
            Componente VARCHAR(255),
            Desconsiderado TINYINT(1) DEFAULT 0,
            ClienteNome VARCHAR(150),
            ClientePonto VARCHAR(20),
            DataDesconsiderado DATETIME,
            Resolver TINYINT(1) DEFAULT 0,
            DataResolver DATETIME,
            FOREIGN KEY (ID_Analise) REFERENCES tabAnalises(ID) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS tabClientTokens (
            ID INT AUTO_INCREMENT PRIMARY KEY,
            ID_Analise INT NOT NULL,
            NroProtocolo INT NOT NULL,
            AnoProtocolo INT NOT NULL,
            Token VARCHAR(64) NOT NULL,
            DataCriacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            DataExpiracao DATETIME NULL,
            UNIQUE KEY unique_token (Token),
            FOREIGN KEY (ID_Analise) REFERENCES tabAnalises(ID) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS tabUserFilterSettings (
            ID INT PRIMARY KEY AUTO_INCREMENT,
            Usuario VARCHAR(150) NOT NULL,
            Ponto VARCHAR(20) NOT NULL,
            Situacoes TEXT NULL,
            Setores TEXT NULL,
            DataAtualizacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_ponto (Ponto)
        )""",
        
        # Papelaria Models (if not in Access)
        """CREATE TABLE IF NOT EXISTS tabPapelariaModelos (
            ID INT AUTO_INCREMENT PRIMARY KEY,
            NomeProduto VARCHAR(100) NOT NULL,
            NomeArquivo VARCHAR(255) NOT NULL,
            Categoria VARCHAR(50),
            Ativo BOOLEAN DEFAULT TRUE,
            ConfigCampos JSON
        )""" 
    ]
    
    with mysql_conn.cursor() as cur:
        for sql in sqls:
            try:
                cur.execute(sql)
            except Exception as e:
                # Ignore duplicates "already exists"
                if "Duplicate key" not in str(e) and "already exists" not in str(e):
                    logging.warning(f"Aux Setup Warning: {e}")

    # Insert default Permissions
    try:
        levels = [
            (1, "Nível 1 - Básico"),
            (2, "Nível 2 - Operacional"),
            (3, "Nível 3 - Supervisor"),
            (4, "Nível 4 - Gerente"),
            (5, "Nível 5 - Administrador")
        ]
        sql_perm = "INSERT IGNORE INTO tabPermissoes (Nivel, Nome) VALUES (%s, %s)"
        with mysql_conn.cursor() as cur:
            cur.executemany(sql_perm, levels)
    except: pass

def main():
    try:
        mysql_conn = get_mysql_conn()
        logging.info("Connected to LOCAL MySQL.")
        
        # Connect to Access
        conn_os = get_access_conn(ACCESS_DB_OS)
        try:
            conn_pap = get_access_conn(ACCESS_DB_PAPELARIA)
        except:
            conn_pap = None
            
        tables = get_access_tables(conn_os)
        
        for table in tables:
            logging.info(f"--- Processing {table} ---")
            
            # Use Cursor from OS DB to get schema
            cursor_os = conn_os.cursor()
            col_names = create_table_dynamic(mysql_conn, cursor_os, table)
            
            # Import from OS
            import_table_data(cursor_os, mysql_conn, table, col_names)
            
            # Import from Papelaria (if shared)
            if table in SHARED_TABLES and conn_pap:
                cursor_pap = conn_pap.cursor()
                import_table_data(cursor_pap, mysql_conn, table, col_names)
                
        # Run Optimizations & Aux Tables
        run_aux_scripts(mysql_conn)
        
        logging.info("--- MIGRATION COMPLETE SUCCESSFULLY ---")
        
    except Exception as e:
        logging.critical(f"Fatal Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()

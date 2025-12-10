import pyodbc
import pymysql
import sys
import logging
from tqdm import tqdm
from config_manager import config_manager
import warnings

warnings.filterwarnings("ignore")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("sync_append_log.txt", encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

ACCESS_DB_OS = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb"
ACCESS_DB_PAPELARIA = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb"

SHARED_TABLES = ['tabAndamento', 'tabProtocolos', 'tabDetalhesServico']

# --- ETL Helpers ---
def clean_int(val):
    if val is None: return None
    if isinstance(val, int): return val
    try:
        s = str(val).strip()
        if not s: return None
        return int(float(s)) # Handle "1.0" strings
    except:
        return None

def clean_date(val):
    # Access often returns datetime objects directly, which is great.
    # If string, we need to parse.
    if val is None: return None
    return val # PyMySQL handles python datetime objects well

def clean_bool(val):
    if val is None: return 0
    s = str(val).lower().strip()
    return 1 if s in ['1', 'true', 'sim', 's', 'on'] else 0

def get_mysql_conn():
    return pymysql.connect(
        host=config_manager.get("db_host", "10.120.1.125"),
        port=int(config_manager.get("db_port", 3306)),
        user=config_manager.get("db_user", "usr_sefoc"),
        password=config_manager.get("db_password", "sefoc_2018"),
        database=config_manager.get("db_name", "sagrafulldb"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        charset='utf8mb4'
    )

def get_access_conn(db_path):
    conn_str = r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + db_path + ";"
    return pyodbc.connect(conn_str)

def get_existing_keys(mysql_conn, table_name):
    # Returns a SET of keys for fast lookup
    keys = set()
    with mysql_conn.cursor() as cursor:
        if table_name == 'tabAndamento':
            cursor.execute("SELECT CodStatus FROM tabAndamento")
            for row in cursor.fetchall():
                keys.add(row['CodStatus'])
        elif table_name in ['tabProtocolos', 'tabDetalhesServico']:
            if table_name == 'tabProtocolos':
                cursor.execute("SELECT NroProtocolo, AnoProtocolo FROM tabProtocolos")
                for row in cursor.fetchall():
                    keys.add((row['NroProtocolo'], row['AnoProtocolo']))
            else:
                cursor.execute("SELECT NroProtocoloLinkDet, AnoProtocoloLinkDet FROM tabDetalhesServico")
                for row in cursor.fetchall():
                    keys.add((row['NroProtocoloLinkDet'], row['AnoProtocoloLinkDet']))
    return keys

def sync_table(access_cursor, mysql_conn, table_name, source_name):
    try:
        logging.info(f"Syncing {table_name} from {source_name}...")
        
        # 1. Get Existing Keys in MySQL
        existing_keys = get_existing_keys(mysql_conn, table_name)
        logging.info(f"  Found {len(existing_keys)} existing records in MySQL.")

        # 2. Read Access Data
        access_cursor.execute(f"SELECT * FROM [{table_name}]")
        rows = access_cursor.fetchall()
        
        if not rows:
            logging.info("  No rows in source.")
            return

        # 3. Filter New Rows
        new_rows = []
        columns = [col[0] for col in access_cursor.description]
        col_map = {name: i for i, name in enumerate(columns)}
        
        for row in rows:
            # Key extraction with robust casting
            key = None
            try:
                if table_name == 'tabAndamento':
                    idx = col_map.get('CodStatus')
                    if idx is not None and row[idx] is not None:
                        key = str(row[idx]).strip()
                elif table_name == 'tabProtocolos':
                    idx_nro = col_map.get('NroProtocolo')
                    idx_ano = col_map.get('AnoProtocolo')
                    if idx_nro is not None and idx_ano is not None:
                        val_nro = clean_int(row[idx_nro])
                        val_ano = clean_int(row[idx_ano])
                        if val_nro is not None and val_ano is not None:
                            key = (val_nro, val_ano)
                elif table_name == 'tabDetalhesServico':
                    idx_nro = col_map.get('NroProtocoloLinkDet')
                    idx_ano = col_map.get('AnoProtocoloLinkDet')
                    if idx_nro is not None and idx_ano is not None:
                        val_nro = clean_int(row[idx_nro])
                        val_ano = clean_int(row[idx_ano])
                        if val_nro is not None and val_ano is not None:
                            key = (val_nro, val_ano)
            except ValueError:
                continue
            
            if key and key not in existing_keys:
                new_rows.append(list(row))
        
        logging.info(f"  Found {len(new_rows)} NEW records to insert.")

        if not new_rows:
            return

        # 4. Transform and Insert
        int_cols = ['NroProtocolo', 'AnoProtocolo', 'CotaRepro', 'CotaCartao', 
                    'NroProtocoloLinkDet', 'AnoProtocoloLinkDet', 'Tiragem', 'Pags', 'NroProtocoloLink', 'AnoProtocoloLink']
        
        insert_rows = []
        for row in new_rows:
            transformed_row = []
            for col_name, val in zip(columns, row):
                if col_name in int_cols:
                    transformed_row.append(clean_int(val))
                elif col_name == "UltimoStatus":
                    transformed_row.append(clean_int(val))
                elif col_name in ['DataEntrada', 'EntregData', 'Data']: 
                    transformed_row.append(clean_date(val))
                else:
                    transformed_row.append(val)
            insert_rows.append(transformed_row)

        placeholders = ', '.join(['%s'] * len(columns))
        col_names = ', '.join([f"`{c}`" for c in columns])
        
        insert_query = f"INSERT IGNORE INTO `{table_name}` ({col_names}) VALUES ({placeholders})"
        
        with mysql_conn.cursor() as cursor:
            batch_size = 1000
            for i in range(0, len(insert_rows), batch_size):
                batch = insert_rows[i:i + batch_size]
                cursor.executemany(insert_query, batch)
        
        logging.info("  Insert complete.")

    except Exception as e:
        logging.error(f"Error syncing {table_name}: {e}")

def main():
    try:
        mysql_conn = get_mysql_conn()
        logging.info("Connected to MySQL.")
        
        dbs = [
            (ACCESS_DB_OS, "OS Atual"),
            (ACCESS_DB_PAPELARIA, "Papelaria Atual")
        ]

        for db_path, source_name in dbs:
            try:
                conn_access = get_access_conn(db_path)
                logging.info(f"--- Processing {source_name} ---")
                
                for table in SHARED_TABLES:
                    # Check if table exists in this DB
                    try:
                        cursor = conn_access.cursor()
                        cursor.execute(f"SELECT TOP 1 * FROM [{table}]")
                        sync_table(cursor, mysql_conn, table, source_name)
                    except Exception as e:
                        logging.warning(f"  Table {table} not found or error in {source_name}: {e}")
                
                conn_access.close()
            except Exception as e:
                logging.error(f"  Failed to connect to {source_name}: {e}")

        logging.info("Sync Append Completed Successfully!")
        
        # Recalculate UltimoStatus to ensure only one TRUE per OS
        recalculate_ultimo_status(mysql_conn)

    except Exception as e:
        logging.critical(f"Critical Error: {e}")
    finally:
        if 'mysql_conn' in locals() and mysql_conn.open: mysql_conn.close()

def recalculate_ultimo_status(conn):
    try:
        logging.info("Recalculating UltimoStatus (Strategy: MAX(CodStatus))...")
        with conn.cursor() as cursor:
            # 1. Reset all to 0
            logging.info("  Resetting all statuses to 0...")
            cursor.execute("UPDATE tabAndamento SET UltimoStatus = 0")
            
            # 2. Set only the row with MAX(CodStatus) for each OS to 1
            logging.info("  Setting status with highest CodStatus to 1...")
            
            # This logic aligns with "Sort A-Z by CodStatus and take the last one".
            # Since CodStatus strings are formatted with zero-padding (e.g. 001232024-05),
            # lexicographical MAX works correctly for ordering.
            
            sql_update = """
            UPDATE tabAndamento t
            JOIN (
                SELECT NroProtocoloLink, AnoProtocoloLink, MAX(CodStatus) as MaxCod
                FROM tabAndamento
                GROUP BY NroProtocoloLink, AnoProtocoloLink
            ) m ON t.NroProtocoloLink = m.NroProtocoloLink 
               AND t.AnoProtocoloLink = m.AnoProtocoloLink 
               AND t.CodStatus = m.MaxCod
            SET t.UltimoStatus = 1;
            """
            
            cursor.execute(sql_update)
            
        logging.info("  UltimoStatus recalculation complete.")

    except Exception as e:
        logging.error(f"Error recalculating UltimoStatus: {e}")

if __name__ == "__main__":
    main()

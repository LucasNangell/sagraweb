import pandas as pd
import pyodbc
from sqlalchemy import create_engine, text
from sqlalchemy.types import Integer, Text, String, DateTime, BigInteger
import yaml
import os
import sys
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)
from config_manager import config_manager
import time
import hashlib
import sys
import warnings
from datetime import datetime

# --- LOGS ---
def log(msg, end="\n"):
    print(f"{msg}", end=end, flush=True)

def log_step(msg):
    log(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

warnings.filterwarnings('ignore')

# --- CONFIGURAÇÃO ---
def load_config(yaml_file="sync_conf.yaml"):
    if not os.path.exists(yaml_file):
        log(f"Erro: Arquivo '{yaml_file}' não encontrado.")
        sys.exit(1)
    with open(yaml_file, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

CONFIG_FULL = load_config()
DB_CONF = CONFIG_FULL['sync_andamento']
MYSQL_CONF = DB_CONF['mysql']
def _override_mdb_path(path):
    if not path:
        return path
    if 'OS Atual.mdb' in path:
        return config_manager.get('mdb_os_atual_path', path)
    if 'Papelaria Atual.mdb' in path:
        return config_manager.get('mdb_papelaria_path', path)
    return path

central_mysql = config_manager.get_mysql_config()
MYSQL_CONF.update({
    "host": central_mysql["host"],
    "port": central_mysql["port"],
    "user": central_mysql["user"],
    "password": central_mysql["password"],
    "database": central_mysql["database"],
})
DB_CONF["mdb_path"] = _override_mdb_path(DB_CONF.get("mdb_path"))

HASH_COLS = [
    'CodStatus', 'NroProtocoloLink', 'AnoProtocoloLink', 
    'SituacaoLink', 'SetorLink', 'UltimoStatus', 'Observaçao', 'Ponto'
]
PK_COLS = DB_CONF['pk_columns']

# --- CONEXÕES ---
def get_access_conn():
    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={DB_CONF['mdb_path']};"
        r"ReadOnly=0;Exclusive=0;Mode=Share Deny None;"
    )
    return pyodbc.connect(conn_str)

def get_mysql_engine():
    conn_str = f"mysql+pymysql://{MYSQL_CONF['user']}:{MYSQL_CONF['password']}@{MYSQL_CONF['host']}:{MYSQL_CONF['port']}/{MYSQL_CONF['database']}?charset=utf8mb4"
    return create_engine(conn_str, pool_recycle=3600)

# --- INFRAESTRUTURA INTELIGENTE ---

def map_pandas_to_sql_types(df):
    dtypedict = {}
    for col in df.columns:
        dtype = df[col].dtypes if not isinstance(df[col], pd.DataFrame) else df[col].iloc[:, 0].dtypes
        if "object" in str(dtype): dtypedict.update({col: Text()})
        elif "datetime" in str(dtype): dtypedict.update({col: DateTime()})
        elif "float" in str(dtype): dtypedict.update({col: String(50)})
        elif "int" in str(dtype): dtypedict.update({col: BigInteger()})
        else: dtypedict.update({col: String(255)})
    return dtypedict

def ensure_control_columns(engine, table_name):
    """Verifica e adiciona colunas de controle na tabela existente sem perder dados."""
    with engine.connect() as conn:
        # 1. Checa SYNC
        try:
            conn.execute(text(f"SELECT sync FROM {table_name} LIMIT 1"))
        except Exception:
            log(f"   -> Adicionando coluna 'sync' em {table_name}...")
            try:
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN sync INT DEFAULT 0"))
            except Exception as e:
                log(f"      [AVISO] Falha ao adicionar sync: {e}")

        # 2. Checa LASTUPDATE
        try:
            conn.execute(text(f"SELECT lastupdate FROM {table_name} LIMIT 1"))
        except Exception:
            log(f"   -> Adicionando coluna 'lastupdate' em {table_name}...")
            try:
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN lastupdate DATETIME"))
            except Exception as e:
                log(f"      [AVISO] Falha ao adicionar lastupdate: {e}")

def auto_setup_infrastructure(engine):
    log_step("Verificando infraestrutura e tabelas...")
    
    # 1. Ler estrutura do MDB
    try:
        mdb_conn = get_access_conn()
        all_cols = list(dict.fromkeys(PK_COLS + HASH_COLS))
        cols_sql = ", ".join([f"[{c}]" for c in all_cols])
        df_sample = pd.read_sql(f"SELECT TOP 1 {cols_sql} FROM [{DB_CONF['table_source']}]", mdb_conn)
        mdb_conn.close()
    except Exception as e:
        log(f"ERRO CRÍTICO MDB: {e}")
        sys.exit(1)

    # 2. Criar Tabelas Monitor (Buffers)
    df_struct = df_sample.head(0).copy()
    df_struct = df_struct.loc[:, ~df_struct.columns.duplicated()]
    if 'sync' not in df_struct.columns: df_struct['sync'] = 0
    if 'lastupdate' not in df_struct.columns: df_struct['lastupdate'] = datetime.now()
    
    dtype_map = map_pandas_to_sql_types(df_struct)
    dtype_map['sync'] = Integer()
    dtype_map['lastupdate'] = DateTime()

    for tbl in [DB_CONF['table_monitor_os'], DB_CONF['table_monitor_sp']]:
        try:
            df_struct.to_sql(tbl, engine, if_exists='append', index=False, dtype=dtype_map)
        except: pass
        with engine.connect() as conn:
            try:
                pk_check = conn.execute(text(f"SHOW KEYS FROM {tbl} WHERE Key_name = 'PRIMARY'")).fetchone()
                if not pk_check: conn.execute(text(f"ALTER TABLE {tbl} ADD PRIMARY KEY ({', '.join(PK_COLS)})"))
            except: pass

    # 3. Validar Tabela Principal
    # Se ela já existe, garantimos que tenha sync/lastupdate
    ensure_control_columns(engine, DB_CONF['table_main'])
    
    # 4. Criar Tabela de Hash Map
    try:
        df_hash = df_sample[PK_COLS].copy()
        df_hash = df_hash.loc[:, ~df_hash.columns.duplicated()]
        df_hash['row_hash'] = "dummy"
        d_map = map_pandas_to_sql_types(df_hash)
        d_map['row_hash'] = String(32)
        df_hash.head(0).to_sql(DB_CONF['table_hash_map'], engine, if_exists='append', index=False, dtype=d_map)
        with engine.connect() as conn:
             if not conn.execute(text(f"SHOW KEYS FROM {DB_CONF['table_hash_map']} WHERE Key_name = 'PRIMARY'")).fetchone():
                 conn.execute(text(f"ALTER TABLE {DB_CONF['table_hash_map']} ADD PRIMARY KEY ({', '.join(PK_COLS)})"))
    except: pass
    
    # 5. Criar Fila de Exclusão
    pk_defs = ", ".join([f"{col} BIGINT" for col in PK_COLS])
    engine.connect().execute(text(f"CREATE TABLE IF NOT EXISTS {DB_CONF['table_del_queue']} ({pk_defs}, data_exclusao DATETIME DEFAULT NOW())"))

    log("Infraestrutura validada.")

# --- FUNÇÕES DE SINCRONIA INTERNA (MONITOR <-> MAIN) ---

def sync_internal_monitor_to_main(engine):
    """Monitor -> Main"""
    tasks = [
        (DB_CONF['table_monitor_os'], "CAST(NroProtocoloLink AS UNSIGNED) < 5000"),
        (DB_CONF['table_monitor_sp'], "CAST(NroProtocoloLink AS UNSIGNED) >= 5000 OR NroProtocoloLink IS NULL")
    ]
    
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for tbl_mon, condition in tasks:
                # Pega colunas do monitor para montar query
                cols_res = conn.execute(text(f"SHOW COLUMNS FROM {tbl_mon}"))
                # Filtra colunas que existem no monitor para inserir na main
                cols = [row[0] for row in cols_res if row[0] not in ['target', 'row_hash']]
                
                cols_str = ", ".join(cols)
                update_str = ", ".join([f"{c} = VALUES({c})" for c in cols if c not in PK_COLS])
                
                sql_upsert = f"""
                INSERT INTO {DB_CONF['table_main']} ({cols_str})
                SELECT {cols_str} FROM {tbl_mon}
                WHERE {condition} AND sync = 0
                ON DUPLICATE KEY UPDATE {update_str}, lastupdate = NOW();
                """
                conn.execute(text(sql_upsert))
            
            # Deletes
            pk_cond = " AND ".join([f"{DB_CONF['table_main']}.{k} = {DB_CONF['table_del_queue']}.{k}" for k in PK_COLS])
            sql_del_main = f"DELETE {DB_CONF['table_main']} FROM {DB_CONF['table_main']} JOIN {DB_CONF['table_del_queue']} ON {pk_cond};"
            conn.execute(text(sql_del_main))
            conn.execute(text(f"DELETE FROM {DB_CONF['table_del_queue']}"))
            
            trans.commit()
        except Exception as e:
            trans.rollback()
            log(f"Erro na Sincronia Interna (Monitor->Main): {e}")

# --- FUNÇÕES CORE (MDB <-> MONITOR) ---

def normalize_for_hash(df):
    df_norm = df.copy()
    for col in HASH_COLS:
        if col not in df_norm.columns:
            df_norm[col] = ""
            continue
        raw_col = df_norm[col]
        if isinstance(raw_col, pd.DataFrame): raw_col = raw_col.iloc[:, 0]
        s = raw_col.astype(str).replace(['None', 'nan', 'NaN', '<NA>'], '')
        s = s.str.strip()
        s = s.str.replace(r'\.0$', '', regex=True)
        df_norm[col] = s
    return df_norm.loc[:, ~df_norm.columns.duplicated()]

def calculate_hash(df):
    if df.empty:
        df['row_hash'] = []
        return df
    df = df.loc[:, ~df.columns.duplicated()]
    df_norm = normalize_for_hash(df[HASH_COLS])
    def row_hash_func(row):
        raw_str = "|".join([str(val) for val in row])
        return hashlib.md5(raw_str.encode('utf-8')).hexdigest()
    df['row_hash'] = df_norm.apply(row_hash_func, axis=1)
    return df

def split_target_table(row):
    try:
        col_val = row['NroProtocoloLink']
        if pd.isna(col_val): return DB_CONF['table_monitor_sp']
        nro = float(str(col_val).replace(',', '.'))
        return DB_CONF['table_monitor_os'] if nro < 5000 else DB_CONF['table_monitor_sp']
    except: return DB_CONF['table_monitor_sp']

def safe_bulk_insert_monitor(engine, df, table_name, is_initial_load=False):
    if df.empty: return
    df = df.loc[:, ~df.columns.duplicated()]
    valid_cols = [c for c in df.columns if c not in ['row_hash', 'target_table', 'target']]
    df_insert = df[valid_cols].copy()
    
    df_insert['sync'] = 0 
    df_insert['lastupdate'] = datetime.now()
    
    for c in df_insert.select_dtypes(include=['float', 'int']).columns:
        df_insert[c] = df_insert[c].where(pd.notnull(df_insert[c]), None)

    with engine.connect() as conn:
        trans = conn.begin()
        try:
            temp_keys = df_insert[PK_COLS].to_dict('records')
            for i in range(0, len(temp_keys), 1000):
                batch = temp_keys[i:i+1000]
                cond = " AND ".join([f"{k}=:{k}" for k in PK_COLS])
                conn.execute(text(f"DELETE FROM {table_name} WHERE {cond}"), batch)
            
            df_insert.to_sql(table_name, conn, if_exists='append', index=False, chunksize=500)
            trans.commit()
        except Exception as e:
            trans.rollback()
            log(f"Erro SQL Monitor {table_name}: {e}")

def sync_mdb_to_monitor(engine):
    try:
        df_map = pd.read_sql(f"SELECT * FROM {DB_CONF['table_hash_map']}", engine)
    except:
        df_map = pd.DataFrame(columns=PK_COLS + ['row_hash'])
    
    is_first_run = df_map.empty

    try:
        mdb_conn = get_access_conn()
        all_cols = list(dict.fromkeys(PK_COLS + HASH_COLS))
        cols_sql = ", ".join([f"[{c}]" for c in all_cols])
        df_mdb = pd.read_sql(f"SELECT {cols_sql} FROM [{DB_CONF['table_source']}]", mdb_conn)
        mdb_conn.close()
    except Exception as e:
        log(f"Erro MDB: {e}")
        return

    df_mdb = calculate_hash(df_mdb)
    df_mdb['target'] = df_mdb.apply(split_target_table, axis=1)

    if is_first_run:
        log_step("CARGA INICIAL (Preenchendo Monitores)...")
        for table_target, group in df_mdb.groupby('target'):
            safe_bulk_insert_monitor(engine, group, table_target, is_initial_load=True)
        
        df_map_new = df_mdb[PK_COLS + ['row_hash']].copy()
        df_map_new.to_sql(DB_CONF['table_hash_map'], engine, if_exists='replace', index=False)
        log("Carga MDB->Monitor Finalizada.")
        return

    df_mdb.set_index(PK_COLS, inplace=True)
    df_map.set_index(PK_COLS, inplace=True)
    
    df_join = df_mdb[['row_hash', 'target']].join(df_map[['row_hash']], lsuffix='_new', rsuffix='_old', how='outer')
    
    to_insert = df_join[df_join['row_hash_old'].isna()]
    to_delete = df_join[df_join['row_hash_new'].isna()]
    to_update = df_join[
        (df_join['row_hash_new'].notna()) & 
        (df_join['row_hash_old'].notna()) & 
        (df_join['row_hash_new'] != df_join['row_hash_old'])
    ]
    
    total = len(to_insert) + len(to_delete) + len(to_update)
    if total == 0:
        log(".", end="")
        return

    log(f"\n[{datetime.now().strftime('%H:%M:%S')}] MDB Alterado: +{len(to_insert)} | ~{len(to_update)} | -{len(to_delete)}")

    upserts = pd.concat([to_insert, to_update])
    if not upserts.empty:
        records = df_mdb.loc[upserts.index].reset_index()
        records = records.loc[:, ~records.columns.duplicated()]
        for table_target, group in records.groupby('target'):
            safe_bulk_insert_monitor(engine, group, table_target)

        with engine.connect() as conn:
            keys = upserts.index.to_frame(index=False).to_dict('records')
            for i in range(0, len(keys), 1000):
                conn.execute(text(f"DELETE FROM {DB_CONF['table_hash_map']} WHERE {' AND '.join([f'{k}=:{k}' for k in PK_COLS])}"), keys[i:i+1000])
            records[PK_COLS + ['row_hash']].to_sql(DB_CONF['table_hash_map'], conn, if_exists='append', index=False, chunksize=1000)

    if not to_delete.empty:
        keys_del = to_delete.index.to_frame(index=False).to_dict('records')
        with engine.connect() as conn:
            targets = [DB_CONF['table_monitor_os'], DB_CONF['table_monitor_sp'], DB_CONF['table_hash_map']]
            conn.execute(text(f"INSERT INTO {DB_CONF['table_del_queue']} ({', '.join(PK_COLS)}) VALUES ({', '.join([':'+k for k in PK_COLS])})"), keys_del)
            for tbl in targets:
                for i in range(0, len(keys_del), 1000):
                    conn.execute(text(f"DELETE FROM {tbl} WHERE {' AND '.join([f'{k}=:{k}' for k in PK_COLS])}"), keys_del[i:i+1000])

def main():
    log("=== Sincronizador v6 (Auto-Alter Table) ===")
    engine = get_mysql_engine()
    auto_setup_infrastructure(engine)
    log("Iniciando Ciclo Contínuo...")
    while True:
        try:
            sync_mdb_to_monitor(engine)
            sync_internal_monitor_to_main(engine)
            time.sleep(CONFIG_FULL['sync_andamento']['interval'])
        except KeyboardInterrupt: break
        except Exception as e:
            log(f"\nErro Loop: {e}")
            time.sleep(10)

if __name__ == "__main__":
    main()
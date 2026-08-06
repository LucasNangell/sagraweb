import mysql.connector
import pyodbc
import time
import logging
import sqlite3
import json
import os
import sys
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)
from config_manager import config_manager
import traceback
import hashlib  # <--- IMPORTANTE PARA O HASH ESTÁVEL
from datetime import datetime, date

# --- CONFIGURAÇÃO ---

MYSQL_CONFIG = config_manager.get_mysql_config()

_paths = config_manager.get_mdb_paths()
MDB_PATH_RECENT = _paths['papelaria'] # OS >= 5000
MDB_PATH_OLD = _paths['os_atual']    # OS < 5000

TABLES_CONFIG = {
    'tabprotocolos': {
        'pk': ['NroProtocolo', 'AnoProtocolo'], 
        'mdb_table': 'tabprotocolos'
    },
    'tabdetalhesservico': {
        'pk': ['NroProtocoloLinkDet', 'AnoProtocoloLinkDet'], 
        'mdb_table': 'tabdetalhesservico'
    }
}

IGNORE_COLUMNS = ['CampoCalculadoExemplo']

# --- LOGGING ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', datefmt='%H:%M:%S')
logger = logging.getLogger()

# --- ESTADO E MEMÓRIA ---
def init_state_db():
    conn = sqlite3.connect('sync_state.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS record_hash (
                    table_name TEXT,
                    record_id TEXT, 
                    data_hash TEXT,
                    last_check DATETIME,
                    PRIMARY KEY (table_name, record_id)
                )''')
    conn.commit()
    conn.close()

def load_state_cache(table_name):
    """
    OTIMIZAÇÃO: Carrega TODOS os hashes da tabela para a memória RAM.
    Evita 7000 consultas SQL por ciclo.
    Retorna: Dict { 'record_id': 'hash' }
    """
    conn = sqlite3.connect('sync_state.db')
    c = conn.cursor()
    c.execute("SELECT record_id, data_hash FROM record_hash WHERE table_name = ?", (table_name,))
    data = dict(c.fetchall())
    conn.close()
    return data

def update_state_batch(buffer_updates):
    """
    OTIMIZAÇÃO: Salva alterações no SQLite em lote (Batch).
    buffer_updates = [(table, id, hash, time), ...]
    """
    if not buffer_updates: return
    conn = sqlite3.connect('sync_state.db')
    c = conn.cursor()
    c.executemany("INSERT OR REPLACE INTO record_hash (table_name, record_id, data_hash, last_check) VALUES (?, ?, ?, ?)", buffer_updates)
    conn.commit()
    conn.close()

# --- HASH ESTÁVEL (CORREÇÃO DE FALSOS NOVOS) ---
def stable_hash(data_dict):
    """
    Cria um MD5 estável. O hash() do Python muda a cada restart.
    O MD5 é sempre igual para os mesmos dados.
    """
    # Converte tudo para string de forma determinística
    clean_dict = {}
    for k, v in data_dict.items():
        if v is None:
            clean_dict[k] = ""
        else:
            clean_dict[k] = str(v)
            
    # Cria JSON ordenado
    s = json.dumps(clean_dict, sort_keys=True)
    return hashlib.md5(s.encode('utf-8')).hexdigest()

# --- CONEXÕES ---
def get_mysql_conn():
    return mysql.connector.connect(**MYSQL_CONFIG)

def get_access_conn(os_number):
    try:
        os_num = int(os_number)
    except:
        os_num = 999999 
    
    db_path = MDB_PATH_RECENT if os_num >= 5000 else MDB_PATH_OLD
    
    if not os.path.exists(db_path):
        if os.path.exists(MDB_PATH_OLD):
            db_path = MDB_PATH_OLD
        else:
            raise FileNotFoundError(f"MDB não encontrado: {db_path}")

    return pyodbc.connect(f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={db_path};")

def get_columns_robust(mysql_conn, table_mysql, table_mdb):
    temp_cursor = mysql_conn.cursor() 
    temp_cursor.execute(f"DESCRIBE {table_mysql}")
    mysql_cols = [row[0].lower() for row in temp_cursor.fetchall()]
    temp_cursor.close()
    
    mdb_cols = []
    try:
        cn = get_access_conn(999999)
        cur = cn.cursor()
        cur.execute(f"SELECT * FROM [{table_mdb}] WHERE 1=0")
        if cur.description:
            mdb_cols = [col[0].lower() for col in cur.description]
        cn.close()
    except Exception:
        # Silencioso no log para não poluir, assume MySQL
        return [c for c in mysql_cols if c not in [x.lower() for x in IGNORE_COLUMNS]]

    if not mdb_cols:
        return [c for c in mysql_cols if c not in [x.lower() for x in IGNORE_COLUMNS]]

    common = set(mysql_cols).intersection(set(mdb_cols))
    return [c for c in common if c not in [x.lower() for x in IGNORE_COLUMNS]]

# --- COMPARAÇÃO INTELIGENTE ---
def normalize_val(v):
    if v is None: return ""
    s = str(v).strip()
    if s.lower() in ['none', 'null']: return ""
    if s == "00:00:00": return "" 
    return s

def smart_compare(val_mysql, val_mdb):
    nm = normalize_val(val_mysql)
    na = normalize_val(val_mdb)

    if nm == na: return True

    if "00:00:00" in nm and na and " " not in na:
        if nm.split(" ")[0] == na: return True
    if "00:00:00" in na and nm and " " not in nm:
        if na.split(" ")[0] == nm: return True

    truthy = ['1', 'true', '-1', 'yes', 'sim']
    falsy = ['0', 'false', 'no', 'nao']
    if nm.lower() in truthy and na.lower() in truthy: return True
    if nm.lower() in falsy and na.lower() in falsy: return True

    try:
        if abs(float(nm) - float(na)) < 0.0001: return True
    except: pass

    return False

# --- SYNC CORE ---
def sync_row(row_data, table_info):
    pk_cols = table_info['pk']
    table_mdb = table_info['mdb_table']
    
    try:
        os_number_val = row_data[pk_cols[0]] 
        pk_values = [row_data[c] for c in pk_cols]
    except KeyError:
        return False, None

    try:
        cn_mdb = get_access_conn(os_number_val)
    except Exception:
        return False, None
        
    if not cn_mdb: return False, None
    cursor_mdb = cn_mdb.cursor()

    try:
        where_clause = " AND ".join([f"[{c}] = ?" for c in pk_cols])
        cursor_mdb.execute(f"SELECT * FROM [{table_mdb}] WHERE {where_clause}", pk_values)
        row_mdb = cursor_mdb.fetchone()

        changed_fields = []
        exists = False

        if row_mdb:
            exists = True
            mdb_data = {col[0].lower(): val for col, val in zip(cursor_mdb.description, row_mdb)}
            for col, val_mysql in row_data.items():
                val_mdb = mdb_data.get(col.lower())
                if not smart_compare(val_mysql, val_mdb):
                    changed_fields.append(col)
            
            if not changed_fields:
                return True, [] 

        else:
            changed_fields = ["(NOVO REGISTRO)"]

        cols = list(row_data.keys())
        vals = list(row_data.values())

        if exists:
            set_clause = ", ".join([f"[{c}] = ?" for c in cols])
            sql = f"UPDATE [{table_mdb}] SET {set_clause} WHERE {where_clause}"
            params = vals + pk_values
        else:
            col_placeholders = ", ".join([f"[{c}]" for c in cols])
            val_placeholders = ", ".join(["?" for _ in cols])
            sql = f"INSERT INTO [{table_mdb}] ({col_placeholders}) VALUES ({val_placeholders})"
            params = vals

        try:
            cursor_mdb.execute(sql, params)
            cn_mdb.commit()
        except pyodbc.Error:
            cn_mdb.rollback()
            if exists: 
                success_partial = []
                for c, v in zip(cols, vals):
                    try:
                        sql_retry = f"UPDATE [{table_mdb}] SET [{c}] = ? WHERE {where_clause}"
                        cursor_mdb.execute(sql_retry, [v] + pk_values)
                        cn_mdb.commit()
                        success_partial.append(c)
                    except: pass
                changed_fields = [c for c in changed_fields if c in success_partial]

        return True, changed_fields

    except Exception as e:
        logger.error(f"Erro Access {pk_values}: {e}")
        return False, None
    finally:
        cursor_mdb.close()
        cn_mdb.close()

# --- LOOP PRINCIPAL ---

def main():
    init_state_db()
    first_run = True
    
    logger.info("Iniciando serviço Sagra (v10 - Rápido & Estável)...")

    cached_columns = {}

    while True:
        try:
            cn_mysql = get_mysql_conn()
            cursor_mysql = cn_mysql.cursor(dictionary=True)

            # Buffer para atualizações do SQLite (para gravar tudo de uma vez no final do ciclo)
            state_updates_buffer = []

            for tbl_name, info in TABLES_CONFIG.items():
                pk_cols = info['pk']
                col_ano = pk_cols[1] 

                # 1. Carrega dados do MySQL
                query = f"SELECT * FROM {tbl_name} WHERE {col_ano} >= 2024"
                cursor_mysql.execute(query)
                results = cursor_mysql.fetchall()
                
                # 2. Carrega Cache de Estado (RAM) - SUPER RÁPIDO
                state_cache = load_state_cache(tbl_name)
                
                total = len(results)
                logger.info(f"{tbl_name}: Verificando {total} registros (Via Cache RAM)...")

                if tbl_name not in cached_columns:
                    cached_columns[tbl_name] = get_columns_robust(cn_mysql, tbl_name, info['mdb_table'])
                common_cols = cached_columns[tbl_name]

                count_updates = 0
                count_news = 0

                for row in results:
                    composite_id = f"{row[pk_cols[0]]}_{row[pk_cols[1]]}"
                    
                    # Gera MD5 estável
                    curr_hash = stable_hash(row)
                    
                    # Busca no Dicionário da Memória (Instantâneo)
                    stored_hash = state_cache.get(composite_id)

                    # Lógica de Decisão
                    needs_sync = False
                    is_first_index = False

                    if stored_hash is None:
                        # Nunca visto antes
                        if first_run:
                            # Apenas indexa, não grava no Access
                            is_first_index = True
                        else:
                            needs_sync = True
                    elif stored_hash != curr_hash:
                        # Mudou conteúdo
                        needs_sync = True

                    # Ação
                    if is_first_index:
                        state_updates_buffer.append((tbl_name, composite_id, curr_hash, datetime.now()))
                    
                    elif needs_sync:
                        clean_data = {k: v for k, v in row.items() if k.lower() in common_cols}
                        ok, changes = sync_row(clean_data, info)
                        
                        if ok:
                            # Adiciona ao buffer para salvar no SQLite
                            state_updates_buffer.append((tbl_name, composite_id, curr_hash, datetime.now()))
                            
                            if changes:
                                action = "NOVO" if "(NOVO REGISTRO)" in changes else "UPDATE"
                                logger.info(f"Sync {action}: {tbl_name} [{composite_id}] | Alterações: {changes}")
                                if action == "NOVO": count_news += 1
                                else: count_updates += 1
                            else:
                                # Falso positivo do Hash (dados iguais na prática) -> Atualiza hash e silencia
                                pass

                if count_news > 0 or count_updates > 0:
                    logger.info(f"Resumo {tbl_name}: {count_news} novos, {count_updates} atualizados.")

            # Grava estado no SQLite em lote (Muito mais rápido que 1 por 1)
            if state_updates_buffer:
                update_state_batch(state_updates_buffer)

            cursor_mysql.close()
            cn_mysql.close()
            
            if first_run:
                first_run = False
                logger.info("-" * 50)
                logger.info("Monitoramento iniciado")
                logger.info("-" * 50)

            time.sleep(60)

        except Exception:
            logger.error("ERRO CRÍTICO NO LOOP PRINCIPAL:")
            logger.error(traceback.format_exc())
            time.sleep(30)

if __name__ == "__main__":
    main()
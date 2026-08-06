import pandas as pd
import pyodbc
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.mysql import insert
import time
from datetime import datetime
import urllib.parse
import sys
import warnings
import yaml
import os
import sys
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)
from config_manager import config_manager

# Suprimir avisos do Pandas
warnings.filterwarnings('ignore')

# --- CARREGAMENTO DE CONFIGURAÇÃO ---
def load_config(yaml_file="sync_conf.yaml", section="monitor_detalhes_sp"):
    if not os.path.exists(yaml_file):
        print(f"ERRO CRÍTICO: Arquivo de configuração '{yaml_file}' não encontrado.")
        sys.exit(1)

    try:
        with open(yaml_file, 'r', encoding='utf-8') as f:
            full_config = yaml.safe_load(f)
        
        if section not in full_config:
            if "monitor_detalhes_sp" in full_config:
                 return full_config["monitor_detalhes_sp"]
            print(f"ERRO CRÍTICO: Seção '{section}' não encontrada no arquivo '{yaml_file}'.")
            sys.exit(1)
            
        return full_config[section]
    except Exception as e:
        print(f"ERRO ao ler arquivo de configuração: {e}")
        sys.exit(1)

# Carrega configurações
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "sync_conf.yaml")
CONFIG = load_config(CONFIG_FILE, "monitor_detalhes_sp")

MDB_PATH = CONFIG['mdb_path']
TABLE_NAME_SOURCE = CONFIG['table_source']
TABLE_NAME_TARGET = CONFIG['table_target']
PK_COLS = CONFIG['pk_columns']
MYSQL_CONF = CONFIG['mysql']
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
MDB_PATH = _override_mdb_path(MDB_PATH)

# --- FUNÇÕES DE CONEXÃO ---

def get_access_connection_read():
    """Conexão LEVE (ReadOnly=1) para leitura contínua."""
    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={MDB_PATH};"
        r"ReadOnly=1;" 
        r"Exclusive=0;" 
        r"Mode=Share Deny None;"
    )
    return pyodbc.connect(conn_str)

def get_access_connection_write():
    """Conexão DE ESCRITA (ReadOnly=0) para Reverse Sync."""
    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={MDB_PATH};"
        r"ReadOnly=0;" 
        r"Exclusive=0;"
        r"Mode=Share Deny None;"
    )
    return pyodbc.connect(conn_str)

def get_mysql_engine():
    connection_string = f"mysql+pymysql://{MYSQL_CONF['user']}:{urllib.parse.quote_plus(MYSQL_CONF['password'])}@{MYSQL_CONF['host']}:{MYSQL_CONF['port']}/{MYSQL_CONF['database']}"
    return create_engine(connection_string, pool_recycle=3600)

# --- REVERSE SYNC (MODIFICADO) ---

def process_reverse_sync(mysql_engine):
    """Verifica se há registros com sync=1 no MySQL e atualiza o Access campo a campo."""
    try:
        query_pending = f"SELECT * FROM {TABLE_NAME_TARGET} WHERE sync = 1 AND AnoProtocoloLinkDet >= 2024"
        df_pending = pd.read_sql(query_pending, mysql_engine)
        
        if df_pending.empty:
            return

        print(f"[{datetime.now()}] REVERSE SYNC: {len(df_pending)} registros para processar.")

        mdb_conn = get_access_connection_write()
        mdb_cursor = mdb_conn.cursor()
        mysql_conn = mysql_engine.connect()
        
        try:
            for index, row in df_pending.iterrows():
                # Colunas editáveis (ignorando metadados e PKs)
                cols_to_update = [c for c in row.index if c not in ['sync', 'lastupdate'] and c not in PK_COLS]
                if not cols_to_update: continue

                # Identificadores para logs e WHERE
                pk_display = "/".join([str(row[pk]) for pk in PK_COLS])
                
                # Prepara cláusula WHERE (comum a todos os campos desta linha)
                where_clause = " AND ".join([f"[{pk}] = ?" for pk in PK_COLS])
                pk_params = [row[pk] for pk in PK_COLS]

                error_log = []
                success_count = 0

                # --- ATUALIZAÇÃO CAMPO A CAMPO ---
                for col in cols_to_update:
                    try:
                        # Tratamento especial para campos tipo Lookup/String que exigem injeção direta
                        if col in ["FormatoLink", "TipoPublicacaoLink", "MaquinaLink", "PapelLink", "Cores"]:
                            val_to_write = row[col]
                            
                            # Lógica inteligente de tipos para evitar Data Type Mismatch no Access
                            if val_to_write is None:
                                sql_val = "NULL"
                            elif isinstance(val_to_write, (int, float)) and not isinstance(val_to_write, bool):
                                sql_val = str(val_to_write)
                            else:
                                # String (ou outros tipos convertidos para string)
                                val_str = str(val_to_write)
                                safe_val = val_str.replace("'", "''")
                                sql_val = f"'{safe_val}'"
                            
                            sql_update_field = f"UPDATE [{TABLE_NAME_SOURCE}] SET [{col}] = {sql_val} WHERE {where_clause}"
                            params = pk_params
                        else:
                            # Método padrão
                            sql_update_field = f"UPDATE [{TABLE_NAME_SOURCE}] SET [{col}] = ? WHERE {where_clause}"
                            params = [row[col]] + pk_params

                        mdb_cursor.execute(sql_update_field, params)
                        success_count += 1
                    
                    except Exception as field_err:
                        # Loga o erro mas NÃO para o script
                        error_msg = str(field_err).replace('\n', ' ')
                        error_log.append(f"Campo '{col}': {error_msg}")

                # Commitamos o que deu certo nesta linha
                if success_count > 0:
                    mdb_conn.commit()

                # --- RELATÓRIO E FINALIZAÇÃO ---
                if error_log:
                    print(f"[{datetime.now()}] AVISO PARCIAL ID {pk_display}:")
                    for err in error_log:
                        print(f"   -> ERRO IGNORADO: {err}")
                    if success_count > 0:
                        print(f"   -> Outros {success_count} campos foram atualizados com sucesso.")
                elif success_count > 0:
                    print(f"[{datetime.now()}] MDB ATUALIZADO: ID {pk_display} OK.")

                # Atualiza MySQL (sync = 0) 
                # Fazemos isso mesmo se houver erro, para evitar loop infinito tentando gravar dado inválido.
                try:
                    pk_conditions = " AND ".join([f"{pk} = :{pk}" for pk in PK_COLS])
                    sql_update_mysql = text(f"UPDATE {TABLE_NAME_TARGET} SET sync = 0, lastupdate = :now WHERE {pk_conditions}")
                    
                    params_mysql = {pk: row[pk] for pk in PK_COLS}
                    params_mysql['now'] = datetime.now()
                    mysql_conn.execute(sql_update_mysql, params_mysql)
                    mysql_conn.commit()
                except Exception as mysql_err:
                    print(f"[{datetime.now()}] ERRO AO BAIXAR FLAG SYNC MYSQL: {mysql_err}")

        finally:
            mdb_conn.close()
            mysql_conn.close()
            
    except Exception as e:
        print(f"[{datetime.now()}] ERRO GERAL REVERSE SYNC: {e}")

# --- FUNÇÕES CORE ---

def get_data_from_mdb():
    conn = get_access_connection_read()
    try:
        query = f"SELECT * FROM [{TABLE_NAME_SOURCE}] WHERE AnoProtocoloLinkDet >= 2024"
        df = pd.read_sql(query, conn)
        return df
    finally:
        conn.close()

def get_data_from_mysql(engine):
    try:
        query = f"SELECT * FROM {TABLE_NAME_TARGET} WHERE AnoProtocoloLinkDet >= 2024"
        df = pd.read_sql(query, engine)
        cols_to_drop = ['lastupdate', 'sync']
        df = df.drop(columns=[c for c in cols_to_drop if c in df.columns], errors='ignore')
        return df
    except Exception:
        return pd.DataFrame()

def setup_database_structure(df_structure, engine):
    df_structure['lastupdate'] = datetime.now()
    df_structure['sync'] = False
    df_structure.head(0).to_sql(TABLE_NAME_TARGET, engine, if_exists='replace', index=False)
    with engine.connect() as conn:
        pk_string = ", ".join(PK_COLS)
        pk_sql = f"ALTER TABLE {TABLE_NAME_TARGET} ADD PRIMARY KEY ({pk_string});"
        conn.execute(text(pk_sql))
        conn.commit()

def upsert_batch(engine, df_to_upsert):
    if df_to_upsert.empty: return
    
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for _, row in df_to_upsert.iterrows():
                where_clauses = [f"{pk} = :p_{pk}" for pk in PK_COLS]
                where_sql = " AND ".join(where_clauses)
                params = {f"p_{pk}": row[pk] for pk in PK_COLS}
                sql_delete = text(f"DELETE FROM {TABLE_NAME_TARGET} WHERE {where_sql}")
                conn.execute(sql_delete, params)
            
            df_to_upsert.to_sql(TABLE_NAME_TARGET, conn, if_exists='append', index=False)
            trans.commit()
        except Exception as e:
            trans.rollback()
            print(f"Erro ao gravar lote: {e}")
            raise

def clean_float_misinterpretation(df):
    """
    Transforma colunas float que são inteiras em Int64 para evitar loops.
    """
    for col in df.select_dtypes(include=['float']).columns:
        if df[col].dropna().apply(lambda x: x.is_integer()).all():
            df[col] = df[col].astype('Int64')
    return df

def main():
    print(f"[{datetime.now()}] --- Script Iniciado ---")
    print(f"[{datetime.now()}] Configuração carregada: {CONFIG_FILE}")
    print(f"[{datetime.now()}] Monitorando Banco: {MDB_PATH}")
    
    mysql_engine = get_mysql_engine()
    first_run = True
    
    while True:
        try:
            # 0. REVERSE SYNC
            if not first_run:
                process_reverse_sync(mysql_engine)

            # 1. Ler Access
            df_mdb = get_data_from_mdb()
            df_mdb = df_mdb.infer_objects() 
            df_mdb = clean_float_misinterpretation(df_mdb)

            if first_run:
                print(f"[{datetime.now()}] Iniciando Carga Inicial...")
                setup_database_structure(df_mdb, mysql_engine)
                df_mdb['lastupdate'] = datetime.now()
                df_mdb['sync'] = False
                df_mdb.to_sql(TABLE_NAME_TARGET, mysql_engine, if_exists='append', index=False, chunksize=1000)
                print(f"[{datetime.now()}] Carga Inicial Concluída. {len(df_mdb)} registros.")
                first_run = False
            else:
                # 2. Ler MySQL
                df_mysql = get_data_from_mysql(mysql_engine)
                df_mysql = clean_float_misinterpretation(df_mysql)
                
                # 3. Índices
                df_mdb.set_index(PK_COLS, inplace=True)
                df_mysql.set_index(PK_COLS, inplace=True)
                
                # 4. Comparação
                common_cols = df_mdb.columns.intersection(df_mysql.columns)
                new_rows_mask = ~df_mdb.index.isin(df_mysql.index)
                common_index = df_mdb.index.intersection(df_mysql.index)
                
                df_mdb_common = df_mdb.loc[common_index, common_cols]
                df_mysql_common = df_mysql.loc[common_index, common_cols]
                
                # CORREÇÃO: Converter para object antes de fillna('NULL')
                df_mdb_comp = df_mdb_common.astype(object)
                df_mysql_comp = df_mysql_common.astype(object)
                
                diff_mask = (df_mdb_comp.fillna('NULL') != df_mysql_comp.fillna('NULL')).any(axis=1)
                
                rows_to_update = df_mdb_common[diff_mask].copy()
                rows_to_insert = df_mdb[new_rows_mask].copy()
                
                total_changes = pd.concat([rows_to_update, rows_to_insert])
                
                if not total_changes.empty:
                    total_changes.reset_index(inplace=True)
                    print(f"[{datetime.now()}] Detectadas {len(total_changes)} alterações.")
                    
                    for idx, row in total_changes.head(5).iterrows():
                        pk_display = "/".join([str(row[pk]) for pk in PK_COLS])
                        print(f"Sincronizando ID: {pk_display}")
                    
                    total_changes['lastupdate'] = datetime.now()
                    total_changes['sync'] = False
                    
                    upsert_batch(mysql_engine, total_changes)
                    print(f"[{datetime.now()}] Sincronização concluída.")
            
            time.sleep(5)
            
        except Exception as e:
            print(f"[{datetime.now()}] ERRO NO CICLO: {e}")
            time.sleep(10)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nMonitoramento encerrado.")
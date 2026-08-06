import pandas as pd
import pyodbc
from sqlalchemy import create_engine, text
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
import multiprocessing
import random

# --- CONFIGURAÇÃO GLOBAL ---
# Suprimir avisos do Pandas
warnings.filterwarnings('ignore')

# --- FUNÇÕES AUXILIARES ---

def load_full_config(yaml_file="sync_conf.yaml"):
    if not os.path.exists(yaml_file):
        print(f"ERRO CRÍTICO: Arquivo '{yaml_file}' não encontrado.")
        sys.exit(1)
    try:
        with open(yaml_file, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    except Exception as e:
        print(f"ERRO ao ler YAML: {e}")
        sys.exit(1)

def clean_float_misinterpretation(df):
    """Transforma colunas float que são inteiras em Int64."""
    for col in df.select_dtypes(include=['float']).columns:
        if df[col].dropna().apply(lambda x: x.is_integer()).all():
            df[col] = df[col].astype('Int64')
    return df

def _override_mdb_path(path):
    if not path:
        return path
    if 'OS Atual.mdb' in path:
        return config_manager.get('mdb_os_atual_path', path)
    if 'Papelaria Atual.mdb' in path:
        return config_manager.get('mdb_papelaria_path', path)
    return path

def get_mysql_engine(mysql_conf):
    conn_str = f"mysql+pymysql://{mysql_conf['user']}:{urllib.parse.quote_plus(mysql_conf['password'])}@{mysql_conf['host']}:{mysql_conf['port']}/{mysql_conf['database']}"
    return create_engine(conn_str, pool_recycle=3600, pool_pre_ping=True)

def get_access_conn(mdb_path, readonly=True):
    read_flag = 1 if readonly else 0
    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={mdb_path};"
        f"ReadOnly={read_flag};" 
        r"Exclusive=0;" 
        r"Mode=Share Deny None;"
    )
    return pyodbc.connect(conn_str)

def safe_close(obj):
    if obj:
        try:
            obj.close()
        except Exception:
            pass

def log(name, msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] [{name}] {msg}")

# --- LÓGICA DO PROCESSO (WORKER) ---
# Esta função roda em um processo separado, com memória isolada
def run_worker_process(name, config, file_lock):
    # Configuração inicial do processo
    pyodbc.pooling = False # Desativa pooling neste processo
    
    # Extrai configurações
    mdb_path = config['mdb_path']
    table_source = config['table_source']
    table_target = config['table_target']
    pk_cols = config['pk_columns']
    mysql_conf = config['mysql']
    central_mysql = config_manager.get_mysql_config()
    mysql_conf.update({
        'host': central_mysql['host'],
        'port': central_mysql['port'],
        'user': central_mysql['user'],
        'password': central_mysql['password'],
        'database': central_mysql['database'],
    })
    mdb_path = _override_mdb_path(mdb_path)
    
    # Cria engine MySQL (dedicada a este processo)
    engine = get_mysql_engine(mysql_conf)
    first_run = True
    
    # Delay inicial aleatório para não baterem todos juntos
    time.sleep(random.uniform(1, 5))
    log(name, "Monitoramento iniciado (PID: {}).".format(os.getpid()))

    while True:
        conn = None
        try:
            # --- 0. REVERSE SYNC (Escrita no Access) ---
            if not first_run:
                # Ler MySQL (Leve, sem lock de arquivo)
                query_pending = f"SELECT * FROM {table_target} WHERE sync = 1"
                try:
                    df_pending = pd.read_sql(query_pending, engine)
                except Exception as e:
                    # Se falhar conexão mysql, ignora e tenta na proxima
                    df_pending = pd.DataFrame() 

                if not df_pending.empty:
                    log(name, f"REVERSE SYNC: {len(df_pending)} registros pendentes.")
                    
                    # LOCK DE ARQUIVO (Multiprocessing Lock)
                    with file_lock:
                        mdb_conn = None
                        mysql_conn = None
                        try:
                            mdb_conn = get_access_conn(mdb_path, readonly=False)
                            mdb_cursor = mdb_conn.cursor()
                            mysql_conn = engine.connect()

                            for index, row in df_pending.iterrows():
                                cols_to_update = [c for c in row.index if c not in ['sync', 'lastupdate'] and c not in pk_cols]
                                if not cols_to_update: continue

                                where_clause = " AND ".join([f"[{pk}] = ?" for pk in pk_cols])
                                pk_params = [row[pk] for pk in pk_cols]
                                
                                success_count = 0
                                
                                # Tenta atualizar campo a campo
                                for col in cols_to_update:
                                    try:
                                        sql_up = f"UPDATE [{table_source}] SET [{col}] = ? WHERE {where_clause}"
                                        params = [row[col]] + pk_params
                                        mdb_cursor.execute(sql_up, params)
                                        success_count += 1
                                    except Exception:
                                        pass # Ignora erro de campo individual

                                if success_count > 0:
                                    mdb_conn.commit()

                                # Baixa flag no MySQL
                                pk_cond = " AND ".join([f"{pk} = :{pk}" for pk in pk_cols])
                                sql_mysql = text(f"UPDATE {table_target} SET sync = 0, lastupdate = :now WHERE {pk_cond}")
                                p_mysql = {pk: row[pk] for pk in pk_cols}
                                p_mysql['now'] = datetime.now()
                                mysql_conn.execute(sql_mysql, p_mysql)
                                mysql_conn.commit()
                                
                        finally:
                            safe_close(mdb_conn)
                            safe_close(mysql_conn)

            # --- 1. LER ACCESS (Leitura da Fonte) ---
            df_mdb = None
            
            # LOCK DE ARQUIVO (Multiprocessing Lock)
            with file_lock:
                try:
                    conn = get_access_conn(mdb_path, readonly=True)
                    query = f"SELECT * FROM [{table_source}]"
                    df_mdb = pd.read_sql(query, conn)
                finally:
                    safe_close(conn)
            
            # Processamento (Fora do Lock)
            if df_mdb is not None:
                df_mdb = clean_float_misinterpretation(df_mdb.infer_objects())

                if first_run:
                    log(name, "Iniciando Carga Inicial...")
                    # Setup estrutura
                    df_mdb['lastupdate'] = datetime.now()
                    df_mdb['sync'] = False
                    
                    # Cria tabela vazia se não existir
                    df_mdb.head(0).to_sql(table_target, engine, if_exists='replace', index=False)
                    
                    # PK e Carga
                    with engine.connect() as k_conn:
                        try:
                            pk_str = ", ".join(pk_cols)
                            k_conn.execute(text(f"ALTER TABLE {table_target} ADD PRIMARY KEY ({pk_str});"))
                            k_conn.commit()
                        except:
                            pass # PK já existe ou erro ignoravel na carga

                    df_mdb.to_sql(table_target, engine, if_exists='append', index=False, chunksize=1000)
                    log(name, f"Carga completa: {len(df_mdb)} registros.")
                    first_run = False
                else:
                    # Comparação Delta
                    df_mysql = pd.read_sql(f"SELECT * FROM {table_target}", engine)
                    df_mysql = df_mysql.drop(columns=['lastupdate', 'sync'], errors='ignore')
                    df_mysql = clean_float_misinterpretation(df_mysql)

                    df_mdb.set_index(pk_cols, inplace=True)
                    df_mysql.set_index(pk_cols, inplace=True)

                    common_idx = df_mdb.index.intersection(df_mysql.index)
                    common_cols = df_mdb.columns.intersection(df_mysql.columns)
                    
                    df_m_comp = df_mdb.loc[common_idx, common_cols].astype(object).fillna('NULL')
                    df_s_comp = df_mysql.loc[common_idx, common_cols].astype(object).fillna('NULL')
                    
                    # Detecta Mudanças
                    diff_mask = (df_m_comp != df_s_comp).any(axis=1)
                    updates = df_mdb.loc[common_idx][diff_mask].copy()
                    inserts = df_mdb[~df_mdb.index.isin(df_mysql.index)].copy()
                    
                    changes = pd.concat([updates, inserts])

                    if not changes.empty:
                        changes.reset_index(inplace=True)
                        log(name, f"Detectadas {len(changes)} alterações.")
                        changes['lastupdate'] = datetime.now()
                        changes['sync'] = False
                        
                        # Upsert Batch
                        with engine.connect() as upsert_conn:
                            trans = upsert_conn.begin()
                            try:
                                for _, row in changes.iterrows():
                                    w_sql = " AND ".join([f"{pk} = :p_{pk}" for pk in pk_cols])
                                    params = {f"p_{pk}": row[pk] for pk in pk_cols}
                                    upsert_conn.execute(text(f"DELETE FROM {table_target} WHERE {w_sql}"), params)
                                changes.to_sql(table_target, upsert_conn, if_exists='append', index=False)
                                trans.commit()
                                log(name, "Sincronizado com sucesso.")
                            except Exception as e:
                                trans.rollback()
                                log(name, f"Erro ao gravar: {e}")

            time.sleep(5)

        except Exception as e:
            log(name, f"ERRO CICLO (PID {os.getpid()}): {e}")
            time.sleep(10)

# --- MASTER RUNNER ---

def main():
    # Fix necessário para Windows evitar spawn recursivo infinito
    multiprocessing.freeze_support() 
    
    print(f"[{datetime.now()}] --- SYNC MASTER (MULTIPROCESSING) INICIADO ---")
    
    config_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync_conf.yaml")
    full_config = load_full_config(config_file)
    
    # Gerenciador de Locks por Arquivo
    # Mapeia caminho_do_mdb -> Lock do Processo
    path_locks = {}
    processes = []
    
    for section, conf_data in full_config.items():
        if isinstance(conf_data, dict) and 'mdb_path' in conf_data:
            mdb_path = conf_data['mdb_path']
            
            # Cria um lock único para este arquivo se não existir
            if mdb_path not in path_locks:
                path_locks[mdb_path] = multiprocessing.Lock()
            
            file_lock = path_locks[mdb_path]
            
            # Cria o PROCESSO (não Thread)
            p = multiprocessing.Process(
                target=run_worker_process, 
                args=(section, conf_data, file_lock),
                name=section
            )
            p.daemon = True # Mata processos filhos se o pai morrer
            p.start()
            processes.append(p)
            print(f"-> Processo iniciado para: {section} (PID: {p.pid})")
    
    print(f"[{datetime.now()}] Total de {len(processes)} processos rodando.")
    print("Pressione Ctrl+C para encerrar todos.")

    try:
        while True:
            time.sleep(1)
            # Verifica se algum processo morreu
            for p in processes:
                if not p.is_alive():
                    print(f"AVISO: Processo {p.name} morreu! O script principal continua...")
    except KeyboardInterrupt:
        print("\nEncerrando Master e matando processos filhos...")

if __name__ == "__main__":
    main()
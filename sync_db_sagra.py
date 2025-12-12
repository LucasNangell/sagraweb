import pyodbc
import pymysql
import sys
import logging
import time
import datetime
from config_manager import config_manager
import warnings

# --- CONFIGURAÇÃO E CONSTANTES ---
# Colunas-chave para substituição se necessário (PLACEHOLDERS)
COL_ID_PROTOCOLO = "NroProtocolo"
COL_ANO_PROTOCOLO = "AnoProtocolo"
COL_ID_ANDAMENTO = "CodStatus"
COL_DATA_ANDAMENTO = "Data"
COL_LINK_PROTOCOLO = "NroProtocoloLink"
COL_LINK_ANO = "AnoProtocoloLink"
COL_OBS = "Observaçao"

import re # Importando regex para parsing de hora

# Caminhos dos Bancos Access
ACCESS_DB_OS = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb"
ACCESS_DB_PAPELARIA = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb"

# Configuração de Log
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("sync_sagra.log", encoding='utf-8')
    ]
)

warnings.filterwarnings("ignore")

# --- FUNÇÕES DE CONEXÃO ---

def get_mysql_conn():
    """Retorna conexão com MySQL (sagrafulldb)."""
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
    """Retorna conexão com Access usando pyodbc."""
    # Drivers comuns: Microsoft Access Driver (*.mdb, *.accdb)
    # Se falhar, pode ser necessário instalar o Access Database Engine 2010 ou 2016 Redistributable (32-bit vs 64-bit)
    conn_str = r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + db_path + ";"
    return pyodbc.connect(conn_str)

# --- HELPER FUNCTIONS ---

def get_today_date():
    return datetime.date.today()

def get_correct_access_db(os_id):
    """Retorna o caminho do banco Access correto baseado na regra do ID 5000."""
    if os_id > 5000:
        return ACCESS_DB_PAPELARIA
    return ACCESS_DB_OS

import traceback

# ... imports ...

# ... (omitted code) ...

def clean_row(row, columns):
    """Converte linha de BD para dict e limpa tipos para compatibilidade."""
    d = {}
    is_dict = isinstance(row, dict)
    
    for i, col in enumerate(columns):
        if is_dict:
            val = row.get(col)
        else:
            try:
                val = row[i]
            except IndexError:
                val = None
                
        # Tratamento de datas e None
        if val is None:
            d[col] = None
        elif isinstance(val, (datetime.date, datetime.datetime)):
            d[col] = val
        else:
            d[col] = val
    return d

def fetch_all_as_dict(cursor, query, params=None):
    """Executa query e retorna lista de dicts."""
    cursor.execute(query, params or [])
    cols = [column[0] for column in cursor.description]
    results = []
    for row in cursor.fetchall():
        results.append(clean_row(row, cols))
    return results

# --- LÓGICA DE SINCRONIZAÇÃO (CORE) ---


def parse_obs_time(obs_text):
    """Extrai hora de string '... 14h30 ...' e retorna datetime.time ou None."""
    if not obs_text: return None
    match = re.search(r'(\d{1,2})h(\d{2})', str(obs_text))
    if match:
        try:
            h, m = int(match.group(1)), int(match.group(2))
            return datetime.time(h, m)
        except:
            return None
    return None

def discover_changed_os_ids_today(since_datetime=None):
    """
    Fase 1: Consulta tabandamento nos 3 bancos buscando registros de HOJE.
    Filtra por hora no campo 'Obs' se since_datetime for fornecido.
    Retorna um SET de tuplas (NroProtocolo, AnoProtocolo) e o maior timestamp encontrado.
    """
    changed_os = set()
    today = get_today_date()
    max_found_dt = since_datetime if since_datetime else datetime.datetime.combine(today, datetime.time.min)

    # Helper para processar rows
    def process_rows(rows, source_name):
        nonlocal max_found_dt
        count = 0
        for row in rows:
            # Indices: 0=Nro, 1=Ano, 2=Obs (precisamos garantir que SELECT pegue Obs)
            # ou usar dict se fetch_all_as_dict
            
            # Ajuste: Vamos retornar Row Dict ou Indices fixos. 
            # Assumir que a query abaixo pede: Nro, Ano, Obs
            
            nro = row.get(COL_LINK_PROTOCOLO) if isinstance(row, dict) else row[0]
            ano = row.get(COL_LINK_ANO) if isinstance(row, dict) else row[1]
            obs = row.get(COL_OBS) if isinstance(row, dict) else row[2]
            
            if not nro or not ano: continue

            # Determinar Timestamp deste registro
            row_time = parse_obs_time(obs)
            if row_time:
                row_dt = datetime.datetime.combine(today, row_time)
            else:
                # Se não tem hora, assumimos 00:00 ou ignoramos filtro de tempo?
                # User disse "existe registro de hora". Se falhar, assumimos que é ANTIGO (00:00) 
                # ou se já processamos hoje, ignoramos.
                # Para segurança, se não tem hora, consideramos como 'agora' apenas se for 1a atualização?
                # Vamos assumir 00:00.
                row_dt = datetime.datetime.combine(today, datetime.time.min)
            
            # Filtro Incremental
            # Se since_datetime é None (primeira do dia), pega tudo.
            # Se tem since_datetime, só pega se row_dt > since_datetime
            if since_datetime and row_dt <= since_datetime:
                continue
                
            changed_os.add((nro, ano))
            
            if row_dt > max_found_dt:
                max_found_dt = row_dt
            count += 1
        return count

    # 1. Check MySQL
    try:
        conn = get_mysql_conn()
        with conn.cursor() as cur:
            sql = f"SELECT {COL_LINK_PROTOCOLO}, {COL_LINK_ANO}, {COL_OBS} FROM tabAndamento WHERE DATE({COL_DATA_ANDAMENTO}) = %s"
            cur.execute(sql, (today,))
            cols = [desc[0] for desc in cur.description]
            rows = [clean_row(r, cols) for r in cur.fetchall()]
            process_rows(rows, "MySQL")
        conn.close()
    except Exception as e:
        logging.error(f"Erro descobrindo IDs no MySQL: {e}")

    # 2. Check Access DBs
    access_dbs = [ACCESS_DB_OS, ACCESS_DB_PAPELARIA]
    for db_path in access_dbs:
        try:
            conn = get_access_conn(db_path)
            cur = conn.cursor()
            # Access SQL
            query = f"SELECT {COL_LINK_PROTOCOLO}, {COL_LINK_ANO}, {COL_OBS} FROM tabandamento WHERE {COL_DATA_ANDAMENTO} >= ?"
            cur.execute(query, (today,))
            # Access retorna Tuplas. Indices: 0, 1, 2
            process_rows(cur.fetchall(), "Access")
            conn.close()
        except Exception as e:
            logging.warning(f"Erro lendo Access ({db_path}): {e}")

    return changed_os, max_found_dt

def sync_os_data(os_id, os_ano):
    """
    Fase 2: Sincroniza UMA OS específica entre seu Access Autorizado e MySQL.
    """
    # 1. Definir quem é a autoridade
    target_access_path = get_correct_access_db(os_id)
    db_name = "Papelaria" if os_id > 5000 else "OS"
    
    logging.info(f"  > Syncing OS {os_id}/{os_ano} (Authority: {db_name})...")

    mysql_conn = None
    access_conn = None

    try:
        mysql_conn = get_mysql_conn()
        access_conn = get_access_conn(target_access_path)

        # Definição das Tabelas para Sync em Cascata
        # PRIORIDADE: tabAndamento primeiro, conforme solicitado.
        tables_config = [
            {
                "table": "tabAndamento",
                "pk": [COL_LINK_PROTOCOLO, COL_LINK_ANO], # Chave 'estrangeira' usada pra filtro
                "is_many": True,
                "real_pk": ["CodStatus"], # Para identificar unicamente linha a linha
                "pk_vals": [os_id, os_ano]
            },
            {
                "table": "tabProtocolos",
                "pk": [COL_ID_PROTOCOLO, COL_ANO_PROTOCOLO],
                "pk_vals": [os_id, os_ano]
            },
            {
                "table": "tabDetalhesServico",
                "pk": ["NroProtocoloLinkDet", "AnoProtocoloLinkDet"],
                "pk_vals": [os_id, os_ano]
            }
        ]

        for conf in tables_config:
            table = conf["table"]
            logging.info(f"    - Processing table {table}...")
            
            # FETCH DATA FROM BOTH
            # MySQL
            mysql_rows = []
            with mysql_conn.cursor() as cur:
                where_clause = " AND ".join([f"{k}=%s" for k in conf["pk"]])
                sql = f"SELECT * FROM {table} WHERE {where_clause}"
                cur.execute(sql, conf["pk_vals"])
                cols = [desc[0] for desc in cur.description]
                mysql_rows = [clean_row(r, cols) for r in cur.fetchall()]

            # Access
            acc_cursor = access_conn.cursor()
            where_clause_acc = " AND ".join([f"{k}=?" for k in conf["pk"]])
            sql_acc = f"SELECT * FROM [{table}] WHERE {where_clause_acc}"
            acc_data_raw = fetch_all_as_dict(acc_cursor, sql_acc, conf["pk_vals"])
            
            # --- MERGE LOGIC ---
            # Simples: Se tabAndamento, merge por CodStatus. Se Protocolo/Detalhes, é 1-to-1 (update fields).
            
            if conf.get("is_many"):
                # Lógica para listas (Andamentos)
                sync_list_data(table, conf["real_pk"][0], mysql_rows, acc_data_raw, mysql_conn, access_conn)
            else:
                # Lógica para objeto único (Protocolo, Detalhes)
                sync_single_record(table, conf["pk"], conf["pk_vals"], mysql_rows, acc_data_raw, mysql_conn, access_conn)

        # Recalcular UltimoStatus em ambos os bancos para garantir consistência
        recalculate_ultimo_status(mysql_conn, os_id, os_ano, "MySQL")
        recalculate_ultimo_status(access_conn, os_id, os_ano, "Access")

    except Exception as e:
        tool_logging_prefix = f"    x Error syncing OS {os_id}/{os_ano}:"
        logging.error(f"{tool_logging_prefix} {e}")
        logging.error(traceback.format_exc())
    finally:
        if mysql_conn: mysql_conn.close()
        if access_conn: access_conn.close()

def recalculate_ultimo_status(conn, os_id, os_ano, db_type):
    """Garante que apenas o maior CodStatus tenha UltimoStatus=Tmure/1."""
    try:
        # 1. Encontrar o maior CodStatus
        cursor = conn.cursor()
        if db_type == "MySQL":
            sql_max = f"SELECT MAX({COL_ID_ANDAMENTO}) as max_id FROM tabAndamento WHERE {COL_LINK_PROTOCOLO}=%s AND {COL_LINK_ANO}=%s"
            cursor.execute(sql_max, (os_id, os_ano))
            row = cursor.fetchone()
            max_id = row['max_id'] if row else None
        else: # Access
            sql_max = f"SELECT MAX({COL_ID_ANDAMENTO}) FROM tabAndamento WHERE {COL_LINK_PROTOCOLO}=? AND {COL_LINK_ANO}=?"
            cursor.execute(sql_max, (os_id, os_ano))
            row = cursor.fetchone()
            max_id = row[0] if row else None
            
        if not max_id: return

        # 2. Resetar todos para False/0
        logging.info(f"      * Fixing UltimoStatus for OS {os_id}: MaxID={max_id} ({db_type})")
        
        if db_type == "MySQL":
            # Set ALL to 0
            update_all = f"UPDATE tabAndamento SET UltimoStatus=0 WHERE {COL_LINK_PROTOCOLO}=%s AND {COL_LINK_ANO}=%s"
            cursor.execute(update_all, (os_id, os_ano))
            # Set Max to 1
            update_max = f"UPDATE tabAndamento SET UltimoStatus=1 WHERE {COL_ID_ANDAMENTO}=%s AND {COL_LINK_PROTOCOLO}=%s AND {COL_LINK_ANO}=%s"
            cursor.execute(update_max, (max_id, os_id, os_ano))
        else: # Access
            # Set ALL to False (0 works usually)
            update_all = f"UPDATE tabAndamento SET UltimoStatus=0 WHERE {COL_LINK_PROTOCOLO}=? AND {COL_LINK_ANO}=?"
            cursor.execute(update_all, (os_id, os_ano))
            # Set Max to True (1 works usually)
            update_max = f"UPDATE tabAndamento SET UltimoStatus=1 WHERE {COL_ID_ANDAMENTO}=? AND {COL_LINK_PROTOCOLO}=? AND {COL_LINK_ANO}=?"
            cursor.execute(update_max, (max_id, os_id, os_ano))
            conn.commit()
            
    except Exception as e:
        logging.error(f"      x Error recalculaing status ({db_type}): {e}")


def sync_single_record(table, pk_cols, pk_vals, mysql_data, access_data, mysql_conn, access_conn):
    """Sincroniza registro 1-para-1 (Ex: Própria OS ou Detalhes)."""
    # Converter listas para item único ou None
    mysql_item = mysql_data[0] if mysql_data else None
    access_item = access_data[0] if access_data else None

    if not mysql_item and not access_item:
        return # Nada a fazer
    
    # 1. Missing in MySQL -> Insert from Access
    if access_item and not mysql_item:
        logging.info(f"      + Inserting into MySQL {table}...")
        insert_into_mysql(mysql_conn, table, access_item)
        return

    # 2. Missing in Access -> Insert from MySQL
    if mysql_item and not access_item:
        logging.info(f"      + Inserting into Access {table}...")
        insert_into_access(access_conn, table, mysql_item)
        return

    # 3. Exists in Both -> Compare updates
    # Comparação simplificada: Se dados diferem, assumimos MySQL (web) como mais recente SE tiver mudado hoje?
    # Ou Access como autoridade final? 
    # USER PEDIU: "Assumir que a versão com o timestamp mais recente... é a correta"
    # Problema: Tabelas Access antigas podem nao ter timestamp de update na linha.
    # Vamos comparar todos valores. Se diferente, update. Quem vence?
    # Regra segura: Access costuma ser o "erp" legado. Mas se web edita, web vence.
    # Para simplificar: UPDATE MySQL com dados do Access (Sync Access -> Web preferencialmente), 
    # MAS se tiver campo de data de modificação, usar.
    # Como não temos coluna "LastModified" garantida, vamos verificar divergência de conteúdo.
    
    if items_differ(mysql_item, access_item, table):
        logging.info(f"      ! Difference detected in {table}. Updating MySQL < Access (Default rule).")
        # Por padrão, vamos replicar Access -> MySQL para manter o legado como fonte da verdade, 
        # a menos que saibamos que a Web editou. 
        # TODO: Refinar isso se tiver campo 'DataAlteracao'.
        update_mysql(mysql_conn, table, pk_cols, pk_vals, access_item)


def sync_list_data(table, unique_key, mysql_list, access_list, mysql_conn, access_conn):
    """Sincroniza lista de itens (Ex: Andamentos). Chave única: CodStatus"""
    mysql_map = {str(item[unique_key]): item for item in mysql_list}
    access_map = {str(item[unique_key]): item for item in access_list}

    all_keys = set(mysql_map.keys()) | set(access_map.keys())

    for key in all_keys:
        m_item = mysql_map.get(key)
        a_item = access_map.get(key)

        if a_item and not m_item:
            # Novo no Access -> MySQL
            logging.info(f"      + New Andamento {key} -> MySQL")
            insert_into_mysql(mysql_conn, table, a_item)
        elif m_item and not a_item:
            # Novo no MySQL -> Access
            logging.info(f"      + New Andamento {key} -> Access")
            insert_into_access(access_conn, table, m_item)
        elif m_item and a_item:
            # Existe em ambos. Comparar.
            if items_differ(m_item, a_item, f"{table} (KB={key})"):
                logging.info(f"      ! Update Andamento {key}: Access -> MySQL")
                update_mysql(mysql_conn, table, [unique_key], [key], a_item)


def items_differ(dict_a, dict_b, table_name="Generic"):
    """Compara dois dicionários ignorando chaves irrelevantes."""
    keys = set(dict_a.keys()) & set(dict_b.keys())
    diff_found = False
    for k in keys:
        val_a = dict_a[k]
        val_b = dict_b[k]
        
        # Normalização pra comparação
        if val_a == val_b: continue
        
        # Tratar int vs float vs str
        str_a = str(val_a) if val_a is not None else ""
        str_b = str(val_b) if val_b is not None else ""
        
        if str_a == str_b: continue
        if not val_a and not val_b: continue # None vs "" vs 0
        
        # Boolean normalization (MySQL 1 vs Access True)
        bool_map = {"True": "1", "False": "0", "1": "1", "0": "0"}
        norm_a = bool_map.get(str_a, str_a)
        norm_b = bool_map.get(str_b, str_b)
        
        if norm_a == norm_b: continue

        # Ignorar diferenças de precisão em ponto flutuante se forem pequenas?
        # Por enquanto logar tudo
        logging.info(f"        [DIFF] {table_name}.{k}: MySQL='{val_a}' vs Access='{val_b}'")
        diff_found = True
        
    return diff_found

# --- SQL GENERATORS ---

def insert_into_mysql(conn, table, data_dict):
    clean_dict = {k: v for k, v in data_dict.items() if v is not None}
    cols = list(clean_dict.keys())
    vals = list(clean_dict.values())
    placeholders = ", ".join(["%s"] * len(cols))
    cols_str = ", ".join([f"`{c}`" for c in cols])
    
    # Use INSERT IGNORE for robustness (similar to sync_fast.py)
    sql = f"INSERT IGNORE INTO `{table}` ({cols_str}) VALUES ({placeholders})"
    with conn.cursor() as cur:
        cur.execute(sql, vals)

def update_mysql(conn, table, pk_cols, pk_vals, data_dict):
    # Remove PKs do set de update
    update_data = {k: v for k, v in data_dict.items() if k not in pk_cols}
    if not update_data: return

    set_clause = ", ".join([f"`{k}`=%s" for k in update_data.keys()])
    where_clause = " AND ".join([f"`{k}`=%s" for k in pk_cols])
    
    vals = list(update_data.values()) + pk_vals
    sql = f"UPDATE `{table}` SET {set_clause} WHERE {where_clause}"
    with conn.cursor() as cur:
        cur.execute(sql, vals)

def insert_into_access(conn, table, data_dict):
    clean_dict = {k: v for k, v in data_dict.items() if v is not None}
    cols = list(clean_dict.keys())
    vals = list(clean_dict.values())
    placeholders = ", ".join(["?"] * len(cols))
    # Access usa [] para colunas
    cols_str = ", ".join([f"[{c}]" for c in cols])
    
    sql = f"INSERT INTO [{table}] ({cols_str}) VALUES ({placeholders})"
    cur = conn.cursor()
    cur.execute(sql, vals)
    conn.commit()

# --- MAIN LOOP ---

def main_loop():
    logging.info("=== SCRIPT DE SINCRONIZAÇÃO SAGRA (BIDIRECIONAL) INICIADO ===")
    
    # Controle de atualização incremental
    # Inicializa com None para garantir que a 1a execução do dia pegue TUDO de hoje
    # Depois atualizamos para o maior horário encontrado
    last_check_time = None 
    current_day = get_today_date()
    
    while True:
        try:
            # Reset diário se virou o dia
            if get_today_date() != current_day:
                logging.info("Virada de dia detectada. Reiniciando ciclo completo.")
                current_day = get_today_date()
                last_check_time = None

            logging.info(f"--- Iniciando ciclo (Incremental > {last_check_time if last_check_time else '00:00'}) ---")
            
            # 1. Identificar mudanças hoje (passando filtro de tempo)
            changed_ids, max_time_found = discover_changed_os_ids_today(last_check_time)
            
            if not changed_ids:
                if last_check_time is None:
                    logging.info("Nenhuma mudança detectada hoje até o momento.")
                else:
                    # Log menos verboso em loops vazios subsequentes
                    pass 
            else:
                
                # 2. Processar cada OS afetada
                logging.info(f"Detectadas {len(changed_ids)} OSs novas/alteradas. (Log Debug Removido)")
                for nro, ano in changed_ids:
                    sync_os_data(nro, ano)
                
                # Atualizar o cursor de tempo APENAS se encontramos coisas novas
                if max_time_found:
                    last_check_time = max_time_found
                    logging.info(f"Cursor de tempo atualizado para: {last_check_time.strftime('%H:%M:%S')}")

                    
            logging.info("Ciclo concluído. Aguardando 5 segundos...")
            
        except KeyboardInterrupt:
            logging.info("Script interrompido pelo usuário.")
            break
        except Exception as e:
            logging.error(f"Erro fatal no loop principal: {e}")
        
        time.sleep(30)

if __name__ == "__main__":
    main_loop()

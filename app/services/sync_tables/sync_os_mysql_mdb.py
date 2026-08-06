import os
import sys
import logging
import time
import datetime
import mysql.connector
import pyodbc
import os
import sys
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)
from config_manager import config_manager
from typing import List, Dict, Any, Tuple

# Configurações de log
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)

# Configurações do MySQL
db_config = config_manager.get_mysql_config()
db_config['raise_on_warnings'] = True

# Configurações dos arquivos MDB
MDB_PATH_5000 = config_manager.get("mdb_papelaria_path", r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb")
MDB_PATH_4999 = config_manager.get("mdb_os_atual_path", r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb")

# Tabelas a sincronizar
target_tables = ["tabdetalhesservico", "tabprotocolos"]

# Nome da tabela de controle de sincronização
SYNC_TABLE = "sync_status"

# Ano mínimo para sincronização
MIN_YEAR = 2024

# Tamanho do lote
BATCH_SIZE = 100

# Função para conectar ao MySQL
def get_mysql_conn():
    return mysql.connector.connect(**db_config)

# Função para conectar ao MDB
def get_mdb_conn(mdb_path: str):
    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={mdb_path};"
    )
    return pyodbc.connect(conn_str)

# Função para obter colunas em comum entre MySQL e MDB
def get_common_columns(mysql_conn, mdb_conn, table: str) -> List[str]:
    # MySQL
    cursor = mysql_conn.cursor()
    cursor.execute(f"SHOW COLUMNS FROM {table}")
    mysql_cols = set(row[0] for row in cursor.fetchall())
    # MDB
    mdb_cursor = mdb_conn.cursor()
    mdb_cursor.execute(f"SELECT * FROM {table} WHERE 1=0")
    mdb_cols = set([column[0] for column in mdb_cursor.description])
    # Interseção
    return list(mysql_cols & mdb_cols)


# Função para criar tabela de controle de sincronização
def create_sync_table(mysql_conn):
    cursor = mysql_conn.cursor()
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS {SYNC_TABLE} (
            table_name VARCHAR(64),
            pk1 VARCHAR(32),
            pk2 VARCHAR(32),
            last_snapshot LONGTEXT,
            PRIMARY KEY (table_name, pk1, pk2)
        )
    """)
    mysql_conn.commit()


# Função para limpar e popular a tabela de controle de sincronização
def initialize_sync_table(mysql_conn, table: str, pk_list: List[Tuple[Any, Any]], snapshot: Dict[Tuple[Any, Any], Dict[str, Any]]):
    cursor = mysql_conn.cursor()
    # Limpa todos os registros da tabela para a tabela alvo
    cursor.execute(f"DELETE FROM {SYNC_TABLE} WHERE table_name = %s", (table,))
    for pk1, pk2 in pk_list:
        cursor.execute(
            f"INSERT INTO {SYNC_TABLE} (table_name, pk1, pk2, last_snapshot) VALUES (%s, %s, %s, %s)",
            (table, str(pk1), str(pk2), str(snapshot[(pk1, pk2)]))
        )
    mysql_conn.commit()


# Função para buscar PKs válidas
def get_valid_pks(mysql_conn, table: str) -> List[Tuple[Any, Any]]:
    cursor = mysql_conn.cursor()
    if table == "tabprotocolos":
        cursor.execute(f"SELECT DISTINCT NroProtocolo, AnoProtocolo FROM {table} WHERE AnoProtocolo >= %s", (MIN_YEAR,))
        return [(row[0], row[1]) for row in cursor.fetchall()]
    elif table == "tabdetalhesservico":
        cursor.execute(f"SELECT DISTINCT NroProtocoloLinkDet, AnoProtocoloLinkDet FROM {table} WHERE AnoProtocoloLinkDet >= %s", (MIN_YEAR,))
        return [(row[0], row[1]) for row in cursor.fetchall()]
    else:
        return []


# Função para buscar snapshot atual de uma tabela
def get_table_snapshot(mysql_conn, table: str, pk_list: List[Tuple[Any, Any]], columns: List[str]) -> Dict[Tuple[Any, Any], Dict[str, Any]]:
    cursor = mysql_conn.cursor(dictionary=True)
    snapshot = {}
    for pk1, pk2 in pk_list:
        if table == "tabprotocolos":
            cursor.execute(
                f"SELECT {', '.join(columns)} FROM {table} WHERE NroProtocolo = %s AND AnoProtocolo = %s ORDER BY NroProtocolo DESC, AnoProtocolo DESC LIMIT 1",
                (pk1, pk2)
            )
        elif table == "tabdetalhesservico":
            cursor.execute(
                f"SELECT {', '.join(columns)} FROM {table} WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s ORDER BY NroProtocoloLinkDet DESC, AnoProtocoloLinkDet DESC LIMIT 1",
                (pk1, pk2)
            )
        else:
            continue
        row = cursor.fetchone()
        if row:
            snapshot[(pk1, pk2)] = row
    return snapshot


# --- Funções auxiliares para sincronização ---
import json

def get_mdb_snapshot(mdb_conn, table: str, pk_list: List[Tuple[Any, Any]], columns: List[str]) -> Dict[Tuple[Any, Any], Dict[str, Any]]:
    cursor = mdb_conn.cursor()
    snapshot = {}
    # Corrigir nomes das tabelas para o MDB
    mdb_table = "TabProtocolos" if table == "tabprotocolos" else "TabDetalhesServico"
    for pk1, pk2 in pk_list:
        if table == "tabprotocolos":
            sql = f"SELECT {', '.join(columns)} FROM {mdb_table} WHERE NroProtocolo = ? AND AnoProtocolo = ?"
            cursor.execute(sql, (pk1, pk2))
        elif table == "tabdetalhesservico":
            sql = f"SELECT {', '.join(columns)} FROM {mdb_table} WHERE NroProtocoloLinkDet = ? AND AnoProtocoloLinkDet = ?"
            cursor.execute(sql, (pk1, pk2))
        else:
            continue
        row = cursor.fetchone()
        if row:
            snapshot[(pk1, pk2)] = dict(zip([desc[0] for desc in cursor.description], row))
    return snapshot
def normalize_value(val):
    # Trata datas: compara apenas a parte de data
    if isinstance(val, datetime.datetime):
        return val.date()
    if isinstance(val, datetime.date):
        return val
    # Trata booleanos
    if isinstance(val, bool):
        return int(val)
    # Trata nulos/vazios
    if val is None or val == '' or (isinstance(val, str) and val.strip() == ''):
        return None
    # Trata strings "0"/"1" para booleanos
    if isinstance(val, str) and val.strip() in ("0", "1"):
        return int(val.strip())
    return val


def get_mdb_conn_for_os(pk1, pk2, table):
    try:
        nro = int(pk1)
    except Exception:
        nro = 0
    if nro >= 5000:
        return get_mdb_conn(MDB_PATH_5000)
    else:
        return get_mdb_conn(MDB_PATH_4999)

def update_mdb_record(mdb_conn, table: str, pk: Tuple[Any, Any], columns: List[str], values: Dict[str, Any]) -> bool:
    try:
        set_clause = ', '.join([f"{col} = ?" for col in columns])
        if table == "tabprotocolos":
            where_clause = "NroProtocolo = ? AND AnoProtocolo = ?"
        else:
            where_clause = "NroProtocoloLinkDet = ? AND AnoProtocoloLinkDet = ?"
        params = [values.get(col) for col in columns] + [pk[0], pk[1]]
        sql = f"UPDATE {table} SET {set_clause} WHERE {where_clause}"
        cursor = mdb_conn.cursor()
        cursor.execute(sql, params)
        mdb_conn.commit()
        return True
    except Exception as e:
        logging.warning(f"Erro ao atualizar registro {pk} em {table}: {e}")
        return False

def records_differ(mysql_row: Dict[str, Any], mdb_row: Dict[str, Any], columns: List[str]) -> bool:
    for col in columns:
        v1 = normalize_value(mysql_row.get(col))
        v2 = normalize_value(mdb_row.get(col))
        # Se ambos None, igual
        if v1 is None and v2 is None:
            continue
        # Se ambos datas, compara só a data
        if isinstance(v1, datetime.date) and isinstance(v2, datetime.date):
            if v1 != v2:
                return True
            continue
        # Se ambos booleanos (0/1), compara
        if v1 in (0, 1) and v2 in (0, 1):
            if v1 != v2:
                return True
            continue
        # Comparação padrão
        if v1 != v2:
            return True
    return False

def sync_batch(mysql_conn, table: str, pk_batch: List[Tuple[Any, Any]], columns: List[str]):
    mysql_snapshot = get_table_snapshot(mysql_conn, table, pk_batch, columns)
    # Usar conexões persistentes por lote
    mdb_conn_5000 = get_mdb_conn(MDB_PATH_5000)
    mdb_conn_4999 = get_mdb_conn(MDB_PATH_4999)
    for pk in pk_batch:
        nro = int(pk[0]) if str(pk[0]).isdigit() else 0
        mdb_conn = mdb_conn_5000 if nro >= 5000 else mdb_conn_4999
        mdb_snapshot = get_mdb_snapshot(mdb_conn, table, [pk], columns)
        mysql_row = mysql_snapshot.get(pk)
        mdb_row = mdb_snapshot.get(pk)
        if not mysql_row:
            continue
        if not mdb_row:
            logging.info(f"Registro {pk} não existe no MDB {table}, inserção não implementada. SQL: {columns} PK: {pk}")
            continue
        if records_differ(mysql_row, mdb_row, columns):
            success = update_mdb_record(mdb_conn, table, pk, columns, mysql_row)
            if not success:
                logging.warning(f"Falha ao sincronizar {pk} em {table}, será tentado novamente depois.")
                continue
            mdb_snapshot2 = get_mdb_snapshot(mdb_conn, table, [pk], columns)
            mdb_row2 = mdb_snapshot2.get(pk)
            if not mdb_row2 or records_differ(mysql_row, mdb_row2, columns):
                success2 = update_mdb_record(mdb_conn, table, pk, columns, mysql_row)
                if not success2:
                    logging.error(f"Sincronização falhou novamente para {pk} em {table}.")
                    continue
            logging.info(f"Registro {pk} sincronizado com sucesso em {table}.")
        else:
            logging.debug(f"Registro {pk} já está sincronizado em {table}.")
    mdb_conn_5000.close()
    mdb_conn_4999.close()

def main():
    logging.info("Iniciando sincronização das tabelas tabdetalhesservico e tabprotocolos...")
    mysql_conn = get_mysql_conn()
    mdb_conn_5000 = get_mdb_conn(MDB_PATH_5000)
    mdb_conn_4999 = get_mdb_conn(MDB_PATH_4999)
    create_sync_table(mysql_conn)
    for table in target_tables:
        common_cols = get_common_columns(mysql_conn, mdb_conn_5000, table)
        pk_list = get_valid_pks(mysql_conn, table)
        snapshot = get_table_snapshot(mysql_conn, table, pk_list, common_cols)
        initialize_sync_table(mysql_conn, table, pk_list, snapshot)
        logging.info(f"Tabela de controle inicializada para {table} com {len(pk_list)} registros.")
        total = len(pk_list)
        for i in range(0, total, BATCH_SIZE):
            batch = pk_list[i:i+BATCH_SIZE]
            logging.info(f"Sincronizando lote {i//BATCH_SIZE+1} de {((total-1)//BATCH_SIZE)+1} para {table}...")
            sync_batch(mysql_conn, table, batch, common_cols)
    logging.info("Sincronização concluída.")

if __name__ == "__main__":
    main()

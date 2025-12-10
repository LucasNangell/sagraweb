import pyodbc
import pymysql
import sys
import logging
from tqdm import tqdm
from config_manager import config_manager
import warnings

# Suppress warnings
warnings.filterwarnings("ignore")

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("import_log.txt", encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

# Configuration
ACCESS_DB_OS = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb"
ACCESS_DB_PAPELARIA = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb"

SHARED_TABLES = ['tabAndamento', 'tabProtocolos', 'tabDetalhesServico']

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

def import_table(access_cursor, mysql_conn, table_name, source_name):
    try:
        # Fetch data from Access
        logging.info(f"Reading {table_name} from {source_name}...")
        access_cursor.execute(f"SELECT * FROM [{table_name}]")
        rows = access_cursor.fetchall()
        
        if not rows:
            logging.info(f"  No rows directly found in {table_name}. Skipping.")
            return

        # Get columns
        columns = [column[0] for column in access_cursor.description]
        
        # Prepare MySQL Insert
        placeholders = ', '.join(['%s'] * len(columns))
        col_names = ', '.join([f"`{c}`" for c in columns])
        
        insert_query = f"INSERT INTO `{table_name}` ({col_names}) VALUES ({placeholders})"
        
        mysql_cursor = mysql_conn.cursor()
        
        # Batch insert
        batch_size = 1000
        batch = []
        
        for row in tqdm(rows, desc=f"Importing {table_name} ({source_name})", unit="rows"):
            # Convert row to list and handle potential data type issues if needed
            batch.append(list(row))
            
            if len(batch) >= batch_size:
                mysql_cursor.executemany(insert_query, batch)
                batch = []
        
        if batch:
            mysql_cursor.executemany(insert_query, batch)
            
        logging.info(f"  Successfully imported {len(rows)} rows into {table_name}.")
        
    except Exception as e:
        logging.error(f"Error importing {table_name} from {source_name}: {e}")
        # Don't raise, allowing other tables to proceed

import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--partial", action="store_true", help="Sync only main tables (Andamento, Protocolos, Detalhes)")
    args = parser.parse_args()

    try:
        # 1. Connect to MySQL
        mysql_conn = get_mysql_conn()
        logging.info("Connected to MySQL.")
        
        # 2. Connect to Access DBs
        try:
            conn_os = get_access_conn(ACCESS_DB_OS)
            logging.info("Connected to OS Atual DB.")
        except Exception as e:
            logging.error(f"Failed to connect to OS DB: {e}")
            return

        try:
            conn_papelaria = get_access_conn(ACCESS_DB_PAPELARIA)
            logging.info("Connected to Papelaria Atual DB.")
        except Exception as e:
            logging.error(f"Failed to connect to Papelaria DB: {e}")
            conn_papelaria = None

        # 3. Determine tables to process
        if args.partial:
            logging.info("PARTIAL SYNC MODE: Updating only Andamento, Protocolos, Detalhes.")
            tables = SHARED_TABLES
        else:
            logging.info("FULL SYNC MODE: Updating ALL tables.")
            tables = get_access_tables(conn_os)
            logging.info(f"Found {len(tables)} tables in automatically.")

        # 4. Truncate Tables in MySQL
        with mysql_conn.cursor() as cursor:
            logging.info("Disabling foreign keys...")
            cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
            
            for table in tables:
                logging.info(f"Truncating {table}...")
                try:
                    cursor.execute(f"TRUNCATE TABLE `{table}`")
                except Exception as e:
                    logging.warning(f"  Could not truncate {table}: {e}")

        # 5. Import Process
        for table in tables:
            logging.info(f"Processing {table}...")
            
            # Import from OS Atual (Always)
            import_table(conn_os.cursor(), mysql_conn, table, "OS Atual")
            
            # Import from Papelaria Atual (If Shared)
            # Logic: If partial, we ONLY process SHARED_TABLES, so we always check if we should import from Papelaria.
            # If full, 'tables' contains everything, but we only verify against SHARED_TABLES list for the second import.
            if table in SHARED_TABLES and conn_papelaria:
                import_table(conn_papelaria.cursor(), mysql_conn, table, "Papelaria Atual")

        # 6. Re-enable FK
        with mysql_conn.cursor() as cursor:
            logging.info("Enabling foreign keys...")
            cursor.execute("SET FOREIGN_KEY_CHECKS = 1")

        logging.info("Import completed!")
        
    except Exception as e:
        logging.critical(f"Critical error: {e}")
    finally:
        if 'mysql_conn' in locals() and mysql_conn.open:
            mysql_conn.close()
        if 'conn_os' in locals() and conn_os:
            conn_os.close()
        if 'conn_papelaria' in locals() and conn_papelaria:
            conn_papelaria.close()

if __name__ == "__main__":
    main()

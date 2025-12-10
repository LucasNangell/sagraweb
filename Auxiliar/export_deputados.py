import pyodbc
import pymysql
import sys
import logging
from config_manager import config_manager

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

ACCESS_DB_PATH = r"C:\_SAGRA\Sagra Cliente - OS Atual.mdb"
TABLE_NAME = "tabDeputados"

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

def map_access_type_to_mysql(type_code):
    # Basic mapping based on ODBC type codes
    # This is a simplification; for production, more robust mapping is needed.
    if type_code == int: return "INT"
    if type_code == str: return "TEXT"
    if type_code == bool: return "TINYINT(1)"
    if type_code == float: return "DOUBLE"
    # Fallback
    return "TEXT"

def create_mysql_table(mysql_conn, table_name, columns_info):
    # columns_info is list of (name, type_code, size...)
    cols_ddl = []
    for col in columns_info:
        col_name = col[0]
        col_type = map_access_type_to_mysql(col[1])
        # Clean column name
        col_name_clean = f"`{col_name}`"
        cols_ddl.append(f"{col_name_clean} {col_type}")
    
    ddl = f"CREATE TABLE IF NOT EXISTS `{table_name}` ({', '.join(cols_ddl)});"
    
    with mysql_conn.cursor() as cursor:
        logging.info(f"Creating table {table_name}...")
        cursor.execute(ddl)

def import_table(access_cursor, mysql_conn, table_name):
    try:
        logging.info(f"Reading {table_name} from Access ({ACCESS_DB_PATH})...")
        access_cursor.execute(f"SELECT * FROM [{table_name}]")
        
        # Get schema from Description
        # description: (name, type_code, display_size, internal_size, precision, scale, null_ok)
        columns_info = access_cursor.description
        if not columns_info:
            logging.error("Could not get column description.")
            return

        # Create Table if Not Exists
        create_mysql_table(mysql_conn, table_name, columns_info)

        rows = access_cursor.fetchall()
        if not rows:
            logging.info("  No rows found.")
            return

        columns = [column[0] for column in columns_info]
        placeholders = ', '.join(['%s'] * len(columns))
        col_names = ', '.join([f"`{c}`" for c in columns])
        
        insert_query = f"INSERT INTO `{table_name}` ({col_names}) VALUES ({placeholders})"
        
        with mysql_conn.cursor() as cursor:
            logging.info(f"Truncating {table_name} in MySQL...")
            cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
            cursor.execute(f"TRUNCATE TABLE `{table_name}`")
            cursor.execute("SET FOREIGN_KEY_CHECKS = 1")
            
            logging.info(f"Inserting {len(rows)} rows...")
            batch_size = 1000
            batch = []
            for row in rows:
                batch.append(list(row))
                if len(batch) >= batch_size:
                    cursor.executemany(insert_query, batch)
                    batch = []
            if batch:
                cursor.executemany(insert_query, batch)

        logging.info("Success! Import completed.")

    except Exception as e:
        logging.error(f"Error during import: {e}")

def main():
    try:
        logging.info("Connecting to MySQL...")
        mysql_conn = get_mysql_conn()
        
        logging.info("Connecting to Access...")
        try:
            access_conn = get_access_conn(ACCESS_DB_PATH)
        except Exception as e:
            logging.error(f"Could not connect to Access DB at {ACCESS_DB_PATH}. Check path and driver.")
            logging.error(e)
            return

        import_table(access_conn.cursor(), mysql_conn, TABLE_NAME)
        
    except Exception as e:
        logging.critical(f"Critical error: {e}")
    finally:
        if 'mysql_conn' in locals() and mysql_conn.open: mysql_conn.close()
        if 'access_conn' in locals() and access_conn: access_conn.close()

if __name__ == "__main__":
    main()

import pymysql
from config_manager import config_manager
import logging

logging.basicConfig(level=logging.INFO)

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

def list_columns(table_name):
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cursor:
            # Check if table exists first
            try:
                cursor.execute(f"DESCRIBE `{table_name}`")
                columns = [row['Field'] for row in cursor.fetchall()]
                print(f"\nTABLE: {table_name}")
                for col in sorted(columns):
                    print(f"  - {col}")
            except Exception as e:
                print(f"Error describing {table_name}: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    try:
        list_columns("tabProtocolos")
        list_columns("tabDetalhesServico")
        list_columns("tabMaterialEntregue")
        list_columns("tabMidiaDigital")
    except Exception as e:
        print(e)

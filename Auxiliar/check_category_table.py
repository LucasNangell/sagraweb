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
        autocommit=True
    )

def check_table():
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SHOW TABLES LIKE 'tabCategorias'")
            result = cursor.fetchone()
            if result:
                print("Table 'tabCategorias' FOUND.")
                cursor.execute("DESCRIBE tabCategorias")
                print(cursor.fetchall())
            else:
                print("Table 'tabCategorias' NOT FOUND.")
    except Exception as e:
        print(e)
    finally:
        conn.close()

if __name__ == "__main__":
    check_table()

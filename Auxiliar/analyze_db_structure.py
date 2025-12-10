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

def analyze_schema():
    conn = get_mysql_conn()
    try:
        tables = ['tabProtocolos', 'tabDetalhesServico', 'tabAndamento', 'tabMaterialEntregue', 'tabMidiaDigital', 'tabDeputados']
        with conn.cursor() as cursor:
            for t in tables:
                try:
                    cursor.execute(f"SHOW CREATE TABLE `{t}`")
                    res = cursor.fetchone()
                    print(f"\n{'-'*20} {t} {'-'*20}")
                    print(res['Create Table'])
                except Exception as e:
                    print(f"Error fetching {t}: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    analyze_schema()

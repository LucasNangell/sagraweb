import pymysql
import pyodbc
from config_manager import config_manager

# MySQL
print("--- MySQL Columns ---")
try:
    conn = pymysql.connect(
        host=config_manager.get("db_host", "10.120.1.125"),
        port=int(config_manager.get("db_port", 3306)),
        user=config_manager.get("db_user", "usr_sefoc"),
        password=config_manager.get("db_password", "sefoc_2018"),
        database=config_manager.get("db_name", "sagrafulldb"),
        charset='utf8mb4'
    )
    print("--- MySQL Columns ---")
    cur = conn.cursor()
    cur.execute("SHOW COLUMNS FROM tabAndamento")
    for row in cur.fetchall():
        print(row)
    conn.close()
except Exception as e:
    print(e)

# Access
print("\n--- Access Columns (OS) ---")
try:
    db_path = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb"
    conn_str = r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + db_path + ";"
    conn = pyodbc.connect(conn_str)
    cur = conn.cursor()
    cur.execute("SELECT TOP 1 * FROM tabAndamento")
    for col in cur.description:
        print(col[0])
    conn.close()
except Exception as e:
    print(e)

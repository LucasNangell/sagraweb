import pymysql
from config_manager import config_manager
import logging

def get_mysql_conn():
    return pymysql.connect(
        host=config_manager.get("db_host", "localhost"),
        port=int(config_manager.get("db_port", 3306)),
        user=config_manager.get("db_user", "root"),
        password=config_manager.get("db_password", ""),
        database=config_manager.get("db_name", "sagrafulldb"),
        cursorclass=pymysql.cursors.DictCursor
    )

def check_log():
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) as total FROM sync_changes_log")
            total = cur.fetchone()['total']
            
            cur.execute("SELECT COUNT(*) as pending FROM sync_changes_log WHERE processed = 0")
            pending = cur.fetchone()['pending']
            
            print(f"Total Rows in Log: {total}")
            print(f"Pending (Unprocessed): {pending}")
            
            cur.execute("SELECT * FROM sync_changes_log WHERE processed = 0 ORDER BY id ASC LIMIT 5")
            rows = cur.fetchall()
            print("\nOldest 5 pending entries:")
            for r in rows:
                print(r)
                
    finally:
        conn.close()

if __name__ == "__main__":
    check_log()

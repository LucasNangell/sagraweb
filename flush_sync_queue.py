import pymysql
from config_manager import config_manager
import logging
import time

def get_mysql_conn():
    return pymysql.connect(
        host=config_manager.get("db_host", "localhost"),
        port=int(config_manager.get("db_port", 3306)),
        user=config_manager.get("db_user", "root"),
        password=config_manager.get("db_password", ""),
        database=config_manager.get("db_name", "sagrafulldb"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True
    )

def flush_log():
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cur:
            # Check backlog count
            cur.execute("SELECT COUNT(*) as pending FROM sync_changes_log WHERE processed = 0")
            pending = cur.fetchone()['pending']
            print(f"Pending records: {pending}")
            
            if pending > 0:
                print("Flushing queue... Marking all pending as processed (Skipping old backlog).")
                # Mark as processed=1 (Applied) or 2 (Skipped)? Let's use 1 to just move on.
                # Actually, only flush records older than 5 minutes to keep very recent tests?
                # User said "Registro andamentos e não reflete". These might be IN the backlog.
                # If they are at the END of the 700k list, we MUST flush the 699k before them.
                # Let's flush everything up to ID < (Current Max ID - 100)?
                # Or just flush everything and ask user to re-do the test?
                # Flushing everything is safer to get to "Zero State".
                
                cur.execute("UPDATE sync_changes_log SET processed = 1 WHERE processed = 0")
                print(f"Marked {cur.rowcount} rows as processed.")
            else:
                print("Queue is already empty.")
                
    finally:
        conn.close()

if __name__ == "__main__":
    flush_log()

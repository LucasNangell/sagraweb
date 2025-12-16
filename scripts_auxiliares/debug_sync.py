
import pymysql
import json
from config_manager import config_manager

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

def debug_check():
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cur:
            # 1. Check if sync_changes_log exists and has data
            cur.execute("SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'sagrafulldb' AND table_name = 'sync_changes_log'")
            table_exists = cur.fetchone()['count'] > 0
            print(f"Table 'sync_changes_log' exists: {table_exists}")
            
            if table_exists:
                cur.execute("SELECT * FROM sync_changes_log ORDER BY id DESC LIMIT 5")
                rows = cur.fetchall()
                print(f"Last 5 rows in sync_changes_log: {rows}")
            
            # 2. Check Triggers
            cur.execute("SHOW TRIGGERS")
            triggers = cur.fetchall()
            print("Existing Triggers:")
            for t in triggers:
                print(f" - {t['Trigger']} ({t['Event']} ON {t['Table']})")

            # 3. Test Insert (Rollback afterwards if possible, or just delete)
            # We need a valid OS ID to test. Let's find one.
            cur.execute("SELECT NroProtocoloLink, AnoProtocoloLink FROM tabAndamento LIMIT 1")
            existing = cur.fetchone()
            if existing:
                print(f"Testing Trigger with Insert using {existing}...")
                # Insert a dummy status
                # Assuming CodStatus is AutoIncrement? Or we provide it? In Access it is usually Autonumber. In MySQL it might be.
                # Let's check table info
                cur.execute("DESCRIBE tabAndamento")
                print("tabAndamento Structure:", cur.fetchall())
                
                # Try inserting
                try:
                    # Provide dummy values. Assuming 99999 as a code that won't conflict or will be deleted.
                    cur.execute("INSERT INTO tabAndamento (NroProtocoloLink, AnoProtocoloLink, Data, Observaçao) VALUES (%s, %s, NOW(), 'TEST_TRIGGER')", 
                                (existing['NroProtocoloLink'], existing['AnoProtocoloLink']))
                    new_id = cur.lastrowid
                    print(f"Inserted Test Row ID: {new_id}")
                    
                    # Check log immediately
                    cur.execute("SELECT * FROM sync_changes_log WHERE table_name='tabAndamento' ORDER BY id DESC LIMIT 1")
                    log = cur.fetchone()
                    print(f"Log after insert: {log}")
                    
                    # Cleanup manually if needed, or let sync handle it (but we don't want to corrupt DB)
                    # Let's delete it
                    cur.execute("DELETE FROM tabAndamento WHERE CodStatus=%s", (new_id,))
                    print("Deleted Test Row.")
                except Exception as e:
                    print(f"Insert Test Failed: {e}")

    finally:
        conn.close()

if __name__ == "__main__":
    debug_check()

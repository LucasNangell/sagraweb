import mysql.connector
from config_manager import config_manager

def alter_column():
    db_config = {
        'host': config_manager.get("db_host", "10.120.1.125"),
        'port': int(config_manager.get("db_port", 3306)),
        'user': config_manager.get("db_user", "root"),
        'password': config_manager.get("db_password", ""),
        'database': config_manager.get("db_name", "sagrafulldb")
    }
    
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor()
    try:
        print("Modifying coef_a4 column to DECIMAL(10,3)...")
        # Mysql syntax: ALTER TABLE tbl MODIFY COLUMN col ...
        cursor.execute("ALTER TABLE tabCalculosOS MODIFY COLUMN coef_a4 DECIMAL(10,3) DEFAULT 0")
        conn.commit()
        print("Column modified successfully.")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    alter_column()

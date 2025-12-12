import mysql.connector
from config_manager import config_manager

def update_schema():
    db_config = {
        'host': config_manager.get("db_host", "10.120.1.125"),
        'port': int(config_manager.get("db_port", 3306)),
        'user': config_manager.get("db_user", "root"),
        'password': config_manager.get("db_password", ""),
        'database': config_manager.get("db_name", "sagrafulldb")
    }
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor()

    table_sql = """
    CREATE TABLE IF NOT EXISTS tabCalculosOS (
        id INT AUTO_INCREMENT PRIMARY KEY,
        os_numero INT NOT NULL,
        os_ano INT NOT NULL,
        capa_color INT DEFAULT 0,
        capa_pb INT DEFAULT 0,
        miolo_color INT DEFAULT 0,
        miolo_pb INT DEFAULT 0,
        altura_mm DECIMAL(10,2) DEFAULT 0,
        largura_mm DECIMAL(10,2) DEFAULT 0,
        coef_a4 INT DEFAULT 0,
        total_paginas INT DEFAULT 0,
        tiragem INT DEFAULT 0,
        cota_total DECIMAL(10,2) DEFAULT 0,
        usuario_registro VARCHAR(50),
        data_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_os (os_numero, os_ano)
    );
    """
    
    try:
        print("Creating/Checking table tabCalculosOS...")
        cursor.execute(table_sql)
        conn.commit()
        
        # Ensure tiragem column exists (in case table existed but lacks column)
        try:
            cursor.execute("SELECT tiragem FROM tabCalculosOS LIMIT 1")
        except:
            print("Adding missing column 'tiragem'...")
            cursor.execute("ALTER TABLE tabCalculosOS ADD COLUMN tiragem INT DEFAULT 0 AFTER total_paginas")
            conn.commit()
            
        print("Schema updated successfully.")
    
    except Exception as e:
        print(f"Error creating table: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    update_schema()

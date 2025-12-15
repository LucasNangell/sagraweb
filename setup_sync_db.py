
import pymysql
from config_manager import config_manager
import logging

# Configuração de Log
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

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

def setup_db():
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cur:
            # 1. Create Sync Changes Log Table
            logging.info("Creating table `sync_changes_log`...")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS `sync_changes_log` (
                    `id` INT AUTO_INCREMENT PRIMARY KEY,
                    `table_name` VARCHAR(50) NOT NULL,
                    `pk_json` JSON NOT NULL,
                    `action` ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
                    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    `processed` TINYINT(1) DEFAULT 0,
                    INDEX `idx_processed` (`processed`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            # 2. Define Triggers
            # We need triggers for: tabAndamento, tabProtocolos, tabDetalhesServico
            
            tables_config = [
                {
                    "name": "tabAndamento",
                    "pk": ["CodStatus"] # Primary Key real
                },
                {
                    "name": "tabProtocolos",
                    "pk": ["NroProtocolo", "AnoProtocolo"]
                },
                {
                    "name": "tabDetalhesServico",
                    "pk": ["NroProtocoloLinkDet", "AnoProtocoloLinkDet"] # This might not be unique? Let's check. 
                    # Assuming it is unique enough for the row or we use all keys.
                    # Wait, tabDetalhesServico in Access usually has more keys? 
                    # Let's use the keys available in the context of the table.
                }
            ]

            # Drop ALL existing triggers to ensure clean state
            triggers = [
                "trg_tabAndamento_after_insert", "trg_tabAndamento_after_update", "trg_tabAndamento_after_delete",
                "trg_tabProtocolos_after_insert", "trg_tabProtocolos_after_update", "trg_tabProtocolos_after_delete",
                "trg_tabDetalhesServico_after_insert", "trg_tabDetalhesServico_after_update", "trg_tabDetalhesServico_after_delete"
            ]
            for t in triggers:
                try:
                    cur.execute(f"DROP TRIGGER IF EXISTS {t}")
                except Exception as e:
                    logging.warning(f"Error dropping trigger {t}: {e}")

            # Create Triggers ONLY for tabAndamento (New Requirements)
            logging.info("Creating triggers for tabAndamento (INSERT Only)...")
            
            # INSERT: Monitor new records from Web to Sync to MDB
            cur.execute("""
                CREATE TRIGGER trg_tabAndamento_after_insert AFTER INSERT ON tabAndamento
                FOR EACH ROW
                BEGIN
                    INSERT INTO sync_changes_log (table_name, pk_json, action)
                    VALUES ('tabAndamento', JSON_OBJECT('CodStatus', NEW.CodStatus, 'NroProtocoloLink', NEW.NroProtocoloLink, 'AnoProtocoloLink', NEW.AnoProtocoloLink), 'INSERT');
                END;
            """)
            
            # Other triggers removed as requested (Exclusive Direction MDB->MySQL for others)

            logging.info("Setup completed successfully!")

    except Exception as e:
        logging.error(f"Failed to setup DB: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()

if __name__ == "__main__":
    setup_db()

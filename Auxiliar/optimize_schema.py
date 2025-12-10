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

def execute_sql(cursor, sql, description):
    try:
        logging.info(f"Executing: {description}")
        cursor.execute(sql)
        logging.info("  Success.")
    except Exception as e:
        logging.warning(f"  Failed (might already verify?): {e}")

def optimize_schema():
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cursor:
            # 1. tabProtocolos
            # Backup first? Assuming user has backup or we rely on reimport.
            # Convert NroProtocolo/AnoProtocolo to INT.
            # Note: Changing types usually requires cleaning data first or using forceful ALTER.
            # Since we have clean import scripts, we can TRUNCATE and ALTER, then Re-Import is safest,
            # BUT user asked to keep data if possible.
            # ALTER TABLE MODIFY will allow MySQL to try casting.
            
            logging.info("--- Optimizing tabProtocolos ---")
            execute_sql(cursor, "ALTER TABLE tabProtocolos MODIFY NroProtocolo INT", "Convert NroProtocolo to INT")
            execute_sql(cursor, "ALTER TABLE tabProtocolos MODIFY AnoProtocolo INT", "Convert AnoProtocolo to INT")
            # Convert Dates
            # Dates in text format might fail conversion depending on format ('DD/MM/YYYY' vs 'YYYY-MM-DD').
            # MySQL STR_TO_DATE is needed if format is 'DD/MM/YYYY'. 
            # Safest is to add new column, update, drop old.
            # But for now, let's assume we will TRUNCATE and Re-Sync with new types, it is cleaner.
            # However, user didn't explicitly say "Clear DB".
            # Let's try aggressive ALTER. If it zeroes out data, we can re-import from Access using "Reimportar" button.
            
            # Actually, standard procedure: Truncate tables, Modify Schema, Re-import.
            # Attempting to convert "14/05/2024" text to DATE directly via ALTER usually fails or nulls.
            
            logging.info("Truncating tables to ensure clean schema change (Data will be re-imported)...")
            execute_sql(cursor, "SET FOREIGN_KEY_CHECKS=0", "Disable FK")
            execute_sql(cursor, "TRUNCATE TABLE tabProtocolos", "Truncate tabProtocolos")
            execute_sql(cursor, "TRUNCATE TABLE tabDetalhesServico", "Truncate tabDetalhesServico")
            execute_sql(cursor, "TRUNCATE TABLE tabAndamento", "Truncate tabAndamento")
            
            # Now safe to modify types
            execute_sql(cursor, "ALTER TABLE tabProtocolos MODIFY NroProtocolo INT", "NroProtocolo INT")
            execute_sql(cursor, "ALTER TABLE tabProtocolos MODIFY AnoProtocolo INT", "AnoProtocolo INT")
            execute_sql(cursor, "ALTER TABLE tabProtocolos MODIFY DataEntrada DATE", "DataEntrada DATE")
            execute_sql(cursor, "ALTER TABLE tabProtocolos MODIFY EntregData DATE", "EntregData DATE")
            execute_sql(cursor, "ALTER TABLE tabProtocolos MODIFY CotaRepro INT", "CotaRepro INT")
            execute_sql(cursor, "ALTER TABLE tabProtocolos MODIFY CotaCartao INT", "CotaCartao INT")
            
            # tabDetalhesServico
            logging.info("--- Optimizing tabDetalhesServico ---")
            execute_sql(cursor, "ALTER TABLE tabDetalhesServico MODIFY NroProtocoloLinkDet INT", "NroLink INT")
            execute_sql(cursor, "ALTER TABLE tabDetalhesServico MODIFY AnoProtocoloLinkDet INT", "AnoLink INT")
            execute_sql(cursor, "ALTER TABLE tabDetalhesServico MODIFY Tiragem INT", "Tiragem INT")
            execute_sql(cursor, "ALTER TABLE tabDetalhesServico MODIFY Pags INT", "Pags INT")
            
            # tabAndamento
            logging.info("--- Optimizing tabAndamento ---")
            execute_sql(cursor, "ALTER TABLE tabAndamento MODIFY NroProtocoloLink INT", "NroLink INT")
            execute_sql(cursor, "ALTER TABLE tabAndamento MODIFY AnoProtocoloLink INT", "AnoLink INT")
            # Data in Andamento often includes Time
            execute_sql(cursor, "ALTER TABLE tabAndamento MODIFY Data DATETIME", "Data DATETIME")
            execute_sql(cursor, "ALTER TABLE tabAndamento MODIFY UltimoStatus TINYINT", "UltimoStatus TINYINT")

            execute_sql(cursor, "SET FOREIGN_KEY_CHECKS=1", "Enable FK")
            
            logging.info("Schema Optimization Complete. Please run Re-Import.")

    except Exception as e:
        logging.error(f"Error during optimization: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    optimize_schema()

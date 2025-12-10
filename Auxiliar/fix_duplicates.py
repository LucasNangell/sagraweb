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

def remove_duplicates():
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cursor:
            # 1. tabProtocolos
            logging.info("Cleaning tabProtocolos...")
            # Keep the row with the LOWEST ID (assuming auto-increment ID exists? Let's check schemas first... Wait, inspect_db showed no ID column for Protocolos, usually it's composite PK)
            # If no unique ID, we use temporary table or self delete.
            # Inspect structure shows: NroProtocolo, AnoProtocolo are likely the logical PK.
            # But inspect_db output didn't show a dedicated primary key 'id' column for tabProtocolos, just Business Keys.
            # Let's check duplicates based on Business Keys.
            
            # Count duplicates
            cursor.execute("""
                SELECT NroProtocolo, AnoProtocolo, COUNT(*) as c 
                FROM tabProtocolos 
                GROUP BY NroProtocolo, AnoProtocolo 
                HAVING c > 1
            """)
            dupes = cursor.fetchall()
            logging.info(f"Found {len(dupes)} duplicate groups in tabProtocolos.")
            
            # Since we don't know if there's a unique ID safe to delete by, let's use a temporary table approach which is safer.
            # Or assume we can just keep one.
            if dupes:
                cursor.execute("""
                    CREATE TABLE temp_proto AS 
                    SELECT * FROM tabProtocolos GROUP BY NroProtocolo, AnoProtocolo;
                """)
                cursor.execute("TRUNCATE TABLE tabProtocolos;")
                cursor.execute("INSERT INTO tabProtocolos SELECT * FROM temp_proto;")
                cursor.execute("DROP TABLE temp_proto;")
                logging.info("tabProtocolos cleaned (deduplicated by Group By).")

            # 2. tabDetalhesServico
            logging.info("Cleaning tabDetalhesServico...")
            cursor.execute("""
                SELECT NroProtocoloLinkDet, AnoProtocoloLinkDet, COUNT(*) as c 
                FROM tabDetalhesServico 
                GROUP BY NroProtocoloLinkDet, AnoProtocoloLinkDet 
                HAVING c > 1
            """)
            dupes_det = cursor.fetchall()
            logging.info(f"Found {len(dupes_det)} duplicate groups in tabDetalhesServico.")
            
            if dupes_det:
                cursor.execute("""
                    CREATE TABLE temp_det AS 
                    SELECT * FROM tabDetalhesServico GROUP BY NroProtocoloLinkDet, AnoProtocoloLinkDet;
                """)
                cursor.execute("TRUNCATE TABLE tabDetalhesServico;")
                cursor.execute("INSERT INTO tabDetalhesServico SELECT * FROM temp_det;")
                cursor.execute("DROP TABLE temp_det;")
                logging.info("tabDetalhesServico cleaned.")

            # 3. tabAndamento
            logging.info("Cleaning tabAndamento...")
            cursor.execute("""
                SELECT CodStatus, COUNT(*) as c 
                FROM tabAndamento 
                GROUP BY CodStatus 
                HAVING c > 1
            """)
            dupes_and = cursor.fetchall()
            logging.info(f"Found {len(dupes_and)} duplicate groups in tabAndamento.")

            if dupes_and:
                cursor.execute("""
                    CREATE TABLE temp_and AS 
                    SELECT * FROM tabAndamento GROUP BY CodStatus;
                """)
                cursor.execute("TRUNCATE TABLE tabAndamento;")
                cursor.execute("INSERT INTO tabAndamento SELECT * FROM temp_and;")
                cursor.execute("DROP TABLE temp_and;")
                logging.info("tabAndamento cleaned.")

    except Exception as e:
        logging.error(f"Error cleaning duplicates: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    remove_duplicates()

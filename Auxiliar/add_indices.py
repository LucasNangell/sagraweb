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

def add_indices():
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cursor:
            # tabProtocolos
            try:
                logging.info("Adding UNIQUE INDEX to tabProtocolos(NroProtocolo, AnoProtocolo)...")
                cursor.execute("ALTER TABLE tabProtocolos ADD UNIQUE INDEX idx_proto_unique (NroProtocolo, AnoProtocolo);")
                logging.info("Success.")
            except Exception as e:
                logging.warning(f"Could not add index to tabProtocolos (maybe exists or dupes?): {e}")

            # tabDetalhesServico
            try:
                logging.info("Adding UNIQUE INDEX to tabDetalhesServico(NroProtocoloLinkDet, AnoProtocoloLinkDet)...")
                cursor.execute("ALTER TABLE tabDetalhesServico ADD UNIQUE INDEX idx_detalhes_unique (NroProtocoloLinkDet, AnoProtocoloLinkDet);")
                logging.info("Success.")
            except Exception as e:
                logging.warning(f"Could not add index to tabDetalhesServico: {e}")

            # tabAndamento
            try:
                logging.info("Adding UNIQUE INDEX to tabAndamento(CodStatus)...")
                cursor.execute("ALTER TABLE tabAndamento ADD UNIQUE INDEX idx_andamento_unique (CodStatus);")
                logging.info("Success.")
            except Exception as e:
                logging.warning(f"Could not add index to tabAndamento: {e}")

    except Exception as e:
        logging.error(f"Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    add_indices()

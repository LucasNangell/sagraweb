from database import db
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def setup():
    logger.info("Setting up database tables...")
    
    # Create tabAnalises if not exists (just to be safe, though it should exist)
    sql_analises = """
    CREATE TABLE IF NOT EXISTS tabAnalises (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        OS INT NOT NULL,
        Ano INT NOT NULL,
        Versao VARCHAR(50),
        Componente VARCHAR(100),
        Usuario VARCHAR(100),
        DataCriacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_os_analise (OS, Ano)
    );
    """
    
    # Create tabAnaliseItens
    # Note: ID_ProblemaPadrao can be 0 or NULL if custom? 
    # The current logic uses ID from library.
    sql_itens = """
    CREATE TABLE IF NOT EXISTS tabAnaliseItens (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        ID_Analise INT NOT NULL,
        ID_ProblemaPadrao INT,
        Obs TEXT,
        HTML_Snapshot LONGTEXT,
        Componente VARCHAR(255),
        FOREIGN KEY (ID_Analise) REFERENCES tabAnalises(ID) ON DELETE CASCADE
    );
    """

    sql_tokens = """
    CREATE TABLE IF NOT EXISTS tabClientTokens (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        ID_Analise INT NOT NULL,
        NroProtocolo INT NOT NULL,
        AnoProtocolo INT NOT NULL,
        Token VARCHAR(64) NOT NULL,
        DataCriacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        DataExpiracao DATETIME NULL,
        UNIQUE KEY unique_token (Token),
        FOREIGN KEY (ID_Analise) REFERENCES tabAnalises(ID) ON DELETE CASCADE
    );
    """
    
    try:
        db.execute_query(sql_analises)
        logger.info("tabAnalises checked/created.")
        
        db.execute_query(sql_itens)
        logger.info("tabAnaliseItens checked/created.")

        db.execute_query(sql_tokens)
        logger.info("tabClientTokens checked/created.")

        # --- MIGRATION FOR CLIENT PORTAL ---
        try:
            chk = db.execute_query("SHOW COLUMNS FROM tabAnaliseItens LIKE 'Desconsiderado'")
            if not chk:
                logger.info("Applying migration: Adding client columns to tabAnaliseItens...")
                db.execute_query("""
                    ALTER TABLE tabAnaliseItens 
                    ADD COLUMN Desconsiderado TINYINT(1) DEFAULT 0,
                    ADD COLUMN ClienteNome VARCHAR(150),
                    ADD COLUMN ClientePonto VARCHAR(20),
                    ADD COLUMN DataDesconsiderado DATETIME
                """)
                logger.info("Migration applied successfully.")
            else:
                logger.info("Migration already applied (Desconsiderado column exists).")
        except Exception as e:
             logger.error(f"Migration error: {e}")

        # --- MIGRATION FOR RESOLVER STATUS ---
        try:
            chk_res = db.execute_query("SHOW COLUMNS FROM tabAnaliseItens LIKE 'Resolver'")
            if not chk_res:
                logger.info("Applying migration: Adding Resolver columns...")
                db.execute_query("""
                    ALTER TABLE tabAnaliseItens 
                    ADD COLUMN Resolver TINYINT(1) DEFAULT 0,
                    ADD COLUMN DataResolver DATETIME
                """)
                logger.info("Migration Resolver applied.")
            else:
                logger.info("Migration Resolver already applied.")
        except Exception as e:
            logger.error(f"Migration Resolver error: {e}")
        
    except Exception as e:
        logger.error(f"Error creating tables: {e}")

if __name__ == "__main__":
    setup()

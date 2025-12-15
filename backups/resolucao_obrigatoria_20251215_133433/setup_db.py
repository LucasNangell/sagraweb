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

        # --- MIGRATION FOR RESOLUCAO OBRIGATORIA ---
        try:
            chk_obrig = db.execute_query("SHOW COLUMNS FROM tabAnaliseItens LIKE 'ResolucaoObrigatoria'")
            if not chk_obrig:
                logger.info("Applying migration: Adding ResolucaoObrigatoria column...")
                db.execute_query("""
                    ALTER TABLE tabAnaliseItens 
                    ADD COLUMN ResolucaoObrigatoria TINYINT(1) NOT NULL DEFAULT 0
                """)
                logger.info("Migration ResolucaoObrigatoria applied.")
            else:
                logger.info("Migration ResolucaoObrigatoria already applied.")
        except Exception as e:
            logger.error(f"Migration ResolucaoObrigatoria error: {e}")
        
    except Exception as e:
        logger.error(f"Error creating tables: {e}")

    # --- FILTER SETTINGS TABLE ---
    try:
        sql_settings = """
        CREATE TABLE IF NOT EXISTS tabUserFilterSettings (
            ID INT PRIMARY KEY AUTO_INCREMENT,
            Usuario VARCHAR(150) NOT NULL,
            Ponto VARCHAR(20) NOT NULL,
            Situacoes TEXT NULL,
            Setores TEXT NULL,
            DataAtualizacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_ponto (Ponto)
        );
        """
        db.execute_query(sql_settings)
        logger.info("tabUserFilterSettings checked/created.")
    except Exception as e:
        logger.error(f"Error creating filter table: {e}")

    # --- Tabela de Vínculos entre OSs ---
    try:
        sql_vinc = """
        CREATE TABLE IF NOT EXISTS tabOSVinculadas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            os_principal_numero INT NOT NULL,
            os_principal_ano INT NOT NULL,
            os_vinculada_numero INT NOT NULL,
            os_vinculada_ano INT NOT NULL,
            data_vinculo DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_link (os_principal_numero, os_principal_ano, os_vinculada_numero, os_vinculada_ano)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        db.execute_query(sql_vinc)
        logger.info("tabOSVinculadas checked/created.")
    except Exception as e:
        logger.error(f"Error creating tabOSVinculadas: {e}")

    # --- Tabela de Exceções/Divergências de Andamento para vínculos ---
    try:
        sql_exc = """
        CREATE TABLE IF NOT EXISTS tabOSVinculoExcecoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            NroProtocolo INT NOT NULL,
            AnoProtocolo INT NOT NULL,
            DataExcecao DATETIME DEFAULT CURRENT_TIMESTAMP,
            Observacao VARCHAR(255) DEFAULT NULL,
            UNIQUE KEY unique_exc (NroProtocolo, AnoProtocolo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        db.execute_query(sql_exc)
        logger.info("tabOSVinculoExcecoes checked/created.")
    except Exception as e:
        logger.error(f"Error creating tabOSVinculoExcecoes: {e}")

if __name__ == "__main__":
    setup()

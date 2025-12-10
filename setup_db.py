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
    
    try:
        db.execute_query(sql_analises)
        logger.info("tabAnalises checked/created.")
        
        db.execute_query(sql_itens)
        logger.info("tabAnaliseItens checked/created.")
        
    except Exception as e:
        logger.error(f"Error creating tables: {e}")

if __name__ == "__main__":
    setup()

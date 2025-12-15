"""
Script para adicionar colunas de armazenamento de HTML de e-mail PT
Adiciona colunas na tabela tabProtocolos para armazenar o HTML gerado
"""
from database import db
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def add_email_pt_columns():
    """Adiciona colunas para armazenamento de HTML de e-mail PT"""
    
    alterations = [
        """
        ALTER TABLE tabProtocolos
        ADD COLUMN IF NOT EXISTS email_pt_html TEXT NULL
        """,
        """
        ALTER TABLE tabProtocolos
        ADD COLUMN IF NOT EXISTS email_pt_versao VARCHAR(50) NULL
        """,
        """
        ALTER TABLE tabProtocolos
        ADD COLUMN IF NOT EXISTS email_pt_data TIMESTAMP NULL
        """
    ]
    
    try:
        with db.cursor() as cursor:
            for sql in alterations:
                logger.info(f"Executando: {sql.strip()}")
                cursor.execute(sql)
                logger.info("✓ Executado com sucesso")
        
        logger.info("✓ Todas as colunas foram adicionadas com sucesso!")
        return True
        
    except Exception as e:
        logger.error(f"Erro ao adicionar colunas: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("ADICIONANDO COLUNAS PARA EMAIL PT HTML")
    print("=" * 60)
    
    success = add_email_pt_columns()
    
    if success:
        print("\n✓ Script executado com sucesso!")
        print("\nColunas adicionadas:")
        print("  - email_pt_html (TEXT)")
        print("  - email_pt_versao (VARCHAR(50))")
        print("  - email_pt_data (TIMESTAMP)")
    else:
        print("\n✗ Erro ao executar script. Verifique os logs acima.")

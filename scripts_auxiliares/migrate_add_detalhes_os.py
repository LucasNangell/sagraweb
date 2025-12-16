#!/usr/bin/env python3
"""
Migração: Adiciona coluna ctx_detalhes_os na tabela ip_permissions
Permite controlar se o IP pode visualizar detalhes da OS em modo somente leitura
"""

from database import Database
import logging

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("MigracaoDetalhesOS")

def migrate():
    """Adiciona coluna ctx_detalhes_os"""
    db = Database()
    
    try:
        # Verificar se a coluna já existe
        check = db.execute_query("""
            SELECT COUNT(*) as count 
            FROM information_schema.columns 
            WHERE table_schema = DATABASE() 
            AND table_name = 'ip_permissions' 
            AND column_name = 'ctx_detalhes_os'
        """)
        
        if check and check[0]['count'] > 0:
            logger.info("✓ Coluna 'ctx_detalhes_os' já existe!")
            return
        
        logger.info("Adicionando coluna 'ctx_detalhes_os'...")
        
        # Adicionar coluna após ctx_imprimir_ficha
        db.execute_query("""
            ALTER TABLE ip_permissions 
            ADD COLUMN ctx_detalhes_os BOOLEAN DEFAULT TRUE 
            AFTER ctx_imprimir_ficha
        """)
        
        logger.info("✓ Coluna 'ctx_detalhes_os' adicionada com sucesso!")
        
        # Atualizar registros existentes (TRUE por padrão para manter compatibilidade)
        db.execute_query("UPDATE ip_permissions SET ctx_detalhes_os = TRUE WHERE ctx_detalhes_os IS NULL")
        logger.info("✓ Registros existentes atualizados!")
        
        logger.info("\n✅ Migração concluída com sucesso!")
        
    except Exception as e:
        logger.error(f"\n❌ Erro durante migração: {e}")
        raise

if __name__ == "__main__":
    print("\n" + "="*60)
    print("🔄 MIGRAÇÃO: Adicionar permissão 'Detalhes da OS'")
    print("="*60 + "\n")
    
    migrate()
    
    print("\n" + "="*60)
    print("Migração finalizada!")
    print("="*60 + "\n")

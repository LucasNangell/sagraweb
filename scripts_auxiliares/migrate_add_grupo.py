"""
Script para adicionar coluna 'grupo' na tabela ip_permissions
"""

from database import Database

def add_grupo_column():
    db = Database()
    
    with db.cursor() as cursor:
        try:
            # Verificar se a coluna já existe
            cursor.execute("""
                SELECT COUNT(*) as count 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = 'sagrafulldb' 
                AND TABLE_NAME = 'ip_permissions' 
                AND COLUMN_NAME = 'grupo'
            """)
            
            result = cursor.fetchone()
            
            if result['count'] == 0:
                print("Adicionando coluna 'grupo' na tabela ip_permissions...")
                cursor.execute("""
                    ALTER TABLE ip_permissions 
                    ADD COLUMN grupo VARCHAR(100) DEFAULT 'Sem Grupo' AFTER descricao
                """)
                print("✓ Coluna 'grupo' adicionada com sucesso!")
                
                # Atualizar registros existentes sem grupo
                cursor.execute("""
                    UPDATE ip_permissions 
                    SET grupo = 'Sem Grupo' 
                    WHERE grupo IS NULL OR grupo = ''
                """)
                print("✓ Registros existentes atualizados!")
            else:
                print("✓ Coluna 'grupo' já existe na tabela")
                
        except Exception as e:
            print(f"❌ Erro: {e}")
            raise

if __name__ == "__main__":
    try:
        add_grupo_column()
        print("\n✅ Migração concluída com sucesso!")
    except Exception as e:
        print(f"\n❌ Erro durante migração: {e}")
        import traceback
        traceback.print_exc()

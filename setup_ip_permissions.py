"""
Script para criar/atualizar a tabela de permissões por IP
Mantém compatibilidade com IPs existentes (todas permissões = TRUE por padrão)
"""

from database import Database

def setup_ip_permissions_table():
    db = Database()
    
    # SQL para criar a tabela com todas as permissões
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS ip_permissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL UNIQUE,
        descricao VARCHAR(255),
        grupo VARCHAR(100) DEFAULT 'Sem Grupo',
        ativo BOOLEAN DEFAULT TRUE,
        
        -- Permissões do Menu de Contexto
        ctx_nova_os BOOLEAN DEFAULT TRUE,
        ctx_duplicar_os BOOLEAN DEFAULT TRUE,
        ctx_editar_os BOOLEAN DEFAULT TRUE,
        ctx_vincular_os BOOLEAN DEFAULT TRUE,
        ctx_abrir_pasta BOOLEAN DEFAULT TRUE,
        ctx_imprimir_ficha BOOLEAN DEFAULT TRUE,
        ctx_detalhes_os BOOLEAN DEFAULT TRUE,
        
        -- Permissões do Sidebar
        sb_inicio BOOLEAN DEFAULT TRUE,
        sb_gerencia BOOLEAN DEFAULT TRUE,
        sb_email BOOLEAN DEFAULT TRUE,
        sb_analise BOOLEAN DEFAULT TRUE,
        sb_papelaria BOOLEAN DEFAULT TRUE,
        sb_usuario BOOLEAN DEFAULT TRUE,
        sb_configuracoes BOOLEAN DEFAULT TRUE,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
    """
    
    with db.cursor() as cursor:
        print("Criando/verificando tabela ip_permissions...")
        cursor.execute(create_table_sql)
        print("✓ Tabela ip_permissions criada/atualizada com sucesso!")
        
        # Verificar se há IPs na tabela antiga (se existir)
        try:
            cursor.execute("SELECT COUNT(*) as total FROM allowed_ips")
            result = cursor.fetchone()
            if result and result['total'] > 0:
                print(f"\nEncontrados {result['total']} IPs na tabela antiga 'allowed_ips'")
                
                # Migrar dados
                cursor.execute("""
                    INSERT IGNORE INTO ip_permissions (ip, descricao, ativo)
                    SELECT ip, descricao, ativo FROM allowed_ips
                """)
                print("✓ Dados migrados com sucesso! (todas permissões = TRUE por padrão)")
        except Exception as e:
            print(f"Nota: Tabela 'allowed_ips' não encontrada ou erro: {e}")
            print("Isso é normal se for a primeira vez executando o sistema.")
        
        # Criar IP padrão se não houver nenhum
        cursor.execute("SELECT COUNT(*) as total FROM ip_permissions")
        result = cursor.fetchone()
        
        if result['total'] == 0:
            print("\nNenhum IP cadastrado. Criando IP padrão (rede local)...")
            cursor.execute("""
                INSERT INTO ip_permissions (ip, descricao, ativo)
                VALUES ('10.120.1.%', 'Rede local DEAPA', TRUE)
            """)
            print("✓ IP padrão criado: 10.120.1.% (permite toda rede local)")

if __name__ == "__main__":
    try:
        setup_ip_permissions_table()
        print("\n✅ Setup concluído com sucesso!")
    except Exception as e:
        print(f"\n❌ Erro durante setup: {e}")
        import traceback
        traceback.print_exc()

#!/usr/bin/env python3
"""
Script de Migração: tabIpPermitidos → ip_permissions

Migra todos os IPs da tabela antiga 'tabIpPermitidos' para a nova tabela 'ip_permissions'.
- IPs ativos recebem todas as permissões habilitadas (para manter comportamento atual)
- IPs inativos são migrados como inativos
- Grupo padrão: 'Migrado - Verificar'
- Duplicatas são ignoradas (baseado no IP)
"""

from database import Database
import logging

# Configuração de Logs
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("MigracaoIPs")

def migrate_ips():
    """Migra IPs de tabIpPermitidos para ip_permissions"""
    db = Database()
    
    try:
        # 1. Verificar se a tabela antiga existe
        logger.info("🔍 Verificando tabela antiga 'tabIpPermitidos'...")
        check_old = db.execute_query("""
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE() 
            AND table_name = 'tabIpPermitidos'
        """)
        
        if not check_old or check_old[0]['count'] == 0:
            logger.error("❌ Tabela 'tabIpPermitidos' não encontrada!")
            return
        
        # 2. Verificar se a nova tabela existe
        logger.info("🔍 Verificando tabela nova 'ip_permissions'...")
        check_new = db.execute_query("""
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE() 
            AND table_name = 'ip_permissions'
        """)
        
        if not check_new or check_new[0]['count'] == 0:
            logger.error("❌ Tabela 'ip_permissions' não encontrada!")
            logger.error("   Execute 'setup_ip_permissions.py' primeiro!")
            return
        
        # 3. Buscar IPs da tabela antiga
        logger.info("\n📋 Buscando IPs da tabela antiga...")
        old_ips = db.execute_query("""
            SELECT id, ip, descricao, ativo 
            FROM tabIpPermitidos 
            ORDER BY id
        """)
        
        if not old_ips:
            logger.info("ℹ️  Nenhum IP encontrado na tabela antiga.")
            return
        
        logger.info(f"   Encontrados {len(old_ips)} IPs para migrar\n")
        
        # 4. Buscar IPs já existentes na nova tabela
        logger.info("🔍 Verificando IPs já existentes na nova tabela...")
        existing_ips = db.execute_query("SELECT ip FROM ip_permissions")
        existing_set = {row['ip'] for row in existing_ips} if existing_ips else set()
        logger.info(f"   {len(existing_set)} IPs já existem na nova tabela\n")
        
        # 5. Migrar IPs
        logger.info("🚀 Iniciando migração...\n")
        
        migrated = 0
        skipped = 0
        errors = 0
        
        for old_ip in old_ips:
            ip = old_ip['ip']
            descricao = old_ip['descricao'] or f"Migrado ID {old_ip['id']}"
            ativo = bool(old_ip['ativo'])
            
            # Verificar duplicata
            if ip in existing_set:
                logger.info(f"⏭️  {ip:20s} - JÁ EXISTE (pulando)")
                skipped += 1
                continue
            
            try:
                # Inserir com todas as permissões habilitadas se ativo
                # Isso mantém o comportamento anterior (acesso total)
                db.execute_query("""
                    INSERT INTO ip_permissions (
                        ip, descricao, grupo, ativo,
                        ctx_nova_os, ctx_duplicar_os, ctx_editar_os, 
                        ctx_vincular_os, ctx_abrir_pasta, ctx_imprimir_ficha,
                        sb_inicio, sb_gerencia, sb_email, 
                        sb_analise, sb_papelaria, sb_usuario, sb_configuracoes
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s
                    )
                """, (
                    ip,
                    descricao,
                    'Migrado - Verificar',  # Grupo padrão para revisão
                    ativo,
                    # Permissões: todas TRUE se ativo, FALSE se inativo
                    ativo, ativo, ativo, ativo, ativo, ativo,  # Context menu
                    ativo, ativo, ativo, ativo, ativo, ativo, ativo  # Sidebar
                ))
                
                status = "✅ ATIVO" if ativo else "⏸️  INATIVO"
                logger.info(f"{status} {ip:20s} - {descricao}")
                migrated += 1
                
            except Exception as e:
                logger.error(f"❌ ERRO  {ip:20s} - {e}")
                errors += 1
        
        # 6. Resumo
        logger.info("\n" + "="*60)
        logger.info("📊 RESUMO DA MIGRAÇÃO")
        logger.info("="*60)
        logger.info(f"✅ Migrados com sucesso: {migrated}")
        logger.info(f"⏭️  Já existentes (pulados): {skipped}")
        logger.info(f"❌ Erros: {errors}")
        logger.info(f"📋 Total processado: {len(old_ips)}")
        logger.info("="*60)
        
        if migrated > 0:
            logger.info("\n💡 IMPORTANTE:")
            logger.info("   - Todos os IPs migrados receberam o grupo 'Migrado - Verificar'")
            logger.info("   - IPs ativos receberam TODAS as permissões habilitadas")
            logger.info("   - IPs inativos ficaram com todas as permissões desabilitadas")
            logger.info("   - Revise e ajuste os grupos e permissões em admin_ips.html")
        
        logger.info("\n✅ Migração concluída com sucesso!")
        
    except Exception as e:
        logger.error(f"\n❌ Erro durante migração: {e}")
        raise

if __name__ == "__main__":
    print("\n" + "="*60)
    print("🔄 MIGRAÇÃO: tabIpPermitidos → ip_permissions")
    print("="*60 + "\n")
    
    migrate_ips()
    
    print("\n" + "="*60)
    print("Migração finalizada!")
    print("="*60 + "\n")

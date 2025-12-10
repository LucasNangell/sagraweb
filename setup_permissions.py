from database import db
import logging

# Configuração de Logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SetupPermissions")

def create_table():
    logger.info("Criando tabela 'tabPermissoes'...")
    
    query_create = """
    CREATE TABLE IF NOT EXISTS tabPermissoes (
        Nivel INT PRIMARY KEY,
        Nome VARCHAR(50) NOT NULL,
        PermCriarOS BOOLEAN DEFAULT FALSE,
        PermEditarOS BOOLEAN DEFAULT FALSE,
        PermPapelaria BOOLEAN DEFAULT FALSE,
        PermAnalise BOOLEAN DEFAULT FALSE,
        PermEmail BOOLEAN DEFAULT FALSE,
        PermAdmin BOOLEAN DEFAULT FALSE
    );
    """
    
    try:
        db.execute_query(query_create)
        logger.info("Tabela criada (ou já existia).")
    except Exception as e:
        logger.error(f"Erro ao criar tabela: {e}")
        return

    # Inserir os 5 níveis iniciais
    levels = [
        (1, "Nível 1 - Básico"),
        (2, "Nível 2 - Operacional"),
        (3, "Nível 3 - Supervisor"),
        (4, "Nível 4 - Gerente"),
        (5, "Nível 5 - Administrador")
    ]

    query_check = "SELECT COUNT(*) as c FROM tabPermissoes"
    res = db.execute_query(query_check)
    count = res[0]['c'] if res else 0

    if count < 5:
        logger.info("Populando níveis de permissão padrão...")
        query_insert = """
        INSERT INTO tabPermissoes (Nivel, Nome, PermCriarOS, PermEditarOS, PermPapelaria, PermAnalise, PermEmail, PermAdmin)
        VALUES (%s, %s, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE)
        ON DUPLICATE KEY UPDATE Nome = VALUES(Nome)
        """
        
        for lvl, nome in levels:
            try:
                db.execute_query(query_insert, (lvl, nome))
                logger.info(f"Nível {lvl} inserido/atualizado.")
            except Exception as e:
                logger.error(f"Erro ao inserir nível {lvl}: {e}")
    else:
        logger.info("Tabela já populada.")

    # Exibir estado atual
    final_res = db.execute_query("SELECT * FROM tabPermissoes ORDER BY Nivel")
    print("\n--- Estado Atual da Tabela de Permissões ---")
    for row in final_res:
        print(row)

if __name__ == "__main__":
    create_table()

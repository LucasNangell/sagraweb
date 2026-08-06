import mysql.connector
import os
import sys
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)
from config_manager import config_manager

# ---------------- CONFIGURAÇÃO ----------------
db_config = config_manager.get_mysql_config()
db_config['raise_on_warnings'] = True

def processar_em_massa():
    conn = None
    try:
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()

        print("Iniciando processamento em massa no banco de dados...")

        # ---------------------------------------------------------
        # PASSO 1: INSERT INTO ... SELECT
        # Cria os novos registros baseados nos antigos.
        # A mágica do CodStatus acontece aqui com SUBSTRING_INDEX e LPAD
        # ---------------------------------------------------------
        sql_insert = """
            INSERT INTO tabandamento (
                CodStatus, 
                NroProtocoloLink, 
                AnoProtocoloLink, 
                SituacaoLink, 
                SetorLink, 
                Data, 
                UltimoStatus, 
                Observaçao, 
                Ponto
            )
            SELECT
                CONCAT(
                    SUBSTRING_INDEX(CodStatus, '-', 1), 
                    '-', 
                    LPAD(CAST(SUBSTRING_INDEX(CodStatus, '-', -1) AS UNSIGNED) + 1, 2, '0')
                ), -- Gera o novo CodStatus (Ex: 020102013-09 vira 020102013-10)
                NroProtocoloLink,
                AnoProtocoloLink,
                'Cancelado',         -- Nova Situação
                'SEFOC',             -- Novo Setor
                NOW(),               -- Data Atual
                1,                   -- UltimoStatus Novo = TRUE
                'Cancelado por tempo excessivo',
                '918.713'
            FROM tabandamento
            WHERE YEAR(Data) <= 2023 
              AND UltimoStatus = 1 
              AND SituacaoLink NOT IN ('Entregue', 'Cancelado')
              AND CodStatus LIKE '%-%'; -- Segurança extra para garantir formato
        """
        
        cursor.execute(sql_insert)
        registros_criados = cursor.rowcount
        print(f"Novos registros de cancelamento criados: {registros_criados}")

        # ---------------------------------------------------------
        # PASSO 2: UPDATE
        # Desativa os registros antigos (define UltimoStatus = 0)
        # Usamos o mesmo filtro WHERE (exceto que agora existem novos registros 'Cancelado', 
        # mas o filtro 'NOT IN Cancelado' impede que desativemos os que acabamos de criar)
        # ---------------------------------------------------------
        sql_update = """
            UPDATE tabandamento
            SET UltimoStatus = 0
            WHERE YEAR(Data) <= 2023 
              AND UltimoStatus = 1 
              AND SituacaoLink NOT IN ('Entregue', 'Cancelado');
        """
        
        cursor.execute(sql_update)
        registros_atualizados = cursor.rowcount
        print(f"Registros antigos desativados: {registros_atualizados}")

        # Se tudo der certo, salva.
        conn.commit()
        print("Processo finalizado com sucesso!")

    except mysql.connector.Error as err:
        print(f"Erro Crítico: {err}")
        if conn:
            conn.rollback()
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()

if __name__ == "__main__":
    processar_em_massa()
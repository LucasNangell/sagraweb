import pyodbc
import os
import sys

def atualizar_registros_mdb():
    """
    Atualiza registros na tabela 'tabandamento' alterando o campo SetorLink
    de 'SEFOC/GRAV' para 'Gravação'
    """
    
    # Caminho do banco de dados
    db_path = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Antiga.mdb"
    
    # Verifica se o arquivo existe
    if not os.path.exists(db_path):
        print(f"ERRO: Arquivo não encontrado em: {db_path}")
        return
    
    print(f"Banco de dados encontrado: {db_path}")
    
    # String de conexão para Access .mdb (usando driver Microsoft Access)
    # Para sistemas 32 bits
    conn_str_32 = (
        r'DRIVER={Microsoft Access Driver (*.mdb)};'
        f'DBQ={db_path};'
    )
    
    # Para sistemas 64 bits (se o driver 32 bits não funcionar)
    conn_str_64 = (
        r'DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};'
        f'DBQ={db_path};'
    )
    
    connection = None
    
    try:
        # Tenta conectar primeiro com o driver 32 bits
        print("Tentando conectar com driver 32 bits...")
        try:
            connection = pyodbc.connect(conn_str_32)
            print("Conexão estabelecida com sucesso (driver 32 bits)!")
        except pyodbc.Error as e:
            print(f"Driver 32 bits falhou: {e}")
            print("Tentando conectar com driver 64 bits...")
            connection = pyodbc.connect(conn_str_64)
            print("Conexão estabelecida com sucesso (driver 64 bits)!")
        
        cursor = connection.cursor()
        
        # Primeiro, conta quantos registros serão alterados
        count_query = """
            SELECT COUNT(*) 
            FROM tabandamento 
            WHERE SetorLink = 'SEFOC/GRAV'
        """
        
        cursor.execute(count_query)
        count = cursor.fetchone()[0]
        
        print(f"\nRegistros encontrados para atualização: {count}")
        
        if count == 0:
            print("Nenhum registro encontrado para atualizar.")
            return
        
        # Mostra alguns exemplos dos registros que serão alterados
        sample_query = """
            SELECT TOP 5 * 
            FROM tabandamento 
            WHERE SetorLink = 'SEFOC/GRAV'
        """
        
        cursor.execute(sample_query)
        samples = cursor.fetchall()
        
        if samples:
            print("\nPrimeiros 5 registros que serão alterados:")
            columns = [column[0] for column in cursor.description]
            for row in samples:
                print("-" * 40)
                for i, col in enumerate(columns):
                    print(f"  {col}: {row[i]}")
        
        # Confirmação do usuário
        resposta = input(f"\nDeseja realmente atualizar {count} registro(s)? (S/N): ").upper()
        
        if resposta != 'S':
            print("Operação cancelada pelo usuário.")
            return
        
        # Query de atualização
        update_query = """
            UPDATE tabandamento 
            SET SetorLink = 'Gravação' 
            WHERE SetorLink = 'SEFOC/GRAV'
        """
        
        print("\nExecutando atualização...")
        cursor.execute(update_query)
        connection.commit()
        
        print(f"✓ Atualização concluída com sucesso!")
        print(f"  Registros alterados: {count}")
        print(f"  Campo: SetorLink")
        print(f"  De: 'SEFOC/GRAV'")
        print(f"  Para: 'Gravação'")
        
        # Verificação pós-atualização
        verify_query = """
            SELECT COUNT(*) 
            FROM tabandamento 
            WHERE SetorLink = 'SEFOC/GRAV'
        """
        
        cursor.execute(verify_query)
        remaining_old = cursor.fetchone()[0]
        
        # Verifica quantos registros agora têm o novo valor
        verify_new_query = """
            SELECT COUNT(*) 
            FROM tabandamento 
            WHERE SetorLink = 'Gravação'
        """
        
        cursor.execute(verify_new_query)
        new_count = cursor.fetchone()[0]
        
        if remaining_old == 0:
            print(f"\n✓ Verificação: Todos os registros foram atualizados corretamente.")
            print(f"  Total de registros com 'Gravação': {new_count}")
        else:
            print(f"\n⚠ AVISO: Ainda existem {remaining_old} registro(s) com o valor antigo 'SEFOC/GRAV'.")
            print(f"  Registros alterados para 'Gravação': {new_count}")
        
    except pyodbc.Error as e:
        print(f"\nERRO na operação com o banco de dados: {e}")
        if connection:
            connection.rollback()
            print("Rollback executado.")
        
    except Exception as e:
        print(f"\nERRO inesperado: {e}")
        if connection:
            connection.rollback()
            print("Rollback executado.")
    
    finally:
        if connection:
            cursor.close()
            connection.close()
            print("\nConexão fechada.")

if __name__ == "__main__":
    print("=" * 60)
    print("ATUALIZAÇÃO DE REGISTROS - BANCO DE DADOS ACCESS")
    print("=" * 60)
    print("Banco: Sagra Base - Papelaria Antiga.mdb")
    print("Tabela: tabandamento")
    print("De: 'SEFOC/GRAV'")
    print("Para: 'Gravação'")
    print("=" * 60)
    
    atualizar_registros_mdb()
    
    print("\nPressione Enter para sair...")
    input()
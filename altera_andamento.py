import pyodbc
import os
import sys
from datetime import datetime

def conectar_banco(db_path):
    """Estabelece conexão com o banco de dados Access"""
    
    if not os.path.exists(db_path):
        print(f"ERRO: Arquivo não encontrado em: {db_path}")
        return None
    
    # String de conexão para Access .mdb
    conn_str_32 = (
        r'DRIVER={Microsoft Access Driver (*.mdb)};'
        f'DBQ={db_path};'
    )
    
    conn_str_64 = (
        r'DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};'
        f'DBQ={db_path};'
    )
    
    try:
        # Tenta conectar primeiro com o driver 32 bits
        try:
            connection = pyodbc.connect(conn_str_32)
            print(f"  Conectado com driver 32 bits")
        except pyodbc.Error:
            connection = pyodbc.connect(conn_str_64)
            print(f"  Conectado com driver 64 bits")
        
        return connection
    
    except pyodbc.Error as e:
        print(f"  ERRO ao conectar: {e}")
        return None

def contar_registros(cursor, db_name):
    """Conta quantos registros serão alterados"""
    
    count_query = """
        SELECT COUNT(*) 
        FROM tabandamento 
        WHERE SetorLink = 'SEFOC' 
        AND SituacaoLink = 'Gravação'
    """
    
    cursor.execute(count_query)
    return cursor.fetchone()[0]

def mostrar_amostra(cursor, db_name):
    """Mostra uma amostra dos registros que serão alterados"""
    
    sample_query = """
        SELECT TOP 5 * 
        FROM tabandamento 
        WHERE SetorLink = 'SEFOC' 
        AND SituacaoLink = 'Gravação'
    """
    
    cursor.execute(sample_query)
    samples = cursor.fetchall()
    
    if samples:
        print(f"\n  Primeiros 5 registros que serão alterados em {db_name}:")
        columns = [column[0] for column in cursor.description]
        for idx, row in enumerate(samples, 1):
            print(f"  Registro {idx}:")
            for i, col in enumerate(columns):
                print(f"    {col}: {row[i]}")
            print()

def atualizar_banco(db_path, db_name):
    """Atualiza os registros em um banco específico"""
    
    print(f"\n{'='*60}")
    print(f"Processando: {db_name}")
    print(f"{'='*60}")
    
    connection = conectar_banco(db_path)
    if not connection:
        return False
    
    try:
        cursor = connection.cursor()
        
        # Conta registros a serem alterados
        count = contar_registros(cursor, db_name)
        print(f"\n  Registros encontrados para atualização: {count}")
        
        if count == 0:
            print("  Nenhum registro para alterar neste banco.")
            return True
        
        # Mostra amostra
        mostrar_amostra(cursor, db_name)
        
        # Query de atualização
        update_query = """
            UPDATE tabandamento 
            SET SetorLink = 'Gravação', 
                SituacaoLink = 'Saída p/' 
            WHERE SetorLink = 'SEFOC' 
            AND SituacaoLink = 'Gravação'
        """
        
        print(f"  Executando atualização...")
        cursor.execute(update_query)
        connection.commit()
        
        print(f"  ✓ Atualização concluída com sucesso!")
        print(f"    Registros alterados: {count}")
        print(f"    SetorLink: 'SEFOC' -> 'Gravação'")
        print(f"    SituacaoLink: 'Gravação' -> 'Saída p/'")
        
        # Verificação pós-atualização
        verify_old_query = """
            SELECT COUNT(*) 
            FROM tabandamento 
            WHERE SetorLink = 'SEFOC' 
            AND SituacaoLink = 'Gravação'
        """
        
        cursor.execute(verify_old_query)
        remaining_old = cursor.fetchone()[0]
        
        # Verifica novos valores
        verify_new_query = """
            SELECT COUNT(*) 
            FROM tabandamento 
            WHERE SetorLink = 'Gravação' 
            AND SituacaoLink = 'Saída p/'
        """
        
        cursor.execute(verify_new_query)
        new_count = cursor.fetchone()[0]
        
        if remaining_old == 0:
            print(f"  ✓ Verificação: Todos os registros foram atualizados corretamente.")
            print(f"    Total de registros com os novos valores: {new_count}")
        else:
            print(f"  ⚠ AVISO: Ainda existem {remaining_old} registro(s) com valores antigos.")
            print(f"    Registros com novos valores: {new_count}")
        
        return True
        
    except pyodbc.Error as e:
        print(f"  ERRO na operação: {e}")
        connection.rollback()
        print("  Rollback executado.")
        return False
        
    except Exception as e:
        print(f"  ERRO inesperado: {e}")
        connection.rollback()
        print("  Rollback executado.")
        return False
    
    finally:
        if connection:
            cursor.close()
            connection.close()
            print("  Conexão fechada.")

def gerar_relatorio(resultados, hora_inicio):
    """Gera um relatório final da operação"""
    
    hora_fim = datetime.now()
    duracao = hora_fim - hora_inicio
    
    print(f"\n{'='*60}")
    print("RELATÓRIO FINAL")
    print(f"{'='*60}")
    print(f"Início: {hora_inicio.strftime('%d/%m/%Y %H:%M:%S')}")
    print(f"Fim: {hora_fim.strftime('%d/%m/%Y %H:%M:%S')}")
    print(f"Duração: {duracao}")
    print(f"\nResultados por banco:")
    
    sucessos = 0
    falhas = 0
    
    for banco, sucesso in resultados.items():
        status = "✓ SUCESSO" if sucesso else "✗ FALHA"
        if sucesso:
            sucessos += 1
        else:
            falhas += 1
        print(f"  {banco}: {status}")
    
    print(f"\nResumo:")
    print(f"  Total de bancos processados: {len(resultados)}")
    print(f"  Sucessos: {sucessos}")
    print(f"  Falhas: {falhas}")
    
    print(f"\nAlterações realizadas:")
    print(f"  Condição: SetorLink = 'SEFOC' E SituacaoLink = 'Gravação'")
    print(f"  Novo SetorLink: 'Gravação'")
    print(f"  Nova SituacaoLink: 'Saída p/'")

def salvar_log(resultados, hora_inicio, base_path):
    """Salva log da operação em arquivo"""
    
    log_path = os.path.join(base_path, "log_atualizacao_multiplas_bases.txt")
    
    try:
        with open(log_path, 'a', encoding='utf-8') as log_file:
            log_file.write(f"\n{'='*60}\n")
            log_file.write(f"Atualização em: {hora_inicio.strftime('%d/%m/%Y %H:%M:%S')}\n")
            log_file.write(f"SetorLink: 'SEFOC' -> 'Gravação'\n")
            log_file.write(f"SituacaoLink: 'Gravação' -> 'Saída p/'\n")
            log_file.write(f"{'='*60}\n")
            
            for nome, sucesso in resultados.items():
                status = "SUCESSO" if sucesso else "FALHA"
                log_file.write(f"{nome}: {status}\n")
            
            log_file.write(f"{'='*60}\n")
        
        print(f"\nLog salvo em: {log_path}")
        return True
    
    except Exception as e:
        print(f"\nNão foi possível salvar o log: {e}")
        return False

def main():
    """Função principal"""
    
    hora_inicio = datetime.now()
    
    print("=" * 60)
    print("ATUALIZAÇÃO EM LOTE - QUATRO BASES DE DADOS")
    print("=" * 60)
    print("Alteração:")
    print("  SetorLink: 'SEFOC' -> 'Gravação'")
    print("  SituacaoLink: 'Gravação' -> 'Saída p/'")
    print("=" * 60)
    
    # Definição dos bancos de dados
    base_dir = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2"
    
    bancos = {
        "OS AntigaCore": os.path.join(base_dir, "Sagra Base - OS AntigaCore.mdb"),
        "Papelaria Antiga": os.path.join(base_dir, "Sagra Base - Papelaria Antiga.mdb"),
        "OS Atual": os.path.join(base_dir, "Sagra Base - OS Atual.mdb"),
        "Papelaria Atual": os.path.join(base_dir, "Sagra Base - Papelaria Atual.mdb")
    }
    
    # Confirmação do usuário
    print("\nBancos que serão processados:")
    for nome, caminho in bancos.items():
        existe = "✓" if os.path.exists(caminho) else "✗"
        print(f"  {existe} {nome}: {os.path.basename(caminho)}")
    
    # Verifica se todos os arquivos existem
    arquivos_faltantes = [nome for nome, caminho in bancos.items() if not os.path.exists(caminho)]
    
    if arquivos_faltantes:
        print(f"\n⚠ ATENÇÃO: Os seguintes arquivos não foram encontrados:")
        for nome in arquivos_faltantes:
            print(f"  • {nome}")
        
        resposta = input(f"\nDeseja continuar mesmo assim? (S/N): ").upper()
        if resposta != 'S':
            print("\nOperação cancelada pelo usuário.")
            return
    
    resposta = input(f"\nDeseja continuar com a atualização nas bases encontradas? (S/N): ").upper()
    
    if resposta != 'S':
        print("\nOperação cancelada pelo usuário.")
        return
    
    # Processa cada banco
    resultados = {}
    
    for nome, caminho in bancos.items():
        # Pula arquivos que não existem
        if not os.path.exists(caminho):
            print(f"\n{'='*60}")
            print(f"Pulando {nome} - Arquivo não encontrado")
            print(f"{'='*60}")
            resultados[nome] = False
            continue
        
        sucesso = atualizar_banco(caminho, nome)
        resultados[nome] = sucesso
    
    # Gera relatório final
    gerar_relatorio(resultados, hora_inicio)
    
    # Salva log
    salvar_log(resultados, hora_inicio, base_dir)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nOperação interrompida pelo usuário.")
    except Exception as e:
        print(f"\nErro crítico: {e}")
    
    print("\nPressione Enter para sair...")
    input()
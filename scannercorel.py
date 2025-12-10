import os
import json
import pymysql
import pymysql.cursors
import win32com.client
import time

# --- CONFIGURAÇÕES ---
DIR_MODELOS = r"\\redecamara\dfsdata\cgraf\sefoc\Laboratorio\Modelos\Modelos Corel\Papelaria\CSP"
memoria_campos = {}

def get_db_connection():
    return pymysql.connect(
        host="10.120.1.125",
        user="usr_sefoc",
        password="sefoc_2018",
        database="sagrafulldb",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        charset='utf8mb4'
    )

def setup_database(conn):
    """Verifica e corrige a estrutura da tabela automaticamente"""
    print("Verificando estrutura do banco de dados...")
    with conn.cursor() as cursor:
        # 1. Verifica se a tabela existe
        cursor.execute("SHOW TABLES LIKE 'tabPapelariaModelos'")
        if not cursor.fetchone():
            print("Criando tabela tabPapelariaModelos...")
            cursor.execute("""
                CREATE TABLE tabPapelariaModelos (
                    ID INT AUTO_INCREMENT PRIMARY KEY,
                    NomeProduto VARCHAR(100) NOT NULL,
                    NomeArquivo VARCHAR(255) NOT NULL,
                    Categoria VARCHAR(50),
                    Ativo BOOLEAN DEFAULT TRUE
                )
            """)

        # 2. Verifica se a coluna ConfigCampos existe
        cursor.execute("SHOW COLUMNS FROM tabPapelariaModelos LIKE 'ConfigCampos'")
        if not cursor.fetchone():
            print("Coluna 'ConfigCampos' ausente. Criando coluna JSON...")
            cursor.execute("ALTER TABLE tabPapelariaModelos ADD COLUMN ConfigCampos JSON")
        else:
            print("Estrutura do banco OK.")

def conectar_corel():
    try:
        print("Tentando conectar ao CorelDRAW...")
        corel = win32com.client.Dispatch("CorelDRAW.Application")
        corel.Visible = True
        return corel
    except Exception as e:
        print(f"Erro ao conectar ao CorelDRAW: {e}")
        return None

def processar_arquivo(corel, filepath, filename):
    print(f"\n--- Processando: {filename} ---")
    try:
        doc = corel.OpenDocument(filepath)
    except Exception as e:
        print(f"Erro ao abrir arquivo: {e}")
        return None

    campos_do_arquivo = []
    
    try:
        shapes = doc.ActivePage.FindShapes()
    except Exception:
        print("   Erro ao ler formas. Arquivo vazio?")
        doc.Close()
        return None

    for shape in shapes:
        try:
            nome_objeto = shape.Name.strip()
        except:
            continue
        
        # Filtra objetos irrelevantes
        if not nome_objeto or "Artistic Text" in nome_objeto or "Rectangle" in nome_objeto or "Group" in nome_objeto or "Layer" in nome_objeto:
            continue
        
        print(f" > Encontrado objeto nomeado: [{nome_objeto}]")

        if nome_objeto in memoria_campos:
            config = memoria_campos[nome_objeto]
            print(f"   (Memória) Mapeado como: '{config['label']}'")
        else:
            # INTERAÇÃO COM USUÁRIO
            print(f"   >>> NOVO CAMPO DETECTADO: '{nome_objeto}' <<<")
            try:
                # Input com tratamento de encoding para terminais Windows
                label = input(f"   Qual o Label para '{nome_objeto}'? (Enter p/ pular): ")
            except UnicodeEncodeError:
                label = input(f"   Qual o Label para esse campo? (Enter p/ pular): ")

            if not label:
                print("   Ignorado.")
                continue

            tipo_input = input("   Tipo (1=Texto, 2=Area, 3=Email)? [1]: ")
            tipo = "text"
            if tipo_input == "2": tipo = "textarea"
            if tipo_input == "3": tipo = "email"

            config = {
                "label": label,
                "key": nome_objeto,
                "type": tipo,
                "placeholder": f"Digite {label}..."
            }
            if tipo == "textarea":
                config["rows"] = 3

            memoria_campos[nome_objeto] = config

        if config not in campos_do_arquivo:
            campos_do_arquivo.append(config)

    doc.Close()
    return campos_do_arquivo

def salvar_no_banco(conn, filename, config_json):
    json_str = json.dumps(config_json, ensure_ascii=False) if config_json else None
    
    # Se for None, salvamos '[]' string vazia JSON válida, ou NULL se preferir
    if not json_str: json_str = '[]'

    with conn.cursor() as cursor:
        # Verifica pelo nome do arquivo
        sql_check = "SELECT ID FROM tabPapelariaModelos WHERE NomeArquivo = %s"
        cursor.execute(sql_check, (filename,))
        result = cursor.fetchone()

        if result:
            print(f"   Atualizando ID {result['ID']}...")
            sql_update = "UPDATE tabPapelariaModelos SET ConfigCampos = %s WHERE ID = %s"
            cursor.execute(sql_update, (json_str, result['ID']))
        else:
            print(f"   Inserindo novo registro: {filename}")
            nome_produto = os.path.splitext(filename)[0]
            sql_insert = """
                INSERT INTO tabPapelariaModelos (NomeProduto, NomeArquivo, Categoria, ConfigCampos)
                VALUES (%s, %s, 'Geral', %s)
            """
            cursor.execute(sql_insert, (nome_produto, filename, json_str))

def main():
    if not os.path.exists(DIR_MODELOS):
        print(f"ERRO: Diretório não encontrado: {DIR_MODELOS}")
        return

    corel = conectar_corel()
    if not corel: return

    try:
        conn = get_db_connection()
        setup_database(conn) # <--- AQUI ESTÁ A CORREÇÃO
    except Exception as e:
        print(f"Erro fatal de banco: {e}")
        return
    
    arquivos = [f for f in os.listdir(DIR_MODELOS) if f.lower().endswith('.cdr')]
    print(f"Encontrados {len(arquivos)} arquivos .cdr.")

    for arquivo in arquivos:
        config_campos = processar_arquivo(corel, os.path.join(DIR_MODELOS, arquivo), arquivo)
        salvar_no_banco(conn, arquivo, config_campos)

    print("\n--- Finalizado ---")
    conn.close()

if __name__ == "__main__":
    main()
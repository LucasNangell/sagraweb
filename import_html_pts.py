import os
import logging
from database import db

# Configuração
FOLDER_PATH = "PTs"
logging.basicConfig(level=logging.INFO)

def import_html_files():
    if not os.path.exists(FOLDER_PATH):
        logging.error(f"Pasta '{FOLDER_PATH}' não encontrada. Crie a pasta e coloque os HTMLs dentro.")
        return

    files = [f for f in os.listdir(FOLDER_PATH) if f.lower().endswith('.html')]
    
    if not files:
        logging.warning("Nenhum arquivo HTML encontrado na pasta PTs.")
        return

    logging.info(f"Iniciando importação de {len(files)} arquivos...")

    count = 0
    for filename in files:
        file_path = os.path.join(FOLDER_PATH, filename)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                html_content = f.read()
            
            # Título = Nome do arquivo sem extensão e underscores substituídos por espaços
            titulo = os.path.splitext(filename)[0].replace('_', ' ')

            # Verifica duplicidade
            exists = db.execute_query("SELECT ID FROM tabProblemasPadrao WHERE TituloPT = %s", (titulo,))

            if exists:
                update_query = "UPDATE tabProblemasPadrao SET ProbTecHTML = %s WHERE ID = %s"
                with db.cursor() as cursor:
                    cursor.execute(update_query, (html_content, exists[0]['ID']))
                logging.info(f"Atualizado: {titulo}")
            else:
                insert_query = "INSERT INTO tabProblemasPadrao (TituloPT, ProbTecHTML) VALUES (%s, %s)"
                with db.cursor() as cursor:
                    cursor.execute(insert_query, (titulo, html_content))
                logging.info(f"Importado: {titulo}")
            
            count += 1

        except Exception as e:
            logging.error(f"Erro ao processar {filename}: {e}")

    logging.info(f"Finalizado. {count} itens processados.")

if __name__ == "__main__":
    import_html_files()
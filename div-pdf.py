import os
from pypdf import PdfReader, PdfWriter

def dividir_pdf(caminho_entrada, diretorio_saida, paginas_por_arquivo):
    # Verifica se o arquivo PDF de entrada existe
    if not os.path.exists(caminho_entrada):
        print(f"Erro: O arquivo '{caminho_entrada}' não foi encontrado.")
        return

    # Cria o diretório de saída caso ele não exista
    if not os.path.exists(diretorio_saida):
        os.makedirs(diretorio_saida)

    # Lê o PDF original
    leitor = PdfReader(caminho_entrada)
    total_paginas = len(leitor.pages)
    
    print(f"\nO documento original tem {total_paginas} páginas.")
    print("Iniciando a divisão...\n")
    
    contador_arquivo = 1
    
    # Percorre as páginas dividindo em blocos
    for i in range(0, total_paginas, paginas_por_arquivo):
        escritor = PdfWriter()
        
        # Define o fim do bloco atual (evita ultrapassar o total de páginas)
        fim = min(i + paginas_por_arquivo, total_paginas)
        
        # Adiciona as páginas do bloco atual ao novo PDF
        for num_pagina in range(i, fim):
            escritor.add_page(leitor.pages[num_pagina])
            
        # Gera e salva o arquivo de saída
        nome_arquivo_saida = os.path.join(diretorio_saida, f"parte_{contador_arquivo}.pdf")
        with open(nome_arquivo_saida, "wb") as arquivo_saida:
            escritor.write(arquivo_saida)
            
        print(f"Salvo: {nome_arquivo_saida} (Páginas {i+1} a {fim})")
        contador_arquivo += 1
        
    print("\nDivisão concluída com sucesso!")

if __name__ == "__main__":
    # Coleta os dados diretamente do usuário via terminal
    arquivo_pdf = input("Digite o caminho completo do arquivo PDF original (ex: documento.pdf): ").strip()
    pasta_destino = input("Digite o nome da pasta para salvar os arquivos (ex: pdfs_divididos): ").strip()
    
    try:
        qtd_paginas = int(input("Quantas páginas cada novo PDF deve ter? "))
        if qtd_paginas <= 0:
            print("Erro: O número de páginas deve ser maior que zero.")
        else:
            dividir_pdf(arquivo_pdf, pasta_destino, qtd_paginas)
    except ValueError:
        print("Erro: Por favor, insira um número inteiro válido para a quantidade de páginas.")
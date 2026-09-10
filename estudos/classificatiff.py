import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import tifffile

# ===== CONFIGURAÇÕES =====
PASTA_ALVO = r"F:\2c- Tiff1bit (Grav Ext)\Apogee PM52 IBF_Fast"
MARGEM_PERCENTUAL = 0.08          # remove 5% das bordas onde ficam as marcas
FATOR_DOWNSAMPLING = 5            # reduz a imagem para acelerar
LIMIAR_UNIFORMIDADE = 0.9905       # se cor dominante > 95%, considera sem grafismo
EXTENSOES_VALIDAS = ('.tif', '.tiff')
MAX_WORKERS = 4                   # threads paralelas

def tem_grafismo(caminho_arquivo):
    """
    Retorna True se houver grafismo (região central com variação significativa),
    False se for apenas marcas (região central uniforme).
    """
    try:
        with tifffile.TiffFile(caminho_arquivo) as tif:
            for page in tif.pages:
                altura, largura = page.shape
                margem_x = int(largura * MARGEM_PERCENTUAL)
                margem_y = int(altura * MARGEM_PERCENTUAL)

                # Carrega a região central e aplica downsampling
                central = page.asarray().astype(np.uint8)[
                    margem_y:altura-margem_y, margem_x:largura-margem_x
                ]
                central_down = central[::FATOR_DOWNSAMPLING, ::FATOR_DOWNSAMPLING]

                # Calcula uniformidade (proporção da cor dominante)
                media = np.mean(central_down)
                uniformidade = max(media, 1.0 - media)

                # Se alguma página tiver uniformidade abaixo do limiar, há grafismo
                if uniformidade < LIMIAR_UNIFORMIDADE:
                    return True
            return False
    except Exception as e:
        print(f"Erro ao processar {caminho_arquivo}: {e}")
        return None

def main():
    arquivos = [os.path.join(PASTA_ALVO, nome) for nome in os.listdir(PASTA_ALVO)
                if nome.lower().endswith(EXTENSOES_VALIDAS)]

    total = len(arquivos)
    print(f"Encontrados {total} arquivos TIFF.")
    if total == 0:
        return

    sem_grafismo = []
    com_grafismo = []
    erros = []
    inicio = time.time()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futuros = {executor.submit(tem_grafismo, arq): arq for arq in arquivos}
        for i, futuro in enumerate(as_completed(futuros), 1):
            caminho = futuros[futuro]
            resultado = futuro.result()
            if resultado is None:
                erros.append(caminho)
            elif resultado:
                com_grafismo.append(caminho)
            else:
                sem_grafismo.append(caminho)
            print(f"Processados {i}/{total} - {os.path.basename(caminho)}")

    tempo_total = time.time() - inicio
    print("\n" + "="*60)
    print(f"RESULTADO - {total} arquivos processados em {tempo_total:.2f}s")
    print(f"Com grafismo: {len(com_grafismo)}")
    print(f"Sem grafismo: {len(sem_grafismo)}")
    if erros:
        print(f"Erros: {len(erros)}")

    if sem_grafismo:
        with open("sem_grafismo.txt", "w") as f:
            for arq in sem_grafismo:
                f.write(arq + "\n")
        print("\nLista salva em 'sem_grafismo.txt'")
    if com_grafismo:
        with open("com_grafismo.txt", "w") as f:
            for arq in com_grafismo:
                f.write(arq + "\n")
        print("Lista salva em 'com_grafismo.txt'")
    if erros:
        with open("erros.txt", "w") as f:
            for arq in erros:
                f.write(arq + "\n")
        print("Lista de erros salva em 'erros.txt'")

if __name__ == "__main__":
    main()
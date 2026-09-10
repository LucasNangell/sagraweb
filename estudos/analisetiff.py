import numpy as np
import tifffile

ARQUIVO = r"F:\2c- Tiff1bit (Grav Ext)\Apogee PM52 IBF_Fast\2026_OS 00799-PM-Coedi-Livro_Manual (Cad 0 A) (K).tif"
MARGEM_PERCENTUAL = 0.05
FATORES_DOWNSAMPLING = [1, 2, 3, 5, 8, 10]

def analisar_arquivo(caminho):
    print(f"Analisando: {caminho}")
    with tifffile.TiffFile(caminho) as tif:
        for idx, page in enumerate(tif.pages):
            print(f"\n--- Página {idx} ---")
            print(f"Dimensões: {page.shape}")
            print(f"Photometric: {page.photometric} (0=MINISBLACK, 1=MINISWHITE)")

            # Carrega a página como inteiro (0/1)
            arr = page.asarray().astype(np.uint8)  # bool -> uint8
            altura, largura = arr.shape

            # Região central
            margem_x = int(largura * MARGEM_PERCENTUAL)
            margem_y = int(altura * MARGEM_PERCENTUAL)
            central = arr[margem_y:altura-margem_y, margem_x:largura-margem_x]

            # Estatísticas da região central (sem downsampling)
            media = np.mean(central)
            desvio = np.std(central)
            frac_brancos = media  # se 1 = branco
            frac_pretos = 1.0 - media
            uniformidade = max(frac_pretos, frac_brancos)  # proporção da cor dominante

            print(f"\nRegião central (sem downsampling):")
            print(f"  Fração de pixels brancos: {frac_brancos:.6f} ({frac_brancos*100:.4f}%)")
            print(f"  Fração de pixels pretos: {frac_pretos:.6f} ({frac_pretos*100:.4f}%)")
            print(f"  Desvio padrão: {desvio:.6f}")
            print(f"  Proporção da cor dominante: {uniformidade:.6f} ({uniformidade*100:.4f}%)")

            print(f"\nEfeito do downsampling na uniformidade (proporção da cor dominante):")
            for fator in FATORES_DOWNSAMPLING:
                central_down = central[::fator, ::fator]
                media_down = np.mean(central_down)
                uniformidade_down = max(media_down, 1.0 - media_down)
                desvio_down = np.std(central_down)
                print(f"  Fator {fator}: uniformidade={uniformidade_down:.6f}, desvio={desvio_down:.6f}")

if __name__ == "__main__":
    analisar_arquivo(ARQUIVO)
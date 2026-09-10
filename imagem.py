"""
detector_mascaras.py
Detecta e remove máscaras de arquivos PNG, JPG e JPEG.

Uso:
    python detector_mascaras.py

O script pergunta o caminho completo da imagem, detecta as máscaras
e permite apagá-las (por padrão, apaga a máscara 0).

Modo CLI (opcional):
    python detector_mascaras.py --arquivo /caminho/imagem.png --apagar 0
"""

import argparse
import sys
from pathlib import Path
from PIL import Image
import numpy as np


EXTENSOES_SUPORTADAS = {".png", ".jpg", ".jpeg"}


# ===================================================================
# DETECÇÃO DE MÁSCARAS
# ===================================================================
class MascaraDetectada:
    def __init__(self, tipo, mascara, descricao, metadados=None):
        self.tipo = tipo
        self.mascara = mascara
        self.descricao = descricao
        self.metadados = metadados or {}

    @property
    def cobertura(self):
        return float(self.mascara.mean())

    def __repr__(self):
        return f"<Mascara tipo={self.tipo} cobertura={self.cobertura:.2%}>"


class DetectorMascaras:
    def __init__(self, caminho):
        self.caminho = Path(caminho).expanduser().resolve()
        if not self.caminho.exists():
            raise FileNotFoundError(f"Arquivo não encontrado: {self.caminho}")
        if not self.caminho.is_file():
            raise ValueError(f"Não é um arquivo: {self.caminho}")

        self.extensao = self.caminho.suffix.lower()
        if self.extensao not in EXTENSOES_SUPORTADAS:
            raise ValueError(
                f"Formato não suportado: '{self.extensao}'. "
                f"Use: {', '.join(sorted(EXTENSOES_SUPORTADAS))}"
            )

        self.tem_alpha = self.extensao == ".png"

        try:
            self.imagem_original = Image.open(self.caminho)
            self.imagem_original.load()  # força carregamento (detecta corrupção)
        except Exception as e:
            raise ValueError(f"Falha ao abrir a imagem: {e}")

        self.rgba = np.array(self.imagem_original.convert("RGBA"))
        self.mascaras = []
        self._detectar()

    # ---------------------------------------------------------------
    # DETECÇÃO
    # ---------------------------------------------------------------
    def _detectar(self):
        if self.tem_alpha:
            self._detectar_alpha()
        self._detectar_grayscale()
        self._detectar_cor_uniforme()
        self._detectar_quase_binaria()

    def _detectar_alpha(self):
        alpha = self.rgba[:, :, 3]
        if np.all(alpha == 255):
            return
        if np.all(alpha == 0):
            self.mascaras.append(MascaraDetectada(
                tipo="alpha",
                mascara=np.ones_like(alpha, dtype=bool),
                descricao="Imagem completamente transparente",
            ))
            return

        valores_unicos = np.unique(alpha)
        if len(valores_unicos) <= 2 and set(valores_unicos.tolist()) <= {0, 255}:
            self.mascaras.append(MascaraDetectada(
                tipo="alpha_binaria",
                mascara=alpha > 127,
                descricao="Máscara alpha binária (0/255)",
            ))
        else:
            self.mascaras.append(MascaraDetectada(
                tipo="alpha_suave",
                mascara=alpha > 0,
                descricao=f"Máscara alpha suave (min={alpha.min()}, max={alpha.max()})",
            ))

    def _detectar_grayscale(self):
        r, g, b = self.rgba[:, :, 0], self.rgba[:, :, 1], self.rgba[:, :, 2]
        tol = 3 if self.tem_alpha else 8

        diff_rg = np.abs(r.astype(np.int16) - g.astype(np.int16))
        diff_gb = np.abs(g.astype(np.int16) - b.astype(np.int16))
        diff_rb = np.abs(r.astype(np.int16) - b.astype(np.int16))

        eh_grayscale = (diff_rg <= tol) & (diff_gb <= tol) & (diff_rb <= tol)

        if eh_grayscale.mean() > 0.95:
            cinza = ((r.astype(np.int32) + g + b) / 3).astype(np.uint8)
            tol_bin = 20 if self.tem_alpha else 40
            quase_binaria = ((cinza <= tol_bin) | (cinza >= 255 - tol_bin))

            if quase_binaria.mean() > 0.95:
                self.mascaras.append(MascaraDetectada(
                    tipo="pb_quase_binaria",
                    mascara=cinza > 127,
                    descricao=f"Imagem P&B quase binária "
                              f"({quase_binaria.mean():.1%} pixels em 0/255)",
                ))
            else:
                self.mascaras.append(MascaraDetectada(
                    tipo="grayscale",
                    mascara=cinza > 0,
                    descricao="Imagem grayscale (R≈G≈B)",
                ))

    def _detectar_cor_uniforme(self):
        rgb = self.rgba[:, :, :3]
        alpha = self.rgba[:, :, 3]
        visiveis = rgb[alpha > 0]
        if visiveis.size == 0:
            return

        quantizado = (visiveis // 16).astype(np.uint8)
        cores, contagens = np.unique(
            quantizado.reshape(-1, 3), axis=0, return_counts=True
        )
        ordem = np.argsort(contagens)[::-1]

        for i in ordem[:3]:
            cor_top = cores[i]
            fracao = contagens[i] / len(visiveis)
            if fracao < 0.20:
                continue

            cor_real = (cor_top.astype(np.int32) * 16 + 8).astype(np.uint8)
            tol = 20 if self.tem_alpha else 35
            diff = np.abs(rgb.astype(np.int32) - cor_real.astype(np.int32))
            mascara = np.all(diff < tol, axis=2)

            if any(
                m.tipo == "chroma_key"
                and np.array_equal(m.metadados.get("cor"), cor_real.tolist())
                for m in self.mascaras
            ):
                continue

            self.mascaras.append(MascaraDetectada(
                tipo="chroma_key",
                mascara=mascara,
                descricao=f"Cor uniforme RGB{tuple(int(x) for x in cor_real)} "
                          f"({fracao:.1%} da imagem)",
                metadados={"cor": cor_real.tolist(), "fracao": fracao},
            ))

    def _detectar_quase_binaria(self):
        if self.tem_alpha:
            return
        r, g, b = self.rgba[:, :, 0], self.rgba[:, :, 1], self.rgba[:, :, 2]
        if any(m.tipo in ("grayscale", "pb_quase_binaria") for m in self.mascaras):
            return

        tol = 40
        for nome, canal in (("R", r), ("G", g), ("B", b)):
            quase_bin = ((canal <= tol) | (canal >= 255 - tol))
            if quase_bin.mean() > 0.95:
                self.mascaras.append(MascaraDetectada(
                    tipo=f"canal_quase_binario_{nome}",
                    mascara=canal > 127,
                    descricao=f"Canal {nome} quase binário "
                              f"({quase_bin.mean():.1%} pixels perto de 0/255)",
                ))

    # ---------------------------------------------------------------
    # LISTAGEM
    # ---------------------------------------------------------------
    def listar_mascaras(self):
        print(f"\n🖼️  Arquivo: {self.caminho.name}")
        print(f"   Caminho: {self.caminho}")
        print(f"   Formato: {self.extensao[1:].upper()}")
        print(f"   Tamanho: {self.imagem_original.size} | "
              f"Modo: {self.imagem_original.mode}")

        if not self.tem_alpha:
            print("   ⚠️  JPG/JPEG não suporta transparência — "
                  "máscaras alpha não se aplicam")

        print(f"   Máscaras detectadas: {len(self.mascaras)}\n")

        if not self.mascaras:
            print("   (nenhuma máscara detectada)")
            return

        for i, m in enumerate(self.mascaras):
            print(f"   [{i}] tipo={m.tipo}")
            print(f"       descrição: {m.descricao}")
            print(f"       cobertura: {m.cobertura:.2%} "
                  f"({m.mascara.sum():,} pixels)")
            print()

    # ---------------------------------------------------------------
    # APAGAR / APLICAR / EXPORTAR
    # ---------------------------------------------------------------
    def apagar_mascara(self, indice, saida=None, preencher_com=None):
        if indice < 0 or indice >= len(self.mascaras):
            raise IndexError(
                f"Índice {indice} inválido. "
                f"Intervalo válido: 0-{len(self.mascaras) - 1}"
            )

        m = self.mascaras[indice]
        img = self.rgba.copy()

        if preencher_com is None:
            if self.tem_alpha:
                preencher_com = None
            else:
                preencher_com = (255, 255, 255, 255)

        if preencher_com is None:
            img[m.mascara, 3] = 0
        else:
            r, g, b, a = preencher_com
            img[m.mascara, 0] = r
            img[m.mascara, 1] = g
            img[m.mascara, 2] = b
            img[m.mascara, 3] = a

        if saida is None:
            ext = self.extensao if self.tem_alpha else ".png"
            saida = self.caminho.with_name(
                f"{self.caminho.stem}_sem_mascara_{indice}{ext}"
            )
        saida = Path(saida).expanduser()

        img_final = Image.fromarray(img, "RGBA")
        if saida.suffix.lower() in (".jpg", ".jpeg"):
            fundo = Image.new("RGBA", img_final.size, (255, 255, 255, 255))
            img_final = Image.alpha_composite(fundo, img_final).convert("RGB")
            img_final.save(saida, "JPEG", quality=95)
        else:
            img_final.save(saida, "PNG")

        print(f"✅ Máscara [{indice}] '{m.tipo}' apagada.")
        if not self.tem_alpha and preencher_com:
            print(f"   (preenchida com RGBA{preencher_com} — JPG não tem alpha)")
        print(f"   Salvo em: {saida}")
        return saida

    def apagar_todas_mascaras(self, saida=None, preencher_com=None):
        if not self.mascaras:
            print("⚠️  Nenhuma máscara para apagar.")
            return None

        img = self.rgba.copy()
        if preencher_com is None and not self.tem_alpha:
            preencher_com = (255, 255, 255, 255)

        for m in self.mascaras:
            if preencher_com is None:
                img[m.mascara, 3] = 0
            else:
                r, g, b, a = preencher_com
                img[m.mascara, 0] = r
                img[m.mascara, 1] = g
                img[m.mascara, 2] = b
                img[m.mascara, 3] = a

        if saida is None:
            ext = self.extensao if self.tem_alpha else ".png"
            saida = self.caminho.with_name(
                f"{self.caminho.stem}_sem_mascaras{ext}"
            )
        saida = Path(saida).expanduser()

        img_final = Image.fromarray(img, "RGBA")
        if saida.suffix.lower() in (".jpg", ".jpeg"):
            fundo = Image.new("RGBA", img_final.size, (255, 255, 255, 255))
            img_final = Image.alpha_composite(fundo, img_final).convert("RGB")
            img_final.save(saida, "JPEG", quality=95)
        else:
            img_final.save(saida, "PNG")

        print(f"✅ {len(self.mascaras)} máscara(s) apagada(s).")
        print(f"   Salvo em: {saida}")
        return saida

    def aplicar_mascara(self, indice, saida=None):
        m = self.mascaras[indice]
        img = self.rgba.copy()
        img[~m.mascara, 3] = 0

        if saida is None:
            saida = self.caminho.with_name(
                f"{self.caminho.stem}_aplicada_{indice}.png"
            )
        saida = Path(saida).expanduser()

        img_final = Image.fromarray(img, "RGBA")
        if saida.suffix.lower() in (".jpg", ".jpeg"):
            fundo = Image.new("RGBA", img_final.size, (255, 255, 255, 255))
            img_final = Image.alpha_composite(fundo, img_final).convert("RGB")
            img_final.save(saida, "JPEG", quality=95)
        else:
            img_final.save(saida, "PNG")

        print(f"✅ Máscara [{indice}] aplicada. Salvo em: {saida}")
        return saida

    def exportar_mascara(self, indice, saida=None):
        m = self.mascaras[indice]
        img = (m.mascara.astype(np.uint8) * 255)
        pil = Image.fromarray(img, mode="L")

        if saida is None:
            saida = self.caminho.with_name(
                f"{self.caminho.stem}_mascara_{indice}_{m.tipo}.png"
            )
        saida = Path(saida).expanduser()
        pil.save(saida, "PNG")
        print(f"✅ Máscara [{indice}] exportada em: {saida}")
        return saida


# ===================================================================
# ENTRADA DE CAMINHO
# ===================================================================
def solicitar_caminho():
    """
    Pede ao usuário o caminho completo da imagem.
    Aceita:
    - Caminho absoluto: /home/user/foto.png
    - Caminho relativo: ./fotos/foto.jpg
    - Caminho com ~ : ~/imagens/foto.jpeg
    - Caminho entre aspas: "/caminho/com espaços/foto.png"
    """
    print("\n🔍 Detector e Removedor de Máscaras")
    print("   Formatos suportados: PNG, JPG, JPEG")
    print("   Digite 'q' a qualquer momento para sair.\n")

    while True:
        try:
            entrada = input("📂 Caminho completo da imagem: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n\n👋 Encerrando.")
            return None

        if not entrada:
            print("❌ Caminho vazio. Tente novamente.\n")
            continue

        if entrada.lower() in ("q", "quit", "sair"):
            print("👋 Encerrando.")
            return None

        # Remove aspas simples/duplas ao redor
        if (entrada.startswith('"') and entrada.endswith('"')) or \
           (entrada.startswith("'") and entrada.endswith("'")):
            entrada = entrada[1:-1]

        # Expande ~ e resolve
        caminho = Path(entrada).expanduser()

        if not caminho.exists():
            print(f"❌ Arquivo não encontrado: {caminho}")
            print("   Verifique o caminho e tente novamente.\n")
            continue

        if not caminho.is_file():
            print(f"❌ O caminho não aponta para um arquivo: {caminho}\n")
            continue

        ext = caminho.suffix.lower()
        if ext not in EXTENSOES_SUPORTADAS:
            print(f"❌ Formato não suportado: '{ext}'")
            print(f"   Use: {', '.join(sorted(EXTENSOES_SUPORTADAS))}\n")
            continue

        return caminho.resolve()


# ===================================================================
# MODO INTERATIVO
# ===================================================================
def modo_interativo():
    caminho = solicitar_caminho()
    if caminho is None:
        return

    try:
        det = DetectorMascaras(caminho)
    except Exception as e:
        print(f"\n❌ Erro ao processar a imagem: {e}")
        return

    det.listar_mascaras()

    if not det.mascaras:
        print("\n⚠️  Nenhuma máscara detectada nessa imagem. Nada a fazer.")
        return

    print("=" * 65)
    print("  O QUE DESEJA FAZER?")
    print("=" * 65)
    print("  [ENTER]     Apagar máscara 0 (padrão)")
    print("  [N]         Apagar máscara de índice N")
    print("  [T]         Apagar TODAS as máscaras")
    print("  [A N]       Aplicar máscara N (manter só ela)")
    print("  [E N]       Exportar máscara N como PNG P&B")
    print("  [C R G B]   Definir cor de preenchimento (0-255 cada)")
    print("  [Q]         Cancelar")

    if not det.tem_alpha:
        print("\n  💡 Dica: em JPG/JPEG a máscara é preenchida com BRANCO")
        print("     por padrão (não tem transparência). Use [C R G B] "
              "para outra cor.")

    print("-" * 65)

    try:
        escolha = input("👉 Escolha [padrão: apagar máscara 0]: ").strip()
    except (KeyboardInterrupt, EOFError):
        print("\n\n👋 Encerrando.")
        return

    escolha_upper = escolha.upper()

    if escolha == "":
        det.apagar_mascara(0)
        return
    if escolha_upper == "Q":
        print("👋 Cancelado.")
        return
    if escolha_upper == "T":
        det.apagar_todas_mascaras()
        return

    partes = escolha_upper.split()

    # [C R G B]
    if len(partes) == 4 and partes[0] == "C":
        try:
            r, g, b = (int(x) for x in partes[1:4])
            if not all(0 <= v <= 255 for v in (r, g, b)):
                raise ValueError
            det.apagar_mascara(0, preencher_com=(r, g, b, 255))
        except ValueError:
            print("❌ Use números entre 0 e 255. Ex: C 0 0 0")
        return

    # [A N] ou [E N]
    if len(partes) == 2:
        cmd, arg = partes
        try:
            idx = int(arg)
        except ValueError:
            print("❌ Índice inválido.")
            return
        if idx < 0 or idx >= len(det.mascaras):
            print(f"❌ Índice fora do intervalo (0-{len(det.mascaras) - 1}).")
            return
        if cmd == "A":
            det.aplicar_mascara(idx)
        elif cmd == "E":
            det.exportar_mascara(idx)
        else:
            print(f"❌ Comando desconhecido: {cmd}")
        return

    # Número simples
    try:
        idx = int(escolha)
        if 0 <= idx < len(det.mascaras):
            det.apagar_mascara(idx)
        else:
            print(f"❌ Índice fora do intervalo (0-{len(det.mascaras) - 1}).")
    except ValueError:
        print(f"❌ Comando desconhecido: {escolha}")


# ===================================================================
# CLI (opcional, para automação)
# ===================================================================
def modo_cli():
    parser = argparse.ArgumentParser(
        description="Detecta e remove máscaras de PNG/JPG/JPEG."
    )
    parser.add_argument("--arquivo",
                        help="Caminho da imagem (se omitido, modo interativo)")
    parser.add_argument("--apagar", type=int, metavar="IDX",
                        help="Apaga a máscara IDX (padrão: 0)")
    parser.add_argument("--apagar-todas", action="store_true",
                        help="Apaga todas as máscaras")
    parser.add_argument("--aplicar", type=int, metavar="IDX",
                        help="Mantém apenas pixels da máscara IDX")
    parser.add_argument("--exportar", type=int, metavar="IDX",
                        help="Exporta máscara IDX como PNG P&B")
    parser.add_argument("--cor", nargs=4, type=int,
                        metavar=("R", "G", "B", "A"),
                        help="Cor RGBA de preenchimento ao apagar")
    parser.add_argument("--saida", help="Caminho do arquivo de saída")
    parser.add_argument("--listar", action="store_true",
                        help="Apenas lista as máscaras")

    args = parser.parse_args()

    if args.arquivo is None:
        modo_interativo()
        return

    det = DetectorMascaras(args.arquivo)
    det.listar_mascaras()

    if args.listar:
        return

    if args.apagar_todas:
        cor = tuple(args.cor) if args.cor else None
        det.apagar_todas_mascaras(args.saida, preencher_com=cor)
    elif args.aplicar is not None:
        det.aplicar_mascara(args.aplicar, args.saida)
    elif args.exportar is not None:
        det.exportar_mascara(args.exportar, args.saida)
    elif args.apagar is not None:
        cor = tuple(args.cor) if args.cor else None
        det.apagar_mascara(args.apagar, args.saida, preencher_com=cor)
    else:
        if det.mascaras:
            det.apagar_mascara(0, args.saida)
        else:
            print("⚠️  Nenhuma máscara detectada.")


if __name__ == "__main__":
    try:
        modo_cli()
    except KeyboardInterrupt:
        print("\n\n👋 Interrompido pelo usuário.")
        sys.exit(0)
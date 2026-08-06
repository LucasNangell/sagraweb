# -*- coding: utf-8 -*-
"""
Encontra o PDF mais semelhante a uma imagem fornecida.

Estratégia (similar ao separar_modelos_produto.py):
- Renderiza a 1ª página de cada PDF em imagem (não usa texto).
- Detecta retângulos do cartão (bordas/linhas longas).
- Converte cada cartão em uma "máscara estrutural" baixa resolução.
- Gera um fingerprint equivalente para a imagem de referência.
- Varre todos os PDFs e retorna o de menor distância (mais semelhante).

Dependências:
    pip install pymupdf opencv-python numpy

Uso:
    python encontrar_pdf_por_imagem.py --pasta "G:\\Deputados\\2026\\Deputados_Papelaria_2026" --imagem "C:\\ref\\ctvisita.png"

Opções úteis:
    --top 5                 salva top-5 no relatório (por padrão: 5)
    --copiar-top 1          copia só o melhor para a pasta de saída (por padrão)
    --limiar 0.30           opcional: valor de corte (distância)
    --dpi 160               dpi para renderização (por padrão: 160)
"""

from __future__ import annotations

import argparse
import csv
import logging
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

try:
    import fitz  # PyMuPDF
    import cv2
    import numpy as np
except ImportError as exc:
    print("ERRO: dependências ausentes.")
    print("Instale com: pip install pymupdf opencv-python numpy")
    print(f"Detalhe técnico: {exc}")
    sys.exit(1)


PASTA_PADRAO = r"G:\Deputados\2026\Deputados_Papelaria_2026"

Box = Tuple[int, int, int, int]  # x, y, largura, altura


@dataclass
class Fingerprint:
    arquivo: Path
    boxes: List[Box]
    masks: List[np.ndarray]


def configurar_logger(pasta_saida: Path) -> None:
    pasta_saida.mkdir(parents=True, exist_ok=True)
    log_path = pasta_saida / "processamento.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def _esta_dentro_de(p: Path, possivel_pai: Path) -> bool:
    try:
        p.resolve().relative_to(possivel_pai.resolve())
        return True
    except ValueError:
        return False


def _texto_para_nome_pasta(texto: str) -> str:
    """Versão segura do nome para compor pastas de saída."""
    seguro = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in texto.strip())
    while "__" in seguro:
        seguro = seguro.replace("__", "_")
    return seguro.strip("_") or "Imagem"


def listar_pdfs(pasta: Path, ignorar_pastas: Optional[Sequence[Path]] = None) -> List[Path]:
    ignorar_pastas = list(ignorar_pastas or [])
    arquivos: List[Path] = []
    for p in pasta.rglob("*.pdf"):
        if not p.is_file():
            continue
        if any(_esta_dentro_de(p, pasta_ignorada) for pasta_ignorada in ignorar_pastas):
            continue
        arquivos.append(p)
    # estabilidade de ordenação: nome e caminho
    return sorted(arquivos, key=lambda x: str(x).lower())


def renderizar_primeira_pagina(pdf_path: Path, dpi: int = 160) -> np.ndarray:
    """Renderiza a primeira página do PDF em RGB. Não extrai nem usa texto."""
    doc = fitz.open(str(pdf_path))
    if doc.page_count < 1:
        raise ValueError("PDF sem páginas.")

    page = doc[0]
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)

    if pix.n >= 4:
        img = img[:, :, :3]

    return img.copy()


def _iou(a: Box, b: Box) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1 = max(ax, bx)
    y1 = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


def detectar_caixas_cartao(img_rgb: np.ndarray) -> List[Box]:
    """
    Detecta os retângulos dos cartões dentro da página.

    Procura bordas/linhas longas, priorizando a geometria do cartão.
    """
    altura, largura = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # Binariza elementos escuros: bordas, logotipo, textos e linhas.
    inv = cv2.threshold(gray, 225, 255, cv2.THRESH_BINARY_INV)[1]

    # Extrai linhas horizontais e verticais longas.
    kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (max(25, int(largura * 0.12)), 1))
    kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(25, int(altura * 0.035))))
    horizontal = cv2.morphologyEx(inv, cv2.MORPH_OPEN, kernel_h)
    vertical = cv2.morphologyEx(inv, cv2.MORPH_OPEN, kernel_v)
    linhas = cv2.bitwise_or(horizontal, vertical)
    linhas = cv2.dilate(linhas, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)

    contornos, _ = cv2.findContours(linhas, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidatos: List[Box] = []

    for contorno in contornos:
        x, y, w, h = cv2.boundingRect(contorno)
        proporcao = w / max(1, h)

        # Cartão 85x50 mm tem proporção aproximada de 1,7.
        if (
            w > largura * 0.25
            and w < largura * 0.90
            and h > altura * 0.06
            and h < altura * 0.35
            and 1.35 < proporcao < 2.10
            and y < altura * 0.75
        ):
            candidatos.append((x, y, w, h))

    candidatos = sorted(candidatos, key=lambda b: b[2] * b[3], reverse=True)
    selecionados: List[Box] = []
    for box in candidatos:
        if all(_iou(box, existente) < 0.30 for existente in selecionados):
            selecionados.append(box)

    # Se houver frente/verso, tende a vir 2 caixas.
    selecionados = sorted(selecionados, key=lambda b: (b[1], b[0]))[:4]

    # Margem para não cortar a borda.
    resultado: List[Box] = []
    for x, y, w, h in selecionados:
        pad = 3
        x2 = max(0, x - pad)
        y2 = max(0, y - pad)
        w2 = min(largura - x2, w + 2 * pad)
        h2 = min(altura - y2, h + 2 * pad)
        resultado.append((x2, y2, w2, h2))

    return resultado


def criar_mascara_estrutural(crop_rgb: np.ndarray) -> np.ndarray:
    """
    Converte o cartão em uma máscara estrutural baixa resolução.

    A ideia é reduzir influência do conteúdo literal (texto) e comparar organização/bordas.
    """
    h, w = crop_rgb.shape[:2]

    # Remove parte da borda externa para bordas iguais não dominarem.
    margem = max(3, int(min(h, w) * 0.03))
    if h > margem * 2 and w > margem * 2:
        crop_rgb = crop_rgb[margem : h - margem, margem : w - margem]

    gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2HSV)
    saturacao = hsv[:, :, 1]
    valor = hsv[:, :, 2]

    # Elementos escuros + elementos coloridos relevantes (brasão/ícones).
    mask = ((gray < 236) | ((saturacao > 35) & (valor < 248))).astype(np.uint8) * 255

    # Reduz ruído e "transforma palavras em blocos" aproximados.
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)))
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 5)), iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 7)))

    # Baixa resolução: reduz influência de diferenças de nomes/e-mails.
    mask_small = cv2.resize(mask, (90, 54), interpolation=cv2.INTER_AREA)
    mask_small = (mask_small > 15).astype(np.uint8)
    return mask_small


def fingerprint_pdf(pdf_path: Path, dpi: int, fullpage: bool = False) -> Fingerprint:
    img = renderizar_primeira_pagina(pdf_path, dpi=dpi)
    altura, largura = img.shape[:2]

    if fullpage:
        boxes = [(0, 0, int(largura), int(altura))]
    else:
        boxes = detectar_caixas_cartao(img)
        if not boxes:
            # Fallback: se não detectar cartão, usa recorte superior.
            logging.warning("Não encontrei bordas claras do cartão; usando recorte superior: %s", pdf_path.name)
            boxes = [(int(largura * 0.25), int(altura * 0.05), int(largura * 0.60), int(altura * 0.30))]

    masks: List[np.ndarray] = []
    for x, y, w, h in boxes:
        crop = img[y : y + h, x : x + w]
        masks.append(criar_mascara_estrutural(crop))

    return Fingerprint(arquivo=pdf_path, boxes=boxes, masks=masks)


def fingerprint_imagem(img_path: Path, fullpage: bool = False) -> Fingerprint:
    """Cria um fingerprint estrutural a partir da imagem de referência."""
    if not img_path.exists():
        raise FileNotFoundError(f"Imagem não encontrada: {img_path}")

    img_bgr = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError(f"Não foi possível ler a imagem: {img_path}")

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    altura, largura = img_rgb.shape[:2]
    if fullpage:
        boxes = [(0, 0, int(largura), int(altura))]
    else:
        # Tenta detectar cartões na imagem (se vier "prova" ou similar). Se não, usa a imagem toda.
        boxes = detectar_caixas_cartao(img_rgb)
        if not boxes:
            boxes = [(0, 0, int(largura), int(altura))]

    masks: List[np.ndarray] = []
    for x, y, w, h in boxes:
        crop = img_rgb[y : y + h, x : x + w]
        masks.append(criar_mascara_estrutural(crop))

    return Fingerprint(arquivo=img_path, boxes=boxes, masks=masks)


def distancia_mascaras(mask_a: np.ndarray, mask_b: np.ndarray) -> float:
    """
    Distância entre duas máscaras estruturais.

    0.0 = idêntico; 1.0 = muito diferente (aprox).
    """
    A = mask_a.astype(bool)
    B = mask_b.astype(bool)
    inter = np.logical_and(A, B).sum()
    union = np.logical_or(A, B).sum()
    iou = inter / union if union else 1.0
    xor = np.logical_xor(A, B).mean()
    return float(0.75 * (1.0 - iou) + 0.25 * xor)


def distancia_imagem_para_pdf(img_fp: Fingerprint, pdf_fp: Fingerprint) -> float:
    """
    Distância de uma referência (imagem) para um PDF.

    Mesmo se a contagem de máscaras diferir (ex.: frente/verso no PDF), a métrica
    procura a melhor correspondência (menor distância) para cada máscara da imagem.
    """
    if not img_fp.masks or not pdf_fp.masks:
        return 1.0

    distancias_por_mask_imagem: List[float] = []
    for mask_img in img_fp.masks:
        melhor = min(distancia_mascaras(mask_img, mask_pdf) for mask_pdf in pdf_fp.masks)
        distancias_por_mask_imagem.append(melhor)

    return float(np.mean(distancias_por_mask_imagem))


def salvar_preview_mascaras(masks: Sequence[np.ndarray], destino: Path) -> None:
    """
    Salva uma imagem de prévia com as máscaras estruturais (tamanho reduzido).
    """
    previews: List[np.ndarray] = []
    for mask in masks:
        bloco = np.ones((74, 120), dtype=np.uint8) * 255
        m = (255 - mask * 255).astype(np.uint8)
        m = cv2.resize(m, (110, 66), interpolation=cv2.INTER_NEAREST)
        bloco[4:70, 5:115] = m
        previews.append(bloco)

    if not previews:
        return

    canvas = np.vstack(previews)
    cv2.imwrite(str(destino), canvas)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Encontra o PDF mais semelhante a uma imagem usando fingerprint estrutural (sem OCR).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--pasta", default=PASTA_PADRAO, help="Pasta raiz onde os PDFs serão procurados recursivamente.")
    parser.add_argument("--imagem", required=True, help="Caminho da imagem de referência (png/jpg/webp).")
    parser.add_argument(
        "--saida",
        default=None,
        help="Pasta de saída. Se omitida, cria uma pasta nova dentro da pasta analisada.",
    )
    parser.add_argument("--top", type=int, default=5, help="Quantos melhores PDFs entram no relatório e previews.")
    parser.add_argument(
        "--copiar-top",
        type=int,
        default=1,
        help="Quantos dos melhores PDFs copiar para a pasta de saída (1 = só o melhor).",
    )
    parser.add_argument(
        "--fullpage",
        action="store_true",
        help="Compara usando a página inteira (imagem inteira vs 1ª página do PDF), ignorando detecção de caixas.",
    )
    parser.add_argument("--limiar", type=float, default=None, help="Opcional: valor de corte de distância (menor é melhor).")
    parser.add_argument("--dpi", type=int, default=160, help="DPI usado na renderização visual dos PDFs.")
    parser.add_argument("--max-pdfs", type=int, default=None, help="Opcional: limita a quantidade de PDFs analisados.")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = parse_args(argv)

    pasta = Path(args.pasta)
    img_path = Path(args.imagem)
    if not pasta.exists():
        raise FileNotFoundError(f"Pasta não encontrada: {pasta}")

    if not img_path.exists():
        raise FileNotFoundError(f"Imagem não encontrada: {img_path}")

    if args.top < 1:
        raise ValueError("--top precisa ser >= 1.")
    if args.copiar_top < 1:
        raise ValueError("--copiar-top precisa ser >= 1.")

    # Nome base para a pasta de saída.
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    if args.saida:
        pasta_saida = Path(args.saida)
    else:
        pasta_saida = pasta / f"_pdf_por_imagem_{_texto_para_nome_pasta(img_path.stem)}_{timestamp}"

    configurar_logger(pasta_saida)

    logging.info("Pasta analisada: %s", pasta)
    logging.info("Imagem de referência: %s", img_path)
    logging.info("Saída: %s", pasta_saida)
    logging.info("Top %s | Copiar top %s | DPI %s", args.top, args.copiar_top, args.dpi)
    if args.limiar is not None:
        logging.info("Limiar informado: %.4f", args.limiar)

    # Fingerprint da imagem (feito uma vez).
    img_fp = fingerprint_imagem(img_path, fullpage=args.fullpage)

    preview_img_path = pasta_saida / "preview_estrutura_imagem.png"
    salvar_preview_mascaras(img_fp.masks, preview_img_path)

    # Lista de PDFs.
    pdfs = listar_pdfs(pasta=pasta, ignorar_pastas=[pasta_saida])
    if args.max_pdfs:
        pdfs = pdfs[: args.max_pdfs]

    logging.info("PDFs encontrados: %s", len(pdfs))

    top_matches: List[Tuple[float, Path, Fingerprint]] = []  # (dist, pdf_path, fp_pdf)
    erros = 0

    for idx, pdf_path in enumerate(pdfs, start=1):
        try:
            logging.info("[%s/%s] analisando: %s", idx, len(pdfs), pdf_path.name)
            fp_pdf = fingerprint_pdf(pdf_path, dpi=args.dpi, fullpage=args.fullpage)
            dist = distancia_imagem_para_pdf(img_fp, fp_pdf)

            if len(top_matches) < args.top:
                top_matches.append((dist, pdf_path, fp_pdf))
                logging.info("dist=%.4f (adicionado ao top)", dist)
            else:
                pior_dist, _, _ = max(top_matches, key=lambda t: t[0])
                if dist < pior_dist:
                    # substitui o pior dentre os atuais
                    j = max(range(len(top_matches)), key=lambda i: top_matches[i][0])
                    top_matches[j] = (dist, pdf_path, fp_pdf)
                    logging.info("dist=%.4f (substituiu pior do top)", dist)
                else:
                    logging.info("dist=%.4f (não entrou no top)", dist)

        except Exception as exc:
            erros += 1
            logging.exception("Erro ao analisar %s: %s", pdf_path, exc)

    if not top_matches:
        raise RuntimeError("Nenhum PDF pôde ser analisado com sucesso.")

    top_matches.sort(key=lambda t: t[0])  # melhor primeiro

    # Relatório CSV.
    csv_path = pasta_saida / "top_matches.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(["rank", "arquivo_pdf", "distancia", "caixas_cartoes_detectados"])
        for i, (dist, pdf_path, fp_pdf) in enumerate(top_matches, start=1):
            writer.writerow([i, str(pdf_path), f"{dist:.6f}".replace(".", ","), len(fp_pdf.boxes)])

    logging.info("Relatório: %s", csv_path)

    # Copiar melhores (opcional).
    copiar_qtd = min(args.copiar_top, len(top_matches))
    for i in range(copiar_qtd):
        dist, pdf_path, fp_pdf = top_matches[i]
        destino_pdf = pasta_saida / f"melhor_{i+1:02d}__dist_{dist:.4f}__{pdf_path.name}"
        shutil.copy2(pdf_path, destino_pdf)

        preview_pdf_path = pasta_saida / f"preview_estrutura_pdf_rank_{i+1:02d}.png"
        salvar_preview_mascaras(fp_pdf.masks, preview_pdf_path)

    melhor_dist, melhor_pdf, _ = top_matches[0]
    logging.info("Melhor match: %s | distancia %.6f", melhor_pdf.name, melhor_dist)

    if args.limiar is not None:
        if melhor_dist <= args.limiar:
            logging.info("Melhor match ATENDE o limiar (<= %.4f).", args.limiar)
        else:
            logging.info("Melhor match NÃO atende o limiar (limiar <= %.4f).", args.limiar)


if __name__ == "__main__":
    main()


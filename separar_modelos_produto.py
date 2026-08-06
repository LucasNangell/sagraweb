# -*- coding: utf-8 -*-
"""
Separador de modelos distintos de PDFs de produtos gráficos.

Objetivo:
- Varre uma pasta procurando PDFs com o produto informado e, por padrão, também com "Prova" no nome.
- Analisa a estrutura visual do cartão de visita, sem usar o texto como critério.
- Copia um PDF representante de cada modelo distinto para uma pasta criada pelo script.
- Gera relatório CSV/TXT, CSV detalhado de agrupamentos e imagens de prévia para conferência.

Instalação das dependências:
    pip install pymupdf opencv-python numpy

Uso padrão:
    python separar_modelos_ctvisita.py

Ao iniciar sem parâmetros, o script perguntará qual produto procurar no nome do arquivo.
Se você apenas apertar ENTER, ele usa CtVisita.

Uso com parâmetros:
    python separar_modelos_ctvisita.py --produto "CtVisita" --pasta "G:\\Deputados\\2026\\Deputados_Papelaria_2026" --limite 100 --limiar 0.30

Exemplos de outros produtos:
    python separar_modelos_ctvisita.py --produto "Pasta"
    python separar_modelos_ctvisita.py --produto "Envelope"
    python separar_modelos_ctvisita.py --produto "Timbrado"

Observação:
- Por padrão, além do produto, o nome do PDF também precisa conter "Prova".
- Para alterar esse segundo termo obrigatório, use --termo-extra.
- Para não exigir nenhum segundo termo, use --termo-extra "".

Observação sobre o limiar:
- Menor = mais rigoroso, separa mais modelos parecidos. Ex.: 0.22 a 0.28
- Maior = agrupa mais modelos parecidos. Ex.: 0.32 a 0.40
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
VERSAO_SCRIPT = "2026-06-18-produto-parametro"

Box = Tuple[int, int, int, int]  # x, y, largura, altura


@dataclass
class Fingerprint:
    arquivo: Path
    boxes: List[Box]
    masks: List[np.ndarray]


@dataclass
class ArquivoAgrupado:
    arquivo: Path
    modelo_numero: Optional[int]
    distancia: Optional[float]
    status: str
    qtd_cartoes_na_prova: int


@dataclass
class ModeloEncontrado:
    numero: int
    representante: Path
    destino_pdf: Path
    preview_png: Path
    fingerprint: Fingerprint
    distancia_mais_proxima: Optional[float]
    modelo_mais_proximo: Optional[int]
    arquivos_agrupados: List[ArquivoAgrupado]


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
    """Cria uma versão segura do nome do produto para usar no nome da pasta de saída."""
    seguro = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in texto.strip())
    while "__" in seguro:
        seguro = seguro.replace("__", "_")
    return seguro.strip("_") or "Produto"


def listar_pdfs_filtrados(
    pasta: Path,
    produto: str,
    termo_extra: str = "Prova",
    ignorar_pastas: Optional[Sequence[Path]] = None,
) -> List[Path]:
    """
    Lista PDFs cujo nome contenha o produto informado e, se configurado, um termo extra.

    A comparação é case-insensitive. Exemplo: CtVisita, ctvisita e CTVISITA serão aceitos.
    """
    produto = produto.strip()
    termo_extra = termo_extra.strip()

    if not produto:
        raise ValueError("Informe um texto de produto para buscar no nome dos PDFs.")

    produto_lower = produto.lower()
    termo_extra_lower = termo_extra.lower()

    arquivos = []
    ignorar_pastas = list(ignorar_pastas or [])

    for p in pasta.rglob("*.pdf"):
        if not p.is_file():
            continue

        # Evita reprocessar arquivos copiados por execuções anteriores do próprio script.
        partes_minusculas = [parte.lower() for parte in p.parts]
        if any(parte.startswith("_modelos_distintos_") for parte in partes_minusculas):
            continue

        if any(_esta_dentro_de(p, pasta_ignorada) for pasta_ignorada in ignorar_pastas):
            continue

        nome = p.name.lower()

        # Evita reprocessar PDFs representantes copiados pelo próprio script,
        # mesmo quando a pasta de saída antiga tiver sido personalizada.
        if nome.startswith("modelo_"):
            continue

        contem_produto = produto_lower in nome
        contem_termo_extra = True if not termo_extra_lower else termo_extra_lower in nome

        if contem_produto and contem_termo_extra:
            arquivos.append(p)
    return sorted(arquivos, key=lambda p: str(p).lower())


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
    Detecta os retângulos dos cartões dentro da prova.

    A lógica procura bordas/linhas longas, não palavras. Isso evita que o rodapé
    da prova SEFOC e os textos do cliente determinem o modelo.
    """
    altura, largura = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

    # Binariza elementos escuros: bordas, logotipo, textos e linhas.
    inv = cv2.threshold(gray, 225, 255, cv2.THRESH_BINARY_INV)[1]

    # Extrai linhas horizontais e verticais longas, priorizando as bordas do cartão.
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
        # Os filtros são flexíveis para aceitar pequenas variações de renderização.
        if (
            w > largura * 0.25
            and w < largura * 0.90
            and h > altura * 0.06
            and h < altura * 0.35
            and 1.35 < proporcao < 2.10
            and y < altura * 0.75
        ):
            candidatos.append((x, y, w, h))

    # Remove duplicidades por sobreposição.
    candidatos = sorted(candidatos, key=lambda b: b[2] * b[3], reverse=True)
    selecionados: List[Box] = []
    for box in candidatos:
        if all(_iou(box, existente) < 0.30 for existente in selecionados):
            selecionados.append(box)

    # Normalmente cartão de visita terá frente apenas ou frente/verso.
    selecionados = sorted(selecionados, key=lambda b: (b[1], b[0]))[:4]

    # Pequena margem para não cortar a borda detectada.
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
    Transforma o cartão em uma máscara estrutural de baixa resolução.

    A máscara agrupa letras em blocos e mantém posições de elementos gráficos.
    O conteúdo literal do texto deixa de ser o fator principal; o que pesa é a
    posição dos blocos, bordas, logotipos, ícones e organização geral.
    """
    h, w = crop_rgb.shape[:2]

    # Remove parte da borda externa para a borda igual não dominar a comparação.
    margem = max(3, int(min(h, w) * 0.03))
    if h > margem * 2 and w > margem * 2:
        crop_rgb = crop_rgb[margem:h - margem, margem:w - margem]

    gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2HSV)
    saturacao = hsv[:, :, 1]
    valor = hsv[:, :, 2]

    # Elementos escuros + elementos coloridos relevantes, como brasão/ícones.
    mask = ((gray < 236) | ((saturacao > 35) & (valor < 248))).astype(np.uint8) * 255

    # Remove ruídos pequenos e transforma palavras em blocos aproximados.
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)))
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 5)), iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 7)))

    # Baixa resolução para reduzir influência de nomes/e-mails diferentes.
    mask_small = cv2.resize(mask, (90, 54), interpolation=cv2.INTER_AREA)
    mask_small = (mask_small > 15).astype(np.uint8)
    return mask_small


def fingerprint_pdf(pdf_path: Path, dpi: int) -> Fingerprint:
    img = renderizar_primeira_pagina(pdf_path, dpi=dpi)
    boxes = detectar_caixas_cartao(img)

    if not boxes:
        # Fallback: caso a borda do cartão não seja detectada, usa a área superior da prova.
        # Ainda assim, não há leitura textual; é apenas um recorte visual.
        altura, largura = img.shape[:2]
        logging.warning("Não encontrei bordas claras do cartão; usando recorte superior: %s", pdf_path.name)
        boxes = [(int(largura * 0.25), int(altura * 0.05), int(largura * 0.60), int(altura * 0.30))]

    masks: List[np.ndarray] = []
    for x, y, w, h in boxes:
        crop = img[y:y + h, x:x + w]
        masks.append(criar_mascara_estrutural(crop))

    return Fingerprint(arquivo=pdf_path, boxes=boxes, masks=masks)


def distancia_fingerprint(a: Fingerprint, b: Fingerprint) -> float:
    """0.0 = idêntico estruturalmente; 1.0 = muito diferente."""
    if len(a.masks) != len(b.masks):
        return 1.0

    distancias = []
    for mask_a, mask_b in zip(a.masks, b.masks):
        A = mask_a.astype(bool)
        B = mask_b.astype(bool)
        inter = np.logical_and(A, B).sum()
        union = np.logical_or(A, B).sum()
        iou = inter / union if union else 1.0
        xor = np.logical_xor(A, B).mean()
        distancias.append(0.75 * (1.0 - iou) + 0.25 * xor)

    return float(np.mean(distancias)) if distancias else 1.0


def salvar_preview(img_pdf: np.ndarray, fingerprint: Fingerprint, destino: Path) -> None:
    """Salva uma imagem de prévia com os cartões detectados e suas máscaras estruturais."""
    previews = []

    # Reabre/renderiza uma única vez externa? Para simplicidade, o caller passa a imagem? Aqui renderiza de novo não.
    for i, mask in enumerate(fingerprint.masks, start=1):
        bloco = np.ones((74, 120), dtype=np.uint8) * 255
        m = (255 - mask * 255).astype(np.uint8)
        m = cv2.resize(m, (110, 66), interpolation=cv2.INTER_NEAREST)
        bloco[4:70, 5:115] = m
        previews.append(bloco)

    if not previews:
        return

    canvas = np.vstack(previews)
    cv2.imwrite(str(destino), canvas)


def copiar_modelo(
    pdf_path: Path,
    fingerprint: Fingerprint,
    pasta_saida: Path,
    numero: int,
    distancia_mais_proxima: Optional[float],
    modelo_mais_proximo: Optional[int],
) -> ModeloEncontrado:
    nome_destino = f"modelo_{numero:03d}__{pdf_path.name}"
    destino_pdf = pasta_saida / nome_destino
    shutil.copy2(pdf_path, destino_pdf)

    preview_png = pasta_saida / f"modelo_{numero:03d}__preview_estrutura.png"
    # img_pdf não é necessário aqui; mantido no nome da função por compatibilidade futura.
    salvar_preview(np.empty((0, 0), dtype=np.uint8), fingerprint, preview_png)

    return ModeloEncontrado(
        numero=numero,
        representante=pdf_path,
        destino_pdf=destino_pdf,
        preview_png=preview_png,
        fingerprint=fingerprint,
        distancia_mais_proxima=distancia_mais_proxima,
        modelo_mais_proximo=modelo_mais_proximo,
        arquivos_agrupados=[],
    )


def gerar_relatorios(
    pasta_saida: Path,
    modelos: Sequence[ModeloEncontrado],
    atribuicoes: Sequence[ArquivoAgrupado],
    produto: str,
    termo_extra: str,
    total_lidos: int,
    total_com_erro: int,
    limiar: float,
    total_excedentes_por_limite: int,
) -> None:
    """
    Gera relatórios finais.

    Importante:
    - qtd_arquivos_agrupados_no_modelo = quantos PDFs foram classificados naquele modelo.
    - qtd_cartoes_detectados_na_prova_representante = quantos retângulos/cartões existem dentro do PDF representante
      normalmente 1 para frente única ou 2 para frente/verso. Não é a quantidade de arquivos do modelo.
    """
    csv_path = pasta_saida / "lista_modelos_distintos.csv"
    detalhes_csv_path = pasta_saida / "arquivos_agrupados_por_modelo.csv"
    txt_path = pasta_saida / "lista_modelos_distintos.txt"

    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow([
            "modelo",
            "qtd_arquivos_agrupados_no_modelo",
            "arquivo_representante_original",
            "arquivo_copiado",
            "preview_estrutura",
            "qtd_cartoes_detectados_na_prova_representante",
            "caixas_detectadas_xywh_representante",
            "distancia_mais_proxima_ao_criar",
            "modelo_mais_proximo_ao_criar",
        ])
        for m in modelos:
            writer.writerow([
                f"modelo_{m.numero:03d}",
                len(m.arquivos_agrupados),
                str(m.representante),
                str(m.destino_pdf),
                str(m.preview_png),
                len(m.fingerprint.boxes),
                " | ".join(map(str, m.fingerprint.boxes)),
                "" if m.distancia_mais_proxima is None else f"{m.distancia_mais_proxima:.4f}",
                "" if m.modelo_mais_proximo is None else f"modelo_{m.modelo_mais_proximo:03d}",
            ])

    with detalhes_csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow([
            "arquivo_pdf",
            "modelo_atribuido",
            "status",
            "distancia_ao_modelo",
            "qtd_cartoes_detectados_na_prova",
        ])
        for item in atribuicoes:
            writer.writerow([
                str(item.arquivo),
                "" if item.modelo_numero is None else f"modelo_{item.modelo_numero:03d}",
                item.status,
                "" if item.distancia is None else f"{item.distancia:.4f}",
                item.qtd_cartoes_na_prova,
            ])

    total_agrupado_em_modelos_salvos = sum(len(m.arquivos_agrupados) for m in modelos)

    with txt_path.open("w", encoding="utf-8") as f:
        f.write(f"Modelos distintos de {produto} encontrados\n")
        f.write("========================================\n\n")
        f.write(f"Produto usado como filtro no nome do arquivo: {produto}\n")
        f.write(f"Termo extra obrigatório no nome do arquivo: {termo_extra or 'nenhum'}\n")
        f.write(f"Total de PDFs encontrados pelo filtro: {total_lidos}\n")
        f.write(f"Total de PDFs com erro de análise: {total_com_erro}\n")
        f.write(f"Total de PDFs agrupados em modelos salvos: {total_agrupado_em_modelos_salvos}\n")
        f.write(f"Total de PDFs excedentes por limite de modelos: {total_excedentes_por_limite}\n")
        f.write(f"Total de modelos distintos salvos: {len(modelos)}\n")
        f.write(f"Limiar usado: {limiar:.2f}\n\n")
        f.write("Observação importante:\n")
        f.write("- 'qtd_arquivos_agrupados_no_modelo' é a quantidade real de PDFs classificados naquele modelo.\n")
        f.write("- 'qtd_cartoes_detectados_na_prova_representante' indica quantos cartões/retângulos há no PDF representante, por exemplo frente única ou frente/verso.\n\n")

        for m in modelos:
            f.write(f"modelo_{m.numero:03d}: {m.representante.name}\n")
            f.write(f"  Quantidade de PDFs agrupados neste modelo: {len(m.arquivos_agrupados)}\n")
            f.write(f"  Original: {m.representante}\n")
            f.write(f"  Copiado:  {m.destino_pdf}\n")
            f.write(f"  Cartões detectados na prova representante: {len(m.fingerprint.boxes)}\n")
            if m.distancia_mais_proxima is not None:
                f.write(
                    f"  Distância para o modelo mais próximo no momento da criação: "
                    f"{m.distancia_mais_proxima:.4f}"
                )
                if m.modelo_mais_proximo:
                    f.write(f" ({m.modelo_mais_proximo:03d})")
                f.write("\n")
            f.write("\n")

    logging.info("Relatório CSV de modelos salvo em: %s", csv_path)
    logging.info("Relatório CSV detalhado de agrupamentos salvo em: %s", detalhes_csv_path)
    logging.info("Relatório TXT salvo em: %s", txt_path)

def encontrar_modelo_mais_proximo(fp: Fingerprint, modelos: Sequence[ModeloEncontrado]) -> Tuple[Optional[int], Optional[float]]:
    if not modelos:
        return None, None

    melhor_numero: Optional[int] = None
    melhor_distancia: Optional[float] = None

    for modelo in modelos:
        d = distancia_fingerprint(fp, modelo.fingerprint)
        if melhor_distancia is None or d < melhor_distancia:
            melhor_distancia = d
            melhor_numero = modelo.numero

    return melhor_numero, melhor_distancia


def processar(
    pasta: Path,
    pasta_saida: Optional[Path],
    produto: str,
    termo_extra: str,
    limite: int,
    limiar: float,
    dpi: int,
) -> None:
    if not pasta.exists():
        raise FileNotFoundError(f"Pasta não encontrada: {pasta}")

    produto = produto.strip() or "CtVisita"
    termo_extra = termo_extra.strip()

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    if pasta_saida is None:
        produto_pasta = _texto_para_nome_pasta(produto)
        pasta_saida = pasta / f"_modelos_distintos_{produto_pasta}_{timestamp}"

    configurar_logger(pasta_saida)

    logging.info("Pasta analisada: %s", pasta)
    logging.info("Pasta de saída: %s", pasta_saida)
    logging.info("Produto buscado no nome do arquivo: %s", produto)
    logging.info("Termo extra obrigatório no nome do arquivo: %s", termo_extra or "nenhum")
    logging.info("Limite de modelos distintos a salvar: %s", limite)
    logging.info("Limiar de agrupamento: %.2f", limiar)

    pdfs = listar_pdfs_filtrados(
        pasta=pasta,
        produto=produto,
        termo_extra=termo_extra,
        ignorar_pastas=[pasta_saida],
    )
    logging.info("PDFs encontrados pelo filtro de produto/termo extra: %s", len(pdfs))

    modelos: List[ModeloEncontrado] = []
    atribuicoes: List[ArquivoAgrupado] = []
    erros = 0
    excedentes_por_limite = 0

    for idx, pdf_path in enumerate(pdfs, start=1):
        try:
            logging.info("[%s/%s] Analisando: %s", idx, len(pdfs), pdf_path.name)
            fp = fingerprint_pdf(pdf_path, dpi=dpi)

            numero_proximo, distancia_proxima = encontrar_modelo_mais_proximo(fp, modelos)

            if distancia_proxima is None or distancia_proxima > limiar:
                if len(modelos) < limite:
                    novo_numero = len(modelos) + 1
                    modelo = copiar_modelo(
                        pdf_path=pdf_path,
                        fingerprint=fp,
                        pasta_saida=pasta_saida,
                        numero=novo_numero,
                        distancia_mais_proxima=distancia_proxima,
                        modelo_mais_proximo=numero_proximo,
                    )
                    item = ArquivoAgrupado(
                        arquivo=pdf_path,
                        modelo_numero=novo_numero,
                        distancia=0.0,
                        status="representante_novo_modelo",
                        qtd_cartoes_na_prova=len(fp.boxes),
                    )
                    modelo.arquivos_agrupados.append(item)
                    modelos.append(modelo)
                    atribuicoes.append(item)
                    logging.info(
                        "NOVO MODELO %03d salvo: %s | cartões na prova: %s | distância próxima: %s",
                        novo_numero,
                        pdf_path.name,
                        len(fp.boxes),
                        "-" if distancia_proxima is None else f"{distancia_proxima:.4f}",
                    )
                else:
                    # O limite de representantes foi atingido, mas o script continua lendo os demais PDFs
                    # para que o relatório reflita corretamente tudo que foi analisado.
                    excedentes_por_limite += 1
                    item = ArquivoAgrupado(
                        arquivo=pdf_path,
                        modelo_numero=None,
                        distancia=distancia_proxima,
                        status="novo_modelo_nao_salvo_limite_atingido",
                        qtd_cartoes_na_prova=len(fp.boxes),
                    )
                    atribuicoes.append(item)
                    logging.info(
                        "Novo modelo provável NÃO salvo por limite atingido: %s | distância %.4f > limiar %.2f",
                        pdf_path.name,
                        -1.0 if distancia_proxima is None else distancia_proxima,
                        limiar,
                    )
            else:
                item = ArquivoAgrupado(
                    arquivo=pdf_path,
                    modelo_numero=numero_proximo,
                    distancia=distancia_proxima,
                    status="agrupado_em_modelo_existente",
                    qtd_cartoes_na_prova=len(fp.boxes),
                )
                atribuicoes.append(item)

                # Registra o arquivo dentro do modelo correspondente para contabilização no CSV principal.
                for modelo in modelos:
                    if modelo.numero == numero_proximo:
                        modelo.arquivos_agrupados.append(item)
                        break

                logging.info(
                    "Agrupado como modelo_%03d: %s | distância %.4f <= limiar %.2f",
                    numero_proximo,
                    pdf_path.name,
                    distancia_proxima,
                    limiar,
                )

        except Exception as exc:
            erros += 1
            item = ArquivoAgrupado(
                arquivo=pdf_path,
                modelo_numero=None,
                distancia=None,
                status=f"erro: {exc}",
                qtd_cartoes_na_prova=0,
            )
            atribuicoes.append(item)
            logging.exception("Erro ao analisar %s: %s", pdf_path, exc)

    gerar_relatorios(
        pasta_saida=pasta_saida,
        modelos=modelos,
        atribuicoes=atribuicoes,
        produto=produto,
        termo_extra=termo_extra,
        total_lidos=len(pdfs),
        total_com_erro=erros,
        limiar=limiar,
        total_excedentes_por_limite=excedentes_por_limite,
    )

    total_agrupado_em_modelos_salvos = sum(len(m.arquivos_agrupados) for m in modelos)
    logging.info("Processamento concluído.")
    logging.info("PDFs encontrados: %s", len(pdfs))
    logging.info("PDFs com erro: %s", erros)
    logging.info("Modelos distintos salvos: %s", len(modelos))
    logging.info("PDFs agrupados em modelos salvos: %s", total_agrupado_em_modelos_salvos)
    logging.info("PDFs excedentes por limite de modelos: %s", excedentes_por_limite)

def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detecta e separa modelos distintos de produtos gráficos em PDFs, usando um texto do produto no nome do arquivo.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--pasta", default=PASTA_PADRAO, help="Pasta raiz onde os PDFs serão procurados recursivamente.")
    parser.add_argument("--saida", default=None, help="Pasta de saída. Se omitida, cria uma pasta nova dentro da pasta analisada.")
    parser.add_argument(
        "--produto",
        default=None,
        help="Texto do produto que deve existir no nome do PDF. Se omitido, o script perguntará ao iniciar. Ex.: CtVisita, Pasta, Envelope.",
    )
    parser.add_argument(
        "--termo-extra",
        default="Prova",
        help="Segundo texto obrigatório no nome do PDF. Use --termo-extra \"\" para não exigir termo extra.",
    )
    parser.add_argument("--versao", action="store_true", help="Mostra a versão do script e encerra.")
    parser.add_argument("--limite", type=int, default=500, help="Quantidade máxima de modelos distintos a salvar.")
    parser.add_argument("--limiar", type=float, default=0.30, help="Limiar de diferença para considerar um novo modelo.")
    parser.add_argument("--dpi", type=int, default=160, help="DPI usado na renderização visual dos PDFs.")
    return parser.parse_args(argv)


def solicitar_produto_se_necessario(produto_arg: Optional[str]) -> str:
    """
    Permite trocar CtVisita por outro produto no início da execução.

    Se o script for chamado com --produto, não pergunta nada.
    Se for chamado sem --produto, pergunta no terminal e usa CtVisita como padrão ao apertar ENTER.
    """
    if produto_arg is not None and produto_arg.strip():
        return produto_arg.strip()

    try:
        resposta = input("Informe o texto do produto a buscar no nome do PDF [CtVisita]: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nNenhum produto informado. Usando padrão: CtVisita")
        return "CtVisita"

    return resposta or "CtVisita"


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = parse_args(argv)

    if getattr(args, "versao", False):
        print(f"separar_modelos_ctvisita.py - versão {VERSAO_SCRIPT}")
        return

    pasta = Path(args.pasta)
    pasta_saida = Path(args.saida) if args.saida else None
    produto = solicitar_produto_se_necessario(args.produto)

    if args.limite < 1:
        raise ValueError("O limite precisa ser maior ou igual a 1.")

    processar(
        pasta=pasta,
        pasta_saida=pasta_saida,
        produto=produto,
        termo_extra=args.termo_extra,
        limite=args.limite,
        limiar=args.limiar,
        dpi=args.dpi,
    )


if __name__ == "__main__":
    main()

"""Detecta e remove páginas em branco de PDFs (ex.: verso sem arte)."""
from __future__ import annotations

import os
from typing import Sequence

import fitz  # pymupdf

# Amostra baixa: página “em branco” do Corel costuma ser quase toda branca.
_SAMPLE_SCALE = 0.2
_WHITE_MIN = 250
# Fração máxima de pixels não-brancos para considerar a página vazia.
_NON_WHITE_MAX_RATIO = 0.002


def page_is_blank(page: fitz.Page) -> bool:
    """True se a página não tem texto útil e o raster é quase todo branco."""
    text = (page.get_text("text") or "").strip()
    if text:
        return False
    try:
        pix = page.get_pixmap(
            matrix=fitz.Matrix(_SAMPLE_SCALE, _SAMPLE_SCALE),
            alpha=False,
        )
    except Exception:
        # Sem raster confiável: se não há imagens, trata como em branco.
        return not bool(page.get_images(full=True))

    samples = pix.samples
    if not samples:
        return True
    n_channels = pix.n
    total = pix.width * pix.height
    if total <= 0:
        return True
    non_white = 0
    for i in range(0, len(samples), n_channels):
        chunk = samples[i : i + n_channels]
        if any(channel < _WHITE_MIN for channel in chunk):
            non_white += 1
            if non_white / total > _NON_WHITE_MAX_RATIO:
                return False
    return True


def copy_pdf_without_blank_pages(
    source_pdf: str,
    dest_pdf: str,
) -> dict[str, object]:
    """
    Grava ``dest_pdf`` com as páginas não-brancas de ``source_pdf``.
    Se todas forem brancas, mantém a primeira página (evita PDF vazio).
    """
    src = os.path.normpath(source_pdf)
    dest = os.path.normpath(dest_pdf)
    if not os.path.isfile(src):
        raise FileNotFoundError(f"PDF de origem não encontrado: {src}")

    keep: list[int] = []
    with fitz.open(src) as doc:
        for index in range(doc.page_count):
            if not page_is_blank(doc[index]):
                keep.append(index)
        if not keep and doc.page_count > 0:
            keep = [0]

        out = fitz.open()
        try:
            if keep:
                out.insert_pdf(doc, from_page=keep[0], to_page=keep[0])
                for page_index in keep[1:]:
                    out.insert_pdf(doc, from_page=page_index, to_page=page_index)
            if os.path.isfile(dest):
                os.remove(dest)
            out.save(dest, garbage=3, deflate=True)
        finally:
            out.close()

    return {
        "kept_pages": keep,
        "kept_count": len(keep),
        "source_pages": _source_page_count(src),
    }


def _source_page_count(path: str) -> int:
    with fitz.open(path) as doc:
        return int(doc.page_count)


def summarize_kept_pages(kept: Sequence[int]) -> str:
    if not kept:
        return "nenhuma"
    return ",".join(str(i + 1) for i in kept)

"""Monta PDF A4 de Prova e-mail: arte BaseSefoc + carimbo textual."""
from __future__ import annotations

import os
from typing import Any

import fitz  # pymupdf

A4_WIDTH_PT = 595.276  # 210 mm
A4_HEIGHT_PT = 841.890  # 297 mm
MARGIN_PT = 28.35  # ~10 mm
CARIMBO_HEIGHT_PT = 48.0


def compose_prova_email_a4(
    *,
    base_pdf_path: str,
    output_pdf_path: str,
    carimbo: dict[str, str],
) -> list[str]:
    """
    Cria A4 com a 1ª página do BaseSefoc escalada na área útil
    e textos do carimbo no rodapé.
    """
    logs: list[str] = []
    if not os.path.isfile(base_pdf_path):
        raise FileNotFoundError(f"BaseSefoc PDF não encontrado: {base_pdf_path}")

    src = fitz.open(base_pdf_path)
    try:
        if src.page_count < 1:
            raise ValueError("BaseSefoc.pdf sem páginas.")
        out = fitz.open()
        try:
            page = out.new_page(width=A4_WIDTH_PT, height=A4_HEIGHT_PT)
            usable_w = A4_WIDTH_PT - 2 * MARGIN_PT
            usable_h = A4_HEIGHT_PT - 2 * MARGIN_PT - CARIMBO_HEIGHT_PT
            src_rect = src[0].rect
            scale = min(usable_w / src_rect.width, usable_h / src_rect.height)
            dest_w = src_rect.width * scale
            dest_h = src_rect.height * scale
            x0 = (A4_WIDTH_PT - dest_w) / 2.0
            y0 = MARGIN_PT + (usable_h - dest_h) / 2.0
            dest = fitz.Rect(x0, y0, x0 + dest_w, y0 + dest_h)
            page.show_pdf_page(dest, src, 0)
            # Borda no tamanho real da arte (após escala), para sinalizar o formato.
            page.draw_rect(
                dest,
                color=(0, 0, 0),
                width=1.0,
                fill=None,
            )

            linha1 = (
                f"{carimbo.get('TipoOSint', '')} {carimbo.get('OSint', '')}  "
                f"Prova {carimbo.get('ProvaNroInt', '')}  "
                f"{carimbo.get('DataInt', '')}"
            ).strip()
            y_text = A4_HEIGHT_PT - MARGIN_PT - 18
            page.insert_text(
                (MARGIN_PT, y_text),
                linha1,
                fontsize=11,
                fontname="helv",
                color=(0, 0, 0),
            )
            page.insert_text(
                (MARGIN_PT, y_text + 16),
                "SEFOC — Prova para aprovação (e-mail)",
                fontsize=9,
                fontname="helv",
                color=(0.25, 0.25, 0.25),
            )

            os.makedirs(os.path.dirname(output_pdf_path) or ".", exist_ok=True)
            out.save(output_pdf_path)
            logs.append(f"Prova e-mail A4 gerada: {os.path.basename(output_pdf_path)}")
        finally:
            out.close()
    finally:
        src.close()
    return logs


def compose_from_job_dict(job: dict[str, Any], base_pdf_path: str, output_pdf_path: str) -> list[str]:
    from corel_generator import montar_carimbo_prova_email, resolve_prova_numero

    carimbo = montar_carimbo_prova_email(
        nro=int(job["nro"]),
        ano=int(job["ano"]),
        prova_numero=resolve_prova_numero(job),
    )
    return compose_prova_email_a4(
        base_pdf_path=base_pdf_path,
        output_pdf_path=output_pdf_path,
        carimbo=carimbo,
    )

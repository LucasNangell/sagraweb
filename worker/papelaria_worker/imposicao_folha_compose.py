"""Monta folha de imposição a partir de PDF template + artes (Pasta Avulso)."""
from __future__ import annotations

import os
from typing import Any

import fitz  # pymupdf

MM_TO_PT = 72.0 / 25.4


def _mm_to_pt(mm: float) -> float:
    return float(mm) * MM_TO_PT


def _cell_origin_mm(
    *,
    folha_w_mm: float,
    folha_h_mm: float,
    page_w_mm: float,
    page_h_mm: float,
    cols: int,
    rows: int,
    gap_h_mm: float,
    gap_v_mm: float,
    centralizar: bool,
    col: int,
    row: int,
) -> tuple[float, float]:
    total_w = cols * page_w_mm + max(0, cols - 1) * gap_h_mm
    total_h = rows * page_h_mm + max(0, rows - 1) * gap_v_mm
    margin_x = max(0.0, (folha_w_mm - total_w) / 2.0) if centralizar else 0.0
    margin_y = max(0.0, (folha_h_mm - total_h) / 2.0) if centralizar else 0.0
    x = margin_x + col * (page_w_mm + gap_h_mm)
    # origem inferior-esquerda (JDF); row 0 = topo da grade visual
    y = margin_y + (rows - 1 - row) * (page_h_mm + gap_v_mm)
    return x, y


def compose_folha_com_template(
    *,
    template_pdf_path: str,
    art_pdf_paths: list[str],
    config: dict[str, Any],
    output_pdf_path: str,
) -> list[str]:
    """
    Copia a 1ª página do PDF de imposição (template) e encaixa cada arte
    nos slots da grade (art_pdf_paths já na ordem dos slots, com duplicatas).
    """
    logs: list[str] = []
    tmpl_path = (template_pdf_path or "").strip()
    if not tmpl_path or not os.path.isfile(tmpl_path):
        raise FileNotFoundError(
            f"PDF de imposição não encontrado: {tmpl_path or '(vazio)'}"
        )
    if not art_pdf_paths:
        raise ValueError("Nenhuma arte para montar na folha de imposição.")

    folha = config.get("folha_mm") or {}
    folha_w = float(folha.get("largura") or 0)
    folha_h = float(folha.get("altura") or 0)
    pagina = config.get("pagina") or {}
    if pagina.get("origem") == "fixixa":
        page_w = float(pagina.get("largura_mm") or 0)
        page_h = float(pagina.get("altura_mm") or 0)
    else:
        with fitz.open(art_pdf_paths[0]) as probe:
            r = probe[0].rect
            page_w = r.width / MM_TO_PT
            page_h = r.height / MM_TO_PT

    grid = config.get("grid") or {}
    cols = max(1, int(grid.get("colunas") or 1))
    rows = max(1, int(grid.get("linhas") or 1))
    esp = config.get("espacamento_mm") or {}
    gap_h = float(esp.get("horizontal") or 0)
    gap_v = float(esp.get("vertical") or 0)
    centralizar = bool(config.get("centralizar_na_folha", True))
    ocupadas = grid.get("ocupadas")
    if not isinstance(ocupadas, list) or not ocupadas:
        ocupadas = [
            {"col": c, "row": r, "pagina": i + 1}
            for i, (r, c) in enumerate(
                (row, col) for row in range(rows) for col in range(cols)
            )
        ]

    tmpl = fitz.open(tmpl_path)
    try:
        if tmpl.page_count < 1:
            raise ValueError("PDF de imposição sem páginas.")
        out = fitz.open()
        try:
            out.insert_pdf(tmpl, from_page=0, to_page=0)
            page = out[0]
            folha_h_pt = page.rect.height
            if folha_w <= 0 or folha_h <= 0:
                folha_w = page.rect.width / MM_TO_PT
                folha_h = page.rect.height / MM_TO_PT
            if page_w <= 0 or page_h <= 0:
                raise ValueError("Tamanho da página (arte) inválido na config.")

            n_slots = min(len(ocupadas), len(art_pdf_paths), cols * rows)
            for i in range(n_slots):
                cell = ocupadas[i]
                art_path = art_pdf_paths[i]
                if not os.path.isfile(art_path):
                    raise FileNotFoundError(f"Arte ausente: {art_path}")
                col = int(cell.get("col") or 0)
                row = int(cell.get("row") or 0)
                x_mm, y_mm = _cell_origin_mm(
                    folha_w_mm=folha_w,
                    folha_h_mm=folha_h,
                    page_w_mm=page_w,
                    page_h_mm=page_h,
                    cols=cols,
                    rows=rows,
                    gap_h_mm=gap_h,
                    gap_v_mm=gap_v,
                    centralizar=centralizar,
                    col=col,
                    row=row,
                )
                # PyMuPDF: y cresce para baixo a partir do topo.
                x0 = _mm_to_pt(x_mm)
                y0 = folha_h_pt - _mm_to_pt(y_mm + page_h)
                x1 = x0 + _mm_to_pt(page_w)
                y1 = y0 + _mm_to_pt(page_h)
                dest = fitz.Rect(x0, y0, x1, y1)
                with fitz.open(art_path) as art:
                    if art.page_count < 1:
                        raise ValueError(f"Arte sem páginas: {art_path}")
                    page.show_pdf_page(dest, art, 0, keep_proportion=True)

            os.makedirs(os.path.dirname(output_pdf_path) or ".", exist_ok=True)
            out.save(output_pdf_path)
            logs.append(
                f"Folha montada com template {os.path.basename(tmpl_path)} "
                f"+ {n_slots} arte(s) → {os.path.basename(output_pdf_path)}"
            )
        finally:
            out.close()
    finally:
        tmpl.close()
    return logs

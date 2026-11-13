"""Monta PDF A4 de Prova e-mail: arte BaseSefoc em tamanho real + carimbo SEFOC."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import fitz  # pymupdf

MM_TO_PT = 72.0 / 25.4
A4_WIDTH_PT = 210 * MM_TO_PT  # 595.276
A4_HEIGHT_PT = 297 * MM_TO_PT  # 841.890
MARGIN_PT = 10 * MM_TO_PT  # 10 mm
TOP_OFFSET_PT = 20 * MM_TO_PT  # 20 mm do topo

# Faixa reservada no rodapé para o carimbo (títulos + caixas).
CARIMBO_BAND_PT = 78.0
CARIMBO_GAP_PT = 8.0
LEFT_BOX_W_PT = 128.0
RIGHT_BOX_W_PT = 210.0
BOX_H_PT = 54.0
# pymupdf: radius = fração do lado menor (0 < v ≤ 0.5).
BOX_RADIUS = 0.08
FIELD_RADIUS = 0.2

# Espaço entre Frente e Verso quando empilhados.
STACK_GAP_PT = 8 * MM_TO_PT
LABEL_FONT_SIZE = 8.0

_WIN_FONTS = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
_FONT_SANS = _WIN_FONTS / "arial.ttf"
_FONT_SERIF = _WIN_FONTS / "times.ttf"


def _pt_to_mm(pt: float) -> float:
    return float(pt) / MM_TO_PT


def _format_dimensoes_mm(width_pt: float, height_pt: float) -> str:
    """Ex.: 110mm (Alt) x 75mm (Larg) — Altura × Largura, como no padrão SEFOC."""
    alt = round(_pt_to_mm(height_pt))
    larg = round(_pt_to_mm(width_pt))
    return f"{alt}mm (Alt) x {larg}mm (Larg)"


def _insert_text_unicode(
    page: fitz.Page,
    point: tuple[float, float],
    text: str,
    *,
    fontsize: float,
    color: tuple[float, float, float],
    serif: bool = False,
) -> None:
    """Insere texto com fonte TTF (Unicode); cai em Base-14 se a TTF não existir."""
    fontfile = _FONT_SERIF if serif else _FONT_SANS
    kwargs: dict[str, Any] = {
        "fontsize": fontsize,
        "color": color,
    }
    if fontfile.is_file():
        kwargs["fontfile"] = str(fontfile)
        kwargs["fontname"] = "sefocserif" if serif else "sefocsans"
    else:
        kwargs["fontname"] = "tiro" if serif else "helv"
    page.insert_text(point, text, **kwargs)


def _side_label(page_index: int, total: int) -> str | None:
    """Rótulo sobre a arte: Frente / Verso (duplex) ou Pág. N."""
    if total <= 1:
        return None
    if page_index == 0:
        return "Frente"
    if page_index == 1:
        return "Verso"
    return f"Pág. {page_index + 1}"


def _compute_stack_layout(
    *,
    page_sizes: list[tuple[float, float]],
    usable: fitz.Rect,
) -> tuple[list[fitz.Rect], float]:
    """
    Calcula retângulos de destino empilhados (centro horizontal, 20 mm do topo).
    Escala única para todas as páginas se o conjunto não couber na área útil.
    """
    n = len(page_sizes)
    gap = STACK_GAP_PT if n > 1 else 0.0
    max_w = max(w for w, _ in page_sizes)
    total_h = sum(h for _, h in page_sizes) + gap * max(0, n - 1)

    scale = 1.0
    if max_w > usable.width or total_h > usable.height:
        scale = min(usable.width / max_w, usable.height / total_h)

    dests: list[fitz.Rect] = []
    y = usable.y0  # já é TOP_OFFSET_PT
    for w, h in page_sizes:
        dw = w * scale
        dh = h * scale
        x0 = (A4_WIDTH_PT - dw) / 2.0
        dests.append(fitz.Rect(x0, y, x0 + dw, y + dh))
        y += dh + gap
    return dests, scale


def _draw_carimbo(page: fitz.Page, carimbo: dict[str, str], dimensoes: str) -> None:
    """
    Carimbo no canto inferior esquerdo:
      [Prova SEFOC]          [Não vale como prova fiel de cor]
      ┌─────────────┐        ┌──────────────────────────────┐
      │ OS nº:  …   │        │ Produto                      │
      │ Data:   …   │        │ 110mm (Alt) x 75mm (Larg)    │
      │ Prova nº: … │        └──────────────────────────────┘
      └─────────────┘
    """
    os_nro = str(carimbo.get("OSint") or "").strip()
    data = str(carimbo.get("DataInt") or "").strip()
    prova = str(carimbo.get("ProvaNroInt") or "").strip()
    produto = str(carimbo.get("ProdutoNome") or "").strip() or "—"

    band_bottom = A4_HEIGHT_PT - MARGIN_PT
    boxes_y0 = band_bottom - BOX_H_PT
    left_x0 = MARGIN_PT
    left_x1 = left_x0 + LEFT_BOX_W_PT
    right_x0 = left_x1 + CARIMBO_GAP_PT
    right_x1 = right_x0 + RIGHT_BOX_W_PT

    left_box = fitz.Rect(left_x0, boxes_y0, left_x1, boxes_y0 + BOX_H_PT)
    right_box = fitz.Rect(right_x0, boxes_y0, right_x1, boxes_y0 + BOX_H_PT)

    _insert_text_unicode(
        page,
        (left_x0 + 1, boxes_y0 - 4),
        "Prova SEFOC",
        fontsize=10,
        color=(0, 0, 0),
        serif=True,
    )
    _insert_text_unicode(
        page,
        (right_x0 + 1, boxes_y0 - 4),
        "Não vale como prova fiel de cor",
        fontsize=8,
        color=(0.25, 0.25, 0.25),
    )

    page.draw_rect(
        left_box,
        color=(1, 1, 1),
        fill=(0.78, 0.78, 0.78),
        width=1.0,
        radius=BOX_RADIUS,
    )
    page.draw_rect(
        right_box,
        color=(0, 0, 0),
        fill=(1, 1, 1),
        width=1.0,
        radius=BOX_RADIUS,
    )

    field_pad_x = 6.0
    field_h = 12.0
    field_gap = 3.5
    label_w = 42.0
    value_x0 = left_x0 + field_pad_x + label_w
    value_x1 = left_x1 - field_pad_x
    rows = (
        ("OS nº:", os_nro),
        ("Data:", data),
        ("Prova nº:", prova),
    )
    y = boxes_y0 + 6.0
    for label, value in rows:
        _insert_text_unicode(
            page,
            (left_x0 + field_pad_x, y + 9),
            label,
            fontsize=7,
            color=(0.15, 0.15, 0.15),
        )
        field_rect = fitz.Rect(value_x0, y, value_x1, y + field_h)
        page.draw_rect(
            field_rect,
            color=(0.55, 0.55, 0.55),
            fill=(1, 1, 1),
            width=0.6,
            radius=FIELD_RADIUS,
        )
        _insert_text_unicode(
            page,
            (value_x0 + 3, y + 9),
            value,
            fontsize=7.5,
            color=(0, 0, 0),
        )
        y += field_h + field_gap

    inner = right_box + (10, 8, -10, -8)
    _insert_text_unicode(
        page,
        (inner.x0, inner.y0 + 14),
        produto,
        fontsize=11,
        color=(0, 0, 0),
    )
    _insert_text_unicode(
        page,
        (inner.x0, inner.y0 + 30),
        dimensoes,
        fontsize=9,
        color=(0.2, 0.2, 0.2),
    )


def compose_prova_email_a4(
    *,
    base_pdf_path: str,
    output_pdf_path: str,
    carimbo: dict[str, str],
) -> list[str]:
    """
    Cria A4 com a arte BaseSefoc em tamanho real (1:1 quando couber):
    - centralizada horizontalmente, 20 mm do topo;
    - se houver 2+ páginas, empilha Frente / Verso na mesma folha;
    - carimbo SEFOC no canto inferior esquerdo.
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
            usable = fitz.Rect(
                MARGIN_PT,
                TOP_OFFSET_PT,
                A4_WIDTH_PT - MARGIN_PT,
                A4_HEIGHT_PT - MARGIN_PT - CARIMBO_BAND_PT,
            )
            # Usa no máximo as páginas do PDF (Frente / Verso / …).
            page_sizes = [(p.rect.width, p.rect.height) for p in src]
            dests, scale = _compute_stack_layout(page_sizes=page_sizes, usable=usable)
            total = len(dests)

            for idx, dest in enumerate(dests):
                page.show_pdf_page(dest, src, idx)
                page.draw_rect(dest, color=(0, 0, 0), width=1.0, fill=None)
                label = _side_label(idx, total)
                if label:
                    # Pequeno texto sobre a arte (canto superior esquerdo).
                    _insert_text_unicode(
                        page,
                        (dest.x0 + 3, dest.y0 + LABEL_FONT_SIZE + 2),
                        label,
                        fontsize=LABEL_FONT_SIZE,
                        color=(0, 0, 0),
                    )

            src0 = src[0].rect
            dimensoes = _format_dimensoes_mm(src0.width, src0.height)
            _draw_carimbo(page, carimbo, dimensoes)

            if scale < 1.0 - 1e-6:
                logs.append(
                    f"Arte maior que a área útil — reduzida para "
                    f"{scale * 100:.1f}% (tamanho real não cabia no A4)."
                )
            else:
                logs.append(
                    f"Arte em tamanho real "
                    f"({_pt_to_mm(src0.width):.1f}×{_pt_to_mm(src0.height):.1f} mm)."
                )
            if total > 1:
                logs.append(f"Empilhadas {total} páginas (Frente/Verso) na mesma folha A4.")

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
        produto_nome=str(job.get("produto") or "").strip() or None,
    )
    return compose_prova_email_a4(
        base_pdf_path=base_pdf_path,
        output_pdf_path=output_pdf_path,
        carimbo=carimbo,
    )

"""
Timbrado A4 Digital via Prova PDF: preenche o PDF do modelo, recorta
cabeçalho/rodapé e devolve PNGs para o worker montar os DOCX Word.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class TimbradoDigitalPdfError(ValueError):
    """Falha ao gerar imagens digitais a partir do PDF do timbrado."""


# Faixas padrão A4 (pt) quando o config não traz regioes_digitais —
# alinhadas ao TimbradoA4.pdf (brasão/vetores no topo, textos no rodapé).
_DEFAULT_CABECALHO_PT = (0.0, 18.0, 595.28, 105.0)
_DEFAULT_RODAPE_PT = (0.0, 795.0, 595.28, 842.0)


def _rect_from_bbox(
    bbox: Any,
    *,
    page_width: float,
    page_height: float,
    unidade: str = "pt",
) -> tuple[float, float, float, float]:
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        raise TimbradoDigitalPdfError("Bbox de região digital inválido.")
    try:
        x0, y0, x1, y1 = (float(v) for v in bbox)
    except (TypeError, ValueError) as exc:
        raise TimbradoDigitalPdfError("Bbox de região digital inválido.") from exc
    uni = (unidade or "pt").strip().lower()
    if uni in ("norm", "normalized", "rel"):
        x0, x1 = x0 * page_width, x1 * page_width
        y0, y1 = y0 * page_height, y1 * page_height
    elif uni == "mm":
        fator = 72.0 / 25.4
        x0, y0, x1, y1 = x0 * fator, y0 * fator, x1 * fator, y1 * fator
    elif uni not in ("pt", "pts", "point", "points"):
        raise TimbradoDigitalPdfError(
            f"Unidade de região digital desconhecida: {unidade!r}."
        )
    if x1 <= x0 or y1 <= y0:
        raise TimbradoDigitalPdfError("Bbox de região digital com área zero.")
    return (x0, y0, x1, y1)


def regioes_digitais_efetivas(
    config: dict[str, Any],
    *,
    page_width: float,
    page_height: float,
) -> dict[str, tuple[float, float, float, float]]:
    """
    Resolve bboxes de cabecalho/rodapé a partir de ``regioes_digitais`` no
    config.json da Prova PDF (ou faixas padrão A4).
    """
    raw = config.get("regioes_digitais") if isinstance(config, dict) else None
    out: dict[str, tuple[float, float, float, float]] = {}
    defaults = {
        "cabecalho": _DEFAULT_CABECALHO_PT,
        "rodape": _DEFAULT_RODAPE_PT,
    }
    for face, default in defaults.items():
        parte = raw.get(face) if isinstance(raw, dict) else None
        if isinstance(parte, dict) and parte.get("bbox") is not None:
            out[face] = _rect_from_bbox(
                parte.get("bbox"),
                page_width=page_width,
                page_height=page_height,
                unidade=str(parte.get("unidade") or "pt"),
            )
        else:
            out[face] = default
    return out


def exportar_imagens_timbrado_digital(
    modelo_id: int,
    dados: dict[str, Any],
    dest_dir: str | Path,
    *,
    dpi: int = 300,
) -> dict[str, str]:
    """
    Renderiza o PDF do modelo com os dados e grava ``cabecalho.png`` /
    ``rodape.png`` em ``dest_dir``. Retorna paths absolutos.
    """
    import fitz

    from services import papelaria_prova_pdf_service as pdf_svc

    mid = int(modelo_id)
    if not pdf_svc.tem_modelo_pdf(mid):
        raise TimbradoDigitalPdfError(
            "Modelo sem Prova PDF configurada — necessário para Timbrado A4 Digital."
        )

    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)

    config = pdf_svc.carregar_config(mid)
    campos = config.get("campos") or []
    pdf_path = pdf_svc.caminho_pdf(mid)
    avisos: list[str] = []
    pdf_bytes = pdf_svc.renderizar(
        pdf_path,
        campos,
        dict(dados or {}),
        avisos=avisos,
        exigir_campos=False,
    )
    for aviso in avisos:
        logger.info("Timbrado digital PDF: %s", aviso)

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        if doc.page_count < 1:
            raise TimbradoDigitalPdfError("PDF do timbrado sem páginas.")
        page = doc[0]
        rect = page.rect
        regioes = regioes_digitais_efetivas(
            config, page_width=float(rect.width), page_height=float(rect.height)
        )
        zoom = max(1.0, float(dpi) / 72.0)
        matrix = fitz.Matrix(zoom, zoom)
        paths: dict[str, str] = {}
        for face, bbox in regioes.items():
            clip = fitz.Rect(bbox) & rect
            if clip.is_empty or clip.width < 1 or clip.height < 1:
                raise TimbradoDigitalPdfError(
                    f"Região digital «{face}» fora da página do PDF."
                )
            pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
            out_path = dest / f"{face}.png"
            pix.save(str(out_path))
            if not out_path.is_file() or out_path.stat().st_size <= 0:
                raise TimbradoDigitalPdfError(f"Falha ao gravar {out_path.name}.")
            paths[face] = str(out_path.resolve())
            logger.info(
                "Timbrado digital: %s %dx%d → %s",
                face,
                pix.width,
                pix.height,
                out_path.name,
            )
        return paths
    finally:
        doc.close()

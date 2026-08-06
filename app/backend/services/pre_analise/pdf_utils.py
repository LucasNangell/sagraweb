"""Utilitários de leitura de PDF para pré-análise."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

PT_TO_MM = 25.4 / 72.0

INVALID_FILE_EXTENSIONS = {
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".indd",
    ".idml",
    ".ai",
    ".psd",
    ".cdr",
    ".pub",
    ".rtf",
    ".odt",
    ".ods",
    ".odp",
}


def list_folder_files(folder_path: str) -> List[str]:
    if not folder_path or not os.path.isdir(folder_path):
        return []
    return sorted(os.listdir(folder_path))


def list_pdfs(folder_path: str) -> List[str]:
    return [
        name
        for name in list_folder_files(folder_path)
        if os.path.isfile(os.path.join(folder_path, name))
        and name.lower().endswith(".pdf")
    ]


def list_invalid_format_files(folder_path: str) -> List[str]:
    found: List[str] = []
    for name in list_folder_files(folder_path):
        path = os.path.join(folder_path, name)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext in INVALID_FILE_EXTENSIONS:
            found.append(name)
    return found


def _page_format_mm(page: Any) -> Tuple[float, float, str]:
    """Dimensão da página via TrimBox/MediaBox (rápido; sem análise de marcas de corte)."""
    from services.pre_analise.crop_marks import trim_box_dimensions_mm

    tb = trim_box_dimensions_mm(page)
    if tb:
        return tb[0], tb[1], "trimbox"
    rect = page.rect
    return (
        round(rect.height * PT_TO_MM, 2),
        round(rect.width * PT_TO_MM, 2),
        "mediabox",
    )


def pdf_info_from_document(
    full_path: str, doc: Any, *, close_doc: bool = False
) -> Dict[str, Any]:
    """Metadados a partir de um documento PyMuPDF já aberto."""
    name = os.path.basename(full_path)
    if fitz is None:
        return {"name": name, "error": "PyMuPDF indisponível.", "page_count": 0}
    try:
        protected = bool(doc.is_encrypted or doc.needs_pass)
        perms = doc.permissions if not doc.is_closed else 0
        page_count = doc.page_count
        pages_mm: List[Dict[str, float]] = []
        for i in range(page_count):
            page = doc.load_page(i)
            altura_mm, largura_mm, fonte = _page_format_mm(page)
            pages_mm.append(
                {
                    "page": i + 1,
                    "altura_mm": altura_mm,
                    "largura_mm": largura_mm,
                    "fonte": fonte,
                }
            )
        return {
            "name": name,
            "error": None,
            "page_count": page_count,
            "protected": protected,
            "permissions": perms,
            "pages_mm": pages_mm,
        }
    except Exception as exc:
        logger.warning("Erro ao ler PDF %s: %s", full_path, exc)
        return {"name": name, "error": str(exc), "page_count": 0, "protected": False}
    finally:
        if close_doc:
            try:
                doc.close()
            except Exception:
                pass


def pdf_infos_from_open_docs(
    docs: List[Tuple[str, Any]],
) -> List[Dict[str, Any]]:
    """Monta metadados sem reabrir arquivos (docs já abertos na sessão)."""
    infos: List[Dict[str, Any]] = []
    for path, doc in docs:
        name = os.path.basename(path)
        if isinstance(doc, Exception):
            infos.append(
                {
                    "name": name,
                    "error": str(doc),
                    "page_count": 0,
                    "protected": False,
                }
            )
            continue
        infos.append(pdf_info_from_document(path, doc))
    return infos


def pdf_info(full_path: str) -> Dict[str, Any]:
    """Metadados básicos de um PDF (leitura rápida para checks de pasta/páginas)."""
    name = os.path.basename(full_path)
    if fitz is None:
        return {"name": name, "error": "PyMuPDF indisponível.", "page_count": 0}

    doc = None
    try:
        doc = fitz.open(full_path)
        return pdf_info_from_document(full_path, doc)
    except Exception as exc:
        logger.warning("Erro ao ler PDF %s: %s", full_path, exc)
        return {"name": name, "error": str(exc), "page_count": 0, "protected": False}
    finally:
        if doc is not None:
            doc.close()


def max_page_dimensions_mm(pdf_infos: List[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    altura = 0.0
    largura = 0.0
    for info in pdf_infos:
        if info.get("error"):
            continue
        for pg in info.get("pages_mm") or []:
            altura = max(altura, float(pg.get("altura_mm") or 0))
            largura = max(largura, float(pg.get("largura_mm") or 0))
    if altura <= 0 or largura <= 0:
        return None
    return (altura, largura)


def classify_pdf_role(name: str, page_count: int) -> str:
    """capa | miolo | indefinido — heurística por nome e páginas."""
    lower = name.lower()
    if any(k in lower for k in ("capa", "cover", "1a capa", "4a capa")):
        return "capa"
    if any(k in lower for k in ("miolo", "texto", "conteudo", "conteúdo")):
        return "miolo"
    if page_count == 4:
        return "capa"
    if page_count > 4:
        return "miolo"
    return "indefinido"

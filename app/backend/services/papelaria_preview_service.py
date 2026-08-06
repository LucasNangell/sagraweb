"""Prévia PNG das páginas do PDF de jobs Papelaria (PyMuPDF)."""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_PREVIEW_SUBDIR = ".preview"
_DEFAULT_RENDER_SCALE = 4.0
_MIN_RENDER_SCALE = 2.0
_MAX_RENDER_SCALE = 6.0
_MAX_PAGES = 20
_RENDER_SCALE_META = ".render_scale"


def _preview_dir_for_job(sefoc_base: str, job_id: int) -> str:
    papelaria = os.path.join(sefoc_base, "Papelaria")
    base = papelaria if os.path.isdir(papelaria) else sefoc_base
    return os.path.join(base, _PREVIEW_SUBDIR, f"job_{job_id}")


def _preview_dir_for_proof(sefoc_base: str, proof_id: int) -> str:
    papelaria = os.path.join(sefoc_base, "Papelaria")
    base = papelaria if os.path.isdir(papelaria) else sefoc_base
    return os.path.join(base, _PREVIEW_SUBDIR, f"proof_{proof_id}")


def _get_sefoc_base_for_os(ano: int, os_id: int) -> str:
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, os_id)
    if not os_path:
        raise FileNotFoundError("Pasta da OS não encontrada.")
    return os.path.normpath(os.path.join(os_path, "Sefoc"))


def _sefoc_base_from_pdf_path(pdf_path: str, sefoc_base: str) -> str:
    real_file = os.path.realpath(pdf_path)
    real_base = os.path.realpath(sefoc_base)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if not real_file.startswith(real_base):
        raise ValueError("Caminho de arquivo inválido.")
    return sefoc_base


def _get_sefoc_base_for_job(job_id: int) -> str:
    from services.papelaria_jobs_service import get_job

    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")

    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(job["ano_protocolo"], job["nro_protocolo"])
    if not os_path:
        raise FileNotFoundError("Pasta da OS não encontrada.")
    return os.path.normpath(os.path.join(os_path, "Sefoc"))


def preview_render_scale() -> float:
    """Escala PyMuPDF para PNG do mockup (4x ≈ 288 dpi; configurável por env)."""
    raw = (os.environ.get("SAGRA_PAPELARIA_PREVIEW_SCALE") or "").strip()
    if not raw:
        return _DEFAULT_RENDER_SCALE
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "SAGRA_PAPELARIA_PREVIEW_SCALE inválido (%s); usando %.1f",
            raw,
            _DEFAULT_RENDER_SCALE,
        )
        return _DEFAULT_RENDER_SCALE
    return max(_MIN_RENDER_SCALE, min(_MAX_RENDER_SCALE, value))


def _read_cached_render_scale(cache_dir: str) -> float | None:
    meta_path = os.path.join(cache_dir, _RENDER_SCALE_META)
    try:
        with open(meta_path, encoding="utf-8") as fh:
            return float(fh.read().strip())
    except (OSError, ValueError):
        return None


def _write_cached_render_scale(cache_dir: str, scale: float) -> None:
    meta_path = os.path.join(cache_dir, _RENDER_SCALE_META)
    with open(meta_path, "w", encoding="utf-8") as fh:
        fh.write(f"{scale:.2f}")


def _png_needs_regenerate(
    png_path: str,
    *,
    pdf_mtime: float,
    png_mtime: float,
    expected_min_width: int,
    cached_scale: float | None,
    target_scale: float,
) -> bool:
    if not os.path.isfile(png_path):
        return True
    if png_mtime < pdf_mtime:
        return True
    if cached_scale is None or abs(cached_scale - target_scale) > 0.01:
        return True
    try:
        from PIL import Image

        with Image.open(png_path) as img:
            width, _height = img.size
            if width < expected_min_width * 0.9:
                return True
    except Exception:
        return True
    return False


def _render_pdf_pages(pdf_path: str, cache_dir: str) -> list[str]:
    import fitz

    os.makedirs(cache_dir, exist_ok=True)
    pdf_mtime = os.path.getmtime(pdf_path)
    render_scale = preview_render_scale()
    cached_scale = _read_cached_render_scale(cache_dir)
    generated: list[str] = []
    rerendered_any = False

    with fitz.open(pdf_path) as doc:
        page_count = min(len(doc), _MAX_PAGES)
        matrix = fitz.Matrix(render_scale, render_scale)

        for index in range(page_count):
            page_num = index + 1
            png_path = os.path.join(cache_dir, f"page_{page_num}.png")
            page = doc.load_page(index)
            expected_min_width = int(page.rect.width * render_scale * 0.95)
            try:
                png_mtime = os.path.getmtime(png_path)
            except OSError:
                png_mtime = 0

            if _png_needs_regenerate(
                png_path,
                pdf_mtime=pdf_mtime,
                png_mtime=png_mtime,
                expected_min_width=expected_min_width,
                cached_scale=cached_scale,
                target_scale=render_scale,
            ):
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                pix.save(png_path)
                rerendered_any = True
                logger.info(
                    "Preview PNG cache (scale=%.1f): %s (%sx%s)",
                    render_scale,
                    png_path,
                    pix.width,
                    pix.height,
                )

            generated.append(png_path)

    if rerendered_any:
        _write_cached_render_scale(cache_dir, render_scale)

    return generated


def ensure_job_preview_pages(job_id: int) -> dict[str, Any]:
    """
    Garante PNGs em Sefoc/Papelaria/.preview/job_{id}/page_N.png (ou Sefoc/.preview).
    Retorna metadados das páginas.
    """
    from services.papelaria_jobs_service import resolve_job_file_path

    pdf_path, _pdf_name = resolve_job_file_path(job_id, "pdf")
    sefoc_base = _get_sefoc_base_for_job(job_id)
    _sefoc_base_from_pdf_path(pdf_path, sefoc_base)

    cache_dir = _preview_dir_for_job(sefoc_base, job_id)
    png_paths = _render_pdf_pages(pdf_path, cache_dir)

    import fitz

    with fitz.open(pdf_path) as doc:
        total_pages = len(doc)

    return {
        "pages": [
            {"page": idx + 1, "path": path}
            for idx, path in enumerate(png_paths)
        ],
        "total_pages": total_pages,
        "truncated": total_pages > len(png_paths),
    }


def build_preview_pages_payload(job_id: int, *, api_prefix: str = "/api/papelaria") -> dict[str, Any]:
    meta = ensure_job_preview_pages(job_id)
    pages = [
        {
            "page": item["page"],
            "url": f"{api_prefix}/jobs/{job_id}/preview-pages/{item['page']}.png",
        }
        for item in meta["pages"]
    ]
    return {
        "pages": pages,
        "total_pages": meta.get("total_pages", len(pages)),
        "truncated": bool(meta.get("truncated")),
    }


def resolve_preview_page_path(job_id: int, page: int) -> str:
    if page < 1:
        raise ValueError("Número de página inválido.")

    meta = ensure_job_preview_pages(job_id)
    for item in meta["pages"]:
        if item["page"] == page:
            path = item["path"]
            sefoc_base = _get_sefoc_base_for_job(job_id)
            preview_root = os.path.realpath(_preview_dir_for_job(sefoc_base, job_id))
            real_path = os.path.realpath(path)
            if not (
                real_path == preview_root
                or real_path.startswith(preview_root + os.sep)
            ):
                raise ValueError("Caminho de prévia inválido.")
            if not os.path.isfile(real_path):
                raise FileNotFoundError("Prévia não encontrada.")
            return real_path

    raise FileNotFoundError("Página de prévia não encontrada.")


def ensure_proof_preview_pages(
    ano: int,
    os_id: int,
    proof_id: int,
    pdf_path: str,
) -> dict[str, Any]:
    """Garante PNGs do PDF de prova (portal cliente) em Sefoc/.preview/proof_{id}/."""
    sefoc_base = _get_sefoc_base_for_os(ano, os_id)
    _sefoc_base_from_pdf_path(pdf_path, sefoc_base)

    cache_dir = _preview_dir_for_proof(sefoc_base, proof_id)
    png_paths = _render_pdf_pages(pdf_path, cache_dir)

    import fitz

    with fitz.open(pdf_path) as doc:
        total_pages = len(doc)

    return {
        "pages": [
            {"page": idx + 1, "path": path}
            for idx, path in enumerate(png_paths)
        ],
        "total_pages": total_pages,
        "truncated": total_pages > len(png_paths),
    }


def build_proof_preview_pages_payload(
    ano: int,
    os_id: int,
    proof_id: int,
    pdf_path: str,
    *,
    token: str,
    mockup_meta: dict[str, Any],
    api_prefix: str = "/api",
) -> dict[str, Any]:
    meta = ensure_proof_preview_pages(ano, os_id, proof_id, pdf_path)
    base = f"{api_prefix}/client/proof/{ano}/{os_id}/preview-pages"
    pages = [
        {
            "page": item["page"],
            "url": f"{base}/{item['page']}.png?token={token}",
        }
        for item in meta["pages"]
    ]
    return {
        "isPapelaria": True,
        "pages": pages,
        "total_pages": meta.get("total_pages", len(pages)),
        "truncated": bool(meta.get("truncated")),
        "mockupConfigJson": mockup_meta.get("mockup_config_json"),
        "produto": mockup_meta.get("produto") or "",
        "arquivoModelo": mockup_meta.get("arquivo_modelo") or "",
        "frenteVerso": mockup_meta.get("frente_verso") or "",
    }


def resolve_proof_preview_page_path(
    ano: int,
    os_id: int,
    proof_id: int,
    pdf_path: str,
    page: int,
) -> str:
    if page < 1:
        raise ValueError("Número de página inválido.")

    meta = ensure_proof_preview_pages(ano, os_id, proof_id, pdf_path)
    for item in meta["pages"]:
        if item["page"] == page:
            path = item["path"]
            sefoc_base = _get_sefoc_base_for_os(ano, os_id)
            preview_root = os.path.realpath(_preview_dir_for_proof(sefoc_base, proof_id))
            real_path = os.path.realpath(path)
            if not (
                real_path == preview_root
                or real_path.startswith(preview_root + os.sep)
            ):
                raise ValueError("Caminho de prévia inválido.")
            if not os.path.isfile(real_path):
                raise FileNotFoundError("Prévia não encontrada.")
            return real_path

    raise FileNotFoundError("Página de prévia não encontrada.")

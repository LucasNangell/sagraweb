"""
Comparador visual de versões PDF — motor compartilhado (API + Folder Opener).

Rasteriza páginas (PyMuPDF), compara pixels (NumPy), gera diff/blend/bboxes e
relatório PDF (fpdf2). Sessões em disco sob TEMP/SagraWeb/Compare.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

import cv2
import fitz
import numpy as np
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

ProgressCb = Callable[[str, int, int, str], None]
CancelCb = Callable[[], bool]

# Limite de jobs ativos no mesmo processo (API / opener).
# Na API o fallback usa 1 para evitar OOM; o opener pode relaxar via parâmetro.
DEFAULT_MAX_ACTIVE_COMPARE_JOBS = 1


class OperationCanceledError(Exception):
    pass


class CompareBusyError(Exception):
    """Novo compare rejeitado porque já há job(s) ativo(s) no processo."""

    def __init__(self, message: str = "Já existe uma comparação em andamento."):
        super().__init__(message)


def compare_root() -> Path:
    root = Path(tempfile.gettempdir()) / "SagraWeb" / "Compare"
    root.mkdir(parents=True, exist_ok=True)
    return root


@dataclass
class PdfCompareOptions:
    dpi: int = 150
    threshold: int = 16
    include_unchanged_in_report: bool = False

    def sanitize(self) -> None:
        self.dpi = 300 if self.dpi == 300 else 150
        self.threshold = max(4, min(64, int(self.threshold)))


@dataclass
class PdfCompareBBox:
    x: int
    y: int
    w: int
    h: int


@dataclass
class PdfComparePageResult:
    index: int
    page_number: int
    status: str
    changed_percent: float
    changed_pixels: int
    total_pixels: int
    width: int
    height: int
    # Dimensões reais de cada versão (antes do canvas de comparação).
    width_a: int = 0
    height_a: int = 0
    width_b: int = 0
    height_b: int = 0
    boxes: list[PdfCompareBBox] = field(default_factory=list)
    image_a: str = ""
    image_b: str = ""
    image_diff: str = ""
    image_blend: str = ""
    thumb: str = ""
    meta_file: str = ""


@dataclass
class PdfCompareResult:
    session_id: str
    session_dir: str
    previous_path: str
    current_path: str
    previous_relative: str
    current_relative: str
    dpi: int
    threshold: int
    page_count_a: int
    page_count_b: int
    compared_pages: int
    changed_pages: int
    pages: list[PdfComparePageResult] = field(default_factory=list)
    summary: str = ""
    include_unchanged_in_report: bool = False


@dataclass
class SessionJob:
    session_id: str
    ano: int
    os_id: int
    session_dir: Path
    cancel_event: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    stage: str = "queued"
    current: int = 0
    total: int = 0
    message: str = "Na fila…"
    pct: float = 0.0
    done: bool = False
    error: Optional[str] = None
    cancelled: bool = False
    result: Optional[PdfCompareResult] = None
    created_at: float = field(default_factory=time.time)


_jobs: dict[str, SessionJob] = {}
_jobs_lock = threading.Lock()


def get_job(session_id: str) -> Optional[SessionJob]:
    with _jobs_lock:
        return _jobs.get(session_id)


def count_active_jobs() -> int:
    with _jobs_lock:
        return sum(1 for job in _jobs.values() if not job.done)


def _register_job_unlocked(job: SessionJob) -> None:
    _jobs[job.session_id] = job


def _register_job(job: SessionJob) -> None:
    with _jobs_lock:
        _register_job_unlocked(job)


def cleanup_old_sessions(max_age_seconds: float = 6 * 3600) -> None:
    root = compare_root()
    cutoff = time.time() - max_age_seconds
    try:
        for child in root.iterdir():
            if not child.is_dir():
                continue
            try:
                if child.stat().st_ctime < cutoff:
                    shutil.rmtree(child, ignore_errors=True)
            except OSError:
                pass
    except OSError:
        pass
    with _jobs_lock:
        stale = [
            sid
            for sid, job in _jobs.items()
            if job.created_at < cutoff and job.done
        ]
        for sid in stale:
            _jobs.pop(sid, None)


def _report(
    progress: Optional[ProgressCb],
    job: Optional[SessionJob],
    stage: str,
    current: int,
    total: int,
    message: str,
) -> None:
    pct = 100.0 if total <= 0 else min(100.0, 100.0 * current / total)
    if job is not None:
        with job.lock:
            job.stage = stage
            job.current = current
            job.total = total
            job.message = message
            job.pct = pct
    if progress:
        try:
            progress(stage, current, total, message)
        except Exception:
            pass


def _render_page_from_doc(doc: fitz.Document, page_index: int, dpi: int) -> Image.Image:
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    page = doc.load_page(page_index)
    pix = page.get_pixmap(matrix=matrix, alpha=False, annots=True)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    # pixmap RGB já vem sem alpha; só converte se o modo divergir.
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def _pad_to_canvas(source: Image.Image, width: int, height: int) -> Image.Image:
    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    canvas.paste(source, (0, 0))
    return canvas


def _normalize_pair(
    a: Image.Image, b: Image.Image
) -> tuple[Image.Image, Image.Image]:
    """Pad só quando necessário; evita copy quando o tamanho já bate."""
    w = max(a.width, b.width)
    h = max(a.height, b.height)
    if a.width != w or a.height != h:
        a = _pad_to_canvas(a, w, h)
    if b.width != w or b.height != h:
        b = _pad_to_canvas(b, w, h)
    return a, b


def _save_jpeg(img: Image.Image, path: Path, quality: int = 90) -> None:
    out = img if img.mode == "RGB" else img.convert("RGB")
    out.save(path, format="JPEG", quality=quality)


def _save_thumb(source: Image.Image, path: Path, max_edge: int = 160) -> None:
    scale = min(1.0, max_edge / float(max(source.width, source.height)))
    tw = max(1, int(round(source.width * scale)))
    th = max(1, int(round(source.height * scale)))
    thumb = source.resize((tw, th), Image.Resampling.LANCZOS)
    _save_jpeg(thumb, path, quality=80)


def _dilate_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask
    kernel = np.ones((radius * 2 + 1, radius * 2 + 1), np.uint8)
    return cv2.dilate(mask, kernel, iterations=1)


def _near(a: PdfCompareBBox, b: PdfCompareBBox, gap: int) -> bool:
    return not (
        a.x + a.w + gap < b.x
        or b.x + b.w + gap < a.x
        or a.y + a.h + gap < b.y
        or b.y + b.h + gap < a.y
    )


def _union(a: PdfCompareBBox, b: PdfCompareBBox) -> PdfCompareBBox:
    x1 = min(a.x, b.x)
    y1 = min(a.y, b.y)
    x2 = max(a.x + a.w, b.x + b.w)
    y2 = max(a.y + a.h, b.y + b.h)
    return PdfCompareBBox(x=x1, y=y1, w=x2 - x1, h=y2 - y1)


def _merge_boxes(boxes: list[PdfCompareBBox], gap: int = 12) -> list[PdfCompareBBox]:
    items = list(boxes)
    merged = True
    while merged:
        merged = False
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                if not _near(items[i], items[j], gap):
                    continue
                items[i] = _union(items[i], items[j])
                items.pop(j)
                merged = True
                break
            if merged:
                break
    return items


def _find_clusters(mask: np.ndarray, min_area: int) -> list[PdfCompareBBox]:
    # mask: uint8 0/1, shape (h, w)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(
        (mask > 0).astype(np.uint8), connectivity=4
    )
    boxes: list[PdfCompareBBox] = []
    for label in range(1, num):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        boxes.append(PdfCompareBBox(x=x, y=y, w=max(1, w), h=max(1, h)))
    boxes = _merge_boxes(boxes, gap=12)
    boxes.sort(key=lambda b: b.w * b.h, reverse=True)
    return boxes[:40]


def _draw_boxes(img: Image.Image, boxes: list[PdfCompareBBox]) -> None:
    if not boxes:
        return
    draw = ImageDraw.Draw(img)
    width = max(2, img.width // 600)
    color = (255, 64, 0)
    for box in boxes:
        x2 = box.x + box.w - 1
        y2 = box.y + box.h - 1
        for i in range(width):
            draw.rectangle(
                [box.x - i, box.y - i, x2 + i, y2 + i], outline=color
            )


def _compare_bitmaps(
    session_dir: Path,
    index: int,
    a_orig: Image.Image,
    b_orig: Image.Image,
    threshold: int,
) -> PdfComparePageResult:
    width_a, height_a = a_orig.size
    width_b, height_b = b_orig.size
    # Canvas comum só para o cálculo visual; as imagens A/B salvas
    # preservam o tamanho real de cada arquivo. _normalize_pair só
    # aloca cópia quando o pad é necessário.
    a, b = _normalize_pair(a_orig, b_orig)
    arr_a = np.asarray(a, dtype=np.int16)
    arr_b = np.asarray(b, dtype=np.int16)
    h, w = arr_a.shape[0], arr_a.shape[1]

    r_a, g_a, b_a = arr_a[:, :, 0], arr_a[:, :, 1], arr_a[:, :, 2]
    r_b, g_b, b_b = arr_b[:, :, 0], arr_b[:, :, 1], arr_b[:, :, 2]

    lum_a = (r_a * 30 + g_a * 59 + b_a * 11) // 100
    lum_b = (r_b * 30 + g_b * 59 + b_b * 11) // 100
    dr = np.abs(r_a - r_b)
    dg = np.abs(g_a - g_b)
    db = np.abs(b_a - b_b)
    dlum = np.abs(lum_a - lum_b)
    delta = np.maximum(dlum, np.maximum(dr, np.maximum(dg, db)))
    changed_mask = (delta > threshold).astype(np.uint8)
    changed = int(changed_mask.sum())

    grey = ((lum_a + lum_b) // 2).astype(np.uint8)
    diff = np.stack([grey, grey, grey], axis=-1)
    highlight = changed_mask.astype(bool)
    # Heatmap: vermelho nas mudanças (R alto, G/B dim).
    diff[highlight, 0] = 220
    diff[highlight, 1] = grey[highlight] // 3
    diff[highlight, 2] = grey[highlight] // 3

    # Onion skin: R=atual, G=média, B=anterior (ciano/magenta).
    blend = np.stack(
        [
            lum_b.astype(np.uint8),
            ((lum_a + lum_b) // 2).astype(np.uint8),
            lum_a.astype(np.uint8),
        ],
        axis=-1,
    )

    mask = _dilate_mask(changed_mask, 2)
    min_area = max(24, (w * h) // 80000)
    boxes = _find_clusters(mask, min_area)

    diff_img = Image.fromarray(diff, mode="RGB")
    blend_img = Image.fromarray(blend, mode="RGB")
    _draw_boxes(diff_img, boxes)

    prefix = f"page-{index + 1:03d}"
    path_a = session_dir / f"{prefix}-a.jpg"
    path_b = session_dir / f"{prefix}-b.jpg"
    path_diff = session_dir / f"{prefix}-diff.jpg"
    path_blend = session_dir / f"{prefix}-blend.jpg"
    path_thumb = session_dir / f"{prefix}-thumb.jpg"
    path_meta = session_dir / f"{prefix}-meta.json"

    _save_jpeg(a_orig, path_a)
    _save_jpeg(b_orig, path_b)
    _save_jpeg(diff_img, path_diff)
    _save_jpeg(blend_img, path_blend)
    _save_thumb(diff_img, path_thumb)

    total_pixels = w * h
    pct = 0.0 if total_pixels == 0 else round(100.0 * changed / total_pixels, 3)
    page = PdfComparePageResult(
        index=index,
        page_number=index + 1,
        status="compared",
        changed_percent=pct,
        changed_pixels=changed,
        total_pixels=total_pixels,
        width=w,
        height=h,
        width_a=width_a,
        height_a=height_a,
        width_b=width_b,
        height_b=height_b,
        boxes=boxes,
        image_a=str(path_a),
        image_b=str(path_b),
        image_diff=str(path_diff),
        image_blend=str(path_blend),
        thumb=str(path_thumb),
        meta_file=str(path_meta),
    )
    path_meta.write_text(
        json.dumps(_page_to_dict(page), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return page


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("segoeui.ttf", "SegoeUI.ttf", "arial.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _save_missing_pair_page(
    session_dir: Path,
    index: int,
    only: Optional[Image.Image],
    status: str,
    side: str,
) -> PdfComparePageResult:
    if only is None:
        w, h = 1, 1
        canvas = Image.new("RGB", (w, h), (255, 255, 255))
    else:
        w, h = only.width, only.height
        canvas = only.copy()

    draw = ImageDraw.Draw(canvas)
    label = (
        "Somente na versão anterior"
        if status == "only-previous"
        else "Somente na versão atual"
    )
    bar_h = min(48, h)
    draw.rectangle([0, 0, w, bar_h], fill=(220, 40, 40))
    draw.text((12, 10), label, fill=(255, 255, 255), font=_font(18))

    empty = Image.new("RGB", (w, h), (255, 255, 255))
    prefix = f"page-{index + 1:03d}"
    path_a = session_dir / f"{prefix}-a.jpg"
    path_b = session_dir / f"{prefix}-b.jpg"
    path_diff = session_dir / f"{prefix}-diff.jpg"
    path_blend = session_dir / f"{prefix}-blend.jpg"
    path_thumb = session_dir / f"{prefix}-thumb.jpg"
    path_meta = session_dir / f"{prefix}-meta.json"

    if side == "a":
        _save_jpeg(canvas, path_a)
        _save_jpeg(empty, path_b)
    else:
        _save_jpeg(empty, path_a)
        _save_jpeg(canvas, path_b)
    _save_jpeg(canvas, path_diff)
    _save_jpeg(canvas, path_blend)
    _save_thumb(canvas, path_thumb)

    page = PdfComparePageResult(
        index=index,
        page_number=index + 1,
        status=status,
        changed_percent=100.0,
        changed_pixels=w * h,
        total_pixels=w * h,
        width=w,
        height=h,
        width_a=w if side == "a" else 0,
        height_a=h if side == "a" else 0,
        width_b=w if side == "b" else 0,
        height_b=h if side == "b" else 0,
        boxes=[PdfCompareBBox(x=0, y=0, w=w, h=h)],
        image_a=str(path_a),
        image_b=str(path_b),
        image_diff=str(path_diff),
        image_blend=str(path_blend),
        thumb=str(path_thumb),
        meta_file=str(path_meta),
    )
    path_meta.write_text(
        json.dumps(_page_to_dict(page), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return page


def _page_to_dict(page: PdfComparePageResult) -> dict[str, Any]:
    return {
        "index": page.index,
        "pageNumber": page.page_number,
        "status": page.status,
        "changedPercent": page.changed_percent,
        "changedPixels": page.changed_pixels,
        "totalPixels": page.total_pixels,
        "width": page.width,
        "height": page.height,
        "widthA": page.width_a,
        "heightA": page.height_a,
        "widthB": page.width_b,
        "heightB": page.height_b,
        "boxes": [asdict(b) for b in page.boxes],
        "imageA": os.path.basename(page.image_a) if page.image_a else None,
        "imageB": os.path.basename(page.image_b) if page.image_b else None,
        "imageDiff": os.path.basename(page.image_diff) if page.image_diff else None,
        "imageBlend": os.path.basename(page.image_blend) if page.image_blend else None,
        "thumb": os.path.basename(page.thumb) if page.thumb else None,
    }


def result_to_api_dict(
    result: PdfCompareResult, *, asset_base: str
) -> dict[str, Any]:
    pages = []
    for page in result.pages:
        base = _page_to_dict(page)
        urls = {
            "a": f"{asset_base}/{base['imageA']}" if base["imageA"] else None,
            "b": f"{asset_base}/{base['imageB']}" if base["imageB"] else None,
            "diff": f"{asset_base}/{base['imageDiff']}" if base["imageDiff"] else None,
            "blend": f"{asset_base}/{base['imageBlend']}" if base["imageBlend"] else None,
            "thumb": f"{asset_base}/{base['thumb']}" if base["thumb"] else None,
        }
        base["urls"] = urls
        pages.append(base)

    return {
        "sessionId": result.session_id,
        "previousPath": result.previous_path,
        "currentPath": result.current_path,
        "previousRelative": result.previous_relative,
        "currentRelative": result.current_relative,
        "previousName": os.path.basename(result.previous_path),
        "currentName": os.path.basename(result.current_path),
        "dpi": result.dpi,
        "threshold": result.threshold,
        "pageCountA": result.page_count_a,
        "pageCountB": result.page_count_b,
        "comparedPages": result.compared_pages,
        "changedPages": result.changed_pages,
        "summary": result.summary,
        "includeUnchangedInReport": result.include_unchanged_in_report,
        "assetBase": asset_base,
        "pages": pages,
        "hasResult": True,
    }


def compare_pdfs(
    previous_pdf: str,
    current_pdf: str,
    *,
    previous_relative: str = "",
    current_relative: str = "",
    options: Optional[PdfCompareOptions] = None,
    progress: Optional[ProgressCb] = None,
    should_cancel: Optional[CancelCb] = None,
    job: Optional[SessionJob] = None,
    session_id: Optional[str] = None,
) -> PdfCompareResult:
    if not previous_pdf or not os.path.isfile(previous_pdf):
        raise FileNotFoundError("PDF anterior não encontrado.")
    if not current_pdf or not os.path.isfile(current_pdf):
        raise FileNotFoundError("PDF atual não encontrado.")

    options = options or PdfCompareOptions()
    options.sanitize()

    cleanup_old_sessions()

    sid = session_id or uuid.uuid4().hex
    session_dir = compare_root() / sid
    session_dir.mkdir(parents=True, exist_ok=True)

    if should_cancel and should_cancel():
        raise OperationCanceledError("Comparação cancelada.")
    _report(progress, job, "copy", 0, 1, "Copiando PDFs…")
    local_a = session_dir / "input-a.pdf"
    local_b = session_dir / "input-b.pdf"
    shutil.copy2(previous_pdf, local_a)
    if should_cancel and should_cancel():
        raise OperationCanceledError("Comparação cancelada.")
    shutil.copy2(current_pdf, local_b)

    doc_a: Optional[fitz.Document] = None
    doc_b: Optional[fitz.Document] = None
    try:
        doc_a = fitz.open(str(local_a))
        doc_b = fitz.open(str(local_b))
        count_a = doc_a.page_count
        count_b = doc_b.page_count
        if count_a == 0 and count_b == 0:
            raise ValueError("Os PDFs não contêm páginas.")

        total = max(count_a, count_b)
        pages: list[PdfComparePageResult] = []
        _report(progress, job, "raster", 0, total, "Preparando páginas…")

        with ThreadPoolExecutor(max_workers=2) as pool:
            for i in range(total):
                if should_cancel and should_cancel():
                    raise OperationCanceledError("Comparação cancelada.")
                _report(
                    progress,
                    job,
                    "compare",
                    i,
                    total,
                    f"Comparando página {i + 1} de {total}…",
                )
                has_a = i < count_a
                has_b = i < count_b

                if has_a and has_b:
                    # Dois documentos distintos — seguro em paralelo.
                    fut_a = pool.submit(
                        _render_page_from_doc, doc_a, i, options.dpi
                    )
                    fut_b = pool.submit(
                        _render_page_from_doc, doc_b, i, options.dpi
                    )
                    bmp_a = fut_a.result()
                    bmp_b = fut_b.result()
                    pages.append(
                        _compare_bitmaps(
                            session_dir, i, bmp_a, bmp_b, options.threshold
                        )
                    )
                    continue

                bmp_a = (
                    _render_page_from_doc(doc_a, i, options.dpi)
                    if has_a
                    else None
                )
                bmp_b = (
                    _render_page_from_doc(doc_b, i, options.dpi)
                    if has_b
                    else None
                )
                only = bmp_a if has_a else bmp_b
                status = "only-previous" if has_a else "only-current"
                side = "a" if has_a else "b"
                pages.append(
                    _save_missing_pair_page(session_dir, i, only, status, side)
                )

        changed = sum(
            1
            for p in pages
            if p.changed_percent > 0.01 or p.status != "compared"
        )
        result = PdfCompareResult(
            session_id=sid,
            session_dir=str(session_dir),
            previous_path=previous_pdf,
            current_path=current_pdf,
            previous_relative=previous_relative,
            current_relative=current_relative,
            dpi=options.dpi,
            threshold=options.threshold,
            page_count_a=count_a,
            page_count_b=count_b,
            compared_pages=len(pages),
            changed_pages=changed,
            pages=pages,
            summary=(
                "Nenhuma diferença visual detectada."
                if changed == 0
                else f"{changed} página(s) com alteração visual."
            ),
            include_unchanged_in_report=options.include_unchanged_in_report,
        )
        (session_dir / "session.json").write_text(
            json.dumps(
                {
                    "sessionId": result.session_id,
                    "previousPath": result.previous_path,
                    "currentPath": result.current_path,
                    "previousRelative": result.previous_relative,
                    "currentRelative": result.current_relative,
                    "dpi": result.dpi,
                    "threshold": result.threshold,
                    "pageCountA": result.page_count_a,
                    "pageCountB": result.page_count_b,
                    "comparedPages": result.compared_pages,
                    "changedPages": result.changed_pages,
                    "summary": result.summary,
                    "includeUnchangedInReport": result.include_unchanged_in_report,
                    "pages": [_page_to_dict(p) for p in pages],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        _report(progress, job, "done", total, total, result.summary)
        return result
    finally:
        if doc_a is not None:
            doc_a.close()
        if doc_b is not None:
            doc_b.close()


def severity_label(page: PdfComparePageResult) -> str:
    if page.status != "compared":
        return "Crítica"
    if page.changed_percent <= 0.01:
        return "Nenhuma"
    if page.changed_percent < 0.5:
        return "Baixa"
    if page.changed_percent < 2.0:
        return "Média"
    return "Alta"


def build_report_pdf(
    result: PdfCompareResult,
    destination: Path,
    *,
    include_unchanged: bool,
    should_cancel: Optional[CancelCb] = None,
    progress: Optional[ProgressCb] = None,
    job: Optional[SessionJob] = None,
) -> Path:
    from fpdf import FPDF

    pages = [
        p
        for p in result.pages
        if include_unchanged or p.changed_percent > 0.01 or p.status != "compared"
    ]
    if not pages:
        pages = list(result.pages)
    if not pages:
        raise ValueError("Nenhuma página disponível para o relatório.")

    total_steps = 2 + len(pages)
    step = 0

    def tick(message: str) -> None:
        nonlocal step
        step += 1
        _report(progress, job, "report", step, total_steps, message)

    if should_cancel and should_cancel():
        raise OperationCanceledError("Relatório cancelado.")

    tick("Montando capa do relatório…")
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Relatorio de comparacao de versoes", ln=True)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, "SAGRA Web - Comparador de versoes PDF", ln=True)
    pdf.ln(4)

    changed = sum(
        1 for p in pages if p.changed_percent > 0.01 or p.status != "compared"
    )
    identical = len(pages) - changed
    max_pct = max((p.changed_percent for p in pages), default=0.0)
    total_boxes = sum(len(p.boxes) for p in pages)

    rows = [
        ("Versao anterior", os.path.basename(result.previous_path)),
        ("Caminho anterior", result.previous_relative or result.previous_path),
        ("Versao atual", os.path.basename(result.current_path)),
        ("Caminho atual", result.current_relative or result.current_path),
        ("Resolucao", f"{result.dpi} DPI"),
        ("Tolerancia", str(result.threshold)),
        ("Paginas anterior", str(result.page_count_a)),
        ("Paginas atual", str(result.page_count_b)),
        ("Paginas no relatorio", str(len(pages))),
        ("Com alteracao", str(changed)),
        ("Sem alteracao", str(identical)),
        ("Maior % alterado", f"{max_pct:.3f}%"),
        ("Regioes detectadas", str(total_boxes)),
        ("Conclusao", result.summary),
    ]
    pdf.set_font("Helvetica", "", 10)
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    for label, value in rows:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(55, 6, label + ":", border=0)
        pdf.set_font("Helvetica", "", 10)
        text = str(value).replace("\n", " ")
        # fpdf2: após cell() a largura restante para multi_cell precisa ser explícita
        remain = max(20.0, usable - 55)
        pdf.multi_cell(remain, 6, text)
        pdf.set_x(pdf.l_margin)

    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Inventario por pagina", ln=True)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(18, 6, "Pag.", border=1)
    pdf.cell(35, 6, "Status", border=1)
    pdf.cell(28, 6, "Alterado", border=1)
    pdf.cell(28, 6, "Regioes", border=1)
    pdf.cell(40, 6, "Severidade", border=1, ln=True)
    pdf.set_font("Helvetica", "", 9)
    for page in pages:
        status = {
            "compared": "Comparada",
            "only-previous": "So anterior",
            "only-current": "So atual",
        }.get(page.status, page.status)
        pdf.cell(18, 6, str(page.page_number), border=1)
        pdf.cell(35, 6, status[:16], border=1)
        pdf.cell(28, 6, f"{page.changed_percent:.3f}%", border=1)
        pdf.cell(28, 6, str(len(page.boxes)), border=1)
        pdf.cell(40, 6, severity_label(page), border=1, ln=True)

    for page in pages:
        if should_cancel and should_cancel():
            raise OperationCanceledError("Relatório cancelado.")
        tick(f"Página {page.page_number} do relatório…")
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 14)
        pdf.cell(0, 9, f"Pagina {page.page_number}", ln=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(
            0,
            6,
            f"Status: {page.status} | Alterado: {page.changed_percent:.3f}% | "
            f"Pixels: {page.changed_pixels}/{page.total_pixels} | "
            f"Regioes: {len(page.boxes)} | Severidade: {severity_label(page)}",
        )
        pdf.ln(2)
        for label, path in (
            ("Diferenca", page.image_diff),
            ("Anterior", page.image_a),
            ("Atual", page.image_b),
            ("Sobreposicao", page.image_blend),
        ):
            if not path or not os.path.isfile(path):
                continue
            pdf.set_font("Helvetica", "B", 11)
            pdf.cell(0, 7, label, ln=True)
            try:
                pdf.image(path, w=180)
            except Exception as exc:
                pdf.set_font("Helvetica", "", 9)
                pdf.cell(0, 6, f"(falha ao embutir imagem: {exc})", ln=True)
            pdf.ln(3)

    tick("Finalizando PDF…")
    destination.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(destination))
    return destination


def start_compare_job(
    *,
    ano: int,
    os_id: int,
    previous_pdf: str,
    current_pdf: str,
    previous_relative: str,
    current_relative: str,
    options: PdfCompareOptions,
    max_active_jobs: Optional[int] = DEFAULT_MAX_ACTIVE_COMPARE_JOBS,
) -> SessionJob:
    cleanup_old_sessions()
    session_id = uuid.uuid4().hex
    session_dir = compare_root() / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    job = SessionJob(
        session_id=session_id,
        ano=ano,
        os_id=os_id,
        session_dir=session_dir,
        message="Iniciando comparação…",
        stage="queued",
    )
    with _jobs_lock:
        if max_active_jobs is not None:
            active = sum(1 for existing in _jobs.values() if not existing.done)
            if active >= max_active_jobs:
                raise CompareBusyError(
                    "Já existe uma comparação em andamento neste servidor. "
                    "Aguarde concluir ou cancele antes de iniciar outra."
                )
        _register_job_unlocked(job)

    def runner() -> None:
        try:
            result = compare_pdfs(
                previous_pdf,
                current_pdf,
                previous_relative=previous_relative,
                current_relative=current_relative,
                options=options,
                should_cancel=job.cancel_event.is_set,
                job=job,
                session_id=session_id,
            )
            with job.lock:
                job.result = result
                job.done = True
                job.message = result.summary
                job.stage = "done"
                job.pct = 100.0
        except OperationCanceledError:
            with job.lock:
                job.done = True
                job.cancelled = True
                job.message = "Comparação cancelada."
                job.stage = "cancelled"
        except Exception as exc:
            logger.exception("Falha na comparação PDF %s", session_id)
            with job.lock:
                job.done = True
                job.error = str(exc)
                job.message = str(exc)
                job.stage = "error"

    threading.Thread(target=runner, name=f"pdf-compare-{session_id}", daemon=True).start()
    return job


def cancel_job(session_id: str) -> bool:
    job = get_job(session_id)
    if not job:
        return False
    job.cancel_event.set()
    return True


def resolve_asset_path(job: SessionJob, name: str) -> Path:
    raw = (name or "").replace("\\", "/")
    if not raw or "/" in raw or ".." in raw or raw.startswith("."):
        raise ValueError("Nome de asset inválido.")
    safe = Path(raw).name
    if safe != raw:
        raise ValueError("Nome de asset inválido.")
    path = (job.session_dir / safe).resolve()
    root = job.session_dir.resolve()
    if root not in path.parents and path != root:
        raise ValueError("Asset fora da sessão.")
    if not path.is_file():
        raise FileNotFoundError(safe)
    return path

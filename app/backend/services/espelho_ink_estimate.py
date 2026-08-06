"""Estimativa de tintas/chapas por página em PDFs de espelho (Gravação Pendente)."""
from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

try:
    import fitz  # type: ignore
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

_CMYK_OP_RE = re.compile(
    r"([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+[kK]\b"
)
_CS_REF_RE = re.compile(r"/(\S+)\s+(\d+)\s+0\s+R")
_XOBJECT_DICT_RE = re.compile(r"/XObject\s*<<([^>]+)>>", re.S)
_COLORSPACE_DICT_RE = re.compile(r"/ColorSpace\s*<<([^>]+)>>", re.S)
_SEPARATION_RE = re.compile(r"/Separation\s*/([^\s/\[\<]+)", re.I)
_DEVICEN_RE = re.compile(r"/DeviceN\s*\[([^\]]+)\]", re.I)
_ICC_N_RE = re.compile(r"/ICCBased\b.*?/N\s+(\d+)", re.S | re.I)

_IGNORED_INK_NAMES = frozenset({"all", "none"})
_CMYK_THRESHOLD = 0.02


def _decode_pdf_name(raw: str) -> str:
    """Decodifica nomes PDF (#20 → espaço)."""
    text = str(raw or "")
    return re.sub(r"#([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), text)


def _normalize_ink_name(raw: str) -> str | None:
    name = _decode_pdf_name(raw).strip()
    if not name:
        return None
    lower = name.lower()
    if lower in _IGNORED_INK_NAMES:
        return None
    # Mapear nomes longos CMYK para canais curtos
    if lower in {"c", "cyan"}:
        return "C"
    if lower in {"m", "magenta"}:
        return "M"
    if lower in {"y", "yellow"}:
        return "Y"
    if lower in {"k", "black"}:
        return "K"
    return name


def _resolve_colorspace_inks(doc: Any, xref: int, depth: int = 0, seen: set[int] | None = None) -> set[str]:
    if seen is None:
        seen = set()
    if xref in seen or depth > 8:
        return set()
    seen.add(xref)
    try:
        obj = doc.xref_object(xref) or ""
    except Exception:
        return set()

    inks: set[str] = set()

    m_sep = _SEPARATION_RE.search(obj)
    if m_sep:
        ink = _normalize_ink_name(m_sep.group(1))
        if ink:
            inks.add(ink)
        return inks

    m_devn = _DEVICEN_RE.search(obj)
    if m_devn:
        for token in re.findall(r"/([^\s/]+)", m_devn.group(1)):
            ink = _normalize_ink_name(token)
            if ink:
                inks.add(ink)
        return inks

    if "/DeviceCMYK" in obj:
        # Processo CMYK só conta via cobertura nas ops (não pela mera presença do CS).
        return set()
    if "/DeviceGray" in obj:
        return set()

    m_icc = _ICC_N_RE.search(obj)
    if m_icc:
        # ICC processo: mesma regra — cobertura vem das ops, não do resource.
        return set()

    return inks


def _collect_form_xrefs(doc: Any, page: Any) -> list[int]:
    """Xrefs de Form XObjects da página + 1 nível aninhado."""
    seen: set[int] = set()
    ordered: list[int] = []

    def _add(xref: int) -> None:
        if xref <= 0 or xref in seen:
            return
        seen.add(xref)
        ordered.append(xref)

    try:
        for xo in page.get_xobjects() or []:
            if isinstance(xo, (list, tuple)) and xo:
                _add(int(xo[0]))
    except Exception:
        pass

    # Um nível de aninhamento via /XObject no dicionário da form
    nested: list[int] = []
    for xref in list(ordered):
        try:
            obj = doc.xref_object(xref) or ""
        except Exception:
            continue
        for m in _XOBJECT_DICT_RE.finditer(obj):
            for m2 in _CS_REF_RE.finditer(m.group(1)):
                nested.append(int(m2.group(2)))
    for xref in nested:
        _add(xref)

    return ordered


def _inks_from_cmyk_ops(content: bytes) -> set[str]:
    text = content.decode("latin-1", errors="ignore")
    used: set[str] = set()
    for m in _CMYK_OP_RE.finditer(text):
        c, m_, y, k = (float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)))
        if c > _CMYK_THRESHOLD:
            used.add("C")
        if m_ > _CMYK_THRESHOLD:
            used.add("M")
        if y > _CMYK_THRESHOLD:
            used.add("Y")
        if k > _CMYK_THRESHOLD:
            used.add("K")
    return used


def _inks_from_form_resources(doc: Any, form_xref: int) -> set[str]:
    inks: set[str] = set()
    try:
        obj = doc.xref_object(form_xref) or ""
    except Exception:
        return inks

    if "/DeviceCMYK" in obj:
        # presença no resource não implica cobertura; só via ops
        pass

    for m in _COLORSPACE_DICT_RE.finditer(obj):
        for m2 in _CS_REF_RE.finditer(m.group(1)):
            inks |= _resolve_colorspace_inks(doc, int(m2.group(2)))

    # Separations / DeviceN declarados direto no objeto
    for m in _SEPARATION_RE.finditer(obj):
        ink = _normalize_ink_name(m.group(1))
        if ink:
            inks.add(ink)
    for m in _DEVICEN_RE.finditer(obj):
        for token in re.findall(r"/([^\s/]+)", m.group(1)):
            ink = _normalize_ink_name(token)
            if ink:
                inks.add(ink)

    return inks


def estimate_inks_for_pdf_path(pdf_path: str) -> dict[str, Any]:
    """
    Analisa um PDF de espelho e retorna páginas com tintas detectadas.

    Retorno:
      {
        "page_count": int,
        "expected_plate_count": int,
        "pages": [{"page": 1, "inks": [...], "count": n}, ...],
        "status": "ok" | "partial" | "unavailable",
      }
    """
    if fitz is None:
        return {
            "page_count": 0,
            "expected_plate_count": 0,
            "pages": [],
            "status": "unavailable",
        }

    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        logger.warning("espelho_ink_estimate: falha ao abrir %s: %s", pdf_path, exc)
        return {
            "page_count": 0,
            "expected_plate_count": 0,
            "pages": [],
            "status": "unavailable",
        }

    pages_out: list[dict[str, Any]] = []
    pages_with_inks = 0
    try:
        page_count = int(doc.page_count or 0)
        for pno in range(page_count):
            page = doc.load_page(pno)
            inks: set[str] = set()

            try:
                content = page.read_contents() or b""
            except Exception:
                content = b""
            inks |= _inks_from_cmyk_ops(content)

            form_xrefs = _collect_form_xrefs(doc, page)
            for xref in form_xrefs:
                inks |= _inks_from_form_resources(doc, xref)
                try:
                    stream = doc.xref_stream(xref) or b""
                except Exception:
                    stream = b""
                inks |= _inks_from_cmyk_ops(stream)

            count = len(inks)
            if count > 0:
                pages_with_inks += 1
            pages_out.append(
                {
                    "page": pno + 1,
                    "inks": sorted(inks),
                    "count": count,
                }
            )
    finally:
        try:
            doc.close()
        except Exception:
            pass

    expected = sum(int(p.get("count") or 0) for p in pages_out)
    if page_count <= 0:
        status = "unavailable"
    elif pages_with_inks == 0:
        status = "unavailable"
    elif pages_with_inks < page_count:
        status = "partial"
    else:
        status = "ok"

    return {
        "page_count": page_count,
        "expected_plate_count": expected if status != "unavailable" else 0,
        "pages": pages_out,
        "status": status,
    }


def estimate_inks_for_pdf_paths(pdf_paths: list[str]) -> dict[str, Any]:
    """Agrega análise de vários PDFs de espelho."""
    if not pdf_paths or fitz is None:
        return {
            "pdf_page_count": 0,
            "expected_plate_count": None,
            "ink_analysis_status": "unavailable",
            "pages": [],
        }

    total_pages = 0
    total_plates = 0
    all_pages: list[dict[str, Any]] = []
    statuses: list[str] = []

    for path in pdf_paths:
        result = estimate_inks_for_pdf_path(path)
        statuses.append(str(result.get("status") or "unavailable"))
        total_pages += int(result.get("page_count") or 0)
        total_plates += int(result.get("expected_plate_count") or 0)
        file_label = path.replace("\\", "/").split("/")[-1]
        for page in result.get("pages") or []:
            all_pages.append({**page, "file": file_label})

    if not statuses or all(s == "unavailable" for s in statuses):
        ink_status = "unavailable"
        expected: int | None = None
    elif any(s == "unavailable" for s in statuses) or any(s == "partial" for s in statuses):
        ink_status = "partial"
        expected = total_plates if total_plates > 0 else None
    else:
        ink_status = "ok"
        expected = total_plates if total_plates > 0 else None

    return {
        "pdf_page_count": total_pages if total_pages > 0 else 0,
        "expected_plate_count": expected,
        "ink_analysis_status": ink_status,
        "pages": all_pages,
    }

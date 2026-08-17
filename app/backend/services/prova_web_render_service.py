"""
Renderização das páginas da Prova WEB (flipbook).

PyMuPDF rasteriza cada página com crop em mm (ou TrimBox legado) em ~216 dpi.
O resultado fica em Sefoc/AdminDocs/WEB/ProvaN na pasta da OS.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from typing import Any, Callable, Optional

from services.prova_web_crop_service import (
    empty_crop,
    mm_to_pt,
    normalize_crop_sides,
    validate_crop_against_page,
    pt_to_mm,
)

logger = logging.getLogger(__name__)

_DEFAULT_RENDER_SCALE = 3.0  # 3.0 => ~216 dpi
_MIN_RENDER_SCALE = 1.0
_MAX_RENDER_SCALE = 4.0
_MAX_PAGES = 400
# Página de capa com largura >= 1.7x a do miolo é tratada como capa aberta
# (spread com lombada) e dividida ao meio.
_SPREAD_RATIO_THRESHOLD = 1.7

_MANIFEST_NAME = "manifest.json"
_WEB_RELATIVE = os.path.join("Sefoc", "AdminDocs", "WEB")
_PASTA_RENDER_RE = re.compile(r"^(Prova[1-9]\d*|AnaliseLab)$")
LAB_PASTA_RENDER = "AnaliseLab"

# Versão da lógica de composição do livro. Incrementar invalida caches antigos.
_LAYOUT_VERSION = 6

_SPINE_ASSET_NAME = "spine.png"
_ALLOWED_RENDER_ASSETS = frozenset({_SPINE_ASSET_NAME})

MODE_UNICO = "unico"
MODE_CAPA_MIOLO = "capa_miolo"
MODE_FOLHA_DOBRADA = "folha_dobrada"
MODE_ESPIRAL = "espiral"
MODE_CAIXA = "caixa"


class ProvaWebRenderCancelled(Exception):
    """Render abortado cooperativamente (descartar / substituir rascunho)."""


ProgressCallback = Callable[[int, int], None]
AbortCallback = Callable[[], bool]

ROLE_COVER_FRONT = "cover-front"
ROLE_COVER_FRONT_INSIDE = "cover-front-inside"
ROLE_PAGE = "page"
ROLE_COVER_BACK_INSIDE = "cover-back-inside"
ROLE_COVER_BACK = "cover-back"
ROLE_SHEET_FRONT = "sheet-front"
ROLE_SHEET_BACK = "sheet-back"
ROLE_SHEET_FACA = "sheet-faca"

_COVER_ROLES = frozenset(
    {
        ROLE_COVER_FRONT,
        ROLE_COVER_FRONT_INSIDE,
        ROLE_COVER_BACK_INSIDE,
        ROLE_COVER_BACK,
    }
)

_DEFAULT_SPREAD_SHEETS = [
    {
        "pageIndex": 0,
        "leftRole": ROLE_COVER_BACK,
        "rightRole": ROLE_COVER_FRONT,
    },
    {
        "pageIndex": 1,
        "leftRole": ROLE_COVER_FRONT_INSIDE,
        "rightRole": ROLE_COVER_BACK_INSIDE,
    },
]


def pasta_render_for_versao(versao: int) -> str:
    return f"Prova{max(1, int(versao))}"


def validate_pasta_render(pasta: str) -> str:
    name = (pasta or "").strip()
    if not _PASTA_RENDER_RE.match(name):
        raise ValueError("Pasta de renderização inválida.")
    return name


def resolve_web_render_dir(os_folder: str, pasta_render: str) -> str:
    """Retorna Sefoc/AdminDocs/WEB/{ProvaN} sob a pasta da OS (valida path)."""
    safe = validate_pasta_render(pasta_render)
    full = os.path.normpath(os.path.join(os_folder, _WEB_RELATIVE, safe))
    real_full = os.path.realpath(full)
    real_base = os.path.realpath(os_folder)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if not real_full.startswith(real_base):
        raise ValueError("Pasta de renderização fora da pasta da OS.")
    return full


def ensure_web_render_dir(os_folder: str, pasta_render: str) -> str:
    """Cria Sefoc/AdminDocs/WEB e ProvaN se necessário; retorna o caminho."""
    render_dir = resolve_web_render_dir(os_folder, pasta_render)
    os.makedirs(render_dir, exist_ok=True)
    return render_dir


def delete_web_render_dir(os_folder: str, pasta_render: str) -> None:
    """Remove a pasta ProvaN (se existir)."""
    import shutil

    render_dir = resolve_web_render_dir(os_folder, pasta_render)
    if os.path.isdir(render_dir):
        shutil.rmtree(render_dir, ignore_errors=True)


def render_scale() -> float:
    raw = (os.environ.get("SAGRA_PROVA_WEB_RENDER_SCALE") or "").strip()
    if not raw:
        return _DEFAULT_RENDER_SCALE
    try:
        value = float(raw)
    except ValueError:
        return _DEFAULT_RENDER_SCALE
    return max(_MIN_RENDER_SCALE, min(_MAX_RENDER_SCALE, value))


def resolve_os_relative_pdf(os_folder: str, relative: str) -> str:
    """Resolve caminho relativo (à pasta da OS) para físico, com validação estrita."""
    raw = (relative or "").strip().replace("\\", "/")
    parts = [p for p in raw.split("/") if p and p != "."]
    if not parts or ".." in parts:
        raise ValueError("Caminho de arquivo inválido.")
    if not parts[-1].lower().endswith(".pdf"):
        raise ValueError("O arquivo da prova deve ser um PDF.")
    full_path = os.path.normpath(os.path.join(os_folder, *parts))
    real_full = os.path.realpath(full_path)
    real_base = os.path.realpath(os_folder)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if not real_full.startswith(real_base):
        raise ValueError("Caminho de arquivo fora da pasta da OS.")
    if not os.path.isfile(real_full):
        raise FileNotFoundError(f"Arquivo não encontrado: {raw}")
    return real_full


def _source_signature(paths: list[str]) -> list[list[Any]]:
    sig: list[list[Any]] = []
    for path in paths:
        stat = os.stat(path)
        sig.append([os.path.basename(path), int(stat.st_mtime), stat.st_size])
    return sig


def _canonicalize_crop_json(crop_json: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not isinstance(crop_json, dict):
        return None
    try:
        return json.loads(json.dumps(crop_json, sort_keys=True))
    except (TypeError, ValueError):
        return None


def _cache_key(
    mode: str,
    paths: list[str],
    scale: float,
    crop_json: Optional[dict[str, Any]] = None,
) -> str:
    payload = json.dumps(
        {
            "mode": mode,
            "sources": _source_signature(paths),
            "scale": round(scale, 2),
            "layout": _LAYOUT_VERSION,
            "crop": _canonicalize_crop_json(crop_json),
        },
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:20]


def _manifest_matches(
    manifest: dict[str, Any],
    mode: str,
    source_paths: list[str],
    scale: float,
    crop_json: Optional[dict[str, Any]] = None,
) -> bool:
    key = _cache_key(mode, source_paths, scale, crop_json)
    return (manifest.get("cacheKey") or "") == key and (manifest.get("mode") or "") == mode


def _apply_trim_crop(page: Any) -> None:
    """Recorta a página no TrimBox (remove sangria/marcas); silencioso se inválido."""
    try:
        trim = page.trimbox
        if trim is None:
            return
        if trim.width < 8 or trim.height < 8:
            return
        page.set_cropbox(trim)
    except Exception:
        pass


def _apply_mm_crop(page: Any, crop_mm: Optional[dict[str, Any]]) -> None:
    """
    Clip absoluto a partir do MediaBox com insets em mm.
    Se crop_mm for None, mantém comportamento legado (TrimBox).
    """
    if crop_mm is None:
        _apply_trim_crop(page)
        return
    crop = normalize_crop_sides(crop_mm) or empty_crop()
    import fitz

    media = page.mediabox
    validate_crop_against_page(pt_to_mm(media.width), pt_to_mm(media.height), crop)
    x0 = float(media.x0) + mm_to_pt(crop["left"])
    y0 = float(media.y0) + mm_to_pt(crop["bottom"])
    x1 = float(media.x1) - mm_to_pt(crop["right"])
    y1 = float(media.y1) - mm_to_pt(crop["top"])
    if x1 - x0 < mm_to_pt(5) or y1 - y0 < mm_to_pt(5):
        raise ValueError("Crop excessivo: área útil insuficiente.")
    page.set_cropbox(fitz.Rect(x0, y0, x1, y1))


def _section_crop(
    crop_json: Optional[dict[str, Any]], key: str
) -> Optional[dict[str, Any]]:
    """Retorna crop tipado da seção, ou None para usar TrimBox legado."""
    if not isinstance(crop_json, dict):
        return None
    raw = crop_json.get(key)
    if raw is None:
        return None
    return normalize_crop_sides(raw) or empty_crop("manual")


def _capa_config(crop_json: Optional[dict[str, Any]]) -> dict[str, Any]:
    raw = crop_json.get("capa") if isinstance(crop_json, dict) else None
    if not isinstance(raw, dict):
        return {
            "layout": None,
            "lombadaMm": 0.0,
            "orelhaEsquerdaMm": 0.0,
            "orelhaDireitaMm": 0.0,
            "crop": None,
            "sheets": list(_DEFAULT_SPREAD_SHEETS),
        }
    layout = raw.get("layout")
    if layout not in ("spread", "pages", "aberta", "paginas"):
        layout = None
    # Aliases do wizard (pt-BR) → canônico
    if layout == "aberta":
        layout = "spread"
    if layout == "paginas":
        layout = "pages"
    try:
        lombada = max(0.0, float(raw.get("lombadaMm") or 0))
    except (TypeError, ValueError):
        lombada = 0.0
    try:
        orelha_e = max(0.0, float(raw.get("orelhaEsquerdaMm") or 0))
    except (TypeError, ValueError):
        orelha_e = 0.0
    try:
        orelha_d = max(0.0, float(raw.get("orelhaDireitaMm") or 0))
    except (TypeError, ValueError):
        orelha_d = 0.0
    if layout != "spread":
        orelha_e = 0.0
        orelha_d = 0.0
    crop = normalize_crop_sides(raw.get("crop")) if raw.get("crop") is not None else None
    sheets = raw.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        sheets = list(_DEFAULT_SPREAD_SHEETS)
    else:
        normalized = []
        for sheet in sheets:
            if not isinstance(sheet, dict):
                continue
            try:
                page_index = int(sheet.get("pageIndex", 0))
            except (TypeError, ValueError):
                continue
            left = str(sheet.get("leftRole") or "")
            right = str(sheet.get("rightRole") or "")
            if left not in _COVER_ROLES or right not in _COVER_ROLES:
                continue
            normalized.append(
                {"pageIndex": page_index, "leftRole": left, "rightRole": right}
            )
        sheets = normalized or list(_DEFAULT_SPREAD_SHEETS)
    return {
        "layout": layout,
        "lombadaMm": lombada,
        "orelhaEsquerdaMm": orelha_e,
        "orelhaDireitaMm": orelha_d,
        "crop": crop,
        "sheets": sheets,
    }


def _outer_crop_half_clip(
    face_rect: Any,
    side: str,
    crop: dict[str, Any],
    lombada_half_pt: float,
    orelha_pt: float = 0.0,
) -> Any:
    """
    Aplica crop externo às bordas da meia-página.
    side=left: externa é a borda esquerda (+ orelha); lombada é a borda direita.
    side=right: externa é a borda direita (+ orelha); lombada é a borda esquerda.
    """
    import fitz

    top = mm_to_pt(crop["top"])
    bottom = mm_to_pt(crop["bottom"])
    left = mm_to_pt(crop["left"])
    right = mm_to_pt(crop["right"])
    orelha = max(0.0, float(orelha_pt))
    x0 = float(face_rect.x0)
    y0 = float(face_rect.y0)
    x1 = float(face_rect.x1)
    y1 = float(face_rect.y1)
    if side == "left":
        x0 += left + orelha
        x1 -= lombada_half_pt  # consome metade da lombada no miolo da spread
        y0 += bottom
        y1 -= top
    else:
        x0 += lombada_half_pt
        x1 -= right + orelha
        y0 += bottom
        y1 -= top
    if x1 - x0 < mm_to_pt(5) or y1 - y0 < mm_to_pt(5):
        raise ValueError("Crop/lombada/orelhas excessivos na capa aberta.")
    return fitz.Rect(x0, y0, x1, y1)


def _render_page_png(
    page: Any,
    matrix: Any,
    png_path: str,
    clip: Any = None,
) -> dict[str, Any]:
    pix = page.get_pixmap(matrix=matrix, alpha=False, clip=clip)
    pix.save(png_path)
    rect = clip if clip is not None else page.rect
    return {
        "width": pix.width,
        "height": pix.height,
        "widthPt": round(float(rect.width), 2),
        "heightPt": round(float(rect.height), 2),
    }


def _spine_clip_rect(
    page: Any,
    crop_mm: Optional[dict[str, Any]],
    lombada_mm: float,
) -> Any:
    """Retângulo da faixa central (lombada) na 1ª página da capa aberta."""
    import fitz

    media = page.mediabox
    crop = normalize_crop_sides(crop_mm) if crop_mm is not None else empty_crop()
    top = mm_to_pt(crop["top"])
    bottom = mm_to_pt(crop["bottom"])
    lombada_pt = mm_to_pt(lombada_mm)
    mid_x = float(media.x0) + float(media.width) / 2.0
    half = lombada_pt / 2.0
    x0 = mid_x - half
    x1 = mid_x + half
    y0 = float(media.y0) + bottom
    y1 = float(media.y1) - top
    if x1 - x0 < 1 or y1 - y0 < mm_to_pt(5):
        raise ValueError("Faixa de lombada inválida para rasterizar spine.")
    return fitz.Rect(x0, y0, x1, y1)


def _try_render_spine_png(
    doc: Any,
    matrix: Any,
    cache_dir: str,
    capa_cfg: dict[str, Any],
    *,
    is_spread: bool,
) -> Optional[str]:
    """
    Grava spine.png (fora da sequência do flipbook). Retorna o nome do arquivo
    ou None se não aplicável / falhou (best-effort).
    """
    lombada_mm = float(capa_cfg.get("lombadaMm") or 0)
    if not is_spread or lombada_mm <= 0 or len(doc) < 1:
        return None
    try:
        page = doc.load_page(0)
        clip = _spine_clip_rect(page, capa_cfg.get("crop"), lombada_mm)
        png_path = os.path.join(cache_dir, _SPINE_ASSET_NAME)
        _render_page_png(page, matrix, png_path, clip=clip)
        return _SPINE_ASSET_NAME
    except Exception as exc:
        logger.warning("Prova WEB: falha ao rasterizar spine.png: %s", exc)
        return None


def _book_mockup_meta(
    *,
    mode: str,
    capa_cfg: Optional[dict[str, Any]],
    cover_entries: list[dict[str, Any]],
    spine_file: Optional[str],
) -> Optional[dict[str, Any]]:
    """Metadados do mockup 3D do livro (fora de pages[])."""
    if mode != MODE_CAPA_MIOLO or not capa_cfg:
        return None
    lombada_mm = float(capa_cfg.get("lombadaMm") or 0)
    if lombada_mm <= 0:
        return None
    front = next(
        (e for e in cover_entries if e.get("role") == ROLE_COVER_FRONT),
        None,
    )
    if not front:
        return None
    page_w_mm = pt_to_mm(float(front["widthPt"]))
    page_h_mm = pt_to_mm(float(front["heightPt"]))
    if lombada_mm >= page_w_mm / 2:
        logger.warning(
            "Prova WEB: lombadaMm (%.1f) >= metade da face (%.1f); omitindo bookMockup.",
            lombada_mm,
            page_w_mm,
        )
        return None
    meta: dict[str, Any] = {
        "lombadaMm": round(lombada_mm, 2),
        "pageWidthMm": page_w_mm,
        "pageHeightMm": page_h_mm,
    }
    if spine_file:
        meta["spineFile"] = spine_file
    return meta


def _espiral_config(crop_json: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Normaliza cropJson.espiral com defaults tipográficos."""
    raw = None
    if isinstance(crop_json, dict):
        cand = crop_json.get("espiral")
        if isinstance(cand, dict):
            raw = cand
    edge = str((raw or {}).get("edge") or "left").strip().lower()
    if edge not in ("left", "top"):
        edge = "left"
    kind = str((raw or {}).get("sourceKind") or "unico").strip().lower()
    if kind not in ("unico", "capa_miolo"):
        kind = "unico"
    try:
        hole_count = int((raw or {}).get("holeCount") or 14)
    except (TypeError, ValueError):
        hole_count = 14
    hole_count = max(4, min(40, hole_count))
    try:
        hole_d = float((raw or {}).get("holeDiameterMm") or 5)
    except (TypeError, ValueError):
        hole_d = 5.0
    hole_d = max(2.0, min(12.0, hole_d))
    try:
        margin = float((raw or {}).get("marginFromEdgeMm") or 8)
    except (TypeError, ValueError):
        margin = 8.0
    margin = max(3.0, min(30.0, margin))
    crop = None
    if isinstance(raw, dict) and isinstance(raw.get("crop"), dict):
        crop = raw["crop"]
    elif isinstance(crop_json, dict):
        if kind == "unico" and isinstance(crop_json.get("unico"), dict):
            crop = crop_json["unico"]
        elif kind == "capa_miolo" and isinstance(crop_json.get("miolo"), dict):
            crop = crop_json["miolo"]
    capa = None
    if isinstance(raw, dict) and isinstance(raw.get("capa"), dict):
        capa = dict(raw["capa"])
        capa["lombadaMm"] = 0
    elif isinstance(crop_json, dict) and isinstance(crop_json.get("capa"), dict):
        capa = dict(crop_json["capa"])
        capa["lombadaMm"] = 0
    return {
        "sourceKind": kind,
        "edge": edge,
        "holeCount": hole_count,
        "holeDiameterMm": hole_d,
        "marginFromEdgeMm": margin,
        "crop": crop,
        "capa": capa,
    }


def _spiral_mockup_meta(
    espiral_cfg: dict[str, Any],
    pages: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Metadados do mockup 3D espiral (fora de pages[])."""
    front = next(
        (p for p in pages if p.get("role") == ROLE_COVER_FRONT and not p.get("blank")),
        None,
    )
    if not front:
        front = next(
            (p for p in pages if p.get("role") in (ROLE_PAGE, ROLE_SHEET_FRONT)),
            pages[0] if pages else None,
        )
    if not front:
        return None
    page_w_mm = pt_to_mm(float(front["widthPt"]))
    page_h_mm = pt_to_mm(float(front["heightPt"]))
    # Conta folhas reais (ignora blank de montagem)
    n_pages = max(
        1,
        sum(1 for p in pages if not p.get("blank")),
    )
    # ~0,1 mm/folha + 2 mm basals (capa); clamp visual do mockup CSS
    block_mm = max(4.0, min(32.0, n_pages * 0.1 + 2.0))
    return {
        "edge": espiral_cfg["edge"],
        "holeCount": int(espiral_cfg["holeCount"]),
        "holeDiameterMm": float(espiral_cfg["holeDiameterMm"]),
        "marginFromEdgeMm": float(espiral_cfg["marginFromEdgeMm"]),
        "pageWidthMm": round(page_w_mm, 2),
        "pageHeightMm": round(page_h_mm, 2),
        "blockThicknessMm": round(block_mm, 2),
    }


def _cover_roles_for_count(count: int) -> list[str]:
    """Papéis das páginas do PDF de capa (não-spread), na ordem capa1..capa4."""
    if count <= 1:
        return [ROLE_COVER_FRONT]
    if count == 2:
        return [ROLE_COVER_FRONT, ROLE_COVER_BACK]
    if count == 3:
        return [ROLE_COVER_FRONT, ROLE_COVER_FRONT_INSIDE, ROLE_COVER_BACK]
    return [
        ROLE_COVER_FRONT,
        ROLE_COVER_FRONT_INSIDE,
        ROLE_COVER_BACK_INSIDE,
        ROLE_COVER_BACK,
    ]


def _detect_spread(
    doc: Any,
    miolo_width_pt: Optional[float],
    layout_force: Optional[str],
    crop_mm: Optional[dict[str, Any]],
) -> bool:
    if layout_force == "spread":
        return True
    if layout_force == "pages":
        return False
    if not miolo_width_pt:
        return False
    first = doc.load_page(0)
    _apply_mm_crop(first, crop_mm)
    return first.rect.width >= _SPREAD_RATIO_THRESHOLD * miolo_width_pt


def _render_cover_pages(
    doc: Any,
    matrix: Any,
    cache_dir: str,
    miolo_width_pt: Optional[float],
    capa_cfg: Optional[dict[str, Any]] = None,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    """
    Renderiza páginas da capa em PNGs temporários (cover_*.png) e retorna
    (metadados com role, spine_file opcional). Detecta capa aberta (spread)
    pela largura vs miolo, ou usa layout forçado via CropJson.
    """
    import fitz

    cfg = capa_cfg or {
        "layout": None,
        "lombadaMm": 0.0,
        "orelhaEsquerdaMm": 0.0,
        "orelhaDireitaMm": 0.0,
        "crop": None,
        "sheets": list(_DEFAULT_SPREAD_SHEETS),
    }
    crop_mm = cfg.get("crop")
    # crop None com CropJson presente em outras seções: None ainda = legado trim.
    # Se capa.crop foi explicitamente enviado (mesmo zeros), já vem normalizado.

    entries: list[dict[str, Any]] = []
    count = min(len(doc), 4)
    is_spread = _detect_spread(doc, miolo_width_pt, cfg.get("layout"), crop_mm)
    spine_file = _try_render_spine_png(
        doc, matrix, cache_dir, cfg, is_spread=is_spread
    )

    if is_spread:
        lombada_half_pt = mm_to_pt(float(cfg.get("lombadaMm") or 0)) / 2.0
        sheets = cfg.get("sheets") or list(_DEFAULT_SPREAD_SHEETS)
        for sheet in sheets:
            page_index = int(sheet["pageIndex"])
            if page_index < 0 or page_index >= len(doc):
                continue
            page = doc.load_page(page_index)
            # Sem set_cropbox global: dividimos a MediaBox e aplicamos crop externo.
            media = page.mediabox
            mid_x = float(media.x0) + float(media.width) / 2.0
            left_face = fitz.Rect(media.x0, media.y0, mid_x, media.y1)
            right_face = fitz.Rect(mid_x, media.y0, media.x1, media.y1)
            crop = crop_mm if crop_mm is not None else empty_crop("trimbox")
            # Sem CropJson (crop_mm None), aplica TrimBox na página inteira antes
            # e divide no cropbox resultante (comportamento legado).
            if crop_mm is None:
                _apply_trim_crop(page)
                rect = page.rect
                mid_x = rect.x0 + rect.width / 2
                left_face = fitz.Rect(rect.x0, rect.y0, mid_x, rect.y1)
                right_face = fitz.Rect(mid_x, rect.y0, rect.x1, rect.y1)
                halves = [
                    (left_face, sheet["leftRole"], "left"),
                    (right_face, sheet["rightRole"], "right"),
                ]
                for clip, role, _side in halves:
                    png_path = os.path.join(cache_dir, f"cover_{len(entries)}.png")
                    meta = _render_page_png(page, matrix, png_path, clip=clip)
                    entries.append({**meta, "role": role, "path": png_path})
                continue

            lombada_half_pt = mm_to_pt(float(cfg.get("lombadaMm") or 0)) / 2.0
            orelha_e_pt = mm_to_pt(float(cfg.get("orelhaEsquerdaMm") or 0))
            orelha_d_pt = mm_to_pt(float(cfg.get("orelhaDireitaMm") or 0))
            halves = [
                (
                    _outer_crop_half_clip(
                        left_face, "left", crop, lombada_half_pt, orelha_e_pt
                    ),
                    sheet["leftRole"],
                ),
                (
                    _outer_crop_half_clip(
                        right_face, "right", crop, lombada_half_pt, orelha_d_pt
                    ),
                    sheet["rightRole"],
                ),
            ]
            for clip, role in halves:
                png_path = os.path.join(cache_dir, f"cover_{len(entries)}.png")
                meta = _render_page_png(page, matrix, png_path, clip=clip)
                entries.append({**meta, "role": role, "path": png_path})
        return entries, spine_file

    # Páginas soltas: mapeamento por sheets (1 role por página) ou ordem clássica.
    page_roles: dict[int, str] = {}
    if cfg.get("layout") == "pages" and cfg.get("sheets"):
        for sheet in cfg["sheets"]:
            # Em modo pages, interpretamos leftRole=role da página e rightRole opcional.
            idx = int(sheet["pageIndex"])
            role = sheet.get("leftRole") or sheet.get("rightRole")
            if role in _COVER_ROLES:
                page_roles[idx] = role
            # Se sheet tem rightRole diferente e pageIndex+ implícito via outro sheet
            right = sheet.get("rightRole")
            if right in _COVER_ROLES and right != role:
                # Sheets no modo pages normalmente têm um role por página;
                # se vierem dois roles no mesmo sheet, left=pageIndex, right=pageIndex+1.
                page_roles.setdefault(idx, sheet["leftRole"])
                page_roles.setdefault(idx + 1, right)

    if page_roles:
        for index, role in sorted(page_roles.items()):
            if index < 0 or index >= len(doc):
                continue
            page = doc.load_page(index)
            _apply_mm_crop(page, crop_mm)
            png_path = os.path.join(cache_dir, f"cover_{len(entries)}.png")
            meta = _render_page_png(page, matrix, png_path)
            entries.append({**meta, "role": role, "path": png_path})
        return entries, spine_file

    roles = _cover_roles_for_count(count)
    for index in range(count):
        page = doc.load_page(index)
        _apply_mm_crop(page, crop_mm)
        png_path = os.path.join(cache_dir, f"cover_{len(entries)}.png")
        meta = _render_page_png(page, matrix, png_path)
        entries.append({**meta, "role": roles[index], "path": png_path})
    return entries, spine_file


def _render_blank_png(
    cache_dir: str,
    name: str,
    reference: dict[str, Any],
    role: str,
) -> dict[str, Any]:
    """Página branca com as mesmas dimensões da referência."""
    import fitz

    png_path = os.path.join(cache_dir, name)
    width = max(1, int(reference["width"]))
    height = max(1, int(reference["height"]))
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, width, height))
    pix.clear_with(255)
    pix.save(png_path)
    return {
        "width": width,
        "height": height,
        "widthPt": reference["widthPt"],
        "heightPt": reference["heightPt"],
        "role": role,
        "path": png_path,
        "blank": True,
    }


# Referência de dimensão preferida para cada capa ausente (capa oposta da mesma folha).
_BLANK_REFERENCE_ROLES: dict[str, tuple[str, ...]] = {
    ROLE_COVER_FRONT: (ROLE_COVER_FRONT_INSIDE, ROLE_COVER_BACK, ROLE_COVER_BACK_INSIDE),
    ROLE_COVER_FRONT_INSIDE: (ROLE_COVER_FRONT, ROLE_COVER_BACK, ROLE_COVER_BACK_INSIDE),
    ROLE_COVER_BACK_INSIDE: (ROLE_COVER_BACK, ROLE_COVER_FRONT, ROLE_COVER_FRONT_INSIDE),
    ROLE_COVER_BACK: (ROLE_COVER_BACK_INSIDE, ROLE_COVER_FRONT, ROLE_COVER_FRONT_INSIDE),
}


def _assemble_book(
    cover_entries: list[dict[str, Any]],
    body_entries: list[dict[str, Any]],
    cache_dir: str,
) -> list[dict[str, Any]]:
    """
    Sequência final: capa1 → capa2 → miolo → capa3 → capa4.

    As quatro posições de capa existem sempre; as que não vierem no PDF entram
    em branco, para que o miolo nunca comece no verso físico da capa. O miolo
    com número ímpar de páginas recebe uma página em branco ao final, mantendo
    a paridade do livro (capa3/capa4 no lado correto).
    """
    by_role: dict[str, dict[str, Any]] = {e["role"]: e for e in cover_entries}
    blank_counter = 0

    def resolve(role: str) -> dict[str, Any]:
        nonlocal blank_counter
        existing = by_role.get(role)
        if existing:
            return existing
        reference = None
        for candidate in _BLANK_REFERENCE_ROLES[role]:
            reference = by_role.get(candidate)
            if reference:
                break
        if reference is None and body_entries:
            reference = body_entries[0]
        if reference is None:
            raise ValueError("Não há páginas suficientes para montar a prova.")
        blank_counter += 1
        return _render_blank_png(
            cache_dir, f"blank_{blank_counter}.png", reference, role
        )

    body = list(body_entries)
    if len(body) % 2 == 1:
        blank_counter += 1
        body.append(
            _render_blank_png(
                cache_dir, f"blank_{blank_counter}.png", body[-1], ROLE_PAGE
            )
        )

    return [
        resolve(ROLE_COVER_FRONT),
        resolve(ROLE_COVER_FRONT_INSIDE),
        *body,
        resolve(ROLE_COVER_BACK_INSIDE),
        resolve(ROLE_COVER_BACK),
    ]


def ensure_prova_web_pages(
    ano: int,
    os_id: int,
    *,
    mode: str,
    source_paths: list[str],
    os_folder: str,
    pasta_render: str,
    crop_json: Optional[dict[str, Any]] = None,
    progress_callback: Optional[ProgressCallback] = None,
    should_abort: Optional[AbortCallback] = None,
) -> dict[str, Any]:
    """
    Garante PNGs renderizados em Sefoc/AdminDocs/WEB/{pasta_render} e retorna
    o manifest.

    mode == 'unico': source_paths = [arquivo]
    mode == 'capa_miolo': source_paths = [capa, miolo]
    mode == 'espiral': source_paths = [arquivo] ou [capa, miolo] conforme sourceKind
    crop_json None: comportamento legado (TrimBox automático).
    """
    import fitz

    def _check_abort() -> None:
        if should_abort and should_abort():
            raise ProvaWebRenderCancelled("Render cancelado.")

    def _progress(done: int, total: int) -> None:
        if progress_callback:
            try:
                progress_callback(max(0, int(done)), max(0, int(total)))
            except Exception:
                logger.debug("Prova WEB: progresso callback falhou", exc_info=True)

    scale = render_scale()
    key = _cache_key(mode, source_paths, scale, crop_json)
    cache_dir = ensure_web_render_dir(os_folder, pasta_render)
    manifest_path = os.path.join(cache_dir, _MANIFEST_NAME)

    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, encoding="utf-8") as fh:
                existing = json.load(fh)
            if _manifest_matches(existing, mode, source_paths, scale, crop_json):
                return existing
        except (OSError, json.JSONDecodeError):
            pass

    _check_abort()
    matrix = fitz.Matrix(scale, scale)
    truncated = False
    total_source_pages = 0
    book_mockup: Optional[dict[str, Any]] = None
    fold_mockup: Optional[dict[str, Any]] = None
    spiral_mockup: Optional[dict[str, Any]] = None
    box_mockup: Optional[dict[str, Any]] = None
    espiral_cfg: Optional[dict[str, Any]] = None

    if mode == MODE_ESPIRAL:
        espiral_cfg = _espiral_config(crop_json)

    if mode == MODE_CAIXA:
        from services.prova_web_caixa_service import (
            build_box_mockup,
            normalize_caixa_config,
        )
        from services.prova_web_dieline_service import (
            detect_page_roles,
            parse_dieline_page,
        )

        caixa_raw = crop_json.get("caixa") if isinstance(crop_json, dict) else None
        source_kind = "combined"
        if isinstance(caixa_raw, dict):
            source_kind = str(caixa_raw.get("sourceKind") or "combined").strip().lower()

        ordered = []
        suggested = None
        caixa_cfg: dict[str, Any]

        if source_kind == "model":
            from services.prova_web_box_model_service import (
                bake_art_transform_onto_net,
                build_box_mockup_from_model_config,
                get_box_model,
            )

            model_id = None
            if isinstance(caixa_raw, dict):
                try:
                    model_id = int(caixa_raw.get("boxModelId"))
                except (TypeError, ValueError):
                    model_id = None
            model = get_box_model(model_id) if model_id else None
            if not model or not model.get("config"):
                raise ValueError("Modelo de caixa não encontrado ou inativo.")
            pdf_path = source_paths[0]
            with fitz.open(pdf_path) as doc:
                total_source_pages = len(doc)
                arte_idx = 0
                if isinstance(caixa_raw, dict) and caixa_raw.get("artePage") is not None:
                    try:
                        arte_idx = max(0, int(caixa_raw.get("artePage")))
                    except (TypeError, ValueError):
                        arte_idx = 0
                arte_idx = max(0, min(len(doc) - 1, arte_idx))

                arte_inside_idx = None
                if len(doc) >= 2:
                    raw_inside = None
                    if isinstance(caixa_raw, dict):
                        raw_inside = caixa_raw.get("arteInsidePage")
                    try:
                        arte_inside_idx = (
                            1 if raw_inside is None else max(0, int(raw_inside))
                        )
                    except (TypeError, ValueError):
                        arte_inside_idx = 1
                    arte_inside_idx = max(0, min(len(doc) - 1, arte_inside_idx))
                    if arte_inside_idx == arte_idx:
                        # Evita bake duplicado da mesma página
                        arte_inside_idx = 1 if arte_idx == 0 and len(doc) > 1 else None
                        if arte_inside_idx == arte_idx:
                            arte_inside_idx = None

                steps = 2 if arte_inside_idx is not None else 1
                _check_abort()
                _progress(0, steps)
                arte_page = doc.load_page(arte_idx)
                art_crop = None
                if isinstance(caixa_raw, dict):
                    art_crop = caixa_raw.get("artCrop")
                _apply_mm_crop(arte_page, art_crop)
                png_arte_raw = os.path.join(cache_dir, "body_0_raw.png")
                meta_a = _render_page_png(arte_page, matrix, png_arte_raw)
                png_arte = os.path.join(cache_dir, "body_0.png")
                art_tf = None
                if isinstance(caixa_raw, dict) and isinstance(
                    caixa_raw.get("artTransform"), dict
                ):
                    art_tf = caixa_raw["artTransform"]
                cut = (model["config"] or {}).get("cutBboxMm") or {}
                net_w = float(cut.get("widthMm") or 100)
                net_h = float(cut.get("heightMm") or 100)
                px_per_mm = max(2.0, float(scale) * 2.0)
                baked = bake_art_transform_onto_net(
                    png_arte_raw,
                    png_arte,
                    net_width_mm=net_w,
                    net_height_mm=net_h,
                    art_transform=art_tf,
                    px_per_mm=px_per_mm,
                )
                meta_a = {**meta_a, **baked}
                ordered.append({**meta_a, "role": ROLE_SHEET_FRONT, "path": png_arte})

                if arte_inside_idx is not None:
                    _check_abort()
                    _progress(1, steps)
                    inside_page = doc.load_page(arte_inside_idx)
                    _apply_mm_crop(inside_page, art_crop)
                    png_inside_raw = os.path.join(cache_dir, "body_1_raw.png")
                    meta_b = _render_page_png(inside_page, matrix, png_inside_raw)
                    png_inside = os.path.join(cache_dir, "body_1.png")
                    art_inside_tf = art_tf
                    if isinstance(caixa_raw, dict) and isinstance(
                        caixa_raw.get("artInsideTransform"), dict
                    ):
                        art_inside_tf = caixa_raw["artInsideTransform"]
                    baked_b = bake_art_transform_onto_net(
                        png_inside_raw,
                        png_inside,
                        net_width_mm=net_w,
                        net_height_mm=net_h,
                        art_transform=art_inside_tf,
                        px_per_mm=px_per_mm,
                    )
                    meta_b = {**meta_b, **baked_b}
                    ordered.append(
                        {**meta_b, "role": ROLE_SHEET_BACK, "path": png_inside}
                    )
                _progress(steps, steps)
            box_mockup = build_box_mockup_from_model_config(model["config"])
            box_mockup["boxModelId"] = model_id
            if isinstance(caixa_raw, dict) and isinstance(
                caixa_raw.get("artTransform"), dict
            ):
                box_mockup["artTransform"] = caixa_raw["artTransform"]
            if isinstance(caixa_raw, dict) and isinstance(
                caixa_raw.get("artInsideTransform"), dict
            ):
                box_mockup["artInsideTransform"] = caixa_raw["artInsideTransform"]
            caixa_cfg = normalize_caixa_config(
                {**(caixa_raw if isinstance(caixa_raw, dict) else {}), "sourceKind": "model"},
                suggested=(model["config"].get("dimsHint") if isinstance(model.get("config"), dict) else None),
            )

        elif source_kind == "separate" and len(source_paths) >= 2:
            faca_path, arte_path = source_paths[0], source_paths[1]
            with fitz.open(faca_path) as faca_doc:
                total_source_pages += len(faca_doc)
                faca_page = faca_doc.load_page(0)
                parsed = parse_dieline_page(faca_page)
                suggested = parsed.get("dims")
                _check_abort()
                _progress(0, 2)
                png_faca = os.path.join(cache_dir, "body_faca.png")
                meta_f = _render_page_png(faca_page, matrix, png_faca)
                ordered.append({**meta_f, "role": ROLE_SHEET_FACA, "path": png_faca})
            with fitz.open(arte_path) as arte_doc:
                total_source_pages += len(arte_doc)
                caixa_cfg = normalize_caixa_config(
                    caixa_raw if isinstance(caixa_raw, dict) else None,
                    suggested=suggested,
                )
                arte_idx = int(caixa_cfg.get("artePage") or 0)
                arte_idx = max(0, min(len(arte_doc) - 1, arte_idx))
                arte_page = arte_doc.load_page(arte_idx)
                _apply_mm_crop(arte_page, caixa_cfg.get("artCrop"))
                _check_abort()
                png_arte = os.path.join(cache_dir, "body_0.png")
                meta_a = _render_page_png(arte_page, matrix, png_arte)
                ordered.insert(0, {**meta_a, "role": ROLE_SHEET_FRONT, "path": png_arte})
                _progress(2, 2)
            box_mockup = build_box_mockup(caixa_cfg)
        else:
            pdf_path = source_paths[0]
            with fitz.open(pdf_path) as doc:
                total_source_pages = len(doc)
                roles = detect_page_roles(doc)
                caixa_cfg = normalize_caixa_config(
                    caixa_raw if isinstance(caixa_raw, dict) else None,
                    suggested=None,
                )
                faca_idx = int(caixa_cfg.get("facaPage", roles["facaPage"]))
                arte_idx = int(caixa_cfg.get("artePage", roles["artePage"]))
                faca_idx = max(0, min(len(doc) - 1, faca_idx))
                arte_idx = max(0, min(len(doc) - 1, arte_idx))
                parsed = parse_dieline_page(doc.load_page(faca_idx))
                caixa_cfg = normalize_caixa_config(
                    {
                        **(caixa_raw if isinstance(caixa_raw, dict) else {}),
                        "facaPage": faca_idx,
                        "artePage": arte_idx,
                    },
                    suggested=parsed.get("dims"),
                )
                _check_abort()
                _progress(0, 2)
                arte_page = doc.load_page(arte_idx)
                _apply_mm_crop(arte_page, caixa_cfg.get("artCrop"))
                png_arte = os.path.join(cache_dir, "body_0.png")
                meta_a = _render_page_png(arte_page, matrix, png_arte)
                ordered.append({**meta_a, "role": ROLE_SHEET_FRONT, "path": png_arte})
                _progress(1, 2)
                if faca_idx != arte_idx:
                    _check_abort()
                    faca_page = doc.load_page(faca_idx)
                    png_faca = os.path.join(cache_dir, "body_1.png")
                    meta_f = _render_page_png(faca_page, matrix, png_faca)
                    ordered.append({**meta_f, "role": ROLE_SHEET_FACA, "path": png_faca})
                _progress(len(ordered), max(len(ordered), 1))
                truncated = len(doc) > 2
            box_mockup = build_box_mockup(caixa_cfg)

    elif mode == MODE_CAPA_MIOLO or (
        mode == MODE_ESPIRAL and espiral_cfg and espiral_cfg["sourceKind"] == "capa_miolo"
    ):
        capa_path, miolo_path = source_paths[0], source_paths[1]
        if mode == MODE_ESPIRAL:
            miolo_crop = espiral_cfg.get("crop") if espiral_cfg else None
            if miolo_crop is None:
                miolo_crop = _section_crop(crop_json, "miolo")
            capa_raw = (espiral_cfg or {}).get("capa")
            if not isinstance(capa_raw, dict) and isinstance(crop_json, dict):
                capa_raw = crop_json.get("capa")
            capa_cfg = _capa_config({"capa": capa_raw} if capa_raw else crop_json)
            capa_cfg = dict(capa_cfg)
            capa_cfg["lombadaMm"] = 0
        else:
            miolo_crop = _section_crop(crop_json, "miolo")
            capa_cfg = _capa_config(crop_json)
        body_entries: list[dict[str, Any]] = []
        with fitz.open(miolo_path) as miolo_doc:
            total_source_pages += len(miolo_doc)
            body_count = min(len(miolo_doc), _MAX_PAGES)
            truncated = len(miolo_doc) > body_count
            miolo_width_pt: Optional[float] = None
            _progress(0, body_count)
            for index in range(body_count):
                _check_abort()
                page = miolo_doc.load_page(index)
                _apply_mm_crop(page, miolo_crop)
                if miolo_width_pt is None:
                    miolo_width_pt = float(page.rect.width)
                png_path = os.path.join(cache_dir, f"body_{index}.png")
                meta = _render_page_png(page, matrix, png_path)
                body_entries.append({**meta, "role": ROLE_PAGE, "path": png_path})
                _progress(index + 1, body_count)

        _check_abort()
        with fitz.open(capa_path) as capa_doc:
            total_source_pages += len(capa_doc)
            cover_entries, spine_file = _render_cover_pages(
                capa_doc, matrix, cache_dir, miolo_width_pt, capa_cfg
            )

        if mode == MODE_CAPA_MIOLO:
            book_mockup = _book_mockup_meta(
                mode=mode,
                capa_cfg=capa_cfg,
                cover_entries=cover_entries,
                spine_file=spine_file,
            )
        ordered = _assemble_book(cover_entries, body_entries, cache_dir)
    elif mode == MODE_FOLHA_DOBRADA:
        from services.prova_web_fold_service import (
            build_fold_mockup,
            normalize_folheto_config,
        )

        pdf_path = source_paths[0]
        ordered = []
        with fitz.open(pdf_path) as doc:
            total_source_pages = len(doc)
            first = doc.load_page(0)
            media = first.mediabox
            page_w_mm = pt_to_mm(media.width)
            page_h_mm = pt_to_mm(media.height)
            folheto_raw = (
                crop_json.get("folheto") if isinstance(crop_json, dict) else None
            )
            folheto_cfg = normalize_folheto_config(
                folheto_raw if isinstance(folheto_raw, dict) else None,
                page_width_mm=page_w_mm,
                page_height_mm=page_h_mm,
            )
            frente_idx = int(folheto_cfg["pageFrente"])
            verso_idx = folheto_cfg.get("pageVerso")
            if frente_idx < 0 or frente_idx >= len(doc):
                frente_idx = 0
            crop_mm = folheto_cfg.get("crop")

            _check_abort()
            _progress(0, 2)
            page = doc.load_page(frente_idx)
            _apply_mm_crop(page, crop_mm)
            png_path = os.path.join(cache_dir, "body_0.png")
            meta = _render_page_png(page, matrix, png_path)
            ordered.append({**meta, "role": ROLE_SHEET_FRONT, "path": png_path})
            _progress(1, 2)

            has_verso = (
                verso_idx is not None
                and int(verso_idx) >= 0
                and int(verso_idx) < len(doc)
                and int(verso_idx) != frente_idx
            )
            if has_verso:
                _check_abort()
                page_v = doc.load_page(int(verso_idx))
                _apply_mm_crop(page_v, crop_mm)
                png_v = os.path.join(cache_dir, "body_1.png")
                meta_v = _render_page_png(page_v, matrix, png_v)
                ordered.append({**meta_v, "role": ROLE_SHEET_BACK, "path": png_v})
                folheto_cfg["pageVerso"] = int(verso_idx)
            else:
                # Uma página: se o PDF tem 2+, usar a 2ª como verso implícito
                if len(doc) >= 2 and verso_idx is None:
                    _check_abort()
                    page_v = doc.load_page(1)
                    _apply_mm_crop(page_v, crop_mm)
                    png_v = os.path.join(cache_dir, "body_1.png")
                    meta_v = _render_page_png(page_v, matrix, png_v)
                    ordered.append({**meta_v, "role": ROLE_SHEET_BACK, "path": png_v})
                    folheto_cfg["pageVerso"] = 1
                else:
                    folheto_cfg["pageVerso"] = None
            _progress(len(ordered), max(len(ordered), 1))

            # Dimensões úteis a partir da face renderizada
            folheto_cfg["usableWidthMm"] = pt_to_mm(float(ordered[0]["widthPt"]))
            folheto_cfg["usableHeightMm"] = pt_to_mm(float(ordered[0]["heightPt"]))
            fold_mockup = build_fold_mockup(folheto_cfg)
            fold_mockup["hasVerso"] = len(ordered) > 1
            from services.prova_web_fold_service import normalize_panel_pages

            fold_mockup["panelPages"] = normalize_panel_pages(
                folheto_cfg.get("panelPages"),
                fold_mockup.get("panels") or [],
                bool(fold_mockup["hasVerso"]),
            )
            truncated = len(doc) > 2
    else:
        # unico OU espiral com sourceKind=unico
        pdf_path = source_paths[0]
        if mode == MODE_ESPIRAL:
            if espiral_cfg is None:
                espiral_cfg = _espiral_config(crop_json)
            unico_crop = espiral_cfg.get("crop")
            if unico_crop is None:
                unico_crop = _section_crop(crop_json, "unico")
        else:
            unico_crop = _section_crop(crop_json, "unico")
        ordered = []
        with fitz.open(pdf_path) as doc:
            total_source_pages = len(doc)
            count = min(len(doc), _MAX_PAGES)
            truncated = len(doc) > count
            _progress(0, count)
            for index in range(count):
                _check_abort()
                page = doc.load_page(index)
                _apply_mm_crop(page, unico_crop)
                if count >= 2 and index == 0:
                    role = ROLE_COVER_FRONT
                elif count >= 2 and index == count - 1:
                    role = ROLE_COVER_BACK
                else:
                    role = ROLE_PAGE
                png_path = os.path.join(cache_dir, f"body_{index}.png")
                meta = _render_page_png(page, matrix, png_path)
                ordered.append({**meta, "role": role, "path": png_path})
                _progress(index + 1, count)

    _check_abort()
    pages: list[dict[str, Any]] = []
    for number, entry in enumerate(ordered, start=1):
        final_name = f"page_{number}.png"
        final_path = os.path.join(cache_dir, final_name)
        if os.path.abspath(entry["path"]) != os.path.abspath(final_path):
            os.replace(entry["path"], final_path)
        pages.append(
            {
                "page": number,
                "file": final_name,
                "width": entry["width"],
                "height": entry["height"],
                "widthPt": entry["widthPt"],
                "heightPt": entry["heightPt"],
                "role": entry["role"],
                "blank": bool(entry.get("blank")),
            }
        )

    if mode == MODE_ESPIRAL:
        if espiral_cfg is None:
            espiral_cfg = _espiral_config(crop_json)
        spiral_mockup = _spiral_mockup_meta(espiral_cfg, pages)

    interior = next(
        (
            p
            for p in pages
            if p["role"] in (ROLE_PAGE, ROLE_SHEET_FRONT) and not p["blank"]
        ),
        pages[0] if pages else None,
    )
    aspect_ratio = None
    if interior and interior["height"]:
        aspect_ratio = round(interior["width"] / interior["height"], 4)

    manifest: dict[str, Any] = {
        "mode": mode,
        "cacheKey": key,
        "pastaRender": validate_pasta_render(pasta_render),
        "pages": pages,
        "pageCount": len(pages),
        "aspectRatio": aspect_ratio,
        "totalSourcePages": total_source_pages,
        "truncated": truncated,
        "renderScale": scale,
    }
    if book_mockup:
        manifest["bookMockup"] = book_mockup
    if fold_mockup:
        manifest["foldMockup"] = fold_mockup
    if spiral_mockup:
        manifest["spiralMockup"] = spiral_mockup
    if box_mockup:
        manifest["boxMockup"] = box_mockup

    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False)

    logger.info(
        "Prova WEB renderizada: OS %s/%s, %s páginas (%s)",
        os_id,
        ano,
        len(pages),
        pasta_render,
    )
    return manifest


def try_load_cached_manifest(
    *,
    mode: str,
    source_paths: list[str],
    os_folder: str,
    pasta_render: str,
    crop_json: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """Retorna manifest em disco se válido; não rasteriza."""
    try:
        cache_dir = resolve_web_render_dir(os_folder, pasta_render)
    except (FileNotFoundError, ValueError, OSError):
        return None
    manifest_path = os.path.join(cache_dir, _MANIFEST_NAME)
    if not os.path.isfile(manifest_path):
        return None
    try:
        with open(manifest_path, encoding="utf-8") as fh:
            existing = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    scale = render_scale()
    if not _manifest_matches(existing, mode, source_paths, scale, crop_json):
        return None
    return existing


def resolve_rendered_page_path(
    os_folder: str,
    pasta_render: str,
    page: int,
) -> str:
    """Resolve PNG em WEB/ProvaN, validando contra path traversal."""
    if page < 1:
        raise ValueError("Número de página inválido.")
    cache_dir = resolve_web_render_dir(os_folder, pasta_render)
    png_path = os.path.join(cache_dir, f"page_{page}.png")
    real_png = os.path.realpath(png_path)
    real_dir = os.path.realpath(cache_dir)
    if not real_png.startswith(real_dir + os.sep):
        raise ValueError("Caminho de página inválido.")
    if not os.path.isfile(real_png):
        raise FileNotFoundError("Página não encontrada na pasta da prova.")
    return real_png


def resolve_rendered_asset_path(
    os_folder: str,
    pasta_render: str,
    name: str,
) -> str:
    """Resolve asset auxiliar (ex.: spine.png) na pasta da prova."""
    safe = (name or "").strip().replace("\\", "/")
    if "/" in safe or safe != os.path.basename(safe):
        raise ValueError("Nome de asset inválido.")
    if safe not in _ALLOWED_RENDER_ASSETS:
        raise ValueError("Asset não permitido.")
    cache_dir = resolve_web_render_dir(os_folder, pasta_render)
    asset_path = os.path.join(cache_dir, safe)
    real_asset = os.path.realpath(asset_path)
    real_dir = os.path.realpath(cache_dir)
    if not real_asset.startswith(real_dir + os.sep):
        raise ValueError("Caminho de asset inválido.")
    if not os.path.isfile(real_asset):
        raise FileNotFoundError("Asset não encontrado na pasta da prova.")
    return real_asset

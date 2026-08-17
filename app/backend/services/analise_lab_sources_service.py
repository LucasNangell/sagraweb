"""
Fontes N:N e crop por página/arquivo/componente do Análise Lab.

Isolado da Prova WEB: concatena PDFs por componente e resolve a hierarquia
de crop. O render compartilhado continua recebendo 1 ou 2 arquivos.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

from services.prova_web_crop_service import empty_crop, normalize_crop_sides
from services.prova_web_render_service import (
    LAB_PASTA_RENDER,
    MODE_CAPA_MIOLO,
    MODE_UNICO,
    _apply_mm_crop,
    ensure_web_render_dir,
    resolve_os_relative_pdf,
    resolve_web_render_dir,
)

logger = logging.getLogger(__name__)

COMP_CAPA = "Capa"
COMP_MIOLO = "Miolo"
COMP_UNICO = "Arq. Único"
COMPONENTES = frozenset({COMP_CAPA, COMP_MIOLO, COMP_UNICO})

CROP_SCOPES = frozenset({"page", "file", "component", "all", "miolo_central"})

_MAX_FONTES = 40
_PAGE_MAP_NAME = "pageMap.json"
_LAB_SOURCES_DIR = "_lab_sources"

Fonte = dict[str, Any]


def normalize_rel_path(path: str) -> str:
    return (path or "").strip().replace("\\", "/")


def page_crop_key(path: str, source_page: int) -> str:
    return f"{normalize_rel_path(path)}#{int(source_page)}"


def normalize_fontes(
    raw: Any,
    *,
    modo: str,
) -> list[Fonte]:
    """Valida e ordena fontes. Aceita lista ou None."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("fontes deve ser uma lista.")
    if len(raw) > _MAX_FONTES:
        raise ValueError(f"Máximo de {_MAX_FONTES} arquivos por sessão.")

    modo_norm = (modo or MODE_UNICO).strip()
    items: list[Fonte] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValueError("Cada fonte deve ser um objeto.")
        path = normalize_rel_path(str(entry.get("path") or ""))
        if not path:
            raise ValueError("Fonte sem caminho.")
        if path in seen:
            raise ValueError(f"Arquivo repetido nas fontes: {path}")
        seen.add(path)
        componente = (entry.get("componente") or "").strip()
        if componente not in COMPONENTES:
            raise ValueError(f"Componente inválido: {componente or '—'}")
        if modo_norm == MODE_CAPA_MIOLO and componente == COMP_UNICO:
            raise ValueError("Modo capa+miolo não aceita arquivo único.")
        if modo_norm != MODE_CAPA_MIOLO and componente in (COMP_CAPA, COMP_MIOLO):
            raise ValueError("Modo arquivo único não aceita capa/miolo.")
        try:
            ordem = int(entry.get("ordem") if entry.get("ordem") is not None else 0)
        except (TypeError, ValueError) as exc:
            raise ValueError("Ordem de fonte inválida.") from exc
        if ordem < 0:
            raise ValueError("Ordem de fonte inválida.")
        items.append({"path": path, "componente": componente, "ordem": ordem})

    items.sort(key=lambda f: (f["componente"], f["ordem"], f["path"]))
    by_comp: dict[str, int] = {}
    ordered: list[Fonte] = []
    for fonte in items:
        seq = by_comp.get(fonte["componente"], 0)
        ordered.append({**fonte, "ordem": seq})
        by_comp[fonte["componente"]] = seq + 1
    return ordered


def fontes_from_legacy(
    *,
    modo: str,
    arquivo_unico: Optional[str],
    arquivo_capa: Optional[str],
    arquivo_miolo: Optional[str],
) -> list[Fonte]:
    modo_norm = (modo or MODE_UNICO).strip()
    if modo_norm == MODE_CAPA_MIOLO:
        raw: list[dict[str, Any]] = []
        if arquivo_capa:
            raw.append({"path": arquivo_capa, "componente": COMP_CAPA, "ordem": 0})
        if arquivo_miolo:
            raw.append({"path": arquivo_miolo, "componente": COMP_MIOLO, "ordem": 0})
        return normalize_fontes(raw, modo=MODE_CAPA_MIOLO)
    if arquivo_unico:
        return normalize_fontes(
            [{"path": arquivo_unico, "componente": COMP_UNICO, "ordem": 0}],
            modo=MODE_UNICO,
        )
    return []


def fontes_from_session(session: dict[str, Any]) -> list[Fonte]:
    modo = (session.get("modo") or MODE_UNICO).strip()
    raw = session.get("fontes")
    if isinstance(raw, list) and raw:
        return normalize_fontes(raw, modo=modo)
    return fontes_from_legacy(
        modo=modo,
        arquivo_unico=session.get("arquivoUnico"),
        arquivo_capa=session.get("arquivoCapa"),
        arquivo_miolo=session.get("arquivoMiolo"),
    )


def derive_legacy_paths(
    fontes: list[Fonte], modo: str
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Primeiro arquivo de cada slot — colunas legado."""
    unico = capa = miolo = None
    for fonte in fontes:
        if fonte["componente"] == COMP_UNICO and unico is None:
            unico = fonte["path"]
        elif fonte["componente"] == COMP_CAPA and capa is None:
            capa = fonte["path"]
        elif fonte["componente"] == COMP_MIOLO and miolo is None:
            miolo = fonte["path"]
    if (modo or "").strip() == MODE_CAPA_MIOLO:
        return None, capa, miolo
    return unico, None, None


def validate_fontes_for_modo(fontes: list[Fonte], modo: str) -> None:
    modo_norm = (modo or MODE_UNICO).strip()
    if modo_norm == MODE_CAPA_MIOLO:
        has_capa = any(f["componente"] == COMP_CAPA for f in fontes)
        has_miolo = any(f["componente"] == COMP_MIOLO for f in fontes)
        if not has_capa:
            raise ValueError("Selecione ao menos um arquivo de capa.")
        if not has_miolo:
            raise ValueError("Selecione ao menos um arquivo de miolo.")
        return
    if not any(f["componente"] == COMP_UNICO for f in fontes):
        raise ValueError("Selecione ao menos um arquivo da prova.")


def _lab_section(crop_json: Optional[dict[str, Any]]) -> dict[str, Any]:
    raw = crop_json.get("lab") if isinstance(crop_json, dict) else None
    if not isinstance(raw, dict):
        return {"all": None, "files": {}, "pages": {}, "mioloCentral": False}
    files = raw.get("files") if isinstance(raw.get("files"), dict) else {}
    pages = raw.get("pages") if isinstance(raw.get("pages"), dict) else {}
    return {
        "all": raw.get("all"),
        "files": dict(files),
        "pages": dict(pages),
        "mioloCentral": bool(raw.get("mioloCentral")),
    }


def swap_crop_left_right(crop: dict[str, Any]) -> dict[str, Any]:
    swapped = dict(crop)
    swapped["left"] = float(crop.get("right") or 0)
    swapped["right"] = float(crop.get("left") or 0)
    return swapped


def identity_crop_sides() -> dict[str, Any]:
    return empty_crop("manual")


def identity_lab_crop_json(modo: str) -> dict[str, Any]:
    zero = identity_crop_sides()
    lab = {"all": None, "files": {}, "pages": {}, "mioloCentral": False}
    if (modo or "").strip() == MODE_CAPA_MIOLO:
        return {
            "miolo": zero,
            "capa": {
                "layout": "pages",
                "lombadaMm": 0.0,
                "orelhaEsquerdaMm": 0.0,
                "orelhaDireitaMm": 0.0,
                "crop": zero,
                "sheets": [],
            },
            "lab": lab,
        }
    return {"unico": zero, "lab": lab}


def resolve_page_crop(
    crop_json: Optional[dict[str, Any]],
    *,
    path: str,
    source_page: int,
    componente: str,
    sequence_page: Optional[int] = None,
) -> dict[str, Any]:
    """página → arquivo → componente → lab.all → identidade (sem TrimBox)."""
    lab = _lab_section(crop_json)
    pages = lab["pages"]
    key = page_crop_key(path, source_page)
    page_raw = pages.get(key)
    if page_raw is not None:
        return normalize_crop_sides(page_raw) or identity_crop_sides()

    npath = normalize_rel_path(path)
    file_raw = lab["files"].get(npath)
    if file_raw is not None:
        crop = normalize_crop_sides(file_raw) or identity_crop_sides()
    else:
        crop_json = crop_json if isinstance(crop_json, dict) else {}
        crop = None
        if componente == COMP_CAPA:
            capa = crop_json.get("capa")
            if isinstance(capa, dict) and capa.get("crop") is not None:
                crop = normalize_crop_sides(capa.get("crop")) or identity_crop_sides()
        elif componente == COMP_MIOLO and crop_json.get("miolo") is not None:
            crop = normalize_crop_sides(crop_json.get("miolo")) or identity_crop_sides()
        elif componente == COMP_UNICO and crop_json.get("unico") is not None:
            crop = normalize_crop_sides(crop_json.get("unico")) or identity_crop_sides()
        if crop is None and lab.get("all") is not None:
            crop = normalize_crop_sides(lab.get("all")) or identity_crop_sides()
        if crop is None:
            crop = identity_crop_sides()

    if (
        componente == COMP_MIOLO
        and lab.get("mioloCentral")
        and sequence_page is not None
        and int(sequence_page) >= 1
        and int(sequence_page) % 2 == 0
    ):
        return swap_crop_left_right(crop)
    return crop


def apply_crop_scope(
    crop_json: Optional[dict[str, Any]],
    *,
    scope: str,
    crop: dict[str, Any],
    path: Optional[str] = None,
    source_page: Optional[int] = None,
    componente: Optional[str] = None,
    fontes: Optional[list[Fonte]] = None,
    sequence_page: Optional[int] = None,
) -> dict[str, Any]:
    """Grava o crop na camada do escopo e limpa overrides mais específicos."""
    if scope not in CROP_SCOPES:
        raise ValueError("Escopo de crop inválido.")
    crop_n = normalize_crop_sides(crop)
    if crop_n is None:
        raise ValueError("Crop inválido.")

    out: dict[str, Any] = dict(crop_json) if isinstance(crop_json, dict) else {}
    lab = _lab_section(out)
    files: dict[str, Any] = dict(lab["files"])
    pages: dict[str, Any] = dict(lab["pages"])
    fontes = fontes or []
    miolo_central = bool(lab.get("mioloCentral"))

    def _paths_for_component(comp: str) -> set[str]:
        return {normalize_rel_path(f["path"]) for f in fontes if f["componente"] == comp}

    def _clear_pages_for_paths(target_paths: set[str]) -> dict[str, Any]:
        kept: dict[str, Any] = {}
        for key, value in pages.items():
            file_part = str(key).rsplit("#", 1)[0]
            if normalize_rel_path(file_part) not in target_paths:
                kept[key] = value
        return kept

    if scope == "page":
        npath = normalize_rel_path(path or "")
        if not npath or source_page is None or int(source_page) < 1:
            raise ValueError("Informe o arquivo e a página de origem.")
        pages[page_crop_key(npath, int(source_page))] = crop_n
    elif scope == "file":
        npath = normalize_rel_path(path or "")
        if not npath:
            raise ValueError("Informe o arquivo.")
        files[npath] = crop_n
        pages = _clear_pages_for_paths({npath})
    elif scope == "component":
        comp = (componente or "").strip()
        if comp not in COMPONENTES:
            raise ValueError("Componente inválido para o crop.")
        if comp == COMP_CAPA:
            capa = dict(out["capa"]) if isinstance(out.get("capa"), dict) else {}
            capa["crop"] = crop_n
            if "layout" not in capa:
                capa["layout"] = "pages"
            out["capa"] = capa
        elif comp == COMP_MIOLO:
            out["miolo"] = crop_n
            miolo_central = False
        else:
            out["unico"] = crop_n
        target = _paths_for_component(comp)
        files = {k: v for k, v in files.items() if normalize_rel_path(k) not in target}
        pages = _clear_pages_for_paths(target)
    elif scope == "miolo_central":
        stored = crop_n
        if sequence_page is not None and int(sequence_page) >= 1 and int(sequence_page) % 2 == 0:
            stored = swap_crop_left_right(crop_n)
        out["miolo"] = stored
        miolo_central = True
        target = _paths_for_component(COMP_MIOLO)
        files = {k: v for k, v in files.items() if normalize_rel_path(k) not in target}
        pages = _clear_pages_for_paths(target)
    else:
        lab["all"] = crop_n
        out["unico"] = crop_n
        out["miolo"] = crop_n
        capa = dict(out["capa"]) if isinstance(out.get("capa"), dict) else {}
        capa["crop"] = crop_n
        if "layout" not in capa:
            capa["layout"] = "pages"
        out["capa"] = capa
        files = {}
        pages = {}
        miolo_central = False

    lab["files"] = files
    lab["pages"] = pages
    lab["mioloCentral"] = miolo_central
    if scope != "all":
        lab["all"] = lab.get("all")
    out["lab"] = lab
    return out


def merge_capa_config(
    crop_json: Optional[dict[str, Any]], capa: Optional[dict[str, Any]]
) -> dict[str, Any]:
    out: dict[str, Any] = dict(crop_json) if isinstance(crop_json, dict) else {}
    if not isinstance(capa, dict):
        return out
    current = dict(out["capa"]) if isinstance(out.get("capa"), dict) else {}
    for key in (
        "layout",
        "lombadaMm",
        "orelhaEsquerdaMm",
        "orelhaDireitaMm",
        "sheets",
    ):
        if key in capa:
            current[key] = capa[key]
    out["capa"] = current
    return out


def render_identity_crop_json(
    crop_json: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """Insets zerados para o render; preserva layout/lombada/orelhas da capa."""
    zero = identity_crop_sides()
    capa_raw = crop_json.get("capa") if isinstance(crop_json, dict) else None
    capa: dict[str, Any]
    if isinstance(capa_raw, dict):
        capa = dict(capa_raw)
        capa["crop"] = zero
    else:
        capa = {
            "layout": "pages",
            "lombadaMm": 0.0,
            "orelhaEsquerdaMm": 0.0,
            "orelhaDireitaMm": 0.0,
            "crop": zero,
            "sheets": [],
        }
    return {"unico": zero, "miolo": zero, "capa": capa}


def _is_multi_file(fontes: list[Fonte]) -> bool:
    by_comp: dict[str, int] = {}
    for fonte in fontes:
        by_comp[fonte["componente"]] = by_comp.get(fonte["componente"], 0) + 1
    return any(count > 1 for count in by_comp.values())


def _has_lab_overrides(crop_json: Optional[dict[str, Any]]) -> bool:
    lab = _lab_section(crop_json)
    if lab.get("all") is not None:
        return True
    if lab.get("files"):
        return True
    if lab.get("pages"):
        return True
    if lab.get("mioloCentral"):
        return True
    return False


def _append_cropped_page(
    out_doc: Any, src_doc: Any, page_index: int, crop_mm: dict[str, Any]
) -> None:
    page = src_doc.load_page(page_index)
    _apply_mm_crop(page, crop_mm)
    clip = page.cropbox
    width = float(clip.width)
    height = float(clip.height)
    if width < 8 or height < 8:
        raise ValueError("Crop excessivo: área útil insuficiente.")
    new_page = out_doc.new_page(width=width, height=height)
    new_page.show_pdf_page(new_page.rect, src_doc, page_index, clip=clip)


def _fontes_for_component(fontes: list[Fonte], componente: str) -> list[Fonte]:
    return [f for f in fontes if f["componente"] == componente]


def build_source_page_map(
    fontes: list[Fonte],
    os_folder: str,
) -> dict[str, Any]:
    """Inventário página-fonte → índice concatenado, sem rasterizar."""
    import fitz

    by_comp: dict[str, list[dict[str, Any]]] = {
        COMP_CAPA: [],
        COMP_MIOLO: [],
        COMP_UNICO: [],
    }
    warnings: list[str] = []
    for componente in (COMP_CAPA, COMP_MIOLO, COMP_UNICO):
        merged_index = 0
        for fonte in _fontes_for_component(fontes, componente):
            full = resolve_os_relative_pdf(os_folder, fonte["path"])
            with fitz.open(full) as doc:
                for index in range(len(doc)):
                    by_comp[componente].append(
                        {
                            "mergedIndex": merged_index,
                            "path": fonte["path"],
                            "sourcePage": index + 1,
                            "componente": componente,
                        }
                    )
                    merged_index += 1
        if componente == COMP_CAPA and merged_index > 4:
            warnings.append(
                f"Capa concatenada tem {merged_index} páginas; "
                "a montagem usa no máximo 4."
            )
    return {"byComponent": by_comp, "warnings": warnings}


def concatenate_component_pdfs(
    fontes: list[Fonte],
    os_folder: str,
    crop_json: Optional[dict[str, Any]],
    dest_dir: str,
) -> tuple[dict[str, str], dict[str, Any]]:
    """Gera PDFs mesclados por componente. Retorna (paths_abs, page_map)."""
    import fitz

    os.makedirs(dest_dir, exist_ok=True)
    page_map = build_source_page_map(fontes, os_folder)
    abs_paths: dict[str, str] = {}
    names = {
        COMP_CAPA: "capa.pdf",
        COMP_MIOLO: "miolo.pdf",
        COMP_UNICO: "unico.pdf",
    }
    for componente, filename in names.items():
        slot = _fontes_for_component(fontes, componente)
        if not slot:
            continue
        out = fitz.open()
        try:
            merged_index = 0
            for fonte in slot:
                full = resolve_os_relative_pdf(os_folder, fonte["path"])
                with fitz.open(full) as src:
                    for index in range(len(src)):
                        crop = resolve_page_crop(
                            crop_json,
                            path=fonte["path"],
                            source_page=index + 1,
                            componente=componente,
                            sequence_page=merged_index + 1,
                        )
                        _append_cropped_page(out, src, index, crop)
                        merged_index += 1
            dest = os.path.join(dest_dir, filename)
            out.save(dest)
            abs_paths[componente] = dest
        finally:
            out.close()
    return abs_paths, page_map


def prepare_lab_render(
    session: dict[str, Any],
    os_folder: str,
) -> dict[str, Any]:
    """
    Resolve caminhos e crop_json para ensure_prova_web_pages.

    Sessão legado (1 arquivo/slot, sem overrides lab): usa os PDFs originais.
    Caso contrário concatena em AnaliseLab/_lab_sources/.
    """
    modo = (session.get("modo") or MODE_UNICO).strip()
    fontes = fontes_from_session(session)
    validate_fontes_for_modo(fontes, modo)
    crop_json = session.get("cropJson") if isinstance(session.get("cropJson"), dict) else None
    pasta = session.get("pastaRender") or LAB_PASTA_RENDER
    page_map = build_source_page_map(fontes, os_folder)

    use_concat = _is_multi_file(fontes) or _has_lab_overrides(crop_json)
    if not use_concat:
        if modo == MODE_CAPA_MIOLO:
            capa = resolve_os_relative_pdf(os_folder, derive_legacy_paths(fontes, modo)[1] or "")
            miolo = resolve_os_relative_pdf(os_folder, derive_legacy_paths(fontes, modo)[2] or "")
            sources = [capa, miolo]
        else:
            unico = resolve_os_relative_pdf(os_folder, derive_legacy_paths(fontes, modo)[0] or "")
            sources = [unico]
        return {
            "mode": modo,
            "source_paths": sources,
            "crop_json": crop_json,
            "page_map": page_map,
            "concatenated": False,
        }

    cache_dir = ensure_web_render_dir(os_folder, pasta)
    dest_dir = os.path.join(cache_dir, _LAB_SOURCES_DIR)
    abs_paths, page_map = concatenate_component_pdfs(
        fontes, os_folder, crop_json, dest_dir
    )
    if modo == MODE_CAPA_MIOLO:
        sources = [abs_paths[COMP_CAPA], abs_paths[COMP_MIOLO]]
    else:
        sources = [abs_paths[COMP_UNICO]]
    return {
        "mode": modo,
        "source_paths": sources,
        "crop_json": render_identity_crop_json(crop_json),
        "page_map": page_map,
        "concatenated": True,
    }


def write_page_map(os_folder: str, pasta_render: str, page_map: dict[str, Any]) -> None:
    cache_dir = ensure_web_render_dir(os_folder, pasta_render)
    path = os.path.join(cache_dir, _PAGE_MAP_NAME)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(page_map, fh, ensure_ascii=False)


def load_page_map(os_folder: str, pasta_render: str) -> Optional[dict[str, Any]]:
    try:
        cache_dir = resolve_web_render_dir(os_folder, pasta_render)
    except (FileNotFoundError, ValueError, OSError):
        return None
    path = os.path.join(cache_dir, _PAGE_MAP_NAME)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def load_ready_lab_manifest(
    os_folder: str, pasta_render: str
) -> Optional[dict[str, Any]]:
    """Lê manifest.json do Lab sem checar cacheKey (paths concatenados diferem)."""
    try:
        cache_dir = resolve_web_render_dir(os_folder, pasta_render)
    except (FileNotFoundError, ValueError, OSError):
        return None
    path = os.path.join(cache_dir, "manifest.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _capa_is_spread(crop_json: Optional[dict[str, Any]]) -> bool:
    capa = crop_json.get("capa") if isinstance(crop_json, dict) else None
    if not isinstance(capa, dict):
        return False
    return (capa.get("layout") or "") == "spread"


def enrich_manifest_pages(
    pages: list[dict[str, Any]],
    page_map: Optional[dict[str, Any]],
    *,
    modo: str,
    crop_json: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Anexa sourcePath/sourcePage/componente às páginas montadas."""
    if not page_map:
        return pages
    by_comp = page_map.get("byComponent") if isinstance(page_map, dict) else None
    if not isinstance(by_comp, dict):
        return pages

    capa_list = list(by_comp.get(COMP_CAPA) or [])
    miolo_list = list(by_comp.get(COMP_MIOLO) or [])
    unico_list = list(by_comp.get(COMP_UNICO) or [])
    spread = _capa_is_spread(crop_json)

    if spread:
        role_to_capa = {
            "cover-back": 0,
            "cover-front": 0,
            "cover-front-inside": 1,
            "cover-back-inside": 1,
        }
    else:
        role_to_capa = {
            "cover-front": 0,
            "cover-front-inside": 1,
            "cover-back-inside": 2,
            "cover-back": 3,
        }

    miolo_i = 0
    unico_i = 0
    enriched: list[dict[str, Any]] = []
    for page in pages:
        extra: dict[str, Any] = {}
        if page.get("blank"):
            enriched.append(page)
            continue
        role = page.get("role") or ""
        src = None
        if (modo or "").strip() != MODE_CAPA_MIOLO:
            if unico_i < len(unico_list):
                src = unico_list[unico_i]
                unico_i += 1
        elif role == "page":
            if miolo_i < len(miolo_list):
                src = miolo_list[miolo_i]
                miolo_i += 1
        elif role in role_to_capa:
            idx = role_to_capa[role]
            if 0 <= idx < len(capa_list):
                src = capa_list[idx]
        if src:
            extra = {
                "sourcePath": src.get("path"),
                "sourcePage": src.get("sourcePage"),
                "sourceSequence": int(src.get("mergedIndex") or 0) + 1,
                "componente": src.get("componente"),
            }
        enriched.append({**page, **extra})
    return enriched

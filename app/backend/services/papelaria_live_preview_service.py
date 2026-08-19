"""Prévia em tempo real Papelaria — validação JSON e imagens base (DEV)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from config_manager import PROJECT_ROOT

_VALID_ALIGN = frozenset({"left", "center", "right"})
_VALID_ANCHOR = frozenset({"start", "middle", "end"})
_VALID_ELEMENT_TYPES = frozenset({"texto"})
_VALID_POSITION_SLOTS = frozenset(
    {
        "top-left",
        "top-center",
        "top-right",
        "center-left",
        "center",
        "center-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
    }
)
_FACE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
_ALLOWED_IMAGE_EXT = frozenset({".png", ".jpg", ".jpeg"})

PREVIEW_BASE_ROOT = PROJECT_ROOT / "Modelos" / "papelaria" / "previews"


def preview_base_dir(modelo_id: int) -> Path:
    return PREVIEW_BASE_ROOT / str(int(modelo_id))


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_preview_config_payload(data: Any) -> dict[str, Any]:
    if data is None:
        raise ValueError("Configuração de prévia vazia.")

    if not isinstance(data, dict):
        raise ValueError("PreviewConfigJson deve ser um objeto JSON.")

    canvas = data.get("canvas")
    if not isinstance(canvas, dict):
        raise ValueError("Campo obrigatório ausente: canvas.")
    width = canvas.get("width")
    height = canvas.get("height")
    if not _is_number(width) or width <= 0:
        raise ValueError("canvas.width numérico positivo obrigatório.")
    if not _is_number(height) or height <= 0:
        raise ValueError("canvas.height numérico positivo obrigatório.")

    faces = data.get("faces")
    if not isinstance(faces, list) or not faces:
        raise ValueError("Campo obrigatório ausente: faces (lista não vazia).")

    seen_ids: set[str] = set()
    for idx, face in enumerate(faces):
        if not isinstance(face, dict):
            raise ValueError(f"Face #{idx + 1} deve ser um objeto.")
        face_id = face.get("id")
        if not face_id or not isinstance(face_id, str):
            raise ValueError(f"Face #{idx + 1}: id obrigatório.")
        if not _FACE_ID_RE.match(face_id):
            raise ValueError(f"Face id inválido: {face_id}")
        if face_id in seen_ids:
            raise ValueError(f"Face id duplicado: {face_id}")
        seen_ids.add(face_id)

        base_image = face.get("baseImage")
        if not base_image or not isinstance(base_image, str):
            raise ValueError(f"Face '{face_id}': baseImage obrigatório.")

        elementos = face.get("elementos")
        if elementos is None:
            elementos = []
        if not isinstance(elementos, list):
            raise ValueError(f"Face '{face_id}': elementos deve ser uma lista.")

        for eidx, el in enumerate(elementos):
            if not isinstance(el, dict):
                raise ValueError(f"Face '{face_id}' elemento #{eidx + 1}: objeto esperado.")
            tipo = el.get("tipo") or "texto"
            if tipo not in _VALID_ELEMENT_TYPES:
                raise ValueError(f"Tipo de elemento não suportado: {tipo}")
            if not el.get("id"):
                raise ValueError(f"Face '{face_id}' elemento #{eidx + 1}: id obrigatório.")
            if not el.get("template"):
                raise ValueError(f"Face '{face_id}' elemento '{el.get('id')}': template obrigatório.")
            for coord in ("x", "y", "width", "height"):
                if not _is_number(el.get(coord)):
                    raise ValueError(
                        f"Face '{face_id}' elemento '{el.get('id')}': {coord} numérico obrigatório."
                    )
            align = (el.get("align") or "left").lower()
            if align not in _VALID_ALIGN:
                raise ValueError(f"align inválido em '{el.get('id')}': {align}")
            anchor = (el.get("anchor") or "start").lower()
            if anchor not in _VALID_ANCHOR:
                raise ValueError(f"anchor inválido em '{el.get('id')}': {anchor}")
            if not _is_number(el.get("fontSize")) or el["fontSize"] <= 0:
                raise ValueError(f"fontSize positivo obrigatório em '{el.get('id')}'.")

            pos_slot = el.get("posicaoSlot")
            if pos_slot is not None:
                slot = str(pos_slot).strip().lower()
                if slot and slot not in _VALID_POSITION_SLOTS:
                    raise ValueError(f"posicaoSlot inválido em '{el.get('id')}': {slot}")

            grupo = el.get("grupo")
            if grupo is not None and not isinstance(grupo, str):
                raise ValueError(f"grupo inválido em '{el.get('id')}'.")

    campos_dinamicos = data.get("camposDinamicos")
    if campos_dinamicos is not None:
        if not isinstance(campos_dinamicos, list):
            raise ValueError("camposDinamicos deve ser uma lista.")
        for didx, item in enumerate(campos_dinamicos):
            if not isinstance(item, dict):
                raise ValueError(f"camposDinamicos #{didx + 1}: objeto esperado.")
            if not item.get("variavel") and not item.get("key"):
                raise ValueError(f"camposDinamicos #{didx + 1}: variavel obrigatória.")
            slot = item.get("posicaoSlot")
            if slot is not None:
                slot_norm = str(slot).strip().lower()
                if slot_norm and slot_norm not in _VALID_POSITION_SLOTS:
                    raise ValueError(f"camposDinamicos #{didx + 1}: posicaoSlot inválido.")
            posicoes = item.get("posicoesPermitidas")
            if posicoes is not None:
                if not isinstance(posicoes, list) or not posicoes:
                    raise ValueError(f"camposDinamicos #{didx + 1}: posicoesPermitidas inválido.")
                for pidx, pos in enumerate(posicoes):
                    pos_norm = str(pos).strip().lower()
                    if pos_norm not in _VALID_POSITION_SLOTS:
                        raise ValueError(
                            f"camposDinamicos #{didx + 1} posição #{pidx + 1}: slot inválido."
                        )

    grupos = data.get("gruposCampos")
    if grupos is not None and not isinstance(grupos, dict):
        raise ValueError("gruposCampos deve ser um objeto.")

    campo_labels = data.get("campoLabels")
    if campo_labels is not None and not isinstance(campo_labels, dict):
        raise ValueError("campoLabels deve ser um objeto.")

    return data


def parse_preview_config_json(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON inválido: {exc.msg}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("PreviewConfigJson deve ser um objeto JSON.")
        return parsed
    raise ValueError("PreviewConfigJson em formato não suportado.")


def normalize_preview_config_json(raw: Any) -> str | None:
    parsed = parse_preview_config_json(raw)
    if parsed is None:
        return None
    validate_preview_config_payload(parsed)
    return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))


def overlay_campos_com_templates_preview(
    campos: dict[str, str],
    preview_config: dict[str, Any] | None,
) -> dict[str, str]:
    """Usa o template da prévia (ex.: **negrito**) no objeto Corel de mesmo id."""
    if not preview_config or not isinstance(campos, dict):
        return campos
    overlay: dict[str, str] = {}
    for face in preview_config.get("faces") or []:
        if not isinstance(face, dict):
            continue
        for el in face.get("elementos") or []:
            if not isinstance(el, dict):
                continue
            eid = str(el.get("id") or "").strip()
            tpl = el.get("template")
            if eid and tpl is not None and str(tpl).strip():
                overlay[eid] = str(tpl)
    if not overlay:
        return campos
    out = dict(campos)
    lower_to_key = {str(k).lower(): k for k in out}
    for eid, tpl in overlay.items():
        if eid in out:
            out[eid] = tpl
        elif eid.lower() in lower_to_key:
            out[lower_to_key[eid.lower()]] = tpl
    return out


_AUTO_LAYOUT_SLOTS = (
    "top-center",
    "center",
    "bottom-center",
    "top-left",
    "center-left",
    "bottom-left",
    "top-right",
    "center-right",
    "bottom-right",
)

_SLOT_ANCHORS: dict[str, tuple[float, float, str, str]] = {
    "top-left": (0.08, 0.1, "left", "start"),
    "top-center": (0.5, 0.1, "center", "start"),
    "top-right": (0.92, 0.1, "right", "start"),
    "center-left": (0.08, 0.5, "left", "middle"),
    "center": (0.5, 0.5, "center", "middle"),
    "center-right": (0.92, 0.5, "right", "middle"),
    "bottom-left": (0.08, 0.9, "left", "end"),
    "bottom-center": (0.5, 0.9, "center", "end"),
    "bottom-right": (0.92, 0.9, "right", "end"),
}

_COMMON_DYNAMIC_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "nome_deputado",
        "variavel": "nome_deputado",
        "label": "Nome do deputado/deputada",
        "tipo": "text",
        "fontFamily": "Arial",
        "fontSize": 44,
        "fontWeight": 700,
        "align": "center",
        "posicoesPermitidas": ["center", "top-center", "bottom-center"],
        "required": True,
    },
    {
        "id": "genero",
        "variavel": "genero",
        "label": "Gênero/Cargo",
        "tipo": "text",
        "fontFamily": "Arial",
        "fontSize": 28,
        "align": "center",
        "posicoesPermitidas": ["top-center", "center"],
    },
    {
        "id": "partido_uf",
        "variavel": "partido",
        "label": "Partido/UF",
        "tipo": "text",
        "template": "{partido}/{uf}",
        "fontFamily": "Arial",
        "fontSize": 28,
        "align": "center",
        "posicoesPermitidas": ["bottom-center", "center"],
    },
    {
        "id": "gabinete",
        "variavel": "gabinete",
        "label": "Gabinete",
        "tipo": "text",
        "fontFamily": "Arial",
        "fontSize": 24,
        "posicoesPermitidas": ["top-left", "top-right"],
    },
    {
        "id": "email",
        "variavel": "email",
        "label": "E-mail",
        "tipo": "email",
        "fontFamily": "Arial",
        "fontSize": 22,
        "posicoesPermitidas": ["bottom-left", "bottom-center"],
    },
    {
        "id": "nome_assessor",
        "variavel": "nome_assessor",
        "label": "Nome do assessor",
        "tipo": "text",
        "fontFamily": "Arial",
        "fontSize": 24,
        "posicoesPermitidas": ["center-left", "center-right", "bottom-left"],
    },
]


def _slugify_campo_id(name: str, used: set[str]) -> str:
    base = re.sub(r"[^\w\s-]", "", str(name).strip())
    base = re.sub(r"\s+", "_", base).strip("_")[:64] or "campo"
    if not re.match(r"^[a-zA-Z]", base):
        base = f"c_{base}"
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _estimate_font_size(template: str) -> int:
    t = template.lower()
    if "{nome_deputado}" in t:
        return 44
    if "{partido}" in t or "{uf}" in t:
        return 28
    if "{genero}" in t:
        return 28
    if len(template) > 80:
        return 22
    return 32


def _estimate_element_height(template: str, font_size: int) -> int:
    lines = max(1, template.count("\n") + 1)
    return max(48, int(font_size * 1.2 * lines))


def _slot_to_element_rect(
    slot_id: str,
    canvas_w: int,
    canvas_h: int,
    width: int = 900,
    height: int = 48,
) -> dict[str, Any]:
    slot = _SLOT_ANCHORS.get(slot_id, _SLOT_ANCHORS["center"])
    x_pct, y_pct, align, anchor = slot
    x_center = canvas_w * x_pct
    y_center = canvas_h * y_pct
    x = x_center - width / 2
    if align == "left":
        x = canvas_w * x_pct
    elif align == "right":
        x = canvas_w * x_pct - width

    y = y_center
    if anchor == "start":
        y = canvas_h * y_pct
    elif anchor == "middle":
        y = y_center - height / 2
    elif anchor == "end":
        y = canvas_h * y_pct - height

    return {
        "x": int(max(0, min(x, canvas_w - width))),
        "y": int(max(0, min(y, canvas_h - height))),
        "width": width,
        "height": height,
        "align": align,
        "anchor": anchor,
    }


def _split_frente_verso_template(template: str) -> tuple[str, str] | None:
    text = str(template).replace("\r\n", "\n").replace("\r", "\n").strip()
    match = re.match(
        r"^\s*Frente:\s*\n?(.*?)\n\s*Verso:\s*\n?(.*?)\s*$",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None
    return match.group(1).strip(), match.group(2).strip()


def _build_dynamic_templates_for_variaveis(variaveis: list[str]) -> list[dict[str, Any]]:
    from services.papelaria_models_service import VARIAVEIS_DERIVADAS

    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    vars_set = {v for v in variaveis if v not in VARIAVEIS_DERIVADAS}

    for tpl in _COMMON_DYNAMIC_TEMPLATES:
        variavel = str(tpl.get("variavel") or "")
        matches = variavel in vars_set or (variavel == "partido" and "uf" in vars_set)
        if not matches:
            continue
        tpl_id = str(tpl.get("id") or variavel)
        if tpl_id in seen:
            continue
        result.append(dict(tpl))
        seen.add(tpl_id)

    for variavel in variaveis:
        if variavel in VARIAVEIS_DERIVADAS:
            continue
        if variavel in seen:
            continue
        if any(str(t.get("variavel")) == variavel for t in _COMMON_DYNAMIC_TEMPLATES):
            continue
        result.append(
            {
                "id": variavel,
                "variavel": variavel,
                "label": variavel.replace("_", " "),
                "tipo": "email" if variavel == "email" else "text",
                "fontFamily": "Arial",
                "fontSize": 28,
                "align": "center",
                "posicoesPermitidas": ["center", "top-center", "bottom-center"],
            }
        )
        seen.add(variavel)

    return result


def _build_faces_from_frente_verso(frente_verso: str) -> list[dict[str, Any]]:
    fv = (frente_verso or "").lower()
    has_verso = "verso" in fv and "frente" in fv
    if has_verso:
        return [
            {
                "id": "frente",
                "nome": "Frente",
                "baseImage": "frente_base.png",
                "elementos": [],
            },
            {
                "id": "verso",
                "nome": "Verso",
                "baseImage": "verso_base.png",
                "pageIndex": 1,
                "elementos": [],
            },
        ]
    return [
        {
            "id": "frente",
            "nome": "Frente",
            "baseImage": "frente_base.png",
            "elementos": [],
        }
    ]


def _preview_element_id(nome_campo: str, used: set[str]) -> str:
    nome = str(nome_campo).strip()
    if re.match(r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$", nome):
        candidate = nome
        if candidate not in used:
            used.add(candidate)
            return candidate
    return _slugify_campo_id(nome_campo, used)


def _scale_layout_rect(
    item: dict[str, Any],
    canvas_w: int,
    canvas_h: int,
) -> dict[str, int]:
    pw = int(item.get("pageWidth") or canvas_w or 1)
    ph = int(item.get("pageHeight") or canvas_h or 1)
    sx = canvas_w / pw if pw else 1.0
    sy = canvas_h / ph if ph else 1.0
    return {
        "x": int(round(float(item.get("x") or 0) * sx)),
        "y": int(round(float(item.get("y") or 0) * sy)),
        "width": int(round(max(1.0, float(item.get("width") or 1) * sx))),
        "height": int(round(max(1.0, float(item.get("height") or 1) * sy))),
    }


def _face_for_page(page_num: int, faces: list[dict[str, Any]]) -> dict[str, Any]:
    if len(faces) >= 2 and page_num >= 2:
        verso = next((f for f in faces if f.get("id") == "verso"), None)
        if verso:
            return verso
    return next(f for f in faces if f.get("id") == "frente")


_CANONICAL_JSON_DIR = PROJECT_ROOT / "Modelos" / "papelaria" / "pdfs" / "json"
_static_layout_index: dict[tuple[str, int], dict[str, Any]] | None = None
_VERSO_CAMPO_KEYS = frozenset(
    {
        "nomeassessor",
        "funcao",
        "funcaoassessor",
        "contatoassessor",
    }
)


def _get_static_layout_index() -> dict[tuple[str, int], dict[str, Any]]:
    global _static_layout_index
    if _static_layout_index is not None:
        return _static_layout_index

    from services.papelaria_models_service import normalize_corel_object_name

    index: dict[tuple[str, int], dict[str, Any]] = {}
    if _CANONICAL_JSON_DIR.is_dir():
        for path in sorted(_CANONICAL_JSON_DIR.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, TypeError):
                continue
            if not isinstance(data, dict):
                continue
            raw_canvas = data.get("canvas") if isinstance(data.get("canvas"), dict) else {}
            canvas_w = int(raw_canvas.get("width") or 964)
            canvas_h = int(raw_canvas.get("height") or 567)
            for face in data.get("faces") or []:
                if not isinstance(face, dict):
                    continue
                page = int(face.get("pageIndex") or 0) + 1
                for el in face.get("elementos") or []:
                    if not isinstance(el, dict):
                        continue
                    el_id = str(el.get("id") or "").strip()
                    if not el_id:
                        continue
                    key = normalize_corel_object_name(el_id)
                    if not key:
                        continue
                    index[(key, page)] = {
                        "element": el,
                        "canvas": {"width": canvas_w, "height": canvas_h},
                        "page": page,
                    }
    _static_layout_index = index
    return index


def _find_campo_key_for_element_id(element_id: str, campos: dict[str, str]) -> str | None:
    from services.papelaria_models_service import normalize_corel_object_name

    target = normalize_corel_object_name(element_id)
    if not target:
        return None
    for nome in campos:
        if normalize_corel_object_name(nome) == target:
            return nome
    return None


def _layout_item_from_preview_element(
    nome_campo: str,
    page: int,
    el: dict[str, Any],
    canvas_w: int,
    canvas_h: int,
) -> dict[str, Any]:
    font_size = el.get("fontSize")
    if not isinstance(font_size, (int, float)) or font_size <= 0:
        font_size = 28
    return {
        "campo": nome_campo,
        "page": page,
        "pageWidth": canvas_w,
        "pageHeight": canvas_h,
        "x": int(el.get("x") or 0),
        "y": int(el.get("y") or 0),
        "width": int(el.get("width") or 100),
        "height": int(el.get("height") or 40),
        "fontFamily": el.get("fontFamily") or "Arial, sans-serif",
        "fontSize": int(font_size),
        "fontWeight": el.get("fontWeight") if el.get("fontWeight") is not None else 400,
        "fontStyle": el.get("fontStyle") or "normal",
        "color": el.get("color") or "#231f20",
        "align": el.get("align") or "left",
        "anchor": el.get("anchor") or "start",
        "lineHeight": el.get("lineHeight") if el.get("lineHeight") is not None else 1.0,
    }


def _extract_layout_items_from_preview_config(
    config: dict[str, Any],
    campos: dict[str, str],
) -> list[dict[str, Any]]:
    canvas = config.get("canvas") if isinstance(config.get("canvas"), dict) else {}
    canvas_w = int(canvas.get("width") or 964)
    canvas_h = int(canvas.get("height") or 567)
    items: list[dict[str, Any]] = []
    for face in config.get("faces") or []:
        if not isinstance(face, dict):
            continue
        page = int(face.get("pageIndex") or 0) + 1
        for el in face.get("elementos") or []:
            if not isinstance(el, dict):
                continue
            nome = _find_campo_key_for_element_id(str(el.get("id") or ""), campos)
            if not nome:
                continue
            items.append(
                _layout_item_from_preview_element(nome, page, el, canvas_w, canvas_h)
            )
    return items


def _find_reference_preview_config_from_db(campos: dict[str, str]) -> dict[str, Any] | None:
    from database import db
    from services.papelaria_models_service import (
        ensure_papelaria_modelos_table,
        normalize_corel_object_name,
    )

    try:
        ensure_papelaria_modelos_table()
        rows = db.execute_query(
            """
            SELECT CamposJson, PreviewConfigJson
            FROM tabPapelariaModelos
            WHERE Ativo = 1
              AND PreviewConfigJson IS NOT NULL
              AND PreviewConfigJson != ''
            """
        )
    except Exception:
        return None

    target_keys = {normalize_corel_object_name(k) for k in campos}
    if not target_keys:
        return None

    best_score = 0
    best_config: dict[str, Any] | None = None
    for row in rows or []:
        try:
            ref_campos_raw = row.get("CamposJson") if isinstance(row, dict) else row[0]
            preview_raw = row.get("PreviewConfigJson") if isinstance(row, dict) else row[1]
            ref_campos = (
                json.loads(ref_campos_raw)
                if isinstance(ref_campos_raw, str)
                else (ref_campos_raw or {})
            )
            config = (
                json.loads(preview_raw)
                if isinstance(preview_raw, str)
                else (preview_raw or {})
            )
        except (json.JSONDecodeError, TypeError, IndexError):
            continue
        if not isinstance(ref_campos, dict) or not isinstance(config, dict):
            continue
        ref_keys = {normalize_corel_object_name(k) for k in ref_campos}
        overlap = len(target_keys & ref_keys)
        el_count = sum(
            len(face.get("elementos") or [])
            for face in (config.get("faces") or [])
            if isinstance(face, dict)
        )
        if el_count == 0 or overlap <= best_score:
            continue
        best_score = overlap
        best_config = config

    min_overlap = max(3, (len(target_keys) * 2 + 2) // 3)
    if best_score >= min_overlap:
        return best_config
    return None


def _static_layout_item_for_campo(nome_campo: str, page_hint: int = 1) -> dict[str, Any] | None:
    from services.papelaria_models_service import normalize_corel_object_name

    key = normalize_corel_object_name(nome_campo)
    index = _get_static_layout_index()
    for page in (page_hint, 1, 2):
        entry = index.get((key, page))
        if not entry:
            continue
        canvas = entry.get("canvas") if isinstance(entry.get("canvas"), dict) else {}
        canvas_w = int(canvas.get("width") or 964)
        canvas_h = int(canvas.get("height") or 567)
        el = entry.get("element")
        if not isinstance(el, dict):
            continue
        return _layout_item_from_preview_element(
            nome_campo,
            int(entry.get("page") or page),
            el,
            canvas_w,
            canvas_h,
        )
    return None


def _is_valid_layout_item(item: dict[str, Any] | None) -> bool:
    if not item or not isinstance(item, dict):
        return False
    width = item.get("width")
    height = item.get("height")
    return (
        isinstance(width, (int, float))
        and isinstance(height, (int, float))
        and width > 0
        and height > 0
    )


_LAYOUT_STYLE_KEYS = (
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "color",
    "align",
    "anchor",
    "lineHeight",
)


def _apply_layout_style(
    item: dict[str, Any],
    partial: dict[str, Any] | None,
) -> dict[str, Any]:
    if not partial:
        return item
    for key in _LAYOUT_STYLE_KEYS:
        value = partial.get(key)
        if value is not None and value != "":
            item[key] = value
    return item


def _elements_on_page(
    elemento_by_campo: dict[str, dict[str, Any]],
    page: int,
) -> dict[str, dict[str, Any]]:
    return {
        nome: item
        for nome, item in elemento_by_campo.items()
        if int(item.get("page") or 1) == page
    }


def _default_page_for_campo(nome_campo: str, page_by_campo: dict[str, int]) -> int:
    from services.papelaria_models_service import normalize_corel_object_name

    if nome_campo in page_by_campo:
        return page_by_campo[nome_campo]
    if normalize_corel_object_name(nome_campo) in _VERSO_CAMPO_KEYS:
        return 2
    return 1


def _heuristic_layout_for_unknown_campo(
    nome_campo: str,
    elemento_by_campo: dict[str, dict[str, Any]],
    canvas: dict[str, int],
    *,
    page: int = 1,
    partial_style: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    from services.papelaria_models_service import normalize_corel_object_name

    on_page = _elements_on_page(elemento_by_campo, page)

    if page >= 2:
        for ref_name in ("NomeAssessor", "Funcao", "ContatoAssessor"):
            base = _static_layout_item_for_campo(ref_name, 2)
            if base:
                item = dict(base)
                item["campo"] = nome_campo
                item["page"] = page
                return _apply_layout_style(item, partial_style)

    anchor: dict[str, Any] | None = None
    for ref_name in ("PartidoDep", "Genero", "NomeDep"):
        ref_key = normalize_corel_object_name(ref_name)
        for nome, item in on_page.items():
            if nome == ref_name or normalize_corel_object_name(nome) == ref_key:
                anchor = item
                break
        if anchor:
            break

    if not anchor and on_page:
        anchor = next(iter(on_page.values()))
    if not anchor:
        return None

    page_w = int(anchor.get("pageWidth") or canvas.get("width") or 964)
    page_h = int(anchor.get("pageHeight") or canvas.get("height") or 567)
    y = int(anchor.get("y") or 300) + int(anchor.get("height") or 40) + 8
    font_size = anchor.get("fontSize")
    if not isinstance(font_size, (int, float)) or font_size <= 0:
        font_size = 28
    item = {
        "campo": nome_campo,
        "page": page,
        "pageWidth": page_w,
        "pageHeight": page_h,
        "x": int(anchor.get("x") or 116),
        "y": y,
        "width": int(anchor.get("width") or 732),
        "height": int(anchor.get("height") or 43),
        "fontFamily": anchor.get("fontFamily") or "Arial, sans-serif",
        "fontSize": int(font_size),
        "fontWeight": anchor.get("fontWeight") if anchor.get("fontWeight") is not None else 500,
        "fontStyle": anchor.get("fontStyle") or "normal",
        "color": anchor.get("color") or "#231f20",
        "align": anchor.get("align") or "center",
        "anchor": anchor.get("anchor") or "middle",
        "lineHeight": anchor.get("lineHeight") if anchor.get("lineHeight") is not None else 1.0,
    }
    return _apply_layout_style(item, partial_style)


def _build_complete_inspect_layout(
    campos: dict[str, str],
    worker_layout: dict[str, Any] | None,
    frente_verso: str,
) -> dict[str, Any]:
    """Mescla layout do worker, modelos existentes no banco e JSONs canônicos."""
    elemento_by_campo: dict[str, dict[str, Any]] = {}
    page_by_campo: dict[str, int] = {}
    partial_by_campo: dict[str, dict[str, Any]] = {}
    canvas: dict[str, int] | None = None

    if isinstance(worker_layout, dict):
        raw_canvas = worker_layout.get("canvas")
        if isinstance(raw_canvas, dict) and raw_canvas.get("width"):
            canvas = {
                "width": int(raw_canvas["width"]),
                "height": int(raw_canvas.get("height") or 800),
            }
        for item in worker_layout.get("elementos") or []:
            if not isinstance(item, dict):
                continue
            nome = str(item.get("campo") or "").strip()
            if not nome:
                continue
            page_by_campo[nome] = int(item.get("page") or 1)
            if _is_valid_layout_item(item):
                elemento_by_campo[nome] = dict(item)
            else:
                partial_by_campo[nome] = dict(item)

    ref_config = _find_reference_preview_config_from_db(campos)
    if ref_config:
        if not canvas:
            rc = ref_config.get("canvas") if isinstance(ref_config.get("canvas"), dict) else {}
            if rc.get("width"):
                canvas = {
                    "width": int(rc["width"]),
                    "height": int(rc.get("height") or 567),
                }
        for item in _extract_layout_items_from_preview_config(ref_config, campos):
            nome = item["campo"]
            if nome in elemento_by_campo:
                continue
            expected_page = page_by_campo.get(nome)
            item_page = int(item.get("page") or 1)
            if expected_page is not None and item_page != expected_page:
                continue
            elemento_by_campo[nome] = item

    for nome_campo in campos:
        if nome_campo in elemento_by_campo:
            continue
        page_hint = _default_page_for_campo(nome_campo, page_by_campo)
        static_item = _static_layout_item_for_campo(nome_campo, page_hint)
        if static_item:
            elemento_by_campo[nome_campo] = _apply_layout_style(
                static_item,
                partial_by_campo.get(nome_campo),
            )
            if not canvas:
                canvas = {
                    "width": int(static_item["pageWidth"]),
                    "height": int(static_item["pageHeight"]),
                }

    canvas = canvas or {"width": 964, "height": 567}
    for nome_campo in campos:
        if nome_campo in elemento_by_campo:
            continue
        page = _default_page_for_campo(nome_campo, page_by_campo)
        heuristic = _heuristic_layout_for_unknown_campo(
            nome_campo,
            elemento_by_campo,
            canvas,
            page=page,
            partial_style=partial_by_campo.get(nome_campo),
        )
        if heuristic:
            elemento_by_campo[nome_campo] = heuristic

    return {
        "canvas": canvas,
        "elementos": list(elemento_by_campo.values()),
    }


def _compose_preview_config_result(
    canvas_w: int,
    canvas_h: int,
    faces: list[dict[str, Any]],
    *,
    habilitar_campos_dinamicos: bool = False,
    all_variaveis: list[str] | None = None,
    campo_labels: dict[str, str] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "canvas": {"width": canvas_w, "height": canvas_h},
        "faces": faces,
    }
    if habilitar_campos_dinamicos:
        result["habilitarCamposDinamicos"] = True
        result["camposDinamicos"] = _build_dynamic_templates_for_variaveis(all_variaveis or [])
        result["gruposCampos"] = {}
        if campo_labels:
            result["campoLabels"] = dict(campo_labels)
    return result


def _build_preview_config_from_layout(
    campos: dict[str, str],
    variaveis: list[str],
    frente_verso: str,
    layout: dict[str, Any],
    *,
    habilitar_campos_dinamicos: bool = True,
    campo_labels: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    from services.papelaria_models_service import extrair_variaveis

    elementos_layout = layout.get("elementos")
    if not isinstance(elementos_layout, list) or not elementos_layout:
        return None

    canvas_raw = layout.get("canvas") if isinstance(layout.get("canvas"), dict) else {}
    canvas_w = int(canvas_raw.get("width") or 1200)
    canvas_h = int(canvas_raw.get("height") or 800)
    if canvas_w <= 0 or canvas_h <= 0:
        return None

    vars_set = set(variaveis)
    for template in campos.values():
        vars_set.update(extrair_variaveis(str(template)))
    all_variaveis = list(vars_set)

    faces = _build_faces_from_frente_verso(frente_verso)
    used_ids: set[str] = set()
    layout_by_campo = {
        str(item.get("campo")): item
        for item in elementos_layout
        if isinstance(item, dict) and item.get("campo")
    }

    for nome_campo, template_raw in sorted(campos.items()):
        template = str(template_raw or "").strip()
        if not template:
            continue
        item = layout_by_campo.get(nome_campo)
        if not item:
            continue

        page_num = int(item.get("page") or 1)
        face = _face_for_page(page_num, faces)
        rect = _scale_layout_rect(item, canvas_w, canvas_h)
        el_id = _preview_element_id(nome_campo, used_ids)
        font_size = item.get("fontSize")
        if not isinstance(font_size, (int, float)) or font_size <= 0:
            font_size = _estimate_font_size(template)

        elemento: dict[str, Any] = {
            "id": el_id,
            "tipo": "texto",
            "template": template,
            **rect,
            "fontFamily": item.get("fontFamily") or "Arial, sans-serif",
            "fontSize": int(font_size),
            "fontWeight": item.get("fontWeight") if item.get("fontWeight") is not None else 400,
            "fontStyle": item.get("fontStyle") or "normal",
            "color": item.get("color") or "#231f20",
            "align": item.get("align") or "left",
            "anchor": item.get("anchor") or "start",
            "lineHeight": item.get("lineHeight") if item.get("lineHeight") is not None else 1.1,
        }
        face["elementos"].append(elemento)

    if not any(face.get("elementos") for face in faces):
        return None

    return _compose_preview_config_result(
        canvas_w,
        canvas_h,
        faces,
        habilitar_campos_dinamicos=habilitar_campos_dinamicos,
        all_variaveis=all_variaveis,
        campo_labels=campo_labels,
    )


def build_preview_config_from_inspect(
    campos: dict[str, str],
    variaveis: list[str],
    frente_verso: str = "",
    *,
    habilitar_campos_dinamicos: bool = False,
    campo_labels: dict[str, str] | None = None,
    preview_layout: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Gera PreviewConfigJson com elementos posicionados a partir da inspeção Corel."""
    merged_layout = _build_complete_inspect_layout(campos, preview_layout, frente_verso)
    if merged_layout.get("elementos"):
        from_layout = _build_preview_config_from_layout(
            campos,
            variaveis,
            frente_verso,
            merged_layout,
            habilitar_campos_dinamicos=habilitar_campos_dinamicos,
            campo_labels=campo_labels,
        )
        if from_layout:
            return from_layout

    from services.papelaria_models_service import extrair_variaveis

    vars_set = set(variaveis)
    for template in campos.values():
        vars_set.update(extrair_variaveis(str(template)))
    all_variaveis = list(vars_set)

    canvas_w = 1200
    canvas_h = 800
    faces = _build_faces_from_frente_verso(frente_verso)
    frente_face = next(f for f in faces if f["id"] == "frente")
    verso_face = next((f for f in faces if f["id"] == "verso"), None)

    used_ids: set[str] = set()
    slot_idx = 0

    for nome_campo, template_raw in sorted(campos.items()):
        template = str(template_raw or "").strip()
        if not template:
            continue

        fv = _split_frente_verso_template(template)
        if fv and verso_face:
            for face, text, suffix in (
                (frente_face, fv[0], "frente"),
                (verso_face, fv[1], "verso"),
            ):
                slot = _AUTO_LAYOUT_SLOTS[slot_idx % len(_AUTO_LAYOUT_SLOTS)]
                slot_idx += 1
                el_id = _slugify_campo_id(f"{nome_campo}_{suffix}", used_ids)
                font_size = _estimate_font_size(text)
                height = _estimate_element_height(text, font_size)
                rect = _slot_to_element_rect(slot, canvas_w, canvas_h, 900, height)
                face["elementos"].append(
                    {
                        "id": el_id,
                        "tipo": "texto",
                        "template": text,
                        **rect,
                        "fontFamily": "Arial, sans-serif",
                        "fontSize": font_size,
                        "fontWeight": 700 if "{nome_deputado}" in text.lower() else 400,
                        "color": "#111827",
                        "lineHeight": 1.1,
                        "posicaoSlot": slot,
                    }
                )
            continue

        slot = _AUTO_LAYOUT_SLOTS[slot_idx % len(_AUTO_LAYOUT_SLOTS)]
        slot_idx += 1
        el_id = _slugify_campo_id(nome_campo, used_ids)
        font_size = _estimate_font_size(template)
        height = _estimate_element_height(template, font_size)
        rect = _slot_to_element_rect(slot, canvas_w, canvas_h, 900, height)
        frente_face["elementos"].append(
            {
                "id": el_id,
                "tipo": "texto",
                "template": template,
                **rect,
                "fontFamily": "Arial, sans-serif",
                "fontSize": font_size,
                "fontWeight": 700 if "{nome_deputado}" in template.lower() else 400,
                "color": "#111827",
                "lineHeight": 1.1,
                "posicaoSlot": slot,
            }
        )

    return _compose_preview_config_result(
        canvas_w,
        canvas_h,
        faces,
        habilitar_campos_dinamicos=habilitar_campos_dinamicos,
        all_variaveis=all_variaveis,
        campo_labels=campo_labels,
    )


def example_preview_config() -> dict[str, Any]:
    return {
        "canvas": {"width": 1200, "height": 800},
        "faces": [
            {
                "id": "frente",
                "nome": "Frente",
                "baseImage": "frente_base.png",
                "pageIndex": 0,
                "elementos": [
                    {
                        "id": "nome_deputado",
                        "tipo": "texto",
                        "template": "{nome_deputado}",
                        "x": 150,
                        "y": 250,
                        "width": 900,
                        "height": 80,
                        "fontFamily": "Arial, sans-serif",
                        "fontSize": 44,
                        "fontWeight": 700,
                        "color": "#111827",
                        "align": "center",
                        "anchor": "middle",
                        "lineHeight": 1.1,
                    },
                    {
                        "id": "partido_uf",
                        "tipo": "texto",
                        "template": "{partido}/{uf}",
                        "x": 150,
                        "y": 340,
                        "width": 900,
                        "height": 40,
                        "fontFamily": "Arial, sans-serif",
                        "fontSize": 28,
                        "fontWeight": 400,
                        "color": "#374151",
                        "align": "center",
                        "anchor": "middle",
                        "lineHeight": 1.1,
                    },
                ],
            }
        ],
    }


def _sanitize_base_filename(filename: str) -> str:
    name = os.path.basename(str(filename).replace("\\", "/"))
    if not name or ".." in name or "/" in name:
        raise ValueError("Nome de arquivo inválido.")
    ext = Path(name).suffix.lower()
    if ext not in _ALLOWED_IMAGE_EXT:
        raise ValueError("Apenas PNG ou JPG são permitidos.")
    return name


def validate_face_id(face_id: str) -> str:
    fid = (face_id or "").strip()
    if not fid or not _FACE_ID_RE.match(fid):
        raise ValueError("Identificador de face inválido.")
    return fid


def _validate_path_under_dir(file_path: Path, base_dir: Path) -> str:
    real_base = os.path.realpath(str(base_dir))
    real_file = os.path.realpath(str(file_path))
    if not real_file.startswith(real_base + os.sep) and real_file != real_base:
        raise ValueError("Caminho de imagem inválido.")
    return real_file


def resolve_face_base_image_path(
    modelo_id: int,
    face_id: str,
    *,
    preview_config: dict[str, Any] | None = None,
) -> str:
    """Resolve caminho físico da imagem base enviada via upload (somente gráficos fixos)."""
    fid = validate_face_id(face_id)
    base_dir = preview_base_dir(modelo_id)
    if not base_dir.is_dir():
        raise FileNotFoundError("Imagens base não configuradas para este modelo.")

    candidates: list[str] = []
    if preview_config:
        for face in preview_config.get("faces") or []:
            if isinstance(face, dict) and face.get("id") == fid:
                base_image = face.get("baseImage")
                if base_image:
                    candidates.append(_sanitize_base_filename(str(base_image)))
                break

    candidates.extend(
        [
            f"{fid}_base.png",
            f"{fid}_base.jpg",
            f"{fid}_base.jpeg",
            f"{fid}.png",
            f"{fid}.jpg",
        ]
    )

    seen: set[str] = set()
    for name in candidates:
        if name in seen:
            continue
        seen.add(name)
        full = base_dir / name
        if full.is_file():
            return _validate_path_under_dir(full, base_dir)

    raise FileNotFoundError("Imagem base da face não encontrada.")


def list_preview_faces_public(
    modelo_id: int,
    preview_config: dict[str, Any] | None,
    *,
    api_prefix: str = "/api/papelaria",
) -> list[dict[str, Any]]:
    if not preview_config:
        return []
    faces_out: list[dict[str, Any]] = []
    for face in preview_config.get("faces") or []:
        if not isinstance(face, dict):
            continue
        fid = face.get("id")
        if not fid:
            continue
        try:
            validate_face_id(str(fid))
            resolve_face_base_image_path(
                modelo_id,
                str(fid),
                preview_config=preview_config,
            )
            has_base = True
        except (ValueError, FileNotFoundError):
            has_base = False
        faces_out.append(
            {
                "id": fid,
                "nome": face.get("nome") or fid,
                "baseImage": face.get("baseImage"),
                "hasBaseImage": has_base,
                "url": f"{api_prefix}/modelos/{modelo_id}/preview-base/{fid}",
            }
        )
    return faces_out


def save_preview_base_upload(
    modelo_id: int,
    face_id: str,
    *,
    filename: str,
    content: bytes,
) -> dict[str, str]:
    fid = validate_face_id(face_id)
    safe_name = _sanitize_base_filename(filename)
    if not content:
        raise ValueError("Arquivo vazio.")

    dest_dir = preview_base_dir(modelo_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    stem = f"{fid}_base"
    ext = Path(safe_name).suffix.lower()
    dest_path = dest_dir / f"{stem}{ext}"

    dest_path.write_bytes(content)
    return {"face_id": fid, "filename": dest_path.name}

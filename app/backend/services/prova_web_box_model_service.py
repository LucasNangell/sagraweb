"""
Modelos de caixa compartilhados (tabProvaWebBoxModel) — pré-cadastro Admin.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
from typing import Any, Dict, List, Optional

from database import db
from services.prova_web_box_panel_graph import build_panel_graph_from_parsed
from services.prova_web_dieline_service import parse_dieline_pdf

logger = logging.getLogger(__name__)

_lock = threading.Lock()

_MAX_NOME = 120
_MAX_HINT = 240
_VALID_SIDE = frozenset({"negative", "positive"})
_VALID_TOWARDS = frozenset({"front", "back"})
_MAX_PDF_BYTES = 25 * 1024 * 1024


def ensure_prova_web_box_model_schema() -> None:
    db.execute_query(
        """
        CREATE TABLE IF NOT EXISTS tabProvaWebBoxModel (
            Id INT NOT NULL AUTO_INCREMENT,
            Nome VARCHAR(120) NOT NULL,
            Hint VARCHAR(240) NOT NULL DEFAULT '',
            Ativo TINYINT(1) NOT NULL DEFAULT 1,
            Ordem INT NOT NULL DEFAULT 0,
            ConfigJson LONGTEXT NOT NULL,
            FacaFileName VARCHAR(255) NULL,
            FacaSha256 CHAR(64) NULL,
            FacaPdf LONGBLOB NULL,
            CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            UpdatedByPonto VARCHAR(20) NULL,
            PRIMARY KEY (Id),
            KEY idx_box_model_ativo (Ativo, Ordem, Nome)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )


def _row_to_dict(row: Dict[str, Any], *, include_pdf: bool = False) -> Dict[str, Any]:
    config_raw = row.get("ConfigJson") or "{}"
    if isinstance(config_raw, (bytes, bytearray)):
        config_raw = config_raw.decode("utf-8")
    if isinstance(config_raw, str):
        try:
            config = json.loads(config_raw)
        except json.JSONDecodeError:
            config = {}
    elif isinstance(config_raw, dict):
        config = config_raw
    else:
        config = {}
    out: Dict[str, Any] = {
        "id": int(row["Id"]),
        "nome": str(row.get("Nome") or ""),
        "hint": str(row.get("Hint") or ""),
        "ativo": bool(row.get("Ativo")),
        "ordem": int(row.get("Ordem") or 0),
        "config": config,
        "facaFileName": row.get("FacaFileName"),
        "facaSha256": row.get("FacaSha256"),
        "hasFacaPdf": bool(row.get("FacaPdf") is not None or row.get("FacaSha256")),
        "createdAt": row.get("CreatedAt"),
        "updatedAt": row.get("UpdatedAt"),
        "updatedByPonto": row.get("UpdatedByPonto"),
    }
    if include_pdf and row.get("FacaPdf") is not None:
        blob = row["FacaPdf"]
        if isinstance(blob, memoryview):
            blob = blob.tobytes()
        out["facaPdf"] = bytes(blob)
    return out


def normalize_box_model_config(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("ConfigJson deve ser um objeto.")

    panels_in = raw.get("panels")
    if not isinstance(panels_in, list) or not panels_in:
        raise ValueError("Informe ao menos um painel.")

    panels: List[Dict[str, Any]] = []
    panel_ids: set[str] = set()
    for i, p in enumerate(panels_in):
        if not isinstance(p, dict):
            raise ValueError(f"Painel inválido no índice {i}.")
        pid = str(p.get("id") or f"p{i + 1}").strip()
        if not pid or pid in panel_ids:
            raise ValueError(f"Id de painel duplicado ou vazio: {pid!r}.")
        try:
            x = float(p.get("xMm") if p.get("xMm") is not None else 0)
            y = float(p.get("yMm") if p.get("yMm") is not None else 0)
            w = float(p.get("wMm") if p.get("wMm") is not None else 0)
            h = float(p.get("hMm") if p.get("hMm") is not None else 0)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Painel {pid}: dimensões inválidas.") from exc
        if w < 1 or h < 1:
            raise ValueError(f"Painel {pid}: w/h devem ser ≥ 1 mm.")
        poly = p.get("polygonMm")
        if not isinstance(poly, list) or len(poly) < 3:
            poly = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
        else:
            poly = [
                [float(pt[0]), float(pt[1])]
                for pt in poly
                if isinstance(pt, (list, tuple)) and len(pt) >= 2
            ]
            if len(poly) < 3:
                poly = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
        panel_ids.add(pid)
        # Área preferencialmente do polígono real
        area = 0.0
        npoly = len(poly)
        for i in range(npoly):
            x0p, y0p = poly[i]
            x1p, y1p = poly[(i + 1) % npoly]
            area += x0p * y1p - x1p * y0p
        area = abs(area) * 0.5
        entry: Dict[str, Any] = {
            "id": pid,
            "polygonMm": poly,
            "xMm": round(x, 2),
            "yMm": round(y, 2),
            "wMm": round(w, 2),
            "hMm": round(h, 2),
            "areaMm2": round(area if area > 0 else w * h, 2),
            "role": str(p.get("role") or ""),
            "label": str(p.get("label") or pid),
            "active": bool(p.get("active", True)),
        }
        for uv in ("u0", "v0", "u1", "v1"):
            if p.get(uv) is not None:
                try:
                    entry[uv] = float(p[uv])
                except (TypeError, ValueError):
                    pass
        panels.append(entry)

    hinges: List[Dict[str, Any]] = []
    hinge_ids: set[str] = set()
    for i, h in enumerate(raw.get("hinges") or []):
        if not isinstance(h, dict):
            continue
        hid = str(h.get("id") or f"h{i + 1}").strip()
        if not hid or hid in hinge_ids:
            raise ValueError(f"Id de hinge duplicado ou vazio: {hid!r}.")
        a = str(h.get("panelA") or "").strip()
        b = str(h.get("panelB") or "").strip()
        if a not in panel_ids or b not in panel_ids:
            raise ValueError(f"Hinge {hid}: painéis inexistentes.")
        hinge_ids.add(hid)
        axis = str(h.get("axis") or "vertical")
        position = float(h.get("positionMm") or 0)
        span_start = float(h.get("spanStartMm") or 0)
        span_end = float(h.get("spanEndMm") or 0)
        segment_mm: Optional[List[List[float]]] = None
        raw_seg = h.get("segmentMm")
        if (
            isinstance(raw_seg, list)
            and len(raw_seg) >= 2
            and isinstance(raw_seg[0], (list, tuple))
            and isinstance(raw_seg[1], (list, tuple))
        ):
            try:
                segment_mm = [
                    [float(raw_seg[0][0]), float(raw_seg[0][1])],
                    [float(raw_seg[1][0]), float(raw_seg[1][1])],
                ]
            except (TypeError, ValueError, IndexError):
                segment_mm = None
        if segment_mm is None:
            # Retrocompat: deriva segmento a partir de axis + position + span
            if axis == "vertical":
                segment_mm = [
                    [position, span_start],
                    [position, span_end],
                ]
            elif axis == "horizontal":
                segment_mm = [
                    [span_start, position],
                    [span_end, position],
                ]
            else:
                segment_mm = [
                    [span_start, position],
                    [span_end, position],
                ]
        else:
            # Deriva axis/position/span a partir do segmento real
            x1s, y1s = segment_mm[0]
            x2s, y2s = segment_mm[1]
            dx = abs(x2s - x1s)
            dy = abs(y2s - y1s)
            if dx <= 0.8 and dy > 0.8:
                axis = "vertical"
                position = round((x1s + x2s) / 2.0, 2)
                span_start = round(min(y1s, y2s), 2)
                span_end = round(max(y1s, y2s), 2)
            elif dy <= 0.8 and dx > 0.8:
                axis = "horizontal"
                position = round((y1s + y2s) / 2.0, 2)
                span_start = round(min(x1s, x2s), 2)
                span_end = round(max(x1s, x2s), 2)
            else:
                axis = "oblique"
                if dx >= dy:
                    position = round((y1s + y2s) / 2.0, 2)
                    span_start = round(min(x1s, x2s), 2)
                    span_end = round(max(x1s, x2s), 2)
                else:
                    position = round((x1s + x2s) / 2.0, 2)
                    span_start = round(min(y1s, y2s), 2)
                    span_end = round(max(y1s, y2s), 2)
        entry_h: Dict[str, Any] = {
            "id": hid,
            "panelA": a,
            "panelB": b,
            "axis": axis,
            "positionMm": position,
            "spanStartMm": span_start,
            "spanEndMm": span_end,
            "segmentMm": segment_mm,
            "active": bool(h.get("active", True)),
            "kind": str(h.get("kind") or "fold"),
        }
        if isinstance(h.get("name"), str) and h["name"].strip():
            entry_h["name"] = h["name"].strip()
        hinges.append(entry_h)

    operations: List[Dict[str, Any]] = []
    op_ids: set[str] = set()
    for i, o in enumerate(raw.get("operations") or []):
        if not isinstance(o, dict):
            continue
        oid = str(o.get("id") or f"op{i + 1}").strip()
        if not oid or oid in op_ids:
            raise ValueError(f"Id de operação duplicado: {oid!r}.")
        hinge_id = str(o.get("hingeId") or "").strip()
        if hinge_id and hinge_id not in hinge_ids:
            raise ValueError(f"Operação {oid}: hingeId inexistente.")
        panel_id = str(o.get("panelId") or "").strip()
        if panel_id and panel_id not in panel_ids:
            raise ValueError(f"Operação {oid}: panelId inexistente.")
        side = str(o.get("movingSide") or "positive").strip()
        towards = str(o.get("towards") or "front").strip()
        if side not in _VALID_SIDE:
            side = "positive"
        if towards not in _VALID_TOWARDS:
            towards = "front"
        try:
            order = int(o.get("order") or (i + 1))
            angle = float(
                o.get("targetAngleDeg") if o.get("targetAngleDeg") is not None else 90
            )
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Operação {oid}: order/ângulo inválido.") from exc
        op_ids.add(oid)
        entry = {
            "id": oid,
            "hingeId": hinge_id,
            "panelId": panel_id,
            "order": order,
            "movingSide": side,
            "towards": towards,
            # Ângulo com sinal: negativo/positivo = sentido da dobra
            "targetAngleDeg": max(-180.0, min(180.0, angle)),
        }
        if o.get("phaseId"):
            entry["phaseId"] = str(o["phaseId"])
        operations.append(entry)

    edges: List[Dict[str, Any]] = []
    edge_ids: set[str] = set()
    for i, e in enumerate(raw.get("edges") or []):
        if not isinstance(e, dict):
            continue
        eid = str(e.get("id") or f"e{i + 1}").strip()
        if not eid or eid in edge_ids:
            continue
        kind = str(e.get("kind") or "fold").strip().lower()
        if kind not in ("cut", "fold"):
            kind = "fold"
        try:
            edge = {
                "id": eid,
                "kind": kind,
                "x1": float(e.get("x1") or 0),
                "y1": float(e.get("y1") or 0),
                "x2": float(e.get("x2") or 0),
                "y2": float(e.get("y2") or 0),
                "hingeId": (
                    str(e["hingeId"])
                    if e.get("hingeId") not in (None, "")
                    else None
                ),
                "source": str(e.get("source") or "detected"),
            }
            name = e.get("name")
            if isinstance(name, str) and name.strip():
                edge["name"] = name.strip()
            edges.append(edge)
            edge_ids.add(eid)
        except (TypeError, ValueError):
            continue

    base = raw.get("basePanelId")
    base_id = None if base in (None, "") else str(base)
    if base_id and base_id not in panel_ids:
        raise ValueError("basePanelId inexistente.")

    cut = raw.get("cutBboxMm") if isinstance(raw.get("cutBboxMm"), dict) else {}
    out: Dict[str, Any] = {
        "version": 1,
        "pageWidthMm": float(raw.get("pageWidthMm") or 0),
        "pageHeightMm": float(raw.get("pageHeightMm") or 0),
        "cutBboxMm": cut,
        "panels": panels,
        "hinges": hinges,
        "operations": operations,
        "edges": edges,
        "basePanelId": base_id,
        "verticalCreasesMm": list(raw.get("verticalCreasesMm") or []),
        "horizontalCreasesMm": list(raw.get("horizontalCreasesMm") or []),
        "foldSegmentsMm": list(raw.get("foldSegmentsMm") or []),
        "cutSegmentsMm": list(raw.get("cutSegmentsMm") or []),
    }
    if isinstance(raw.get("dimsHint"), dict):
        out["dimsHint"] = raw["dimsHint"]
    outline = raw.get("netOutlineMm")
    if isinstance(outline, list) and len(outline) >= 3:
        out["netOutlineMm"] = [
            [float(pt[0]), float(pt[1])]
            for pt in outline
            if isinstance(pt, (list, tuple)) and len(pt) >= 2
        ]
    warnings = raw.get("parseWarnings")
    if isinstance(warnings, list) and warnings:
        out["parseWarnings"] = [
            w for w in warnings if isinstance(w, dict) and w.get("code")
        ]
    return out


def parse_faca_to_box_config(
    faca_bytes: bytes,
    *,
    page_index: int = 0,
    filename: Optional[str] = None,
) -> Dict[str, Any]:
    """Parse bytes de SVG (preferido) ou PDF → config de grafo de painéis."""
    if not faca_bytes:
        raise ValueError("Arquivo da faca vazio.")
    if len(faca_bytes) > _MAX_PDF_BYTES:
        raise ValueError("Arquivo da faca excede 25 MB.")

    from services.prova_web_dieline_svg import looks_like_svg, parse_dieline_svg

    if looks_like_svg(faca_bytes, filename):
        parsed = parse_dieline_svg(faca_bytes)
        graph = build_panel_graph_from_parsed(parsed)
        return normalize_box_model_config(graph)

    import os
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(faca_bytes)
        path = tmp.name
    try:
        parsed = parse_dieline_pdf(path, page_index=page_index)
        graph = build_panel_graph_from_parsed(parsed)
        return normalize_box_model_config(graph)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def list_box_models(*, ativo_only: bool = False) -> List[Dict[str, Any]]:
    ensure_prova_web_box_model_schema()
    sql = "SELECT Id, Nome, Hint, Ativo, Ordem, ConfigJson, FacaFileName, FacaSha256, CreatedAt, UpdatedAt, UpdatedByPonto, (FacaPdf IS NOT NULL) AS _has FROM tabProvaWebBoxModel"
    if ativo_only:
        sql += " WHERE Ativo = 1"
    sql += " ORDER BY Ordem ASC, Nome ASC, Id ASC"
    rows = db.execute_query(sql) or []
    out = []
    for r in rows:
        # synthesize hasFacaPdf without blob
        r = dict(r)
        if r.get("_has") is not None:
            r["FacaPdf"] = b"x" if r["_has"] else None
        out.append(_row_to_dict(r))
    return out


def get_box_model(model_id: int, *, include_pdf: bool = False) -> Optional[Dict[str, Any]]:
    ensure_prova_web_box_model_schema()
    cols = (
        "Id, Nome, Hint, Ativo, Ordem, ConfigJson, FacaFileName, FacaSha256, "
        "CreatedAt, UpdatedAt, UpdatedByPonto"
    )
    if include_pdf:
        cols += ", FacaPdf"
    rows = db.execute_query(
        f"SELECT {cols} FROM tabProvaWebBoxModel WHERE Id = %s LIMIT 1",
        (model_id,),
    )
    if not rows:
        return None
    row = dict(rows[0])
    if not include_pdf:
        row["FacaPdf"] = b"x" if row.get("FacaSha256") else None
    return _row_to_dict(row, include_pdf=include_pdf)


def create_box_model(
    *,
    nome: str,
    hint: str = "",
    config: Any,
    ordem: int = 0,
    faca_pdf: Optional[bytes] = None,
    faca_file_name: Optional[str] = None,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_prova_web_box_model_schema()
    name = (nome or "").strip()
    if not name:
        raise ValueError("Informe o nome do modelo.")
    if len(name) > _MAX_NOME:
        raise ValueError(f"Nome com no máximo {_MAX_NOME} caracteres.")
    hint_s = (hint or "").strip()
    if len(hint_s) > _MAX_HINT:
        raise ValueError(f"Dica com no máximo {_MAX_HINT} caracteres.")
    normalized = normalize_box_model_config(config)
    sha = None
    blob = None
    fname = (faca_file_name or "").strip() or None
    if faca_pdf:
        if len(faca_pdf) > _MAX_PDF_BYTES:
            raise ValueError("PDF da faca excede 25 MB.")
        blob = faca_pdf
        sha = hashlib.sha256(faca_pdf).hexdigest()
    insert_params = (
        name,
        hint_s,
        int(ordem),
        json.dumps(normalized, ensure_ascii=False),
        fname,
        sha,
        blob,
        updated_by_ponto,
    )

    def _insert(cursor):
        cursor.execute(
            """
            INSERT INTO tabProvaWebBoxModel
                (Nome, Hint, Ativo, Ordem, ConfigJson, FacaFileName, FacaSha256, FacaPdf, UpdatedByPonto)
            VALUES (%s, %s, 1, %s, %s, %s, %s, %s, %s)
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    # lastrowid na mesma conexão — LAST_INSERT_ID() em outra conexão do pool retorna 0
    with _lock:
        new_id = int(db.execute_transaction([_insert])[0])
    model = get_box_model(new_id)
    if not model:
        raise RuntimeError(f"Falha ao criar modelo de caixa (id={new_id}).")
    return model


def update_box_model(
    model_id: int,
    *,
    nome: Optional[str] = None,
    hint: Optional[str] = None,
    config: Any = None,
    ativo: Optional[bool] = None,
    ordem: Optional[int] = None,
    faca_pdf: Optional[bytes] = None,
    faca_file_name: Optional[str] = None,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_prova_web_box_model_schema()
    existing = get_box_model(model_id, include_pdf=False)
    if not existing:
        raise ValueError("Modelo não encontrado.")

    name = existing["nome"] if nome is None else (nome or "").strip()
    if not name:
        raise ValueError("Informe o nome do modelo.")
    hint_s = existing["hint"] if hint is None else (hint or "").strip()
    ativo_v = existing["ativo"] if ativo is None else bool(ativo)
    ordem_v = existing["ordem"] if ordem is None else int(ordem)
    cfg = existing["config"] if config is None else normalize_box_model_config(config)

    sets = [
        "Nome = %s",
        "Hint = %s",
        "Ativo = %s",
        "Ordem = %s",
        "ConfigJson = %s",
        "UpdatedByPonto = %s",
    ]
    params: list[Any] = [
        name,
        hint_s,
        1 if ativo_v else 0,
        ordem_v,
        json.dumps(cfg, ensure_ascii=False),
        updated_by_ponto,
    ]
    if faca_pdf is not None:
        if len(faca_pdf) > _MAX_PDF_BYTES:
            raise ValueError("PDF da faca excede 25 MB.")
        sets.extend(["FacaPdf = %s", "FacaSha256 = %s", "FacaFileName = %s"])
        params.extend(
            [
                faca_pdf,
                hashlib.sha256(faca_pdf).hexdigest(),
                (faca_file_name or existing.get("facaFileName") or "faca.pdf"),
            ]
        )
    params.append(model_id)
    with _lock:
        db.execute_query(
            f"UPDATE tabProvaWebBoxModel SET {', '.join(sets)} WHERE Id = %s",
            tuple(params),
        )
    model = get_box_model(model_id)
    if not model:
        raise RuntimeError("Falha ao atualizar modelo.")
    return model


def delete_box_model(model_id: int) -> bool:
    ensure_prova_web_box_model_schema()
    with _lock:
        db.execute_query("DELETE FROM tabProvaWebBoxModel WHERE Id = %s", (model_id,))
    return True


def build_box_mockup_from_model_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Manifest boxMockup a partir do grafo do modelo Admin."""
    base_id = cfg.get("basePanelId")
    hinges = list(cfg.get("hinges") or [])

    # Árvore enraizada na base (só hinges) — trocar base não inverte pais errados
    adj: dict[str, list[str]] = {}
    for h in hinges:
        a, b = h.get("panelA"), h.get("panelB")
        if not a or not b or a == b:
            continue
        adj.setdefault(str(a), []).append(str(b))
        adj.setdefault(str(b), []).append(str(a))
    parent_map: dict[str, str] = {}
    if base_id:
        seen = {str(base_id)}
        queue = [str(base_id)]
        while queue:
            cur = queue.pop(0)
            for nb in adj.get(cur, []):
                if nb in seen:
                    continue
                seen.add(nb)
                parent_map[nb] = cur
                queue.append(nb)

    def moving_for_hinge(h: Dict[str, Any]) -> Optional[str]:
        a, b = str(h.get("panelA") or ""), str(h.get("panelB") or "")
        if parent_map.get(a) == b:
            return a
        if parent_map.get(b) == a:
            return b
        if a == base_id:
            return b
        if b == base_id:
            return a
        return b or a or None

    panels = []
    for p in cfg.get("panels") or []:
        if not p.get("active", True):
            continue
        pid = p["id"]
        parent_id = parent_map.get(pid)
        hinge_axis = None
        if parent_id:
            for h in hinges:
                if {h.get("panelA"), h.get("panelB")} == {pid, parent_id}:
                    hinge_axis = "left" if h.get("axis") == "vertical" else "bottom"
                    break
        panels.append(
            {
                "id": pid,
                "role": p.get("role") or "panel",
                "xMm": p["xMm"],
                "yMm": p["yMm"],
                "wMm": p["wMm"],
                "hMm": p["hMm"],
                "parentId": parent_id,
                "hinge": hinge_axis,
                "bodyAngleDeg": 0,
                "flap": pid != base_id,
                "u0": p.get("u0", 0),
                "v0": p.get("v0", 0),
                "u1": p.get("u1", 1),
                "v1": p.get("v1", 1),
                "label": p.get("label") or pid,
                "polygonMm": p.get("polygonMm"),
            }
        )

    hinge_by_id = {h["id"]: h for h in hinges}
    open_ops = []
    for o in cfg.get("operations") or []:
        h = hinge_by_id.get(o.get("hingeId") or "")
        moving = moving_for_hinge(h) if h else o.get("panelId")
        open_ops.append(
            {
                "id": o["id"],
                "panelId": moving,
                "hingeId": o.get("hingeId"),
                "order": o.get("order"),
                "targetAngleDeg": o.get("targetAngleDeg", 90),
                "phaseId": o.get("phaseId"),
                "movingSide": o.get("movingSide"),
                "towards": o.get("towards"),
            }
        )

    cut = cfg.get("cutBboxMm") or {}
    return {
        "template": "graph",
        "source": "box_model",
        "dimsMm": {
            "length": float(cut.get("widthMm") or cfg.get("pageWidthMm") or 100),
            "width": float(cut.get("heightMm") or cfg.get("pageHeightMm") or 100),
            "height": float(
                ((cfg.get("dimsHint") or {}).get("heightMm"))
                if isinstance(cfg.get("dimsHint"), dict)
                else 40
            ),
            "glue": 20,
        },
        "netWidthMm": float(cut.get("widthMm") or 100),
        "netHeightMm": float(cut.get("heightMm") or 100),
        "panels": panels,
        "hinges": hinges,
        "openOperations": open_ops,
        "basePanelId": base_id,
        "cutBboxMm": cut,
        "ready": True,
        "paperThicknessMm": 0.4,
    }



def bake_art_transform_onto_net(
    arte_png_path: str,
    out_png_path: str,
    *,
    net_width_mm: float,
    net_height_mm: float,
    art_transform: Optional[Dict[str, Any]] = None,
    px_per_mm: float = 4.0,
) -> Dict[str, Any]:
    """
    Compõe a arte sobre um canvas do tamanho da net (bbox da faca),
    aplicando tx/ty (mm), scale e rotationDeg relativos ao centro da net.
    """
    from PIL import Image

    tw = max(8, int(round(float(net_width_mm) * float(px_per_mm))))
    th = max(8, int(round(float(net_height_mm) * float(px_per_mm))))
    canvas = Image.new("RGBA", (tw, th), (255, 255, 255, 0))

    art = Image.open(arte_png_path).convert("RGBA")
    tf = art_transform if isinstance(art_transform, dict) else {}
    try:
        scale = max(0.1, min(5.0, float(tf.get("scale") or 1.0)))
    except (TypeError, ValueError):
        scale = 1.0
    try:
        rot = float(tf.get("rotationDeg") or 0.0)
    except (TypeError, ValueError):
        rot = 0.0
    try:
        tx_mm = float(tf.get("txMm") or 0.0)
        ty_mm = float(tf.get("tyMm") or 0.0)
    except (TypeError, ValueError):
        tx_mm, ty_mm = 0.0, 0.0

    # Escala a arte para caber na net (contain) e depois aplica scale do overlay
    aw, ah = art.size
    fit = min(tw / max(1, aw), th / max(1, ah))
    nw = max(1, int(round(aw * fit * scale)))
    nh = max(1, int(round(ah * fit * scale)))
    layer = art.resize((nw, nh), Image.Resampling.LANCZOS)
    if abs(rot) > 0.01:
        layer = layer.rotate(-rot, expand=True, resample=Image.Resampling.BICUBIC)

    lw, lh = layer.size
    cx = tw // 2 + int(round(tx_mm * px_per_mm))
    cy = th // 2 + int(round(ty_mm * px_per_mm))
    x0 = cx - lw // 2
    y0 = cy - lh // 2
    # Paste parcial se a arte extrapolar a net
    src_x0 = max(0, -x0)
    src_y0 = max(0, -y0)
    dst_x0 = max(0, x0)
    dst_y0 = max(0, y0)
    src_x1 = min(lw, tw - x0)
    src_y1 = min(lh, th - y0)
    if src_x1 > src_x0 and src_y1 > src_y0:
        crop = layer.crop((src_x0, src_y0, src_x1, src_y1))
        canvas.alpha_composite(crop, (dst_x0, dst_y0))
    # Fundo branco sob texto/arte (textura Three costuma sem alpha útil)
    bg = Image.new("RGB", (tw, th), (255, 255, 255))
    bg.paste(canvas, mask=canvas.split()[-1])
    bg.save(out_png_path, format="PNG")
    return {"width": tw, "height": th, "widthPt": 0, "heightPt": 0}

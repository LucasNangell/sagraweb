"""
Modelos de dobra compartilhados (tabProvaWebFoldModel).

Geometria portátil: creases em fração da área útil + operations.
Builtins de código não entram nesta tabela.
"""
from __future__ import annotations

import json
import logging
import threading
from typing import Any, Dict, List, Optional

from database import db

logger = logging.getLogger(__name__)

_lock = threading.Lock()

_VALID_AXIS = frozenset({"vertical", "horizontal"})
_VALID_SIDE = frozenset({"negative", "positive"})
_VALID_TOWARDS = frozenset({"front", "back"})
_MIN_FRAC = 0.02
_MAX_FRAC = 0.98
_MAX_CREASES = 12
_MAX_NOME = 120
_MAX_HINT = 240


def ensure_prova_web_fold_model_schema() -> None:
    db.execute_query(
        """
        CREATE TABLE IF NOT EXISTS tabProvaWebFoldModel (
            Id INT NOT NULL AUTO_INCREMENT,
            Nome VARCHAR(120) NOT NULL,
            Hint VARCHAR(240) NOT NULL DEFAULT '',
            Ativo TINYINT(1) NOT NULL DEFAULT 1,
            Ordem INT NOT NULL DEFAULT 0,
            ConfigJson LONGTEXT NOT NULL,
            CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            UpdatedByPonto VARCHAR(20) NULL,
            PRIMARY KEY (Id),
            KEY idx_fold_model_ativo (Ativo, Ordem, Nome)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )


def _row_to_dict(row: Dict[str, Any]) -> Dict[str, Any]:
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
    return {
        "id": int(row["Id"]),
        "nome": str(row.get("Nome") or ""),
        "hint": str(row.get("Hint") or ""),
        "ativo": bool(row.get("Ativo")),
        "ordem": int(row.get("Ordem") or 0),
        "config": config,
        "createdAt": row.get("CreatedAt"),
        "updatedAt": row.get("UpdatedAt"),
        "updatedByPonto": row.get("UpdatedByPonto"),
    }


def normalize_fold_model_config(raw: Any) -> Dict[str, Any]:
    """Valida e normaliza o JSON portátil do modelo."""
    if not isinstance(raw, dict):
        raise ValueError("ConfigJson deve ser um objeto.")

    creases_in = raw.get("creases")
    ops_in = raw.get("operations")
    if not isinstance(creases_in, list) or not creases_in:
        raise ValueError("Informe ao menos um vinco.")
    if len(creases_in) > _MAX_CREASES:
        raise ValueError(f"Máximo de {_MAX_CREASES} vincos.")
    if not isinstance(ops_in, list) or not ops_in:
        raise ValueError("Informe ao menos uma operação de dobra.")

    creases: List[Dict[str, Any]] = []
    crease_ids: set[str] = set()
    for i, c in enumerate(creases_in):
        if not isinstance(c, dict):
            raise ValueError(f"Vinco inválido no índice {i}.")
        cid = str(c.get("id") or f"c{i + 1}").strip()
        if not cid or cid in crease_ids:
            raise ValueError(f"Id de vinco duplicado ou vazio: {cid!r}.")
        axis = str(c.get("axis") or "").strip()
        if axis not in _VALID_AXIS:
            raise ValueError(f"Eixo inválido no vinco {cid}.")
        if "positionFrac" in c and c.get("positionFrac") is not None:
            frac = float(c["positionFrac"])
        else:
            # Compat: mm + referência → fração
            ref_w = float(raw.get("refWidthMm") or 0)
            ref_h = float(raw.get("refHeightMm") or 0)
            pos = float(c.get("positionMm") or 0)
            span = ref_w if axis == "vertical" else ref_h
            if span <= 0:
                raise ValueError(
                    f"Vinco {cid}: informe positionFrac ou positionMm com refWidth/Height."
                )
            frac = pos / span
        if not (_MIN_FRAC <= frac <= _MAX_FRAC):
            raise ValueError(
                f"Vinco {cid}: positionFrac deve estar entre {_MIN_FRAC} e {_MAX_FRAC}."
            )
        crease_ids.add(cid)
        creases.append(
            {
                "id": cid,
                "axis": axis,
                "positionFrac": round(frac, 6),
            }
        )

    operations: List[Dict[str, Any]] = []
    op_ids: set[str] = set()
    for i, o in enumerate(ops_in):
        if not isinstance(o, dict):
            raise ValueError(f"Operação inválida no índice {i}.")
        oid = str(o.get("id") or f"o{i + 1}").strip()
        if not oid or oid in op_ids:
            raise ValueError(f"Id de operação duplicado ou vazio: {oid!r}.")
        crease_id = str(o.get("creaseId") or "").strip()
        if crease_id not in crease_ids:
            raise ValueError(f"Operação {oid}: creaseId inexistente ({crease_id}).")
        side = str(o.get("movingSide") or "").strip()
        towards = str(o.get("towards") or "").strip()
        if side not in _VALID_SIDE:
            raise ValueError(f"Operação {oid}: movingSide inválido.")
        if towards not in _VALID_TOWARDS:
            raise ValueError(f"Operação {oid}: towards inválido.")
        try:
            order = int(o.get("order") or (i + 1))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Operação {oid}: order inválido.") from exc
        try:
            angle = float(o.get("targetAngleDeg") if o.get("targetAngleDeg") is not None else 180)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Operação {oid}: targetAngleDeg inválido.") from exc
        angle = max(1.0, min(180.0, angle))
        op_ids.add(oid)
        entry: Dict[str, Any] = {
            "id": oid,
            "creaseId": crease_id,
            "order": order,
            "movingSide": side,
            "towards": towards,
            "targetAngleDeg": angle,
        }
        phase = o.get("phaseId")
        if phase:
            entry["phaseId"] = str(phase)
        try:
            stagger_raw = o.get("startAfterPrevOpen01")
            if stagger_raw is not None:
                stagger = float(stagger_raw)
                stagger = max(0.0, min(1.0, stagger))
                if abs(stagger - 1.0) > 1e-6:
                    entry["startAfterPrevOpen01"] = round(stagger, 6)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Operação {oid}: startAfterPrevOpen01 inválido."
            ) from exc
        operations.append(entry)

    out: Dict[str, Any] = {
        "version": 1,
        "creases": creases,
        "operations": operations,
    }

    if "pageFrente" in raw and raw.get("pageFrente") is not None:
        try:
            out["pageFrente"] = max(0, int(raw["pageFrente"]))
        except (TypeError, ValueError) as exc:
            raise ValueError("pageFrente inválido.") from exc
    if "pageVerso" in raw:
        if raw.get("pageVerso") is None:
            out["pageVerso"] = None
        else:
            try:
                out["pageVerso"] = max(0, int(raw["pageVerso"]))
            except (TypeError, ValueError) as exc:
                raise ValueError("pageVerso inválido.") from exc

    if "basePanelId" in raw:
        bp = raw.get("basePanelId")
        out["basePanelId"] = None if bp in (None, "") else str(bp)

    physical = raw.get("physical")
    if isinstance(physical, dict) and physical:
        cleaned: Dict[str, float] = {}
        for key in ("paperThicknessMm", "renderGapMm", "creaseRadiusMm"):
            if key in physical and physical[key] is not None:
                try:
                    cleaned[key] = float(physical[key])
                except (TypeError, ValueError):
                    continue
        if cleaned:
            out["physical"] = cleaned

    back = raw.get("backArtworkTransform")
    if isinstance(back, dict):
        out["backArtworkTransform"] = {
            "mirrorX": bool(back.get("mirrorX", True)),
            "mirrorY": bool(back.get("mirrorY")),
            "rotationDeg": int(back.get("rotationDeg") or 0) % 360,
        }

    return out


def list_fold_models(*, ativo_only: bool = False) -> List[Dict[str, Any]]:
    ensure_prova_web_fold_model_schema()
    sql = """
        SELECT * FROM tabProvaWebFoldModel
    """
    params: tuple = ()
    if ativo_only:
        sql += " WHERE Ativo = 1"
    sql += " ORDER BY Ordem ASC, Nome ASC, Id ASC"
    rows = db.execute_query(sql, params) or []
    return [_row_to_dict(r) for r in rows]


def get_fold_model(model_id: int) -> Optional[Dict[str, Any]]:
    ensure_prova_web_fold_model_schema()
    rows = db.execute_query(
        "SELECT * FROM tabProvaWebFoldModel WHERE Id = %s LIMIT 1",
        (model_id,),
    )
    if not rows:
        return None
    return _row_to_dict(rows[0])


def create_fold_model(
    *,
    nome: str,
    hint: str = "",
    config: Any,
    ordem: int = 0,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_prova_web_fold_model_schema()
    name = (nome or "").strip()
    if not name:
        raise ValueError("Informe o nome do modelo.")
    if len(name) > _MAX_NOME:
        raise ValueError(f"Nome com no máximo {_MAX_NOME} caracteres.")
    hint_s = (hint or "").strip()
    if len(hint_s) > _MAX_HINT:
        raise ValueError(f"Dica com no máximo {_MAX_HINT} caracteres.")
    normalized = normalize_fold_model_config(config)
    with _lock:
        db.execute_query(
            """
            INSERT INTO tabProvaWebFoldModel
                (Nome, Hint, Ativo, Ordem, ConfigJson, UpdatedByPonto)
            VALUES (%s, %s, 1, %s, %s, %s)
            """,
            (
                name,
                hint_s,
                int(ordem),
                json.dumps(normalized, ensure_ascii=False),
                updated_by_ponto,
            ),
        )
        rows = db.execute_query("SELECT MAX(Id) AS mid FROM tabProvaWebFoldModel")
        new_id = int(rows[0]["mid"])
    model = get_fold_model(new_id)
    assert model is not None
    return model


def update_fold_model(
    model_id: int,
    *,
    nome: Optional[str] = None,
    hint: Optional[str] = None,
    config: Any = None,
    ativo: Optional[bool] = None,
    ordem: Optional[int] = None,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_prova_web_fold_model_schema()
    current = get_fold_model(model_id)
    if current is None:
        raise LookupError("Modelo não encontrado.")

    name = current["nome"] if nome is None else (nome or "").strip()
    if not name:
        raise ValueError("Informe o nome do modelo.")
    if len(name) > _MAX_NOME:
        raise ValueError(f"Nome com no máximo {_MAX_NOME} caracteres.")

    hint_s = current["hint"] if hint is None else (hint or "").strip()
    if len(hint_s) > _MAX_HINT:
        raise ValueError(f"Dica com no máximo {_MAX_HINT} caracteres.")

    if config is None:
        normalized = normalize_fold_model_config(current["config"])
    else:
        normalized = normalize_fold_model_config(config)

    ativo_val = current["ativo"] if ativo is None else bool(ativo)
    ordem_val = current["ordem"] if ordem is None else int(ordem)

    db.execute_query(
        """
        UPDATE tabProvaWebFoldModel SET
            Nome = %s,
            Hint = %s,
            Ativo = %s,
            Ordem = %s,
            ConfigJson = %s,
            UpdatedByPonto = %s
        WHERE Id = %s
        """,
        (
            name,
            hint_s,
            1 if ativo_val else 0,
            ordem_val,
            json.dumps(normalized, ensure_ascii=False),
            updated_by_ponto,
            model_id,
        ),
    )
    model = get_fold_model(model_id)
    assert model is not None
    return model


def delete_fold_model(model_id: int) -> bool:
    ensure_prova_web_fold_model_schema()
    current = get_fold_model(model_id)
    if current is None:
        return False
    db.execute_query("DELETE FROM tabProvaWebFoldModel WHERE Id = %s", (model_id,))
    return True

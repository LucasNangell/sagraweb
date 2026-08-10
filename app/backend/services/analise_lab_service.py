"""
Registro e marcas do Análise Lab (tabAnaliseLabSessao / tabAnaliseLabMarca).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Optional

from database import db
from services.prova_web_render_service import (
    LAB_PASTA_RENDER,
    MODE_CAPA_MIOLO,
    MODE_UNICO,
    resolve_os_relative_pdf,
)

logger = logging.getLogger(__name__)

RENDER_PENDING = "pending"
RENDER_RUNNING = "running"
RENDER_READY = "ready"
RENDER_ERROR = "error"
RENDER_CANCELLED = "cancelled"

RENDER_STATUSES = frozenset(
    {
        RENDER_PENDING,
        RENDER_RUNNING,
        RENDER_READY,
        RENDER_ERROR,
        RENDER_CANCELLED,
    }
)
RENDER_IN_FLIGHT = frozenset({RENDER_PENDING, RENDER_RUNNING})

MARK_TYPES = frozenset(
    {
        "offset_corte",
        "faixa",
        "retangulo",
        "ponto",
        "medida",
        "grade",
    }
)
MARK_COLORS = frozenset(
    {"red", "orange", "yellow", "green", "blue", "purple", "black", "white"}
)
MARK_EDGES = frozenset({"top", "right", "bottom", "left"})

_SELECT_SESSAO = """
    ID, NroProtocolo, AnoProtocolo, VersaoLabel, Modo,
    ArquivoUnico, ArquivoCapa, ArquivoMiolo, CropJson, PastaRender,
    RenderStatus, RenderError, RenderProgress,
    RenderStartedAt, RenderFinishedAt, PontoRegistro,
    DataRegistro, DataAtualizacao
"""


def _parse_json_object(raw: Any) -> Optional[dict[str, Any]]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None
    return None


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value) if value else None


def _normalize_render_status(raw: Any) -> str:
    value = (str(raw).strip().lower() if raw is not None else "") or RENDER_PENDING
    return value if value in RENDER_STATUSES else RENDER_PENDING


def is_render_ready(session: Optional[dict[str, Any]]) -> bool:
    return bool(session) and _normalize_render_status(session.get("renderStatus")) == RENDER_READY


def is_render_in_flight(session: Optional[dict[str, Any]]) -> bool:
    return bool(session) and _normalize_render_status(session.get("renderStatus")) in RENDER_IN_FLIGHT


def _row_to_session(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row.get("ID") or 0),
        "nroProtocolo": int(row.get("NroProtocolo") or 0),
        "anoProtocolo": int(row.get("AnoProtocolo") or 0),
        "versaoLabel": (row.get("VersaoLabel") or "").strip(),
        "modo": (row.get("Modo") or MODE_UNICO).strip(),
        "arquivoUnico": (row.get("ArquivoUnico") or "").strip() or None,
        "arquivoCapa": (row.get("ArquivoCapa") or "").strip() or None,
        "arquivoMiolo": (row.get("ArquivoMiolo") or "").strip() or None,
        "cropJson": _parse_json_object(row.get("CropJson")),
        "pastaRender": (row.get("PastaRender") or LAB_PASTA_RENDER).strip()
        or LAB_PASTA_RENDER,
        "renderStatus": _normalize_render_status(row.get("RenderStatus")),
        "renderError": (row.get("RenderError") or "").strip() or None,
        "renderProgress": _parse_json_object(row.get("RenderProgress")),
        "renderStartedAt": _iso(row.get("RenderStartedAt")),
        "renderFinishedAt": _iso(row.get("RenderFinishedAt")),
        "pontoRegistro": row.get("PontoRegistro"),
        "dataRegistro": _iso(row.get("DataRegistro")),
        "dataAtualizacao": _iso(row.get("DataAtualizacao")),
    }


def get_session(ano: int, os_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_SESSAO}
        FROM tabAnaliseLabSessao
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
        LIMIT 1
        """,
        {"nro": os_id, "ano": ano},
    )
    if not rows:
        return None
    return _row_to_session(rows[0])


def get_session_by_id(sessao_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_SESSAO}
        FROM tabAnaliseLabSessao
        WHERE ID = %(id)s
        LIMIT 1
        """,
        {"id": int(sessao_id)},
    )
    if not rows:
        return None
    return _row_to_session(rows[0])


def upsert_session(
    ano: int,
    os_id: int,
    *,
    versao_label: str,
    modo: str,
    arquivo_unico: Optional[str],
    arquivo_capa: Optional[str],
    arquivo_miolo: Optional[str],
    crop_json: Optional[dict[str, Any]],
    ponto: Optional[int],
) -> dict[str, Any]:
    crop_payload = (
        json.dumps(crop_json, ensure_ascii=False) if crop_json is not None else None
    )
    existing = get_session(ano, os_id)
    if existing:
        db.execute_query(
            """
            UPDATE tabAnaliseLabSessao
            SET VersaoLabel = %s, Modo = %s,
                ArquivoUnico = %s, ArquivoCapa = %s, ArquivoMiolo = %s,
                CropJson = %s, PastaRender = %s,
                RenderStatus = %s, RenderError = NULL, RenderProgress = NULL,
                RenderStartedAt = NULL, RenderFinishedAt = NULL,
                PontoRegistro = %s
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
            """,
            (
                versao_label,
                modo,
                arquivo_unico,
                arquivo_capa,
                arquivo_miolo,
                crop_payload,
                LAB_PASTA_RENDER,
                RENDER_PENDING,
                ponto,
                os_id,
                ano,
            ),
        )
    else:
        db.execute_query(
            """
            INSERT INTO tabAnaliseLabSessao
                (NroProtocolo, AnoProtocolo, VersaoLabel, Modo,
                 ArquivoUnico, ArquivoCapa, ArquivoMiolo, CropJson,
                 PastaRender, RenderStatus, PontoRegistro)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                os_id,
                ano,
                versao_label,
                modo,
                arquivo_unico,
                arquivo_capa,
                arquivo_miolo,
                crop_payload,
                LAB_PASTA_RENDER,
                RENDER_PENDING,
                ponto,
            ),
        )
    record = get_session(ano, os_id)
    if not record:
        raise RuntimeError("Falha ao gravar sessão do Análise Lab.")
    return record


def delete_session(ano: int, os_id: int) -> bool:
    existing = get_session(ano, os_id)
    if not existing:
        return False
    db.execute_query(
        """
        DELETE FROM tabAnaliseLabSessao
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
        """,
        {"nro": os_id, "ano": ano},
    )
    return True


def mark_render_pending(ano: int, os_id: int) -> None:
    db.execute_query(
        """
        UPDATE tabAnaliseLabSessao
        SET RenderStatus = %(status)s,
            RenderError = NULL,
            RenderProgress = NULL,
            RenderStartedAt = NULL,
            RenderFinishedAt = NULL
        WHERE NroProtocolo = %(nro)s AND AnoProtocolo = %(ano)s
        """,
        {"status": RENDER_PENDING, "nro": os_id, "ano": ano},
    )


def claim_render(ano: int, os_id: int) -> bool:
    claimed = {"ok": False}

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tabAnaliseLabSessao
            SET RenderStatus = %s,
                RenderError = NULL,
                RenderStartedAt = NOW(),
                RenderFinishedAt = NULL
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND RenderStatus = %s
            """,
            (RENDER_RUNNING, os_id, ano, RENDER_PENDING),
        )
        claimed["ok"] = int(cursor.rowcount or 0) == 1

    db.execute_transaction([_op])
    return bool(claimed["ok"])


def finalize_render(
    ano: int,
    os_id: int,
    *,
    render_status: str,
    render_error: Optional[str] = None,
    clear_error: bool = False,
    clear_progress: bool = False,
) -> bool:
    if render_status not in (RENDER_READY, RENDER_ERROR, RENDER_CANCELLED):
        raise ValueError(f"Status final inválido: {render_status}")
    applied = {"ok": False}
    error_value = None if clear_error else render_error
    if error_value is not None:
        error_value = str(error_value).strip()[:512] or None

    def _op(cursor) -> None:
        sets = [
            "RenderStatus = %s",
            "RenderError = %s",
            "RenderFinishedAt = NOW()",
        ]
        params: list[Any] = [render_status, error_value]
        if clear_progress:
            sets.append("RenderProgress = NULL")
        cursor.execute(
            f"""
            UPDATE tabAnaliseLabSessao
            SET {", ".join(sets)}
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND RenderStatus = %s
            """,
            (*params, os_id, ano, RENDER_RUNNING),
        )
        applied["ok"] = int(cursor.rowcount or 0) == 1

    db.execute_transaction([_op])
    return bool(applied["ok"])


def update_render_progress(ano: int, os_id: int, *, done: int, total: int) -> bool:
    applied = {"ok": False}
    payload = json.dumps(
        {"done": max(0, int(done)), "total": max(0, int(total))},
        ensure_ascii=False,
    )

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tabAnaliseLabSessao
            SET RenderProgress = %s
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND RenderStatus = %s
            """,
            (payload, os_id, ano, RENDER_RUNNING),
        )
        applied["ok"] = int(cursor.rowcount or 0) == 1

    db.execute_transaction([_op])
    return bool(applied["ok"])


def list_pending_or_running_jobs() -> list[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_SESSAO}
        FROM tabAnaliseLabSessao
        WHERE RenderStatus IN (%s, %s)
        ORDER BY DataAtualizacao ASC
        """,
        (RENDER_PENDING, RENDER_RUNNING),
    )
    return [_row_to_session(r) for r in (rows or [])]


def resolve_session_sources(
    ano: int, os_id: int, session: dict[str, Any]
) -> tuple[str, list[str]]:
    from routers.os_routes import _get_os_folder_path

    folder = _get_os_folder_path(ano, os_id)
    if not folder or not os.path.isdir(folder):
        raise FileNotFoundError("Pasta da OS não encontrada na rede.")
    modo = session.get("modo") or MODE_UNICO
    if modo == MODE_CAPA_MIOLO:
        capa = resolve_os_relative_pdf(folder, session.get("arquivoCapa") or "")
        miolo = resolve_os_relative_pdf(folder, session.get("arquivoMiolo") or "")
        return MODE_CAPA_MIOLO, [capa, miolo]
    unico = resolve_os_relative_pdf(folder, session.get("arquivoUnico") or "")
    return MODE_UNICO, [unico]


def _row_to_mark(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row.get("ID") or 0),
        "sessaoId": int(row.get("SessaoID") or 0),
        "pagina": int(row.get("Pagina") or 0),
        "tipo": (row.get("Tipo") or "").strip(),
        "geometria": _parse_json_object(row.get("GeometriaJson")) or {},
        "rotulo": (row.get("Rotulo") or "").strip() or None,
        "cor": (row.get("Cor") or "red").strip() or "red",
        "pontoRegistro": row.get("PontoRegistro"),
        "dataRegistro": _iso(row.get("DataRegistro")),
        "dataAtualizacao": _iso(row.get("DataAtualizacao")),
    }


def list_marks(sessao_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT ID, SessaoID, Pagina, Tipo, GeometriaJson, Rotulo, Cor,
               PontoRegistro, DataRegistro, DataAtualizacao
        FROM tabAnaliseLabMarca
        WHERE SessaoID = %(sid)s
        ORDER BY ID ASC
        """,
        {"sid": int(sessao_id)},
    )
    return [_row_to_mark(r) for r in (rows or [])]


def get_mark(mark_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT ID, SessaoID, Pagina, Tipo, GeometriaJson, Rotulo, Cor,
               PontoRegistro, DataRegistro, DataAtualizacao
        FROM tabAnaliseLabMarca
        WHERE ID = %(id)s
        LIMIT 1
        """,
        {"id": int(mark_id)},
    )
    if not rows:
        return None
    return _row_to_mark(rows[0])


def _validate_geometry(tipo: str, geom: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(geom, dict):
        raise ValueError("Geometria inválida.")
    if tipo == "offset_corte":
        edge = str(geom.get("edge") or "").strip().lower()
        if edge not in MARK_EDGES:
            raise ValueError("Borda inválida.")
        offset = float(geom.get("offsetMm") or 0)
        if offset < 0 or offset > 500:
            raise ValueError("offsetMm fora do intervalo permitido.")
        return {"edge": edge, "offsetMm": round(offset, 3)}
    if tipo == "faixa":
        edge = str(geom.get("edge") or "").strip().lower()
        if edge not in MARK_EDGES:
            raise ValueError("Borda inválida.")
        from_mm = float(geom.get("fromMm") or 0)
        to_mm = float(geom.get("toMm") or 0)
        if from_mm < 0 or to_mm < 0 or to_mm <= from_mm or to_mm > 500:
            raise ValueError("Faixa inválida.")
        return {"edge": edge, "fromMm": round(from_mm, 3), "toMm": round(to_mm, 3)}
    if tipo == "retangulo":
        x = float(geom.get("xMm") or 0)
        y = float(geom.get("yMm") or 0)
        w = float(geom.get("wMm") or 0)
        h = float(geom.get("hMm") or 0)
        if w <= 0 or h <= 0 or x < 0 or y < 0 or x > 2000 or y > 2000:
            raise ValueError("Retângulo inválido.")
        return {
            "xMm": round(x, 3),
            "yMm": round(y, 3),
            "wMm": round(w, 3),
            "hMm": round(h, 3),
        }
    if tipo == "ponto":
        x = float(geom.get("xMm") or 0)
        y = float(geom.get("yMm") or 0)
        if x < 0 or y < 0 or x > 2000 or y > 2000:
            raise ValueError("Ponto inválido.")
        return {"xMm": round(x, 3), "yMm": round(y, 3)}
    if tipo == "medida":
        x1 = float(geom.get("x1Mm") or 0)
        y1 = float(geom.get("y1Mm") or 0)
        x2 = float(geom.get("x2Mm") or 0)
        y2 = float(geom.get("y2Mm") or 0)
        for v in (x1, y1, x2, y2):
            if v < 0 or v > 2000:
                raise ValueError("Medida inválida.")
        return {
            "x1Mm": round(x1, 3),
            "y1Mm": round(y1, 3),
            "x2Mm": round(x2, 3),
            "y2Mm": round(y2, 3),
        }
    if tipo == "grade":
        step = float(geom.get("stepMm") or 0)
        if step < 1 or step > 50:
            raise ValueError("stepMm deve estar entre 1 e 50.")
        return {"stepMm": round(step, 3)}
    raise ValueError(f"Tipo de marca inválido: {tipo}")


def add_mark(
    sessao_id: int,
    *,
    pagina: int,
    tipo: str,
    geometria: dict[str, Any],
    rotulo: Optional[str],
    cor: str,
    ponto: Optional[int],
) -> dict[str, Any]:
    tipo_n = (tipo or "").strip().lower()
    if tipo_n not in MARK_TYPES:
        raise ValueError(f"Tipo de marca inválido: {tipo}")
    cor_n = (cor or "red").strip().lower()
    if cor_n not in MARK_COLORS:
        raise ValueError("Cor inválida.")
    if int(pagina) < 0:
        raise ValueError("Página inválida.")
    geom = _validate_geometry(tipo_n, geometria)
    rotulo_n = (rotulo or "").strip()[:120] or None
    db.execute_query(
        """
        INSERT INTO tabAnaliseLabMarca
            (SessaoID, Pagina, Tipo, GeometriaJson, Rotulo, Cor, PontoRegistro)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            int(sessao_id),
            int(pagina),
            tipo_n,
            json.dumps(geom, ensure_ascii=False),
            rotulo_n,
            cor_n,
            ponto,
        ),
    )
    rows = db.execute_query(
        """
        SELECT ID, SessaoID, Pagina, Tipo, GeometriaJson, Rotulo, Cor,
               PontoRegistro, DataRegistro, DataAtualizacao
        FROM tabAnaliseLabMarca
        WHERE SessaoID = %(sid)s
        ORDER BY ID DESC
        LIMIT 1
        """,
        {"sid": int(sessao_id)},
    )
    if not rows:
        raise RuntimeError("Falha ao gravar marca.")
    return _row_to_mark(rows[0])


def update_mark(
    mark_id: int,
    *,
    pagina: Optional[int] = None,
    geometria: Optional[dict[str, Any]] = None,
    rotulo: Optional[str] = None,
    cor: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    current = get_mark(mark_id)
    if not current:
        return None
    pagina_n = int(pagina) if pagina is not None else int(current["pagina"])
    if pagina_n < 0:
        raise ValueError("Página inválida.")
    cor_n = (cor or current["cor"] or "red").strip().lower()
    if cor_n not in MARK_COLORS:
        raise ValueError("Cor inválida.")
    geom = (
        _validate_geometry(current["tipo"], geometria)
        if geometria is not None
        else current["geometria"]
    )
    rotulo_n = (
        (rotulo.strip()[:120] if isinstance(rotulo, str) else None)
        if rotulo is not None
        else current.get("rotulo")
    )
    db.execute_query(
        """
        UPDATE tabAnaliseLabMarca
        SET Pagina = %s, GeometriaJson = %s, Rotulo = %s, Cor = %s
        WHERE ID = %s
        """,
        (
            pagina_n,
            json.dumps(geom, ensure_ascii=False),
            rotulo_n,
            cor_n,
            int(mark_id),
        ),
    )
    return get_mark(mark_id)


def delete_mark(mark_id: int) -> bool:
    before = get_mark(mark_id)
    if not before:
        return False
    db.execute_query(
        "DELETE FROM tabAnaliseLabMarca WHERE ID = %(id)s",
        {"id": int(mark_id)},
    )
    return True


def clear_marks(sessao_id: int) -> None:
    db.execute_query(
        "DELETE FROM tabAnaliseLabMarca WHERE SessaoID = %(sid)s",
        {"sid": int(sessao_id)},
    )

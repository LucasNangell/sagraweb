"""
Registro e marcas do Análise Lab (tabAnaliseLabSessao / tabAnaliseLabMarca).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Iterable, Optional

from database import db
from services.prova_web_render_service import (
    LAB_PASTA_RENDER,
    MODE_CAPA_MIOLO,
    MODE_UNICO,
    resolve_os_relative_pdf,
)

logger = logging.getLogger(__name__)

_MAX_PAGES_SPEC = 400

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
        "sangria",
        "retangulo",
        "ponto",
        "medida",
        "grade",
        "seta",
        "circulo",
        "texto",
        "livre",
    }
)
MARK_COLORS = frozenset(
    {"red", "orange", "yellow", "green", "blue", "purple", "black", "white"}
)
MARK_EDGES = frozenset({"top", "right", "bottom", "left", "all"})
MARK_EDGES_SANGRIA = frozenset({"top", "right", "bottom", "left", "all"})

_SELECT_SESSAO = """
    ID, NroProtocolo, AnoProtocolo, VersaoLabel, Modo,
    ArquivoUnico, ArquivoCapa, ArquivoMiolo, CropJson, PastaRender,
    RenderStatus, RenderError, RenderProgress,
    RenderStartedAt, RenderFinishedAt, CropVersao, PontoRegistro,
    DataRegistro, DataAtualizacao
"""

_SELECT_MARCA = """
    ID, SessaoID, Pagina, Paginas, Tipo, GeometriaJson, Rotulo, Cor,
    Espelhar, PaginaOrigem, CropVersao, ItemID,
    PontoRegistro, DataRegistro, DataAtualizacao
"""


def parse_page_spec(spec: str) -> list[int]:
    """Expande '1-15,20,23,25-30' em lista ordenada sem duplicatas."""
    raw = (spec or "").strip()
    if not raw:
        raise ValueError("Informe as páginas (ex.: 1-15,20,23).")
    pages: set[int] = set()
    for token in raw.split(","):
        part = token.strip()
        if not part:
            continue
        if "-" in part:
            ends = part.split("-", 1)
            if len(ends) != 2 or not ends[0].strip() or not ends[1].strip():
                raise ValueError(f"Intervalo inválido: {part}")
            try:
                start = int(ends[0].strip())
                end = int(ends[1].strip())
            except ValueError as exc:
                raise ValueError(f"Intervalo inválido: {part}") from exc
            if start < 1 or end < 1:
                raise ValueError("Páginas devem ser >= 1.")
            if start > end:
                raise ValueError(f"Intervalo inválido: {part}")
            for n in range(start, end + 1):
                pages.add(n)
        else:
            try:
                n = int(part)
            except ValueError as exc:
                raise ValueError(f"Página inválida: {part}") from exc
            if n < 1:
                raise ValueError("Páginas devem ser >= 1.")
            pages.add(n)
    if not pages:
        raise ValueError("Informe as páginas (ex.: 1-15,20,23).")
    if len(pages) > _MAX_PAGES_SPEC:
        raise ValueError(f"Máximo de {_MAX_PAGES_SPEC} páginas por marca.")
    return sorted(pages)


def format_page_spec(pages: Iterable[int]) -> str:
    """Compacta páginas ordenadas em '1-15,20,23,25-30'."""
    ordered = sorted({int(p) for p in pages if int(p) >= 1})
    if not ordered:
        return ""
    runs: list[tuple[int, int]] = []
    start = prev = ordered[0]
    for n in ordered[1:]:
        if n == prev + 1:
            prev = n
            continue
        runs.append((start, prev))
        start = prev = n
    runs.append((start, prev))
    parts: list[str] = []
    for a, b in runs:
        parts.append(str(a) if a == b else f"{a}-{b}")
    return ",".join(parts)


def _normalize_paginas(
    *,
    pagina: int,
    paginas: Optional[str],
) -> tuple[int, Optional[str]]:
    """
    Retorna (pagina_indice, paginas_canonicas).
    - Spec preenchida: Pagina = primeira página; Paginas = forma canônica.
    - Spec vazia: Paginas = None; Pagina = 0 (todas) ou página única.
    """
    raw = (paginas or "").strip() if paginas is not None else ""
    if raw:
        pages = parse_page_spec(raw)
        return pages[0], format_page_spec(pages)
    if int(pagina) < 0:
        raise ValueError("Página inválida.")
    return int(pagina), None


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
        "cropVersao": int(row.get("CropVersao") or 1),
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


def _canonicalize_crop_json(crop_json: Optional[dict[str, Any]]) -> Optional[str]:
    if crop_json is None:
        return None
    return json.dumps(crop_json, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


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
        prev_canon = _canonicalize_crop_json(existing.get("cropJson"))
        next_canon = _canonicalize_crop_json(crop_json)
        crop_changed = prev_canon != next_canon
        next_crop_versao = int(existing.get("cropVersao") or 1) + (
            1 if crop_changed else 0
        )
        db.execute_query(
            """
            UPDATE tabAnaliseLabSessao
            SET VersaoLabel = %s, Modo = %s,
                ArquivoUnico = %s, ArquivoCapa = %s, ArquivoMiolo = %s,
                CropJson = %s, PastaRender = %s,
                RenderStatus = %s, RenderError = NULL, RenderProgress = NULL,
                RenderStartedAt = NULL, RenderFinishedAt = NULL,
                CropVersao = %s, PontoRegistro = %s
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
                next_crop_versao,
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
                 PastaRender, RenderStatus, CropVersao, PontoRegistro)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                1,
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
    paginas_raw = (row.get("Paginas") or "").strip() or None
    item_raw = row.get("ItemID")
    return {
        "id": int(row.get("ID") or 0),
        "sessaoId": int(row.get("SessaoID") or 0),
        "pagina": int(row.get("Pagina") or 0),
        "paginas": paginas_raw,
        "tipo": (row.get("Tipo") or "").strip(),
        "geometria": _parse_json_object(row.get("GeometriaJson")) or {},
        "rotulo": (row.get("Rotulo") or "").strip() or None,
        "cor": (row.get("Cor") or "red").strip() or "red",
        "espelhar": bool(int(row.get("Espelhar") or 0)),
        "paginaOrigem": int(row.get("PaginaOrigem") or 0),
        "cropVersao": int(row.get("CropVersao") or 1),
        "itemId": int(item_raw) if item_raw is not None else None,
        "pontoRegistro": row.get("PontoRegistro"),
        "dataRegistro": _iso(row.get("DataRegistro")),
        "dataAtualizacao": _iso(row.get("DataAtualizacao")),
    }


def _clamp_espessura(geom: dict[str, Any]) -> int:
    try:
        esp = int(geom.get("espessura") or 2)
    except (TypeError, ValueError):
        esp = 2
    if esp < 1 or esp > 3:
        raise ValueError("espessura deve estar entre 1 e 3.")
    return esp


def list_marks(sessao_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_MARCA}
        FROM tabAnaliseLabMarca
        WHERE SessaoID = %(sid)s
        ORDER BY ID ASC
        """,
        {"sid": int(sessao_id)},
    )
    return [_row_to_mark(r) for r in (rows or [])]


def get_mark(mark_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_MARCA}
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
    if tipo == "sangria":
        edge = str(geom.get("edge") or "").strip().lower()
        if edge not in MARK_EDGES_SANGRIA:
            raise ValueError("Borda inválida.")
        from_mm = float(geom.get("fromMm") or 0)
        to_mm = float(geom.get("toMm") if geom.get("toMm") is not None else 0)
        along_from = float(geom.get("alongFromMm") or 0)
        along_to = float(geom.get("alongToMm") or 0)
        # Somente fora do papel: fromMm ∈ [-50, 0), toMm = 0.
        if from_mm < -50 or from_mm >= 0:
            raise ValueError("Sangria inválida (profundidade).")
        if abs(to_mm) > 1e-9:
            raise ValueError("Sangria inválida (toMm deve ser 0).")
        if edge == "all":
            # Moldura completa: o trecho é a página inteira em cada borda.
            return {
                "edge": edge,
                "fromMm": round(from_mm, 3),
                "toMm": 0.0,
                "alongFromMm": 0.0,
                "alongToMm": 0.0,
            }
        if along_to <= along_from:
            raise ValueError("Sangria inválida (trecho).")
        for v in (along_from, along_to):
            if v < -50 or v > 550:
                raise ValueError("Sangria inválida (trecho fora do intervalo).")
        return {
            "edge": edge,
            "fromMm": round(from_mm, 3),
            "toMm": 0.0,
            "alongFromMm": round(along_from, 3),
            "alongToMm": round(along_to, 3),
        }
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
    if tipo == "seta":
        x1 = float(geom.get("x1Mm") or 0)
        y1 = float(geom.get("y1Mm") or 0)
        x2 = float(geom.get("x2Mm") or 0)
        y2 = float(geom.get("y2Mm") or 0)
        for v in (x1, y1, x2, y2):
            if v < 0 or v > 2000:
                raise ValueError("Seta inválida.")
        return {
            "x1Mm": round(x1, 3),
            "y1Mm": round(y1, 3),
            "x2Mm": round(x2, 3),
            "y2Mm": round(y2, 3),
            "espessura": _clamp_espessura(geom),
        }
    if tipo == "circulo":
        x = float(geom.get("xMm") or 0)
        y = float(geom.get("yMm") or 0)
        w = float(geom.get("wMm") or 0)
        h = float(geom.get("hMm") or 0)
        if w <= 0 or h <= 0 or x < 0 or y < 0 or x > 2000 or y > 2000:
            raise ValueError("Círculo inválido.")
        return {
            "xMm": round(x, 3),
            "yMm": round(y, 3),
            "wMm": round(w, 3),
            "hMm": round(h, 3),
            "espessura": _clamp_espessura(geom),
        }
    if tipo == "texto":
        x = float(geom.get("xMm") or 0)
        y = float(geom.get("yMm") or 0)
        texto = str(geom.get("texto") or "").strip()
        if x < 0 or y < 0 or x > 2000 or y > 2000:
            raise ValueError("Texto inválido.")
        if not texto or len(texto) > 500:
            raise ValueError("texto deve ter entre 1 e 500 caracteres.")
        try:
            tamanho = float(geom.get("tamanhoPt") or 12)
        except (TypeError, ValueError) as exc:
            raise ValueError("tamanhoPt inválido.") from exc
        if tamanho < 6 or tamanho > 96:
            raise ValueError("tamanhoPt deve estar entre 6 e 96.")
        return {
            "xMm": round(x, 3),
            "yMm": round(y, 3),
            "texto": texto,
            "tamanhoPt": round(tamanho, 1),
        }
    if tipo == "livre":
        raw_points = geom.get("points")
        if not isinstance(raw_points, list) or len(raw_points) < 2:
            raise ValueError("Traço livre precisa de ao menos 2 pontos.")
        if len(raw_points) > 2000:
            raise ValueError("Traço livre limitado a 2000 pontos.")
        points: list[list[float]] = []
        for pt in raw_points:
            if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                raise ValueError("Ponto inválido no traço livre.")
            x = float(pt[0])
            y = float(pt[1])
            if x < 0 or y < 0 or x > 2000 or y > 2000:
                raise ValueError("Ponto inválido no traço livre.")
            points.append([round(x, 3), round(y, 3)])
        return {"points": points, "espessura": _clamp_espessura(geom)}
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
    espelhar: bool = False,
    pagina_origem: int = 0,
    paginas: Optional[str] = None,
    item_id: Optional[int] = None,
) -> dict[str, Any]:
    tipo_n = (tipo or "").strip().lower()
    if tipo_n not in MARK_TYPES:
        raise ValueError(f"Tipo de marca inválido: {tipo}")
    cor_n = (cor or "red").strip().lower()
    if cor_n not in MARK_COLORS:
        raise ValueError("Cor inválida.")
    if int(pagina_origem) < 0:
        raise ValueError("Página de origem inválida.")
    pagina_n, paginas_n = _normalize_paginas(pagina=pagina, paginas=paginas)
    geom = _validate_geometry(tipo_n, geometria)
    rotulo_n = (rotulo or "").strip()[:120] or None
    item_n = int(item_id) if item_id is not None else None
    if item_n is not None and item_n < 1:
        raise ValueError("ItemID inválido.")
    session = get_session_by_id(sessao_id)
    crop_versao = int((session or {}).get("cropVersao") or 1)
    db.execute_query(
        """
        INSERT INTO tabAnaliseLabMarca
            (SessaoID, Pagina, Paginas, Tipo, GeometriaJson, Rotulo, Cor,
             Espelhar, PaginaOrigem, CropVersao, ItemID, PontoRegistro)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            int(sessao_id),
            int(pagina_n),
            paginas_n,
            tipo_n,
            json.dumps(geom, ensure_ascii=False),
            rotulo_n,
            cor_n,
            1 if espelhar else 0,
            int(pagina_origem),
            crop_versao,
            item_n,
            ponto,
        ),
    )
    rows = db.execute_query(
        f"""
        SELECT {_SELECT_MARCA}
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
    espelhar: Optional[bool] = None,
    pagina_origem: Optional[int] = None,
    paginas: Optional[str] = None,
    item_id: Optional[int] = None,
    clear_item: bool = False,
) -> Optional[dict[str, Any]]:
    current = get_mark(mark_id)
    if not current:
        return None

    if paginas is not None:
        # Cliente enviou o campo (mesmo vazio = todas/pág. única via pagina)
        pagina_base = int(pagina) if pagina is not None else 0
        if str(paginas).strip():
            pagina_n, paginas_n = _normalize_paginas(
                pagina=pagina_base, paginas=paginas
            )
        else:
            if pagina_base < 0:
                raise ValueError("Página inválida.")
            pagina_n, paginas_n = pagina_base, None
    elif pagina is not None:
        pagina_n, paginas_n = _normalize_paginas(pagina=int(pagina), paginas=None)
    else:
        pagina_n = int(current["pagina"])
        paginas_n = current.get("paginas")

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
    espelhar_n = (
        bool(espelhar) if espelhar is not None else bool(current.get("espelhar"))
    )
    origem_n = (
        int(pagina_origem)
        if pagina_origem is not None
        else int(current.get("paginaOrigem") or 0)
    )
    if origem_n < 0:
        raise ValueError("Página de origem inválida.")
    if clear_item:
        item_n = None
    elif item_id is not None:
        item_n = int(item_id)
        if item_n < 1:
            raise ValueError("ItemID inválido.")
    else:
        item_n = current.get("itemId")
    db.execute_query(
        """
        UPDATE tabAnaliseLabMarca
        SET Pagina = %s, Paginas = %s, GeometriaJson = %s, Rotulo = %s, Cor = %s,
            Espelhar = %s, PaginaOrigem = %s, ItemID = %s
        WHERE ID = %s
        """,
        (
            pagina_n,
            paginas_n,
            json.dumps(geom, ensure_ascii=False),
            rotulo_n,
            cor_n,
            1 if espelhar_n else 0,
            origem_n,
            item_n,
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

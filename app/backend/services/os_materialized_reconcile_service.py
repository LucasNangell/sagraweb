"""
Reconciliação incremental tabAndamento ↔ tab_os_ultimo_andamento_operacional.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from database import db
from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE
from services.andamento_table import get_andamento_table
from services.os_andamento_post_change_service import (
    after_andamento_changed,
    emit_force_refresh_home,
)
from services.os_ultimo_andamento_service import TABLE, fetch_operacional_row

logger = logging.getLogger(__name__)

_FINISHED = ("Entregue", "Cancelada", "Cancelado")
_FINISHED_SQL = ", ".join(f"'{s}'" for s in _FINISHED)

# Alias da query: tabAndamento AS a (mesmo que MIRROR_EXCLUDE_CLAUSE espera).
_MIRROR_GAP = MIRROR_EXCLUDE_CLAUSE

# tabAndamento = utf8mb4_general_ci (legado); materializada = utf8mb4_unicode_ci
_TEXT_COMPARE_COLLATE = "utf8mb4_unicode_ci"


def _text_neq_sql(materialized_expr: str, andamento_expr: str) -> str:
    """Comparação segura entre colunas de collations diferentes."""
    c = _TEXT_COMPARE_COLLATE
    return (
        f"{materialized_expr} COLLATE {c} != {andamento_expr} COLLATE {c}"
    )


def _materialized_stale_predicate() -> str:
    return " OR ".join(
        [
            _text_neq_sql("m.situacao", "a.SituacaoLink"),
            _text_neq_sql("m.setor", "a.SetorLink"),
            _text_neq_sql("m.cod_status", "a.CodStatus"),
        ]
    )


def reconcile_config() -> Dict[str, Any]:
    def _env_bool(key: str, default: bool) -> bool:
        raw = os.environ.get(key, "").strip().lower()
        if not raw:
            return default
        return raw in ("1", "true", "yes")

    def _env_int(key: str, default: int) -> int:
        try:
            return int(os.environ.get(key, str(default)))
        except (TypeError, ValueError):
            return default

    def _env_bool_any(keys: tuple[str, ...], default: bool) -> bool:
        for key in keys:
            raw = os.environ.get(key, "").strip().lower()
            if raw:
                return raw in ("1", "true", "yes")
        return default

    def _env_int_any(keys: tuple[str, ...], default: int) -> int:
        for key in keys:
            raw = os.environ.get(key, "").strip()
            if raw:
                try:
                    return int(raw)
                except (TypeError, ValueError):
                    pass
        return default

    cfg = {
        "enabled": _env_bool_any(
            ("SAGRA_HOME_SOURCE_RECONCILE_ENABLED", "SAGRA_OS_MATERIALIZED_RECONCILE_ENABLED"),
            True,
        ),
        "interval_seconds": max(
            30,
            _env_int_any(
                (
                    "SAGRA_HOME_SOURCE_RECONCILE_INTERVAL_SECONDS",
                    "SAGRA_OS_MATERIALIZED_RECONCILE_INTERVAL_SECONDS",
                ),
                60,
            ),
        ),
        "lookback_minutes": max(
            5,
            _env_int_any(
                (
                    "SAGRA_HOME_SOURCE_RECONCILE_LOOKBACK_MINUTES",
                    "SAGRA_OS_MATERIALIZED_RECONCILE_LOOKBACK_MINUTES",
                ),
                30,
            ),
        ),
        "max_rows": max(
            1,
            min(
                5000,
                _env_int_any(
                    (
                        "SAGRA_HOME_SOURCE_RECONCILE_MAX_ROWS",
                        "SAGRA_OS_MATERIALIZED_RECONCILE_MAX_ROWS",
                    ),
                    500,
                ),
            ),
        ),
        "ws_individual_threshold": 20,
    }
    try:
        cfg["andamento_table"] = get_andamento_table()
    except Exception:
        cfg["andamento_table"] = "tabAndamento"
    return cfg


def find_materialized_gaps(
    *,
    lookback_minutes: Optional[int] = None,
    max_rows: Optional[int] = None,
    setor: Optional[str] = None,
    nro: Optional[int] = None,
    ano: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """OSs com UltimoStatus=1 em tabAndamento sem linha ou com divergência na materializada."""
    cfg = reconcile_config()
    lookback = lookback_minutes if lookback_minutes is not None else cfg["lookback_minutes"]
    limit = max_rows if max_rows is not None else cfg["max_rows"]

    extra = ""
    params: List[Any] = []
    if nro is not None and ano is not None:
        extra += " AND a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s"
        params.extend([nro, ano])
    elif setor:
        extra += " AND a.SetorLink = %s"
        params.append(setor.strip())

    if nro is None and ano is None:
        extra += " AND a.`Data` >= DATE_SUB(NOW(), INTERVAL %s MINUTE)"
        params.append(lookback)

    stale_pred = _materialized_stale_predicate()
    andamento_tbl = get_andamento_table()
    sql = f"""
    SELECT
        a.NroProtocoloLink AS nro,
        a.AnoProtocoloLink AS ano,
        a.CodStatus AS cod_status,
        a.SituacaoLink AS situacao,
        a.SetorLink AS setor,
        m.situacao AS mat_situacao,
        m.setor AS mat_setor,
        m.cod_status AS mat_cod_status,
        CASE
            WHEN m.nro_protocolo IS NULL THEN 'missing'
            WHEN {stale_pred} THEN 'stale'
            ELSE 'ok'
        END AS gap_kind
    FROM {andamento_tbl} AS a
    LEFT JOIN {TABLE} AS m
        ON m.nro_protocolo = a.NroProtocoloLink
       AND m.ano_protocolo = a.AnoProtocoloLink
    WHERE a.UltimoStatus = 1
      AND {_MIRROR_GAP}
      AND a.SituacaoLink NOT IN ({_FINISHED_SQL})
      AND a.CodStatus IS NOT NULL
      {extra}
      AND (
          m.nro_protocolo IS NULL
          OR ({stale_pred})
      )
    ORDER BY a.`Data` DESC, a.CodStatus DESC
    LIMIT %s
    """
    params.append(limit)
    return db.execute_query(sql, tuple(params)) or []


def reconcile_os(
    nro: int,
    ano: int,
    *,
    source: str = "reconcile",
    notify: bool = True,
) -> Dict[str, Any]:
    """Corrige uma OS e opcionalmente notifica via WebSocket."""
    live = fetch_operacional_row(nro, ano)
    result = after_andamento_changed(
        nro,
        ano,
        "materialized_refresh",
        source=source,
        notify=notify,
        setor=(live or {}).get("setor"),
        situacao=(live or {}).get("situacao"),
    )
    result["reconciled"] = "error" not in result
    return result


def reconcile_gaps(
    gaps: List[Dict[str, Any]],
    *,
    source: str = "reconcile_batch",
) -> Dict[str, Any]:
    """Corrige lista de gaps; emite WS individual ou force_refresh consolidado."""
    cfg = reconcile_config()
    fixed: List[Tuple[int, int]] = []
    errors: List[Dict[str, Any]] = []
    seen: set[Tuple[int, int]] = set()

    for row in gaps:
        nro = int(row["nro"])
        ano = int(row["ano"])
        key = (nro, ano)
        if key in seen:
            continue
        seen.add(key)
        out = reconcile_os(nro, ano, source=source, notify=False)
        if out.get("error"):
            errors.append({"nro": nro, "ano": ano, "error": out["error"]})
        else:
            fixed.append(key)

    notified = 0
    if fixed:
        if len(fixed) <= cfg["ws_individual_threshold"]:
            for nro, ano in fixed:
                live = fetch_operacional_row(nro, ano)
                after_andamento_changed(
                    nro,
                    ano,
                    "materialized_refresh",
                    source=source,
                    notify=True,
                    setor=(live or {}).get("setor"),
                    situacao=(live or {}).get("situacao"),
                )
                notified += 1
        else:
            emit_force_refresh_home(reason=source, count=len(fixed))
            notified = 1

    return {
        "candidates": len(gaps),
        "fixed": len(fixed),
        "errors": errors,
        "ws_events": notified,
        "pairs": [{"nro": n, "ano": a} for n, a in fixed],
    }


def run_reconcile_cycle(
    *,
    lookback_minutes: Optional[int] = None,
    max_rows: Optional[int] = None,
    setor: Optional[str] = None,
) -> Dict[str, Any]:
    """Um ciclo incremental idempotente."""
    t0 = time.perf_counter()
    gaps = find_materialized_gaps(
        lookback_minutes=lookback_minutes,
        max_rows=max_rows,
        setor=setor,
    )
    if not gaps:
        return {
            "candidates": 0,
            "fixed": 0,
            "elapsed_seconds": round(time.perf_counter() - t0, 3),
        }

    result = reconcile_gaps(gaps, source="reconcile_scheduler")
    result["elapsed_seconds"] = round(time.perf_counter() - t0, 3)
    if result["fixed"]:
        logger.info(
            "[OS MATERIALIZED RECONCILE] fixed=%s candidates=%s elapsed=%.2fs",
            result["fixed"],
            result["candidates"],
            result["elapsed_seconds"],
        )
    return result


def diagnostics(*, setor: Optional[str] = None, sample: int = 20) -> Dict[str, Any]:
    from services.os_ultimo_andamento_service import audit_materialized_table

    gaps = find_materialized_gaps(
        lookback_minutes=reconcile_config()["lookback_minutes"] * 4,
        max_rows=sample,
        setor=setor,
    )
    return {
        "audit": audit_materialized_table(),
        "reconcile_config": reconcile_config(),
        "recent_gaps_sample": gaps,
        "recent_gap_count": len(gaps),
    }

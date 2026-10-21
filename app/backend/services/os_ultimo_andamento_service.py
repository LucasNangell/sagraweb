"""
Último andamento operacional materializado — fonte de situação/setor em GET /os/search.
Alinhado a tabAndamento: UltimoStatus=1, excluindo espelhos Sub OS (MIRROR_EXCLUDE_CLAUSE).
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Tuple

from database import db
from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE
from services.andamento_table import get_andamento_table

logger = logging.getLogger(__name__)

TABLE = "tab_os_ultimo_andamento_operacional"


def _select_operacional_sql() -> str:
    tbl = get_andamento_table()
    return f"""
SELECT
    a.CodStatus AS cod_status,
    a.SituacaoLink AS situacao,
    a.SetorLink AS setor,
    a.`Data` AS `data`,
    a.`Observaçao` AS observacao,
    a.Ponto AS ponto,
    a.UltimoStatus AS ultimo_status
FROM {tbl} AS a
WHERE a.NroProtocoloLink = %(nro)s AND a.AnoProtocoloLink = %(ano)s
  AND a.UltimoStatus = 1
  AND {MIRROR_EXCLUDE_CLAUSE.strip()}
ORDER BY a.`Data` DESC, a.CodStatus DESC
LIMIT 1
"""

_UPSERT_SQL = f"""
INSERT INTO {TABLE} (
    nro_protocolo, ano_protocolo, cod_status, situacao, setor,
    `data`, observacao, ponto, ultimo_status, atualizado_em
) VALUES (
    %(nro_protocolo)s, %(ano_protocolo)s, %(cod_status)s, %(situacao)s, %(setor)s,
    %(data)s, %(observacao)s, %(ponto)s, %(ultimo_status)s, NOW()
)
ON DUPLICATE KEY UPDATE
    cod_status = VALUES(cod_status),
    situacao = VALUES(situacao),
    setor = VALUES(setor),
    `data` = VALUES(`data`),
    observacao = VALUES(observacao),
    ponto = VALUES(ponto),
    ultimo_status = VALUES(ultimo_status),
    atualizado_em = NOW()
"""

_DELETE_SQL = f"""
DELETE FROM {TABLE} WHERE nro_protocolo = %s AND ano_protocolo = %s
"""


def fetch_materialized_operacional_row(
    nro: int, ano: int, *, cursor=None
) -> Optional[Dict[str, Any]]:
    """Estado atual na tabela materializada (antes de um refresh)."""
    if not nro or not ano:
        return None
    sql = f"""
        SELECT situacao, setor, cod_status
        FROM {TABLE}
        WHERE nro_protocolo = %s AND ano_protocolo = %s
        LIMIT 1
    """
    if cursor is not None:
        cursor.execute(sql, (nro, ano))
        row = cursor.fetchone()
        return dict(row) if row else None
    rows = db.execute_query(sql, (nro, ano))
    return rows[0] if rows else None


def fetch_operacional_row(nro: int, ano: int, *, cursor=None) -> Optional[Dict[str, Any]]:
    """Calcula último andamento operacional de uma OS (sem gravar)."""
    params = {"nro": nro, "ano": ano}
    sql = _select_operacional_sql()
    if cursor is not None:
        cursor.execute(sql, params)
        row = cursor.fetchone()
        return dict(row) if row else None
    rows = db.execute_query(sql, params)
    return rows[0] if rows else None


def fetch_operacional_rows_batch(
    pairs: List[Tuple[int, int]],
    *,
    cursor=None,
    include_user: bool = False,
) -> Dict[Tuple[int, int], Dict[str, Any]]:
    """
    Último andamento operacional live para várias OSs — mesma regra do painel PCP.
    Uma query indexada por lote (pós-paginação da home).
    """
    if not pairs:
        return {}

    seen: set[Tuple[int, int]] = set()
    unique: List[Tuple[int, int]] = []
    for nro, ano in pairs:
        if not nro or not ano:
            continue
        key = (int(nro), int(ano))
        if key in seen:
            continue
        seen.add(key)
        unique.append(key)

    if not unique:
        return {}

    tbl = get_andamento_table()
    placeholders = ", ".join(["(%s, %s)"] * len(unique))
    flat: List[Any] = []
    for nro, ano in unique:
        flat.extend([nro, ano])

    user_select = ", u.Nome AS andamento_usuario" if include_user else ""
    user_join = """
    LEFT JOIN tabUsuarios u
        ON u.Ponto = CAST(REPLACE(REPLACE(COALESCE(a.Ponto, ''), '.', ''), '-', '') AS UNSIGNED)
    """ if include_user else ""
    sql = f"""
    SELECT
        a.NroProtocoloLink AS nro_protocolo,
        a.AnoProtocoloLink AS ano_protocolo,
        a.CodStatus AS cod_status,
        a.SituacaoLink AS situacao,
        a.SetorLink AS setor,
        a.`Data` AS `data`,
        a.`Observaçao` AS observacao,
        a.Ponto AS ponto
        {user_select}
    FROM {tbl} AS a
    {user_join}
    WHERE (a.NroProtocoloLink, a.AnoProtocoloLink) IN ({placeholders})
      AND a.UltimoStatus = 1
      AND {MIRROR_EXCLUDE_CLAUSE.strip()}
    ORDER BY a.NroProtocoloLink, a.AnoProtocoloLink, a.`Data` DESC, a.CodStatus DESC
    """

    if cursor is not None:
        cursor.execute(sql, tuple(flat))
        rows = cursor.fetchall() or []
        raw_rows = [dict(r) for r in rows]
    else:
        raw_rows = db.execute_query(sql, tuple(flat)) or []

    result: Dict[Tuple[int, int], Dict[str, Any]] = {}
    for row in raw_rows:
        key = (int(row["nro_protocolo"]), int(row["ano_protocolo"]))
        if key not in result:
            result[key] = row
    return result


def refresh_os_ultimo_andamento_operacional(
    nro: int,
    ano: int,
    *,
    cursor=None,
) -> None:
    """Recalcula e upsert/delete na tabela materializada para uma OS."""
    if not nro or not ano:
        return

    row = fetch_operacional_row(nro, ano, cursor=cursor)

    if row is None:
        if cursor is not None:
            cursor.execute(_DELETE_SQL, (nro, ano))
        else:
            db.execute_query(_DELETE_SQL, (nro, ano))
        return

    payload = {
        "nro_protocolo": nro,
        "ano_protocolo": ano,
        "cod_status": row.get("cod_status"),
        "situacao": row.get("situacao"),
        "setor": row.get("setor"),
        "data": row.get("data"),
        "observacao": row.get("observacao"),
        "ponto": row.get("ponto"),
        "ultimo_status": int(row.get("ultimo_status") or 0),
    }
    if cursor is not None:
        cursor.execute(_UPSERT_SQL, payload)
    else:
        db.execute_query(_UPSERT_SQL, payload)


def materialized_table_populated() -> bool:
    """True se a tabela materializada tem ao menos uma linha."""
    try:
        rows = db.execute_query(f"SELECT 1 AS ok FROM {TABLE} LIMIT 1")
        return bool(rows)
    except Exception:
        return False


def count_materialized_rows() -> int:
    rows = db.execute_query(f"SELECT COUNT(*) AS cnt FROM {TABLE}")
    return int(rows[0]["cnt"]) if rows else 0


def backfill_os_ultimo_andamento_operacional(
    *,
    batch_size: int = 500,
    log_every: int = 5000,
) -> Dict[str, Any]:
    """
    Backfill completo a partir de tabProtocolos + tabAndamento.
    Usa INSERT…SELECT com window function (aceitável offline).
    """
    from os_ultimo_andamento_schema import ensure_os_ultimo_andamento_schema

    ensure_os_ultimo_andamento_schema()
    t0 = time.perf_counter()

    mirror_exclude = MIRROR_EXCLUDE_CLAUSE.replace("a.CodStatus", "a2.CodStatus")
    andamento_tbl = get_andamento_table()

    db.execute_query(f"TRUNCATE TABLE {TABLE}")

    insert_sql = f"""
    INSERT INTO {TABLE} (
        nro_protocolo, ano_protocolo, cod_status, situacao, setor,
        `data`, observacao, ponto, ultimo_status, atualizado_em
    )
    SELECT
        ranked.NroProtocoloLink,
        ranked.AnoProtocoloLink,
        ranked.CodStatus,
        ranked.SituacaoLink,
        ranked.SetorLink,
        ranked.`Data`,
        ranked.`Observaçao`,
        ranked.Ponto,
        ranked.UltimoStatus,
        NOW()
    FROM (
        SELECT
            a2.NroProtocoloLink,
            a2.AnoProtocoloLink,
            a2.CodStatus,
            a2.SituacaoLink,
            a2.SetorLink,
            a2.`Data`,
            a2.`Observaçao`,
            a2.Ponto,
            a2.UltimoStatus,
            ROW_NUMBER() OVER (
                PARTITION BY a2.NroProtocoloLink, a2.AnoProtocoloLink
                ORDER BY a2.`Data` DESC, a2.CodStatus DESC
            ) AS _rn
        FROM {andamento_tbl} AS a2
        WHERE a2.UltimoStatus = 1
          AND {mirror_exclude.strip()}
    ) AS ranked
    WHERE ranked._rn = 1
    """
    db.execute_query(insert_sql)

    total = count_materialized_rows()
    elapsed = time.perf_counter() - t0
    logger.info(
        "Backfill %s: %s OSs em %.2fs",
        TABLE,
        total,
        elapsed,
    )
    return {"rows": total, "elapsed_seconds": round(elapsed, 3)}


def rebuild_os_ultimo_andamento_operacional() -> Dict[str, Any]:
    """Alias idempotente para backfill completo."""
    return backfill_os_ultimo_andamento_operacional()


def audit_materialized_table() -> Dict[str, Any]:
    """Auditoria somente leitura da tabela materializada vs tabProtocolos."""
    from os_ultimo_andamento_schema import ensure_os_ultimo_andamento_schema

    ensure_os_ultimo_andamento_schema()
    result: Dict[str, Any] = {"table": TABLE}

    try:
        mat_count = count_materialized_rows()
        proto_rows = db.execute_query("SELECT COUNT(*) AS cnt FROM tabProtocolos")
        proto_count = int(proto_rows[0]["cnt"]) if proto_rows else 0
        gap_rows = db.execute_query(
            f"""
            SELECT COUNT(*) AS cnt
            FROM tabProtocolos p
            LEFT JOIN {TABLE} m
              ON m.nro_protocolo = p.NroProtocolo AND m.ano_protocolo = p.AnoProtocolo
            WHERE m.nro_protocolo IS NULL
            """
        )
        gap_count = int(gap_rows[0]["cnt"]) if gap_rows else 0
        index_rows = db.execute_query(
            f"""
            SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = '{TABLE}'
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
            """
        )
        result.update(
            {
                "materialized_rows": mat_count,
                "protocolos_rows": proto_count,
                "protocolos_sem_materializada": gap_count,
                "populated": mat_count > 0,
                "indexes": index_rows or [],
            }
        )
    except Exception as exc:
        result["error"] = str(exc)
    return result


def sample_divergences_vs_live(
    *,
    sample_size: int = 50,
    ano: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Compara amostra da materializada com cálculo live (fetch_operacional_row).
    Somente leitura.
    """
    params: List[Any] = []
    ano_filter = ""
    if ano is not None:
        ano_filter = "WHERE ano_protocolo = %s"
        params.append(ano)

    rows = db.execute_query(
        f"""
        SELECT nro_protocolo, ano_protocolo, situacao, setor, cod_status
        FROM {TABLE}
        {ano_filter}
        ORDER BY atualizado_em DESC
        LIMIT %s
        """,
        tuple([*params, sample_size]),
    )
    divergences: List[Dict[str, Any]] = []
    checked = 0
    for row in rows or []:
        nro = int(row["nro_protocolo"])
        year = int(row["ano_protocolo"])
        live = fetch_operacional_row(nro, year)
        checked += 1
        if live is None:
            divergences.append(
                {"nro": nro, "ano": year, "issue": "materialized_exists_live_missing"}
            )
            continue
        for field, live_key in (("situacao", "situacao"), ("setor", "setor"), ("cod_status", "cod_status")):
            mat_val = (row.get(field) or "").strip() if row.get(field) else row.get(field)
            live_val = (live.get(live_key) or "").strip() if live.get(live_key) else live.get(live_key)
            if mat_val != live_val:
                divergences.append(
                    {
                        "nro": nro,
                        "ano": year,
                        "field": field,
                        "materialized": mat_val,
                        "live": live_val,
                    }
                )
    return {
        "checked": checked,
        "divergences": divergences,
        "divergence_count": len(divergences),
    }

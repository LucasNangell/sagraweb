"""Opções leves para dropdowns de filtros da lista de OSs."""
from __future__ import annotations

import logging
import time
import unicodedata
from typing import Any, Dict, List, Optional

from database import db

logger = logging.getLogger(__name__)

TABLE_PRODUCTS = "tab_os_filter_produtos"
TABLE_REQUESTERS = "tab_os_filter_solicitantes"

DEFAULT_LIMIT = 30
MAX_LIMIT = 50
MAX_CATEGORIAS = 20

_years_cache: tuple[float, List[int]] | None = None
_YEARS_CACHE_TTL_SEC = 15 * 60


def normalize_label(value: str) -> str:
    collapsed = " ".join((value or "").strip().split())
    if not collapsed:
        return ""
    decomposed = unicodedata.normalize("NFD", collapsed.casefold())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def _clean_filter_values(values: Optional[List[str]]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for raw in values or []:
        item = (raw or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _escape_sql_like(term: str) -> str:
    return (
        term.replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


def _like_contains(term: str) -> str:
    return f"%{_escape_sql_like(term)}%"


def fetch_distinct_years() -> List[int]:
    global _years_cache
    now = time.time()
    if _years_cache and now - _years_cache[0] < _YEARS_CACHE_TTL_SEC:
        return list(_years_cache[1])

    rows = db.execute_query(
        """
        SELECT DISTINCT AnoProtocolo AS ano
        FROM tabProtocolos
        WHERE AnoProtocolo IS NOT NULL
        ORDER BY AnoProtocolo DESC
        """
    )
    years = [int(r["ano"]) for r in (rows or []) if r.get("ano") is not None]
    _years_cache = (now, years)
    return years


def invalidate_years_cache() -> None:
    global _years_cache
    _years_cache = None


def _table_has_rows(table: str) -> bool:
    try:
        rows = db.execute_query(f"SELECT 1 AS ok FROM {table} LIMIT 1")
        return bool(rows)
    except Exception:
        return False


def search_products(*, q: Optional[str] = None, limit: int = DEFAULT_LIMIT) -> List[Dict[str, Any]]:
    from services.system_catalog_service import apply_catalog_to_filter_rows

    limit = min(max(1, limit), MAX_LIMIT)
    q_norm = normalize_label(q or "")

    if _table_has_rows(TABLE_PRODUCTS):
        if q_norm:
            rows = db.execute_query(
                f"""
                SELECT produto AS value, produto AS label, total_os AS count
                FROM {TABLE_PRODUCTS}
                WHERE produto_normalizado LIKE %(needle)s ESCAPE '\\\\'
                ORDER BY produto ASC
                LIMIT %(limit)s
                """,
                {"needle": _like_contains(q_norm), "limit": limit},
            )
        else:
            rows = db.execute_query(
                f"""
                SELECT produto AS value, produto AS label, total_os AS count
                FROM {TABLE_PRODUCTS}
                ORDER BY produto ASC
                LIMIT %(limit)s
                """,
                {"limit": limit},
            )
        return apply_catalog_to_filter_rows("produto", list(rows or []), q=q, limit=limit)

    # Fallback limitado — não varrer 1M+ sem prefixo
    if not q_norm:
        rows = db.execute_query(
            """
            SELECT TipoPublicacaoLink AS value, TipoPublicacaoLink AS label,
                   COUNT(*) AS count
            FROM tabDetalhesServico
            WHERE TipoPublicacaoLink IS NOT NULL AND TRIM(TipoPublicacaoLink) != ''
            GROUP BY TipoPublicacaoLink
            ORDER BY count DESC, TipoPublicacaoLink ASC
            LIMIT %(limit)s
            """,
            {"limit": limit},
        )
    else:
        rows = db.execute_query(
            """
            SELECT TipoPublicacaoLink AS value, TipoPublicacaoLink AS label,
                   COUNT(*) AS count
            FROM tabDetalhesServico
            WHERE TipoPublicacaoLink IS NOT NULL
              AND TipoPublicacaoLink LIKE %(needle)s ESCAPE '\\\\'
            GROUP BY TipoPublicacaoLink
            ORDER BY TipoPublicacaoLink ASC
            LIMIT %(limit)s
            """,
            {"needle": _like_contains((q or "").strip()), "limit": limit},
        )
    return apply_catalog_to_filter_rows("produto", list(rows or []), q=q, limit=limit)


def search_requesters(
    *,
    q: Optional[str] = None,
    limit: int = DEFAULT_LIMIT,
    categorias: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    from services.system_catalog_service import apply_catalog_to_filter_rows

    limit = min(max(1, limit), MAX_LIMIT)
    q_norm = normalize_label(q or "")
    clean_categorias = _clean_filter_values(categorias)[:MAX_CATEGORIAS]

    if clean_categorias:
        cat_placeholders = ", ".join(
            f"%(cat_sel_{i})s" for i in range(len(clean_categorias))
        )
        params: Dict[str, Any] = {"limit": limit}
        for i, val in enumerate(clean_categorias):
            params[f"cat_sel_{i}"] = val
        needle_sql = ""
        if q_norm:
            needle_sql = " AND NomeUsuario LIKE %(needle)s ESCAPE '\\\\'"
            params["needle"] = _like_contains((q or "").strip())
        rows = db.execute_query(
            f"""
            SELECT NomeUsuario AS value, NomeUsuario AS label, COUNT(*) AS count
            FROM tabProtocolos
            WHERE NomeUsuario IS NOT NULL AND TRIM(NomeUsuario) != ''
              AND CategoriaLink IN ({cat_placeholders})
              {needle_sql}
            GROUP BY NomeUsuario
            ORDER BY NomeUsuario ASC
            LIMIT %(limit)s
            """,
            params,
        )
        return apply_catalog_to_filter_rows(
            "cliente",
            list(rows or []),
            q=q,
            limit=limit,
            inject_missing=False,
        )

    if _table_has_rows(TABLE_REQUESTERS):
        if q_norm:
            rows = db.execute_query(
                f"""
                SELECT solicitante AS value, solicitante AS label, total_os AS count
                FROM {TABLE_REQUESTERS}
                WHERE solicitante_normalizado LIKE %(needle)s ESCAPE '\\\\'
                ORDER BY solicitante ASC
                LIMIT %(limit)s
                """,
                {"needle": _like_contains(q_norm), "limit": limit},
            )
        else:
            rows = db.execute_query(
                f"""
                SELECT solicitante AS value, solicitante AS label, total_os AS count
                FROM {TABLE_REQUESTERS}
                ORDER BY solicitante ASC
                LIMIT %(limit)s
                """,
                {"limit": limit},
            )
        return apply_catalog_to_filter_rows("cliente", list(rows or []), q=q, limit=limit)

    if not q_norm:
        rows = db.execute_query(
            """
            SELECT NomeUsuario AS value, NomeUsuario AS label, COUNT(*) AS count
            FROM tabProtocolos
            WHERE NomeUsuario IS NOT NULL AND TRIM(NomeUsuario) != ''
            GROUP BY NomeUsuario
            ORDER BY count DESC, NomeUsuario ASC
            LIMIT %(limit)s
            """,
            {"limit": limit},
        )
    else:
        rows = db.execute_query(
            """
            SELECT NomeUsuario AS value, NomeUsuario AS label, COUNT(*) AS count
            FROM tabProtocolos
            WHERE NomeUsuario IS NOT NULL
              AND NomeUsuario LIKE %(needle)s ESCAPE '\\\\'
            GROUP BY NomeUsuario
            ORDER BY NomeUsuario ASC
            LIMIT %(limit)s
            """,
            {"needle": _like_contains((q or "").strip()), "limit": limit},
        )
    return apply_catalog_to_filter_rows("cliente", list(rows or []), q=q, limit=limit)


def search_formatos(*, q: Optional[str] = None, limit: int = DEFAULT_LIMIT) -> List[Dict[str, Any]]:
    from services.system_catalog_service import apply_catalog_to_filter_rows

    limit = min(max(1, limit), MAX_LIMIT)
    q_norm = normalize_label(q or "")

    if not q_norm:
        rows = db.execute_query(
            """
            SELECT FormatoLink AS value, FormatoLink AS label,
                   COUNT(*) AS count
            FROM tabDetalhesServico
            WHERE FormatoLink IS NOT NULL AND TRIM(FormatoLink) != ''
            GROUP BY FormatoLink
            ORDER BY count DESC, FormatoLink ASC
            LIMIT %(limit)s
            """,
            {"limit": limit},
        )
    else:
        rows = db.execute_query(
            """
            SELECT FormatoLink AS value, FormatoLink AS label,
                   COUNT(*) AS count
            FROM tabDetalhesServico
            WHERE FormatoLink IS NOT NULL
              AND FormatoLink LIKE %(needle)s ESCAPE '\\\\'
            GROUP BY FormatoLink
            ORDER BY FormatoLink ASC
            LIMIT %(limit)s
            """,
            {"needle": _like_contains((q or "").strip()), "limit": limit},
        )
    return apply_catalog_to_filter_rows("formato", list(rows or []), q=q, limit=limit)


def backfill_filter_products() -> Dict[str, Any]:
    from os_filter_options_schema import ensure_os_filter_options_schema

    ensure_os_filter_options_schema()
    t0 = time.perf_counter()
    db.execute_query(f"TRUNCATE TABLE {TABLE_PRODUCTS}")
    db.execute_query(
        f"""
        INSERT INTO {TABLE_PRODUCTS} (
            produto, produto_normalizado, total_os, ultima_os_ano, atualizado_em
        )
        SELECT
            agg.produto,
            agg.produto_normalizado,
            agg.total_os,
            agg.ultima_os_ano,
            NOW()
        FROM (
            SELECT
                MIN(TRIM(d.TipoPublicacaoLink)) AS produto,
                LOWER(TRIM(d.TipoPublicacaoLink)) AS produto_normalizado,
                COUNT(DISTINCT CONCAT(d.NroProtocoloLinkDet, '-', d.AnoProtocoloLinkDet)) AS total_os,
                MAX(d.AnoProtocoloLinkDet) AS ultima_os_ano
            FROM tabDetalhesServico AS d
            WHERE d.TipoPublicacaoLink IS NOT NULL
              AND TRIM(d.TipoPublicacaoLink) != ''
            GROUP BY LOWER(TRIM(d.TipoPublicacaoLink))
        ) AS agg
        """
    )
    count_rows = db.execute_query(f"SELECT COUNT(*) AS cnt FROM {TABLE_PRODUCTS}")
    total = int(count_rows[0]["cnt"]) if count_rows else 0
    elapsed = time.perf_counter() - t0
    logger.info("Backfill %s: %s linhas em %.2fs", TABLE_PRODUCTS, total, elapsed)
    return {"rows": total, "elapsed_seconds": round(elapsed, 3)}


def backfill_filter_requesters() -> Dict[str, Any]:
    from os_filter_options_schema import ensure_os_filter_options_schema

    ensure_os_filter_options_schema()
    t0 = time.perf_counter()
    db.execute_query(f"TRUNCATE TABLE {TABLE_REQUESTERS}")
    db.execute_query(
        f"""
        INSERT INTO {TABLE_REQUESTERS} (
            solicitante, solicitante_normalizado, total_os, ultima_os_ano, atualizado_em
        )
        SELECT
            agg.solicitante,
            agg.solicitante_normalizado,
            agg.total_os,
            agg.ultima_os_ano,
            NOW()
        FROM (
            SELECT
                MIN(TRIM(p.NomeUsuario)) AS solicitante,
                LOWER(TRIM(p.NomeUsuario)) AS solicitante_normalizado,
                COUNT(*) AS total_os,
                MAX(p.AnoProtocolo) AS ultima_os_ano
            FROM tabProtocolos AS p
            WHERE p.NomeUsuario IS NOT NULL
              AND TRIM(p.NomeUsuario) != ''
            GROUP BY LOWER(TRIM(p.NomeUsuario))
        ) AS agg
        """
    )
    count_rows = db.execute_query(f"SELECT COUNT(*) AS cnt FROM {TABLE_REQUESTERS}")
    total = int(count_rows[0]["cnt"]) if count_rows else 0
    elapsed = time.perf_counter() - t0
    logger.info("Backfill %s: %s linhas em %.2fs", TABLE_REQUESTERS, total, elapsed)
    return {"rows": total, "elapsed_seconds": round(elapsed, 3)}


def backfill_all_filter_options() -> Dict[str, Any]:
    products = backfill_filter_products()
    requesters = backfill_filter_requesters()
    invalidate_years_cache()
    return {"products": products, "requesters": requesters}


def upsert_filter_options_for_os(
    nro: int,
    ano: int,
    *,
    cursor=None,
) -> None:
    """Upsert incremental em tab_os_filter_* para uma OS (produto/solicitante)."""
    if not nro or not ano:
        return

    def _run_query(sql: str, params: tuple) -> list:
        if cursor is not None:
            cursor.execute(sql, params)
            return cursor.fetchall() or []
        return db.execute_query(sql, params) or []

    def _exec(sql: str, params: tuple) -> None:
        if cursor is not None:
            cursor.execute(sql, params)
        else:
            db.execute_query(sql, params)

    proto_rows = _run_query(
        "SELECT NomeUsuario FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
        (nro, ano),
    )
    if proto_rows:
        solicitante = str((proto_rows[0].get("NomeUsuario") if isinstance(proto_rows[0], dict) else proto_rows[0][0]) or "").strip()
        if solicitante:
            norm = normalize_label(solicitante)
            _exec(
                f"""
                INSERT INTO {TABLE_REQUESTERS} (
                    solicitante, solicitante_normalizado, total_os, ultima_os_ano, atualizado_em
                ) VALUES (%s, %s, 1, %s, NOW())
                ON DUPLICATE KEY UPDATE
                    solicitante = VALUES(solicitante),
                    total_os = total_os + 1,
                    ultima_os_ano = GREATEST(COALESCE(ultima_os_ano, 0), VALUES(ultima_os_ano)),
                    atualizado_em = NOW()
                """,
                (solicitante, norm, ano),
            )

    det_rows = _run_query(
        """
        SELECT TipoPublicacaoLink FROM tabDetalhesServico
        WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
        """,
        (nro, ano),
    )
    if det_rows:
        produto = str(
            (det_rows[0].get("TipoPublicacaoLink") if isinstance(det_rows[0], dict) else det_rows[0][0])
            or ""
        ).strip()
        if produto:
            norm = normalize_label(produto)
            _exec(
                f"""
                INSERT INTO {TABLE_PRODUCTS} (
                    produto, produto_normalizado, total_os, ultima_os_ano, atualizado_em
                ) VALUES (%s, %s, 1, %s, NOW())
                ON DUPLICATE KEY UPDATE
                    produto = VALUES(produto),
                    total_os = total_os + 1,
                    ultima_os_ano = GREATEST(COALESCE(ultima_os_ano, 0), VALUES(ultima_os_ano)),
                    atualizado_em = NOW()
                """,
                (produto, norm, ano),
            )


"""
Nome canônico da tabela de andamentos no MySQL.

O sync legado usa `tabandamento`; o backend histórico usa `tabAndamento`.
Em servidores case-sensitive podem existir como tabelas distintas — resolvemos uma vez.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

_RESOLVED: Optional[str] = None
_CANDIDATES = ("tabAndamento", "tabandamento")


def ensure_andamento_table() -> str:
    """Detecta e fixa o nome real da tabela no schema atual."""
    global _RESOLVED
    if _RESOLVED:
        return _RESOLVED

    from database import db

    rows = db.execute_query(
        """
        SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('tabAndamento', 'tabandamento')
        ORDER BY TABLE_NAME
        """
    )
    names = [r["TABLE_NAME"] for r in (rows or []) if r.get("TABLE_NAME")]

    if len(names) == 1:
        _RESOLVED = names[0]
    elif len(names) >= 2:
        best_name = names[0]
        best_cnt = -1
        for tbl in names:
            try:
                rows = db.execute_query(f"SELECT COUNT(*) AS cnt FROM {tbl}")
                cnt = int(rows[0]["cnt"]) if rows else 0
            except Exception:
                cnt = 0
            if cnt > best_cnt:
                best_cnt = cnt
                best_name = tbl
        _RESOLVED = best_name
        logger.warning(
            "Duas tabelas de andamento detectadas — usando %s (%s linhas). "
            "Considere unificar tabAndamento/tabandamento no MySQL.",
            _RESOLVED,
            best_cnt,
        )
    else:
        _RESOLVED = "tabAndamento"
        logger.warning(
            "Tabela de andamento não encontrada — fallback para %s",
            _RESOLVED,
        )

    logger.info("Tabela de andamento MySQL: %s", _RESOLVED)
    return _RESOLVED


def get_andamento_table() -> str:
    if _RESOLVED:
        return _RESOLVED
    return ensure_andamento_table()

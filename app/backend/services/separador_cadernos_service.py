"""Quantidade de cadernos a partir dos TIFFs lançados na gravação."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from database import db
from services.plate_filename_utils import caderno_until_from_filenames

logger = logging.getLogger(__name__)

_UNION_SQL = """
SELECT origem, session_id, criado_em, nome
FROM (
  SELECT
    'pendente' AS origem,
    p.Id AS session_id,
    p.CriadoEm AS criado_em,
    pa.NomeArquivo AS nome
  FROM tab_os_gravacao_pendente p
  INNER JOIN tab_os_gravacao_pendente_arquivo pa
    ON pa.GravacaoPendenteId = p.Id
  WHERE p.OsAno = %s AND p.OsNro = %s
  UNION ALL
  SELECT
    'externa' AS origem,
    e.Id AS session_id,
    e.CriadoEm AS criado_em,
    ea.NomeArquivo AS nome
  FROM tab_os_gravacao_externa e
  INNER JOIN tab_os_gravacao_externa_arquivo ea
    ON ea.GravacaoExternaId = e.Id
  WHERE e.OsAno = %s AND e.OsNro = %s
) t
"""

_PENDENTE_SQL = """
SELECT
  'pendente' AS origem,
  p.Id AS session_id,
  p.CriadoEm AS criado_em,
  pa.NomeArquivo AS nome
FROM tab_os_gravacao_pendente p
INNER JOIN tab_os_gravacao_pendente_arquivo pa
  ON pa.GravacaoPendenteId = p.Id
WHERE p.OsAno = %s AND p.OsNro = %s
"""

_EXTERNA_SQL = """
SELECT
  'externa' AS origem,
  e.Id AS session_id,
  e.CriadoEm AS criado_em,
  ea.NomeArquivo AS nome
FROM tab_os_gravacao_externa e
INNER JOIN tab_os_gravacao_externa_arquivo ea
  ON ea.GravacaoExternaId = e.Id
WHERE e.OsAno = %s AND e.OsNro = %s
"""


def _safe_query(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]] | None:
    try:
        return list(db.execute_query(sql, params) or [])
    except Exception as exc:
        logger.info("separador cadernos: consulta ignorada: %s", exc)
        return None


def _fetch_arquivo_rows(ano: int, nr_os: int) -> list[dict[str, Any]]:
    union_rows = _safe_query(_UNION_SQL, (ano, nr_os, ano, nr_os))
    if union_rows is not None:
        return union_rows
    rows: list[dict[str, Any]] = []
    for sql, params in ((_PENDENTE_SQL, (ano, nr_os)), (_EXTERNA_SQL, (ano, nr_os))):
        part = _safe_query(sql, params)
        if part:
            rows.extend(part)
    return rows


def _session_sort_key(key: tuple[str, int, Any]) -> tuple[Any, int]:
    _origem, session_id, criado_em = key
    stamp = criado_em if criado_em is not None else datetime.min
    return (stamp, session_id)


def until_from_arquivo_rows(rows: list[dict[str, Any]]) -> int | None:
    sessions: dict[tuple[str, int, Any], list[str]] = {}
    order: list[tuple[str, int, Any]] = []
    for row in rows:
        origem = str(row.get("origem") or "")
        try:
            session_id = int(row.get("session_id") or 0)
        except (TypeError, ValueError):
            continue
        key = (origem, session_id, row.get("criado_em"))
        if key not in sessions:
            sessions[key] = []
            order.append(key)
        nome = str(row.get("nome") or "").strip()
        if nome:
            sessions[key].append(nome)
    order.sort(key=_session_sort_key, reverse=True)
    for key in order:
        until = caderno_until_from_filenames(sessions[key])
        if until is not None:
            return until
    return None


def lookup_gravacao_caderno_until(ano: int, nr_os: int) -> int | None:
    if ano < 1 or nr_os < 1:
        return None
    return until_from_arquivo_rows(_fetch_arquivo_rows(ano, nr_os))

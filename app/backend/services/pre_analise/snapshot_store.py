"""
Persistência da pré-análise por OS + versão (uma linha por combinação, sobrescrita a cada execução completa).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_table_ready = False


def ensure_snapshot_table() -> None:
    global _table_ready
    if _table_ready:
        return
    try:
        from database import db

        db.execute_query(
            """
            CREATE TABLE IF NOT EXISTS tab_pre_analise_snapshot (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                AnoProtocolo INT NOT NULL,
                NroProtocolo INT NOT NULL,
                VersaoLabel VARCHAR(255) NOT NULL,
                ResultsJson LONGTEXT NOT NULL,
                CheckCount INT NOT NULL DEFAULT 0,
                AlertCount INT NOT NULL DEFAULT 0,
                ExecutadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ExecutadoPor VARCHAR(32) NULL,
                UNIQUE KEY uk_pre_analise_os_versao (
                    AnoProtocolo, NroProtocolo, VersaoLabel
                ),
                INDEX idx_pre_analise_os (AnoProtocolo, NroProtocolo)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        _table_ready = True
        logger.info("Tabela tab_pre_analise_snapshot verificada/criada")
    except Exception as exc:
        logger.warning("Não foi possível garantir tab_pre_analise_snapshot: %s", exc)


def _count_alert_items(results: List[Dict[str, Any]]) -> int:
    total = 0
    for result in results:
        achados = result.get("achados") or []
        if achados:
            total += sum(
                1
                for a in achados
                if a.get("severidade") in ("warning", "error")
            )
        elif result.get("status") in ("warning", "error"):
            total += 1
    return total


def save_snapshot(
    ano: int,
    os_id: int,
    versao_label: str,
    results: List[Dict[str, Any]],
    *,
    executed_by: Optional[str] = None,
    folder_fingerprint: Optional[str] = None,
) -> None:
    """Grava ou sobrescreve o snapshot da versão."""
    ensure_snapshot_table()
    envelope: Dict[str, Any] = {"v": 1, "results": results}
    if folder_fingerprint:
        envelope["folder_fingerprint"] = folder_fingerprint
    payload = json.dumps(envelope, ensure_ascii=False)
    check_count = len(results)
    alert_count = _count_alert_items(results)
    try:
        from database import db

        db.execute_query(
            """
            INSERT INTO tab_pre_analise_snapshot (
                AnoProtocolo, NroProtocolo, VersaoLabel,
                ResultsJson, CheckCount, AlertCount,
                ExecutadoEm, ExecutadoPor
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                ResultsJson = VALUES(ResultsJson),
                CheckCount = VALUES(CheckCount),
                AlertCount = VALUES(AlertCount),
                ExecutadoEm = VALUES(ExecutadoEm),
                ExecutadoPor = VALUES(ExecutadoPor)
            """,
            (
                ano,
                os_id,
                versao_label.strip(),
                payload,
                check_count,
                alert_count,
                datetime.now(),
                executed_by,
            ),
        )
    except Exception as exc:
        logger.warning(
            "Falha ao salvar snapshot pré-análise OS %s/%s versão %s: %s",
            ano,
            os_id,
            versao_label,
            exc,
        )


def get_snapshot(
    ano: int,
    os_id: int,
    versao_label: str,
) -> Optional[Dict[str, Any]]:
    ensure_snapshot_table()
    try:
        from database import db

        rows = db.execute_query(
            """
            SELECT ResultsJson, CheckCount, AlertCount, ExecutadoEm, ExecutadoPor
            FROM tab_pre_analise_snapshot
            WHERE AnoProtocolo = %s AND NroProtocolo = %s AND VersaoLabel = %s
            LIMIT 1
            """,
            (ano, os_id, versao_label.strip()),
        )
        if not rows:
            return None
        row = rows[0]
        raw = row.get("ResultsJson") or "[]"
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        folder_fingerprint: Optional[str] = None
        if isinstance(parsed, dict) and "results" in parsed:
            results = parsed.get("results") or []
            fp = parsed.get("folder_fingerprint")
            folder_fingerprint = str(fp) if fp else None
        elif isinstance(parsed, list):
            results = parsed
        else:
            results = []
        executed_at = row.get("ExecutadoEm")
        if isinstance(executed_at, datetime):
            executed_at = executed_at.isoformat(sep=" ", timespec="seconds")
        return {
            "results": results,
            "check_count": int(row.get("CheckCount") or 0),
            "alert_count": int(row.get("AlertCount") or 0),
            "executed_at": executed_at,
            "executed_by": row.get("ExecutadoPor"),
            "folder_fingerprint": folder_fingerprint,
        }
    except Exception as exc:
        logger.warning(
            "Falha ao carregar snapshot pré-análise OS %s/%s: %s",
            ano,
            os_id,
            exc,
        )
        return None


def list_snapshots_index(ano: int, os_id: int) -> List[Dict[str, Any]]:
    """Resumo por versão (rótulo, data, alertas) para badges na árvore."""
    ensure_snapshot_table()
    try:
        from database import db

        rows = db.execute_query(
            """
            SELECT VersaoLabel, AlertCount, ExecutadoEm
            FROM tab_pre_analise_snapshot
            WHERE AnoProtocolo = %s AND NroProtocolo = %s
            ORDER BY ExecutadoEm DESC
            """,
            (ano, os_id),
        )
        out: List[Dict[str, Any]] = []
        for row in rows:
            executed_at = row.get("ExecutadoEm")
            if isinstance(executed_at, datetime):
                executed_at = executed_at.isoformat(sep=" ", timespec="seconds")
            out.append(
                {
                    "versao_label": row.get("VersaoLabel"),
                    "alert_count": int(row.get("AlertCount") or 0),
                    "executed_at": executed_at,
                }
            )
        return out
    except Exception as exc:
        logger.warning(
            "Falha ao listar snapshots pré-análise OS %s/%s: %s",
            ano,
            os_id,
            exc,
        )
        return []

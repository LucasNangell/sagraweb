"""Leitura/escrita de sync_policy e fila de exclusões de OS (API admin)."""
from __future__ import annotations

import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from database import db

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sync_policy import (  # noqa: E402
    TABLE_NAMES,
    apply_env_kill_switches,
    ensure_sync_control_tables,
    load_policies,
    validate_policy_update,
)


def ensure_tables() -> None:
    with db.cursor() as cur:
        ensure_sync_control_tables(cur)


def get_policies(*, apply_env: bool = True) -> List[Dict[str, Any]]:
    ensure_tables()
    with db.cursor() as cur:
        policies = load_policies(cur)
    if apply_env:
        policies = apply_env_kill_switches(policies)
    return [policies[name] for name in TABLE_NAMES if name in policies]


def update_policy(
    table_name: str,
    *,
    enabled: Optional[bool] = None,
    mode: Optional[str] = None,
    delete_policy: Optional[str] = None,
    updated_by: Optional[str] = None,
) -> Dict[str, Any]:
    validate_policy_update(
        table_name, enabled=enabled, mode=mode, delete_policy=delete_policy
    )
    ensure_tables()
    with db.cursor() as cur:
        cur.execute(
            "SELECT enabled, mode, delete_policy FROM sync_policy WHERE table_name = %s",
            (table_name,),
        )
        old = cur.fetchone() or {}
        new_enabled = (
            int(bool(enabled))
            if enabled is not None
            else int(bool(old.get("enabled", 1)))
        )
        new_mode = mode if mode is not None else (old.get("mode") or "uni")
        new_del = (
            delete_policy
            if delete_policy is not None
            else (old.get("delete_policy") or "dryrun")
        )
        cur.execute(
            """
            INSERT INTO sync_policy
                (table_name, enabled, mode, delete_policy, updated_by)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                enabled = VALUES(enabled),
                mode = VALUES(mode),
                delete_policy = VALUES(delete_policy),
                updated_by = VALUES(updated_by),
                updated_at = CURRENT_TIMESTAMP
            """,
            (table_name, new_enabled, new_mode, new_del, updated_by),
        )
        cur.execute(
            """
            INSERT INTO sync_policy_audit
            (table_name, changed_by, old_enabled, old_mode, old_delete_policy,
             new_enabled, new_mode, new_delete_policy)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                table_name,
                updated_by,
                old.get("enabled"),
                old.get("mode"),
                old.get("delete_policy"),
                new_enabled,
                new_mode,
                new_del,
            ),
        )
    return next(p for p in get_policies(apply_env=False) if p["table_name"] == table_name)


def list_pending_deletes(
    *, status: Optional[str] = None, limit: int = 100
) -> List[Dict[str, Any]]:
    ensure_tables()
    limit = max(1, min(int(limit), 500))
    with db.cursor() as cur:
        if status:
            cur.execute(
                """
                SELECT p.*, d.Titulo AS titulo
                FROM sync_os_pending_delete p
                LEFT JOIN tabDetalhesServico d
                  ON d.NroProtocoloLinkDet = p.nro
                 AND d.AnoProtocoloLinkDet = p.ano
                WHERE p.status = %s
                ORDER BY p.first_missing_at ASC
                LIMIT %s
                """,
                (status, limit),
            )
        else:
            cur.execute(
                """
                SELECT p.*, d.Titulo AS titulo
                FROM sync_os_pending_delete p
                LEFT JOIN tabDetalhesServico d
                  ON d.NroProtocoloLinkDet = p.nro
                 AND d.AnoProtocoloLinkDet = p.ano
                WHERE p.status IN ('pending', 'blocked', 'approved')
                ORDER BY
                  FIELD(p.status, 'blocked', 'pending', 'approved'),
                  p.first_missing_at ASC
                LIMIT %s
                """,
                (limit,),
            )
        rows = cur.fetchall() or []
    out = []
    for r in rows:
        item = dict(r)
        for k, v in list(item.items()):
            if isinstance(v, datetime):
                item[k] = v.isoformat(sep=" ", timespec="seconds")
        out.append(item)
    return out


def decide_pending_delete(
    nro: int,
    ano: int,
    *,
    approve: bool,
    decided_by: Optional[str],
) -> Dict[str, Any]:
    ensure_tables()
    with db.cursor() as cur:
        cur.execute(
            "SELECT * FROM sync_os_pending_delete WHERE nro = %s AND ano = %s",
            (nro, ano),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError(f"Pendência {nro}/{ano} não encontrada")
        if row.get("status") == "executed":
            return {"nro": nro, "ano": ano, "status": "executed", "ok": True}

        if not approve:
            cur.execute(
                """
                UPDATE sync_os_pending_delete
                SET status = 'rejected', decided_by = %s, decided_at = NOW(),
                    last_check_at = NOW(),
                    motivo = COALESCE(motivo, 'Rejeitado no frontend')
                WHERE nro = %s AND ano = %s
                """,
                (decided_by, nro, ano),
            )
            return {"nro": nro, "ano": ano, "status": "rejected", "ok": True}

        cur.execute(
            """
            UPDATE sync_os_pending_delete
            SET status = 'approved', decided_by = %s, decided_at = NOW(),
                last_check_at = NOW()
            WHERE nro = %s AND ano = %s
            """,
            (decided_by, nro, ano),
        )

    # Marca approved; o serviço NSSM executa após reverificar o MDB.
    return {
        "nro": nro,
        "ano": ano,
        "status": "approved",
        "ok": True,
        "note": "Será executado no próximo ciclo do serviço após reverificação MDB",
    }


def pending_counts() -> Dict[str, int]:
    ensure_tables()
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT status, COUNT(*) AS c
            FROM sync_os_pending_delete
            GROUP BY status
            """
        )
        rows = cur.fetchall() or []
    counts = {r["status"]: int(r["c"]) for r in rows}
    return {
        "pending": counts.get("pending", 0),
        "blocked": counts.get("blocked", 0),
        "approved": counts.get("approved", 0),
        "executed": counts.get("executed", 0),
        "rejected": counts.get("rejected", 0),
    }

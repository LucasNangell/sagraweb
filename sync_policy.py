"""
Política de sincronização por tabela (fonte única MySQL).

Usado pelo serviço NSSM e pela API admin. Env flags só desligam (kill-switch).
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

TABLE_NAMES = ("tabProtocolos", "tabDetalhesServico", "tabAndamento")
MODES = ("uni", "bi")
DELETE_POLICIES = ("off", "dryrun", "on")

DEFAULT_POLICIES: List[Dict[str, Any]] = [
    {
        "table_name": "tabProtocolos",
        "enabled": True,
        "mode": "uni",
        "delete_policy": "dryrun",
    },
    {
        "table_name": "tabDetalhesServico",
        "enabled": True,
        "mode": "uni",
        "delete_policy": "dryrun",
    },
    {
        "table_name": "tabAndamento",
        "enabled": True,
        "mode": "bi",
        "delete_policy": "on",
    },
]

# Limites de segurança (exclusão de OS)
OS_DELETE_AUTO_LIMIT = int(os.getenv("SYNC_OS_DELETE_AUTO_LIMIT", "3"))
OS_DELETE_DWELL_SECONDS = int(os.getenv("SYNC_OS_DELETE_DWELL_SECONDS", "120"))
OS_DELETE_MIN_CONFIRM = int(os.getenv("SYNC_OS_DELETE_MIN_CONFIRM", "2"))
OS_DELETE_AUDIT_GRACE_SECONDS = int(os.getenv("SYNC_OS_DELETE_AUDIT_GRACE_SECONDS", "300"))
OS_DELETE_VOLUME_DROP_PCT = float(os.getenv("SYNC_OS_DELETE_VOLUME_DROP_PCT", "10"))
OS_MIN_YEAR = int(os.getenv("SYNC_OS_MIN_YEAR", "2024"))


def ensure_sync_control_tables(cursor) -> None:
    """CREATE TABLE IF NOT EXISTS + seed de sync_policy. Cursor MySQL sem dictionary."""
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS sync_policy (
            table_name VARCHAR(64) NOT NULL PRIMARY KEY,
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            mode VARCHAR(8) NOT NULL DEFAULT 'uni',
            delete_policy VARCHAR(16) NOT NULL DEFAULT 'dryrun',
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            updated_by VARCHAR(80) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS sync_policy_audit (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            table_name VARCHAR(64) NOT NULL,
            changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            changed_by VARCHAR(80) NULL,
            old_enabled TINYINT(1) NULL,
            old_mode VARCHAR(8) NULL,
            old_delete_policy VARCHAR(16) NULL,
            new_enabled TINYINT(1) NULL,
            new_mode VARCHAR(8) NULL,
            new_delete_policy VARCHAR(16) NULL,
            INDEX idx_spa_table (table_name),
            INDEX idx_spa_changed (changed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS cache_os_mdb (
            nro INT NOT NULL,
            ano INT NOT NULL,
            origem VARCHAR(50) NOT NULL,
            last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (nro, ano),
            INDEX idx_cache_os_origem (origem),
            INDEX idx_cache_os_seen (last_seen_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS sync_os_pending_delete (
            nro INT NOT NULL,
            ano INT NOT NULL,
            origem VARCHAR(50) NULL,
            first_missing_at DATETIME NOT NULL,
            confirm_count INT NOT NULL DEFAULT 1,
            last_check_at DATETIME NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            payload_hash VARCHAR(64) NULL,
            andamentos_count INT NOT NULL DEFAULT 0,
            motivo VARCHAR(255) NULL,
            decided_by VARCHAR(80) NULL,
            decided_at DATETIME NULL,
            PRIMARY KEY (nro, ano),
            INDEX idx_sopd_status (status),
            INDEX idx_sopd_check (last_check_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS deleted_os (
            nro INT NOT NULL,
            ano INT NOT NULL,
            content_hash VARCHAR(64) NULL,
            deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            motivo VARCHAR(255) NULL,
            origem VARCHAR(50) NULL,
            PRIMARY KEY (nro, ano),
            INDEX idx_deleted_os_at (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS backup_os (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            timestamp_backup DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            nro INT NOT NULL,
            ano INT NOT NULL,
            origem VARCHAR(50) NULL,
            dados_json LONGTEXT NOT NULL,
            INDEX idx_backup_os_nro_ano (nro, ano),
            INDEX idx_backup_os_ts (timestamp_backup)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS sync_os_baseline (
            nro INT NOT NULL,
            ano INT NOT NULL,
            table_name VARCHAR(64) NOT NULL,
            payload_hash CHAR(64) NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (nro, ano, table_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )

    for row in DEFAULT_POLICIES:
        cursor.execute(
            """
            INSERT IGNORE INTO sync_policy
                (table_name, enabled, mode, delete_policy, updated_by)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                row["table_name"],
                1 if row["enabled"] else 0,
                row["mode"],
                row["delete_policy"],
                "bootstrap",
            ),
        )


def load_policies(cursor) -> Dict[str, Dict[str, Any]]:
    """Retorna {table_name: {enabled, mode, delete_policy, updated_at, updated_by}}."""
    cursor.execute(
        """
        SELECT table_name, enabled, mode, delete_policy, updated_at, updated_by
        FROM sync_policy
        """
    )
    rows = cursor.fetchall()
    result: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if isinstance(row, dict):
            name = row["table_name"]
            result[name] = {
                "table_name": name,
                "enabled": bool(row["enabled"]),
                "mode": row["mode"],
                "delete_policy": row["delete_policy"],
                "updated_at": row.get("updated_at"),
                "updated_by": row.get("updated_by"),
            }
        else:
            name = row[0]
            result[name] = {
                "table_name": name,
                "enabled": bool(row[1]),
                "mode": row[2],
                "delete_policy": row[3],
                "updated_at": row[4] if len(row) > 4 else None,
                "updated_by": row[5] if len(row) > 5 else None,
            }
    for default in DEFAULT_POLICIES:
        if default["table_name"] not in result:
            result[default["table_name"]] = dict(default)
    return result


def apply_env_kill_switches(policies: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Env só desliga: nunca liga algo que a policy DB tenha desligado.
    SYNC_TABANDAMENTO_BIDI=false → tabAndamento mode=uni
    SYNC_MYSQL_TO_MDB_CATCHUP=false → tabAndamento mode=uni (sem catch-up)
    SYNC_OS_DELETE_POLICY=off|dryrun|on → força delete_policy de Protocolos/Detalhes
    """
    out = {k: dict(v) for k, v in policies.items()}

    def _env_bool(name: str, default: bool) -> bool:
        raw = (os.getenv(name) or "").strip().lower()
        if not raw:
            return default
        return raw in ("1", "true", "yes", "on")

    bidi = _env_bool("SYNC_TABANDAMENTO_BIDI", True)
    catchup = _env_bool("SYNC_MYSQL_TO_MDB_CATCHUP", True)
    if "tabAndamento" in out:
        if not bidi or not catchup:
            out["tabAndamento"]["mode"] = "uni"
        if not bidi:
            out["tabAndamento"]["enabled"] = out["tabAndamento"]["enabled"] and True
            # enabled permanece; mode uni desliga catch-up no serviço

    force_del = (os.getenv("SYNC_OS_DELETE_POLICY") or "").strip().lower()
    if force_del in DELETE_POLICIES:
        for name in ("tabProtocolos", "tabDetalhesServico"):
            if name in out:
                out[name]["delete_policy"] = force_del

    return out


def effective_os_delete_policy(policies: Dict[str, Dict[str, Any]]) -> str:
    """Política efetiva de exclusão de OS = mais restritiva entre Protocolos e Detalhes."""
    order = {"off": 0, "dryrun": 1, "on": 2}
    p = policies.get("tabProtocolos", {}).get("delete_policy", "dryrun")
    d = policies.get("tabDetalhesServico", {}).get("delete_policy", "dryrun")
    if order.get(p, 1) <= order.get(d, 1):
        return p if p in DELETE_POLICIES else "dryrun"
    return d if d in DELETE_POLICIES else "dryrun"


def validate_policy_update(
    table_name: str,
    *,
    enabled: Optional[bool] = None,
    mode: Optional[str] = None,
    delete_policy: Optional[str] = None,
) -> None:
    if table_name not in TABLE_NAMES:
        raise ValueError(f"table_name inválido: {table_name}")
    if mode is not None and mode not in MODES:
        raise ValueError(f"mode inválido: {mode}")
    if delete_policy is not None and delete_policy not in DELETE_POLICIES:
        raise ValueError(f"delete_policy inválido: {delete_policy}")
    if enabled is not None and not isinstance(enabled, bool):
        raise ValueError("enabled deve ser bool")

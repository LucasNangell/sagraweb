from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from database import db

logger = logging.getLogger(__name__)

GLOBAL_EMAIL_CONFIG_PONTO = "__GLOBAL__"

DEFAULT_EWS_URL = "https://ce.camara.leg.br/EWS/Exchange.asmx"
DEFAULT_VERIFY_SSL = False
DEFAULT_MAX_ITEMS = 20
DEFAULT_REFRESH_SECONDS = 15
DEFAULT_ONLY_UNREAD = True

DEFAULT_MAILBOX_CANDIDATES = [
    "sepim.deapa@camara.leg.br",
    "papelaria.deapa@camara.leg.br",
]

DEFAULT_MONITORED_TARGETS = [
    {
        "mailbox": "sepim.deapa@camara.leg.br",
        "folders": [
            {"id": "", "name": "Entrada de Provas", "parent": "Inbox"},
            {"id": "", "name": "Entrada de Prob. Tec.", "parent": "Inbox"},
        ],
    },
    {
        "mailbox": "papelaria.deapa@camara.leg.br",
        "folders": [
            {"id": "", "name": "Entrada de Provas", "parent": "Inbox"},
            {"id": "", "name": "Entrada de Prob. Tec.", "parent": "Inbox"},
        ],
    },
]


@dataclass
class EmailExchangeConfig:
    ponto: str
    ews_url: str
    verify_ssl: bool
    max_items_per_folder: int
    refresh_interval_sec: int
    only_unread: bool
    monitored_targets: List[Dict[str, Any]]
    send_mailbox_os_lt_5000: str
    send_mailbox_os_gte_5000: str
    send_routing: Dict[str, Any]
    sent_folder_routing: Dict[str, Any]
    config_version: int
    configured: bool = True


def ensure_email_config_schema() -> None:
    db.execute_query(
        """
        CREATE TABLE IF NOT EXISTS tabEmailExchangeConfig (
            Ponto VARCHAR(20) PRIMARY KEY,
            EwsUsername VARCHAR(255) NOT NULL DEFAULT '',
            EwsPasswordEnc TEXT NULL,
            EwsUrl VARCHAR(512) NOT NULL DEFAULT '',
            VerifySsl TINYINT(1) NOT NULL DEFAULT 0,
            MaxItemsPerFolder INT NOT NULL DEFAULT 20,
            RefreshIntervalSec INT NOT NULL DEFAULT 5,
            OnlyUnread TINYINT(1) NOT NULL DEFAULT 1,
            MonitoredTargets JSON NULL,
            SendMailboxOsLt5000 VARCHAR(255) NOT NULL DEFAULT '',
            SendMailboxOsGte5000 VARCHAR(255) NOT NULL DEFAULT '',
            SendRouting JSON NULL,
            SentFolderRouting JSON NULL,
            ConfigVersion INT NOT NULL DEFAULT 1,
            UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
        """
    )
    # Migração aditiva para bases antigas já existentes.
    alter_statements = [
        "ALTER TABLE tabEmailExchangeConfig ADD COLUMN SendRouting JSON NULL",
        "ALTER TABLE tabEmailExchangeConfig ADD COLUMN SentFolderRouting JSON NULL",
        "ALTER TABLE tabEmailExchangeConfig ADD COLUMN ConfigVersion INT NOT NULL DEFAULT 1",
    ]
    for statement in alter_statements:
        try:
            db.execute_query(statement)
        except Exception:
            # Coluna já pode existir dependendo da versão do banco.
            continue


def _parse_json(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


def _normalize_scope_ponto(_ponto: str) -> str:
    return GLOBAL_EMAIL_CONFIG_PONTO


def _get_config_row(ponto: str) -> Optional[Dict[str, Any]]:
    normalized = _normalize_scope_ponto(ponto)
    rows = db.execute_query(
        "SELECT * FROM tabEmailExchangeConfig WHERE Ponto = %s LIMIT 1",
        (normalized,),
    )
    if rows:
        return rows[0]

    # Compatibilidade de transição: antes do primeiro save global, reutiliza a
    # configuração mais recentemente atualizada já existente.
    legacy_rows = db.execute_query(
        """
        SELECT *
        FROM tabEmailExchangeConfig
        WHERE Ponto <> %s
        ORDER BY UpdatedAt DESC
        LIMIT 1
        """,
        (normalized,),
    )
    if legacy_rows:
        return legacy_rows[0]
    return None


def _row_to_public_config(row: Dict[str, Any]) -> Dict[str, Any]:
    monitored = _parse_json(row.get("MonitoredTargets"), [])
    send_routing = _parse_json(row.get("SendRouting"), {})
    sent_folder_routing = _parse_json(row.get("SentFolderRouting"), {})
    config_version = int(row.get("ConfigVersion") or 1)
    return {
        "ponto": str(row.get("Ponto") or ""),
        "ews_url": row.get("EwsUrl") or DEFAULT_EWS_URL,
        "verify_ssl": bool(row.get("VerifySsl")),
        "max_items_per_folder": int(row.get("MaxItemsPerFolder") or DEFAULT_MAX_ITEMS),
        "refresh_interval_sec": int(row.get("RefreshIntervalSec") or DEFAULT_REFRESH_SECONDS),
        "only_unread": bool(row.get("OnlyUnread", 1)),
        "monitored_targets": monitored or [],
        "send_mailbox_os_lt_5000": row.get("SendMailboxOsLt5000")
        or "sepim.deapa@camara.leg.br",
        "send_mailbox_os_gte_5000": row.get("SendMailboxOsGte5000")
        or "papelaria.deapa@camara.leg.br",
        "send_routing": send_routing if isinstance(send_routing, dict) else {},
        "sent_folder_routing": (
            sent_folder_routing if isinstance(sent_folder_routing, dict) else {}
        ),
        "config_version": max(1, config_version),
        "configured": True,
        "updated_at": row.get("UpdatedAt"),
    }


def get_public_config(ponto: str) -> Dict[str, Any]:
    ensure_email_config_schema()
    row = _get_config_row(str(ponto))
    if not row:
        return {
            "ponto": GLOBAL_EMAIL_CONFIG_PONTO,
            "ews_url": DEFAULT_EWS_URL,
            "verify_ssl": DEFAULT_VERIFY_SSL,
            "max_items_per_folder": DEFAULT_MAX_ITEMS,
            "refresh_interval_sec": DEFAULT_REFRESH_SECONDS,
            "only_unread": DEFAULT_ONLY_UNREAD,
            "monitored_targets": [],
            "send_mailbox_os_lt_5000": "sepim.deapa@camara.leg.br",
            "send_mailbox_os_gte_5000": "papelaria.deapa@camara.leg.br",
            "send_routing": {},
            "sent_folder_routing": {},
            "config_version": 1,
            "configured": False,
            "updated_at": None,
        }
    return _row_to_public_config(row)


def get_runtime_config(ponto: str) -> Optional[EmailExchangeConfig]:
    ensure_email_config_schema()
    row = _get_config_row(str(ponto))
    if not row:
        return None
    monitored = _parse_json(row.get("MonitoredTargets"), [])
    send_routing = _parse_json(row.get("SendRouting"), {})
    sent_folder_routing = _parse_json(row.get("SentFolderRouting"), {})
    config_version = int(row.get("ConfigVersion") or 1)
    if not monitored:
        return None
    return EmailExchangeConfig(
        ponto=str(row.get("Ponto") or GLOBAL_EMAIL_CONFIG_PONTO),
        ews_url=row.get("EwsUrl") or DEFAULT_EWS_URL,
        verify_ssl=bool(row.get("VerifySsl")),
        max_items_per_folder=int(row.get("MaxItemsPerFolder") or DEFAULT_MAX_ITEMS),
        refresh_interval_sec=int(row.get("RefreshIntervalSec") or DEFAULT_REFRESH_SECONDS),
        only_unread=bool(row.get("OnlyUnread", 1)),
        monitored_targets=monitored,
        send_mailbox_os_lt_5000=row.get("SendMailboxOsLt5000")
        or "sepim.deapa@camara.leg.br",
        send_mailbox_os_gte_5000=row.get("SendMailboxOsGte5000")
        or "papelaria.deapa@camara.leg.br",
        send_routing=send_routing if isinstance(send_routing, dict) else {},
        sent_folder_routing=(
            sent_folder_routing if isinstance(sent_folder_routing, dict) else {}
        ),
        config_version=max(1, config_version),
        configured=True,
    )


def save_config(
    *,
    ponto: str,
    ews_url: str,
    verify_ssl: bool,
    max_items_per_folder: int,
    refresh_interval_sec: int,
    only_unread: bool,
    monitored_targets: List[Dict[str, Any]],
    send_mailbox_os_lt_5000: Optional[str] = None,
    send_mailbox_os_gte_5000: Optional[str] = None,
    send_routing: Optional[Dict[str, Any]] = None,
    sent_folder_routing: Optional[Dict[str, Any]] = None,
    config_version: Optional[int] = None,
) -> Dict[str, Any]:
    ensure_email_config_schema()
    scoped_ponto = _normalize_scope_ponto(ponto)
    existing = get_public_config(scoped_ponto)
    resolved_send_lt_5000 = (
        (send_mailbox_os_lt_5000 or "").strip()
        if send_mailbox_os_lt_5000 is not None
        else str(existing.get("send_mailbox_os_lt_5000") or "").strip()
    )
    resolved_send_gte_5000 = (
        (send_mailbox_os_gte_5000 or "").strip()
        if send_mailbox_os_gte_5000 is not None
        else str(existing.get("send_mailbox_os_gte_5000") or "").strip()
    )
    resolved_send_routing = (
        send_routing if isinstance(send_routing, dict) else existing.get("send_routing") or {}
    )
    resolved_sent_folder_routing = (
        sent_folder_routing
        if isinstance(sent_folder_routing, dict)
        else existing.get("sent_folder_routing") or {}
    )
    resolved_config_version = (
        max(1, int(config_version))
        if config_version is not None
        else max(1, int(existing.get("config_version") or 1))
    )
    db.execute_query(
        """
        INSERT INTO tabEmailExchangeConfig (
            Ponto, EwsUrl, VerifySsl,
            MaxItemsPerFolder, RefreshIntervalSec, OnlyUnread, MonitoredTargets,
            SendMailboxOsLt5000, SendMailboxOsGte5000, SendRouting, SentFolderRouting, ConfigVersion
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            EwsUrl = VALUES(EwsUrl),
            VerifySsl = VALUES(VerifySsl),
            MaxItemsPerFolder = VALUES(MaxItemsPerFolder),
            RefreshIntervalSec = VALUES(RefreshIntervalSec),
            OnlyUnread = VALUES(OnlyUnread),
            MonitoredTargets = VALUES(MonitoredTargets),
            SendMailboxOsLt5000 = VALUES(SendMailboxOsLt5000),
            SendMailboxOsGte5000 = VALUES(SendMailboxOsGte5000),
            SendRouting = VALUES(SendRouting),
            SentFolderRouting = VALUES(SentFolderRouting),
            ConfigVersion = VALUES(ConfigVersion),
            UpdatedAt = CURRENT_TIMESTAMP
        """,
        (
            scoped_ponto,
            ews_url.strip() or DEFAULT_EWS_URL,
            1 if verify_ssl else 0,
            max(1, min(max_items_per_folder, 100)),
            max(3, min(refresh_interval_sec, 120)),
            1 if only_unread else 0,
            json.dumps(monitored_targets or []),
            resolved_send_lt_5000,
            resolved_send_gte_5000,
            json.dumps(resolved_send_routing),
            json.dumps(resolved_sent_folder_routing),
            resolved_config_version,
        ),
    )
    return get_public_config(scoped_ponto)


def get_default_runtime_config() -> EmailExchangeConfig:
    return EmailExchangeConfig(
        ponto="",
        ews_url=DEFAULT_EWS_URL,
        verify_ssl=DEFAULT_VERIFY_SSL,
        max_items_per_folder=DEFAULT_MAX_ITEMS,
        refresh_interval_sec=DEFAULT_REFRESH_SECONDS,
        only_unread=DEFAULT_ONLY_UNREAD,
        monitored_targets=DEFAULT_MONITORED_TARGETS,
        send_mailbox_os_lt_5000="sepim.deapa@camara.leg.br",
        send_mailbox_os_gte_5000="papelaria.deapa@camara.leg.br",
        send_routing={},
        sent_folder_routing={},
        config_version=1,
        configured=False,
    )

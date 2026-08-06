"""Schema: inscrições de notificação por OS e push subscriptions."""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_TAB_OS_NOTIFICACAO_WATCH = """
CREATE TABLE IF NOT EXISTS tabOsNotificacaoWatch (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Ponto VARCHAR(32) NOT NULL,
    NroProtocolo INT NOT NULL,
    AnoProtocolo INT NOT NULL,
    NotifyAndamentos TINYINT(1) NOT NULL DEFAULT 0,
    NotifyAllAndamentos TINYINT(1) NOT NULL DEFAULT 1,
    AndamentoSituacao VARCHAR(128) NULL,
    AndamentoSetor VARCHAR(128) NULL,
    NotifyOsChanges TINYINT(1) NOT NULL DEFAULT 0,
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    DataCriacao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DataAtualizacao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_os_watch_user_os (Ponto, NroProtocolo, AnoProtocolo),
    KEY idx_os_watch_os (NroProtocolo, AnoProtocolo),
    KEY idx_os_watch_ponto (Ponto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_CREATE_TAB_PUSH_SUBSCRIPTIONS = """
CREATE TABLE IF NOT EXISTS tabPushSubscriptions (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Ponto VARCHAR(32) NOT NULL,
    Endpoint VARCHAR(768) NOT NULL,
    P256dh VARCHAR(256) NOT NULL,
    AuthKey VARCHAR(128) NOT NULL,
    UserAgent VARCHAR(512) NULL,
    DataCriacao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_push_endpoint (Endpoint(255)),
    KEY idx_push_ponto (Ponto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_CREATE_TAB_PAINEL_TABLET_PUSH = """
CREATE TABLE IF NOT EXISTS tabPainelTabletPush (
    Ponto VARCHAR(32) NOT NULL,
    Setor VARCHAR(64) NOT NULL,
    Enabled TINYINT(1) NOT NULL DEFAULT 1,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (Ponto),
    KEY idx_painel_tablet_push_setor (Setor, Enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""


def ensure_os_notificacao_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB_OS_NOTIFICACAO_WATCH)
            cursor.execute(_CREATE_TAB_PUSH_SUBSCRIPTIONS)
            cursor.execute(_CREATE_TAB_PAINEL_TABLET_PUSH)
        logger.info(
            "Schema tabOsNotificacaoWatch / tabPushSubscriptions / tabPainelTabletPush verificado"
        )
    except Exception as exc:
        logger.error("Erro ao garantir schema de notificação OS: %s", exc)
        raise

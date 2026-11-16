"""Deduplicação de envio automático por CodStatus (API + monitor MySQL)."""
from __future__ import annotations

import logging
from typing import Optional

from database import db

logger = logging.getLogger(__name__)

_TABLE = "tabEmailAutoSendClaim"


def ensure_auto_send_claim_schema() -> None:
    db.execute_query(
        f"""
        CREATE TABLE IF NOT EXISTS {_TABLE} (
            CodStatus VARCHAR(32) NOT NULL PRIMARY KEY,
            NroProtocolo INT NOT NULL,
            AnoProtocolo INT NOT NULL,
            Status VARCHAR(16) NOT NULL,
            Detail VARCHAR(255) NULL,
            CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UpdatedAt DATETIME NOT NULL
                DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_auto_send_claim_os (NroProtocolo, AnoProtocolo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )


def try_claim_auto_send(
    *,
    cod_status: str,
    os_num: int,
    ano: int,
) -> bool:
    """
    Reserva CodStatus para processamento.
    Retorna False se já existir claim (já tratado ou em andamento).
    """
    ensure_auto_send_claim_schema()
    code = str(cod_status or "").strip()
    if not code:
        return False
    try:
        db.execute_query(
            f"""
            INSERT INTO {_TABLE} (CodStatus, NroProtocolo, AnoProtocolo, Status)
            VALUES (%s, %s, %s, 'pending')
            """,
            (code, int(os_num), int(ano)),
        )
        return True
    except Exception as exc:
        # Duplicate key / race → já claimado
        logger.debug("auto_send claim skip %s: %s", code, exc)
        return False


def update_auto_send_claim(
    cod_status: str,
    *,
    status: str,
    detail: str = "",
) -> None:
    ensure_auto_send_claim_schema()
    code = str(cod_status or "").strip()
    if not code:
        return
    db.execute_query(
        f"""
        UPDATE {_TABLE}
        SET Status = %s, Detail = %s
        WHERE CodStatus = %s
        """,
        (str(status)[:16], str(detail or "")[:255], code),
    )


def release_auto_send_claim(cod_status: str) -> None:
    """Libera claim para retry (falha transitória)."""
    ensure_auto_send_claim_schema()
    code = str(cod_status or "").strip()
    if not code:
        return
    db.execute_query(
        f"DELETE FROM {_TABLE} WHERE CodStatus = %s AND Status = 'pending'",
        (code,),
    )


def is_auto_send_claimed(cod_status: str) -> bool:
    ensure_auto_send_claim_schema()
    code = str(cod_status or "").strip()
    if not code:
        return False
    rows = db.execute_query(
        f"SELECT 1 FROM {_TABLE} WHERE CodStatus = %s LIMIT 1",
        (code,),
    )
    return bool(rows)


def find_current_encam_cod_status(os_num: int, ano: int) -> Optional[str]:
    rows = db.execute_query(
        """
        SELECT CodStatus
        FROM tabAndamento
        WHERE NroProtocoloLink = %(os)s
          AND AnoProtocoloLink = %(ano)s
          AND SituacaoLink = %(sit)s
          AND UltimoStatus = 1
        ORDER BY `Data` DESC, CodStatus DESC
        LIMIT 1
        """,
        {"os": os_num, "ano": ano, "sit": "Encam. de Docum."},
    )
    if not rows:
        return None
    return str(rows[0].get("CodStatus") or "").strip() or None

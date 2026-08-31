"""Lock pessimista por OS: um holder por (nro, ano), com heartbeat e TTL."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from database import db

logger = logging.getLogger(__name__)

TTL_SECONDS = 90
ORIGENS = frozenset({"os_edit", "andamento"})

_SELECT_FOR_UPDATE = """
SELECT nro_protocolo, ano_protocolo, ponto, nome, origem, token,
       acquired_at, heartbeat_at
FROM tab_os_edit_lock
WHERE nro_protocolo = %s AND ano_protocolo = %s
FOR UPDATE
"""

_SELECT_STATUS = """
SELECT nro_protocolo, ano_protocolo, ponto, nome, origem, token,
       acquired_at, heartbeat_at
FROM tab_os_edit_lock
WHERE nro_protocolo = %s AND ano_protocolo = %s
"""

_INSERT_SQL = """
INSERT INTO tab_os_edit_lock (
    nro_protocolo, ano_protocolo, ponto, nome, origem, token,
    acquired_at, heartbeat_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
"""

_UPDATE_HOLDER_SQL = """
UPDATE tab_os_edit_lock
SET ponto = %s, nome = %s, origem = %s, token = %s,
    acquired_at = %s, heartbeat_at = %s
WHERE nro_protocolo = %s AND ano_protocolo = %s
"""

_HEARTBEAT_SQL = """
UPDATE tab_os_edit_lock
SET heartbeat_at = %s
WHERE nro_protocolo = %s AND ano_protocolo = %s AND ponto = %s AND token = %s
"""

_RELEASE_TOKEN_SQL = """
DELETE FROM tab_os_edit_lock
WHERE nro_protocolo = %s AND ano_protocolo = %s AND ponto = %s AND token = %s
"""

_RELEASE_PONTO_SQL = """
DELETE FROM tab_os_edit_lock
WHERE nro_protocolo = %s AND ano_protocolo = %s AND ponto = %s
"""


class OsEditLockGoneError(Exception):
    """Lock ausente, expirado ou token da aba não corresponde mais."""


class OsEditLockedError(Exception):
    def __init__(self, holder_ponto: int, holder_nome: str):
        self.holder_ponto = int(holder_ponto)
        self.holder_nome = str(holder_nome or "").strip() or "desconhecido"
        super().__init__(self.message)

    @property
    def message(self) -> str:
        return (
            f"O usuário {self.holder_nome} (ponto {self.holder_ponto}) "
            "está editando esta OS no momento. Não é possível editá-la."
        )

    def to_detail(self) -> dict[str, Any]:
        return {
            "code": "os_edit_locked",
            "message": self.message,
            "holder_nome": self.holder_nome,
            "holder_ponto": self.holder_ponto,
        }


def _now() -> datetime:
    return datetime.now()


def _normalize_origem(origem: str | None) -> str:
    value = (origem or "os_edit").strip()
    if value not in ORIGENS:
        return "os_edit"
    return value


def _normalize_token(token: str | None) -> str:
    raw = (token or "").strip()
    if len(raw) < 8:
        return str(uuid.uuid4())
    return raw[:36]


def _row_dt(row: dict[str, Any], key: str) -> datetime:
    val = row.get(key)
    if isinstance(val, datetime):
        return val
    if val is None:
        return datetime.min
    try:
        return datetime.fromisoformat(str(val))
    except ValueError:
        return datetime.min


def _is_fresh(row: dict[str, Any], now: datetime) -> bool:
    hb = _row_dt(row, "heartbeat_at")
    return (now - hb) < timedelta(seconds=TTL_SECONDS)


def _row_ponto(row: dict[str, Any]) -> int:
    try:
        return int(row.get("ponto") or 0)
    except (TypeError, ValueError):
        return 0


def _lock_payload(
    nro: int,
    ano: int,
    ponto: int,
    nome: str,
    origem: str,
    token: str,
    *,
    acquired: bool,
) -> dict[str, Any]:
    return {
        "held": True,
        "acquired": acquired,
        "nro_protocolo": int(nro),
        "ano_protocolo": int(ano),
        "ponto": int(ponto),
        "nome": nome,
        "origem": origem,
        "token": token,
    }


def _take_lock(
    cursor: Any,
    nro: int,
    ano: int,
    ponto: int,
    nome: str,
    origem: str,
    token: str,
    now: datetime,
    *,
    insert: bool,
) -> dict[str, Any]:
    if insert:
        cursor.execute(
            _INSERT_SQL,
            (nro, ano, ponto, nome, origem, token, now, now),
        )
    else:
        cursor.execute(
            _UPDATE_HOLDER_SQL,
            (ponto, nome, origem, token, now, now, nro, ano),
        )
    return _lock_payload(nro, ano, ponto, nome, origem, token, acquired=True)


def _acquire_on_cursor(
    cursor: Any,
    nro: int,
    ano: int,
    ponto: int,
    nome: str,
    origem: str,
    token: str,
    now: datetime,
    *,
    steal_same_ponto: bool,
    keep_token_if_same: bool,
) -> dict[str, Any]:
    cursor.execute(_SELECT_FOR_UPDATE, (nro, ano))
    row = cursor.fetchone()
    if not row:
        return _take_lock(
            cursor, nro, ano, ponto, nome, origem, token, now, insert=True
        )

    holder = _row_ponto(row)
    fresh = _is_fresh(row, now)
    existing_token = str(row.get("token") or "")

    if fresh and holder != ponto:
        raise OsEditLockedError(holder, str(row.get("nome") or ""))

    if fresh and holder == ponto:
        next_token = existing_token if keep_token_if_same and existing_token else token
        if not steal_same_ponto and existing_token and existing_token != token:
            raise OsEditLockedError(holder, str(row.get("nome") or ""))
        cursor.execute(
            _UPDATE_HOLDER_SQL,
            (ponto, nome, origem, next_token, _row_dt(row, "acquired_at"), now, nro, ano),
        )
        return _lock_payload(
            nro, ano, ponto, nome, origem, next_token, acquired=False
        )

    return _take_lock(
        cursor, nro, ano, ponto, nome, origem, token, now, insert=False
    )


def acquire_lock(
    nro: int,
    ano: int,
    ponto: int,
    nome: str,
    origem: str = "os_edit",
    token: str | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    origem_n = _normalize_origem(origem)
    token_n = _normalize_token(token)
    when = now or _now()
    nome_n = (nome or "").strip()[:120]

    def _tx(cursor: Any) -> dict[str, Any]:
        return _acquire_on_cursor(
            cursor,
            int(nro),
            int(ano),
            int(ponto),
            nome_n,
            origem_n,
            token_n,
            when,
            steal_same_ponto=True,
            keep_token_if_same=False,
        )

    return db.execute_transaction([_tx])[0]


def assert_holder_or_acquire(
    nro: int,
    ano: int,
    ponto: int,
    nome: str,
    origem: str = "os_edit",
    token: str | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Garante que o ponto da sessão é o holder; adquire se livre/expirado.

    Se já for o holder, preserva o token da aba (não invalida o heartbeat).
    """
    origem_n = _normalize_origem(origem)
    token_n = _normalize_token(token) if token else str(uuid.uuid4())
    when = now or _now()
    nome_n = (nome or "").strip()[:120]
    keep = not token

    def _tx(cursor: Any) -> dict[str, Any]:
        return _acquire_on_cursor(
            cursor,
            int(nro),
            int(ano),
            int(ponto),
            nome_n,
            origem_n,
            token_n,
            when,
            steal_same_ponto=True,
            keep_token_if_same=keep,
        )

    return db.execute_transaction([_tx])[0]


def heartbeat_lock(
    nro: int,
    ano: int,
    ponto: int,
    token: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    token_n = (token or "").strip()
    if len(token_n) < 8:
        raise ValueError("token inválido")
    when = now or _now()

    def _tx(cursor: Any) -> dict[str, Any]:
        cursor.execute(_SELECT_FOR_UPDATE, (int(nro), int(ano)))
        row = cursor.fetchone()
        if not row or not _is_fresh(row, when):
            raise OsEditLockGoneError("lock expirado")
        holder = _row_ponto(row)
        if holder != int(ponto) or str(row.get("token") or "") != token_n:
            raise OsEditLockGoneError("lock de outra aba ou usuário")
        cursor.execute(_HEARTBEAT_SQL, (when, int(nro), int(ano), int(ponto), token_n))
        return {
            "held": True,
            "heartbeat_at": when.isoformat(sep=" ", timespec="seconds"),
        }

    return db.execute_transaction([_tx])[0]


def release_lock(
    nro: int,
    ano: int,
    ponto: int,
    token: str | None = None,
) -> dict[str, Any]:
    token_n = (token or "").strip()

    def _tx(cursor: Any) -> dict[str, Any]:
        if len(token_n) >= 8:
            cursor.execute(
                _RELEASE_TOKEN_SQL,
                (int(nro), int(ano), int(ponto), token_n[:36]),
            )
        else:
            cursor.execute(_RELEASE_PONTO_SQL, (int(nro), int(ano), int(ponto)))
        return {"released": True}

    return db.execute_transaction([_tx])[0]


def get_lock_status(
    nro: int,
    ano: int,
    ponto: int | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    when = now or _now()
    rows = db.execute_query(_SELECT_STATUS, (int(nro), int(ano)))
    if not rows:
        return {
            "locked": False,
            "expired": False,
            "holder_ponto": None,
            "holder_nome": None,
            "origem": None,
            "is_self": False,
        }
    row = rows[0]
    holder = _row_ponto(row)
    fresh = _is_fresh(row, when)
    return {
        "locked": fresh,
        "expired": not fresh,
        "holder_ponto": holder,
        "holder_nome": str(row.get("nome") or ""),
        "origem": str(row.get("origem") or ""),
        "is_self": bool(ponto is not None and holder == int(ponto) and fresh),
    }


def raise_locked_http(exc: OsEditLockedError) -> None:
    from fastapi import HTTPException

    raise HTTPException(status_code=409, detail=exc.to_detail()) from exc


def session_from_request(request: Any) -> Any:
    from security.session_auth import get_session_from_request

    session = getattr(request.state, "sagra_session", None)
    if session is not None:
        return session
    return get_session_from_request(request)


def enforce_interactive_lock(
    request: Any,
    nro: int,
    ano: int,
    origem: str,
) -> Any:
    """Exige sessão e lock do ponto atual. Levanta HTTP 403/409."""
    from fastapi import HTTPException

    session = session_from_request(request)
    if session is None:
        raise HTTPException(
            status_code=403,
            detail="Sessão ausente ou inválida.",
        )
    try:
        assert_holder_or_acquire(
            nro=nro,
            ano=ano,
            ponto=int(session.ponto),
            nome=str(session.nome or ""),
            origem=origem,
        )
    except OsEditLockedError as exc:
        raise_locked_http(exc)
    return session


def release_lock_for_request(request: Any, nro: int, ano: int) -> None:
    session = session_from_request(request)
    if session is None:
        return
    try:
        release_lock(nro, ano, int(session.ponto))
    except Exception as exc:
        logger.warning(
            "Falha ao liberar lock de OS %s/%s: %s", nro, ano, exc
        )

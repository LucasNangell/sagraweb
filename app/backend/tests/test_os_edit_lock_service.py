"""Lock pessimista de edição de OS."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

from services.os_edit_lock_service import (
    TTL_SECONDS,
    OsEditLockedError,
    acquire_lock,
    assert_holder_or_acquire,
    heartbeat_lock,
    release_lock,
)


NOW = datetime(2026, 8, 31, 12, 0, 0)


def _tx_runner(cursor: MagicMock):
    def fake_tx(ops):
        return [ops[0](cursor)]

    return fake_tx


def _row(
    ponto: int = 111,
    nome: str = "Ana",
    token: str = "token-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    heartbeat: datetime | None = None,
    origem: str = "os_edit",
) -> dict:
    hb = heartbeat if heartbeat is not None else NOW - timedelta(seconds=5)
    return {
        "nro_protocolo": 3100,
        "ano_protocolo": 2026,
        "ponto": ponto,
        "nome": nome,
        "origem": origem,
        "token": token,
        "acquired_at": hb,
        "heartbeat_at": hb,
    }


@pytest.fixture
def cursor():
    return MagicMock()


def test_locked_error_message_names_holder():
    exc = OsEditLockedError(918713, "Maria Silva")
    assert "Maria Silva" in exc.message
    assert "918713" in exc.message
    assert "Não é possível editá-la" in exc.message
    detail = exc.to_detail()
    assert detail["code"] == "os_edit_locked"
    assert detail["holder_ponto"] == 918713
    assert detail["holder_nome"] == "Maria Silva"


def test_acquire_inserts_when_free(monkeypatch, cursor):
    cursor.fetchone.return_value = None
    monkeypatch.setattr(
        "services.os_edit_lock_service.db.execute_transaction",
        _tx_runner(cursor),
    )
    result = acquire_lock(
        3100,
        2026,
        222,
        "João",
        "andamento",
        "token-joao-aaaaaaaaaaaaaaaaaaaaaaaaaa",
        now=NOW,
    )
    assert result["held"] is True
    assert result["acquired"] is True
    assert result["ponto"] == 222
    sql = cursor.execute.call_args_list[-1][0][0]
    assert "INSERT INTO tab_os_edit_lock" in sql


def test_acquire_rejects_other_user_fresh(monkeypatch, cursor):
    cursor.fetchone.return_value = _row()
    monkeypatch.setattr(
        "services.os_edit_lock_service.db.execute_transaction",
        _tx_runner(cursor),
    )
    with pytest.raises(OsEditLockedError) as raised:
        acquire_lock(
            3100,
            2026,
            222,
            "João",
            "os_edit",
            "token-joao-aaaaaaaaaaaaaaaaaaaaaaaaaa",
            now=NOW,
        )
    assert raised.value.holder_ponto == 111
    assert raised.value.holder_nome == "Ana"


def test_acquire_steals_expired_lock(monkeypatch, cursor):
    expired = NOW - timedelta(seconds=TTL_SECONDS + 10)
    cursor.fetchone.return_value = _row(heartbeat=expired)
    monkeypatch.setattr(
        "services.os_edit_lock_service.db.execute_transaction",
        _tx_runner(cursor),
    )
    result = acquire_lock(
        3100,
        2026,
        222,
        "João",
        "os_edit",
        "token-joao-aaaaaaaaaaaaaaaaaaaaaaaaaa",
        now=NOW,
    )
    assert result["held"] is True
    assert result["ponto"] == 222
    sql = cursor.execute.call_args_list[-1][0][0]
    assert "UPDATE tab_os_edit_lock" in sql


def test_same_ponto_reacquires_and_replaces_token(monkeypatch, cursor):
    cursor.fetchone.return_value = _row(ponto=222, nome="João", token="old-token-old-token-old-token-old")
    monkeypatch.setattr(
        "services.os_edit_lock_service.db.execute_transaction",
        _tx_runner(cursor),
    )
    result = acquire_lock(
        3100,
        2026,
        222,
        "João",
        "andamento",
        "new-token-new-token-new-token-new",
        now=NOW,
    )
    assert result["token"] == "new-token-new-token-new-token-new"
    assert result["acquired"] is False


def test_assert_holder_keeps_existing_token(monkeypatch, cursor):
    existing = "keep-this-token-keep-this-token-aa"
    cursor.fetchone.return_value = _row(ponto=222, nome="João", token=existing)
    monkeypatch.setattr(
        "services.os_edit_lock_service.db.execute_transaction",
        _tx_runner(cursor),
    )
    result = assert_holder_or_acquire(
        3100, 2026, 222, "João", "os_edit", token=None, now=NOW
    )
    assert result["token"] == existing


def test_heartbeat_rejects_wrong_token(monkeypatch, cursor):
    cursor.fetchone.return_value = _row()
    monkeypatch.setattr(
        "services.os_edit_lock_service.db.execute_transaction",
        _tx_runner(cursor),
    )
    from services.os_edit_lock_service import OsEditLockGoneError

    with pytest.raises(OsEditLockGoneError):
        heartbeat_lock(
            3100,
            2026,
            111,
            "other-token-other-token-other-tok",
            now=NOW,
        )


def test_release_by_token(monkeypatch, cursor):
    monkeypatch.setattr(
        "services.os_edit_lock_service.db.execute_transaction",
        _tx_runner(cursor),
    )
    result = release_lock(
        3100, 2026, 111, "token-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    )
    assert result["released"] is True
    sql = cursor.execute.call_args[0][0]
    assert "DELETE FROM tab_os_edit_lock" in sql
    assert "token" in sql.lower()

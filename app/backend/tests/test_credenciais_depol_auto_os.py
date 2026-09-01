"""Testes do serviço de duplicação de OS e settings DEPOL auto-OS."""
from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from services import credenciais_depol_service as depol
from services.os_duplicate_service import (
    COLS_DETALHES,
    COLS_PROTOCOLO,
    DuplicateOsResult,
    format_ponto_for_andamento,
    sql_ident_list,
)


def test_duplicate_sql_columns_are_unique():
    for block in (COLS_PROTOCOLO, COLS_DETALHES):
        cols = sql_ident_list(block)
        assert cols
        dups = [c for c in cols if cols.count(c) > 1]
        assert dups == [], f"coluna repetida no INSERT de duplicar OS: {dups}"
    assert "FormatoLink" in sql_ident_list(COLS_DETALHES)


def test_format_ponto_for_andamento_digits():
    assert format_ponto_for_andamento("918713") == "918.713"


def test_format_ponto_for_andamento_cliente_prefix():
    # C123 → dígitos 123
    assert format_ponto_for_andamento("C123") == "123"
    # só letra → fallback bruto
    assert format_ponto_for_andamento("C") == "C"


def test_get_auto_os_settings_defaults(monkeypatch):
    monkeypatch.setattr(depol.config_manager, "get", lambda _k, default=None: {})
    s = depol.get_auto_os_settings()
    assert s["auto_criar_os"] is True
    assert s["os_template_nro"] == 20
    assert s["os_template_ano"] == 2026


def test_update_auto_os_settings(monkeypatch):
    stored = {}

    def fake_get(key, default=None):
        if key == "credenciais_depol":
            return dict(stored)
        return default

    def fake_set(key, value):
        if key == "credenciais_depol":
            stored.clear()
            stored.update(value)

    monkeypatch.setattr(depol.config_manager, "get", fake_get)
    monkeypatch.setattr(depol.config_manager, "set", fake_set)
    monkeypatch.setattr(depol.config_manager, "save_config", lambda *a, **k: None)

    out = depol.update_auto_os_settings(
        auto_criar_os=True, os_template_nro=20, os_template_ano=2026
    )
    assert out["auto_criar_os"] is True
    assert stored["auto_criar_os"] is True
    assert stored["os_template_nro"] == 20


def test_create_pedido_flag_off_no_os(monkeypatch):
    monkeypatch.setattr(depol, "ensure_credenciais_depol_schema", lambda: None)
    monkeypatch.setattr(
        depol,
        "_validate_itens_payload",
        lambda itens: [
            {
                "ordem": 1,
                "modelo_arquivo": "a.jpg",
                "linha1": "A",
                "linha2": None,
                "linha3": None,
            }
        ],
    )
    monkeypatch.setattr(
        depol, "get_auto_os_settings", lambda: {"auto_criar_os": False}
    )

    calls = {"auto": 0}

    def boom(*_a, **_k):
        calls["auto"] += 1
        raise AssertionError("não deveria criar OS")

    monkeypatch.setattr(depol, "_auto_criar_e_vincular_os", boom)
    monkeypatch.setattr(
        depol.db,
        "execute_transaction",
        lambda ops: [op(MagicMock()) if callable(op) else None for op in ops],
    )

    # _insert returns id via lastrowid — simulate
    def tx(ops):
        cur = MagicMock()
        cur.lastrowid = 55
        return [ops[0](cur)]

    monkeypatch.setattr(depol.db, "execute_transaction", tx)
    monkeypatch.setattr(
        depol,
        "get_pedido",
        lambda pid: {
            "id": pid,
            "status": depol.STATUS_ABERTO,
            "itens": [],
            "nro_protocolo": None,
            "ano_protocolo": None,
        },
    )

    ped = depol.create_pedido(criado_por="10", itens=[{"modelo_arquivo": "a.jpg", "linha1": "A"}])
    assert ped["id"] == 55
    assert ped["status"] == depol.STATUS_ABERTO
    assert calls["auto"] == 0


def test_create_pedido_flag_on_calls_auto(monkeypatch):
    monkeypatch.setattr(depol, "ensure_credenciais_depol_schema", lambda: None)
    monkeypatch.setattr(
        depol,
        "_validate_itens_payload",
        lambda itens: [
            {
                "ordem": 1,
                "modelo_arquivo": "a.jpg",
                "linha1": "A",
                "linha2": None,
                "linha3": None,
            }
        ],
    )
    monkeypatch.setattr(
        depol,
        "get_auto_os_settings",
        lambda: {
            "auto_criar_os": True,
            "os_template_nro": 20,
            "os_template_ano": 2026,
        },
    )

    seen = {}

    def fake_auto(pedido_id, clean_itens, ponto, settings):
        seen["pedido_id"] = pedido_id
        seen["n"] = len(clean_itens)
        seen["ponto"] = ponto
        seen["settings"] = settings

    monkeypatch.setattr(depol, "_auto_criar_e_vincular_os", fake_auto)

    def tx(ops):
        cur = MagicMock()
        cur.lastrowid = 77
        return [ops[0](cur)]

    monkeypatch.setattr(depol.db, "execute_transaction", tx)
    monkeypatch.setattr(
        depol,
        "get_pedido",
        lambda pid: {
            "id": pid,
            "status": depol.STATUS_VINCULADO,
            "itens": [{"ordem": 1}],
            "nro_protocolo": 101,
            "ano_protocolo": 2026,
        },
    )

    ped = depol.create_pedido(criado_por="918713", itens=[{"modelo_arquivo": "a.jpg", "linha1": "A"}])
    assert seen["pedido_id"] == 77
    assert seen["n"] == 1
    assert seen["ponto"] == "918713"
    assert ped["nro_protocolo"] == 101


def test_create_pedido_flag_on_failure_deletes_pedido(monkeypatch):
    monkeypatch.setattr(depol, "ensure_credenciais_depol_schema", lambda: None)
    monkeypatch.setattr(
        depol,
        "_validate_itens_payload",
        lambda itens: [
            {
                "ordem": 1,
                "modelo_arquivo": "a.jpg",
                "linha1": "A",
                "linha2": None,
                "linha3": None,
            }
        ],
    )
    monkeypatch.setattr(
        depol,
        "get_auto_os_settings",
        lambda: {
            "auto_criar_os": True,
            "os_template_nro": 20,
            "os_template_ano": 2026,
        },
    )

    def fail(*_a, **_k):
        raise LookupError("OS 20/2026 não encontrada.")

    monkeypatch.setattr(depol, "_auto_criar_e_vincular_os", fail)

    def tx(ops):
        cur = MagicMock()
        cur.lastrowid = 88
        return [ops[0](cur)]

    monkeypatch.setattr(depol.db, "execute_transaction", tx)
    deleted = []

    def fake_exec(sql, params=None):
        deleted.append((sql, params))
        return []

    monkeypatch.setattr(depol.db, "execute_query", fake_exec)

    with pytest.raises(LookupError):
        depol.create_pedido(
            criado_por="10", itens=[{"modelo_arquivo": "a.jpg", "linha1": "A"}]
        )
    assert any("DELETE FROM tabCredenciaisDepolPedidos" in s for s, _ in deleted)


def test_auto_criar_uses_duplicate_overrides(monkeypatch):
    from datetime import timedelta

    captured = {}

    def fake_dup(**kwargs):
        captured.update(kwargs)
        return DuplicateOsResult(new_id=501, new_year=2026, cod_status="005012026-01")

    monkeypatch.setattr(
        "services.os_duplicate_service.duplicate_os",
        fake_dup,
    )
    monkeypatch.setattr(
        depol,
        "vincular_pedido",
        lambda pid, ano, nro, por: {
            "id": pid,
            "status": depol.STATUS_VINCULADO,
            "ano_protocolo": ano,
            "nro_protocolo": nro,
        },
    )

    depol._auto_criar_e_vincular_os(
        9,
        [{"ordem": 1}, {"ordem": 2}],
        "C42",
        {"os_template_nro": 20, "os_template_ano": 2026},
    )
    assert captured["source_nro"] == 20
    assert captured["source_ano"] == 2026
    assert captured["usuario"] == "C42"
    assert captured["setor_andamento"] == "SEORG"
    assert captured["obs_andamento"] == "2 Credenciais DEPOL"
    assert captured["modelos_arq"] == "2"
    assert captured["entreg_data"] == date.today() + timedelta(days=1)

"""Testes de status rascunho/publicado da Prova WEB (registro)."""
from __future__ import annotations

from typing import Any

import pytest

from services import prova_web_record_service as svc


def _row(**overrides: Any) -> dict[str, Any]:
    base = {
        "Modo": "unico",
        "ArquivoUnico": "arquivo.pdf",
        "ArquivoCapa": None,
        "ArquivoMiolo": None,
        "CropJson": None,
        "Versao": 1,
        "PastaRender": "Prova1",
        "Status": "rascunho",
        "PontoRegistro": 1,
        "DataRegistro": None,
        "DataAtualizacao": None,
    }
    base.update(overrides)
    return base


def test_row_to_record_rascunho_is_draft() -> None:
    rec = svc._row_to_record(_row(Status="rascunho"))
    assert rec["status"] == svc.STATUS_RASCUNHO
    assert rec["isDraft"] is True
    assert rec["versao"] == 1
    assert rec["renderStatus"] == svc.RENDER_READY


def test_row_to_record_render_pending() -> None:
    rec = svc._row_to_record(
        _row(
            Status="rascunho",
            RenderStatus="pending",
            RenderProgress='{"done": 2, "total": 10}',
        )
    )
    assert rec["renderStatus"] == svc.RENDER_PENDING
    assert rec["renderProgress"] == {"done": 2, "total": 10}
    assert rec["isDraft"] is True


def test_row_to_record_publicado() -> None:
    rec = svc._row_to_record(_row(Status="publicado", Versao=2, PastaRender="Prova2"))
    assert rec["status"] == svc.STATUS_PUBLICADO
    assert rec["isDraft"] is False
    assert rec["versao"] == 2
    assert rec["pastaRender"] == "Prova2"


def test_row_to_record_missing_status_defaults_publicado() -> None:
    """Linhas antigas sem coluna Status tratadas como publicadas."""
    row = _row()
    del row["Status"]
    rec = svc._row_to_record(row)
    assert rec["status"] == svc.STATUS_PUBLICADO
    assert rec["isDraft"] is False


def test_set_status_rejects_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple] = []

    def fake_execute(sql: str, params=None):
        calls.append((sql, params))
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_execute)
    with pytest.raises(ValueError, match="Status inválido"):
        svc.set_prova_web_status(2026, 1, 1, "lixo")
    assert calls == []


def test_set_status_updates(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Any] = []

    def fake_execute(sql: str, params=None):
        calls.append(params)
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_execute)
    svc.set_prova_web_status(2026, 10, 2, svc.STATUS_PUBLICADO)
    assert calls
    assert calls[0]["status"] == svc.STATUS_PUBLICADO
    assert calls[0]["versao"] == 2


def test_delete_version(monkeypatch: pytest.MonkeyPatch) -> None:
    state = {"exists": True}

    def fake_get(ano, os_id, versao):
        if state["exists"]:
            return {"versao": versao, "isDraft": True}
        return None

    deleted: list[Any] = []

    def fake_execute(sql: str, params=None):
        deleted.append((sql, params))
        state["exists"] = False
        return []

    monkeypatch.setattr(svc, "get_prova_web_record_by_versao", fake_get)
    monkeypatch.setattr(svc.db, "execute_query", fake_execute)
    assert svc.delete_prova_web_version(2026, 10, 1) is True
    assert deleted
    assert svc.delete_prova_web_version(2026, 10, 1) is False

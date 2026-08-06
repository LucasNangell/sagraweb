"""Decisões de PUT/aprov/descartar rascunho — lógica coberta com mocks."""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


def test_replace_draft_when_latest_is_draft() -> None:
    """Mesma versão se última é rascunho e nova=False."""
    existing = {"isDraft": True, "versao": 2, "pastaRender": "Prova2"}
    body_nova = False
    replace_draft = bool(existing and existing.get("isDraft") and not body_nova)
    assert replace_draft is True


def test_no_replace_when_publicado_and_nova_false() -> None:
    existing = {"isDraft": False, "versao": 1}
    body_nova = False
    replace_draft = bool(existing and existing.get("isDraft") and not body_nova)
    assert replace_draft is False
    # Rota real responde 409 neste caso


def test_nova_true_increments_even_if_draft() -> None:
    """nova=true força nova versão (não replace)."""
    existing = {"isDraft": True, "versao": 1}
    body_nova = True
    replace_draft = bool(existing and existing.get("isDraft") and not body_nova)
    assert replace_draft is False


def test_aprovar_rejects_publicado(monkeypatch: pytest.MonkeyPatch) -> None:
    from routers import prova_web_routes as routes

    monkeypatch.setattr(routes, "_require_prova_web", lambda _r: None)
    monkeypatch.setattr(
        routes,
        "get_prova_web_record_by_versao",
        lambda *_a, **_k: {"isDraft": False, "versao": 1},
    )
    with pytest.raises(HTTPException) as ei:
        routes.aprovar_prova_web(2026, 1, 1, MagicMock())
    assert ei.value.status_code == 409


def test_aprovar_publishes_and_returns_portal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from routers import prova_web_routes as routes

    monkeypatch.setattr(routes, "_require_prova_web", lambda _r: None)
    draft = {"isDraft": True, "versao": 2, "status": "rascunho"}
    published = {"isDraft": False, "versao": 2, "status": "publicado"}
    state: dict[str, Any] = {"rec": draft}
    status_calls: list[str] = []

    def fake_get(*_a, **_k):
        return state["rec"]

    def fake_set(_ano, _os, _v, status):
        status_calls.append(status)
        state["rec"] = published

    monkeypatch.setattr(routes, "get_prova_web_record_by_versao", fake_get)
    monkeypatch.setattr(routes, "set_prova_web_status", fake_set)
    monkeypatch.setattr(routes, "_session_ponto", lambda _r: 99)
    monkeypatch.setattr(
        routes,
        "_ensure_portal_link",
        lambda *_a, **_k: "https://example/prova?t=abc",
    )

    out = routes.aprovar_prova_web(2026, 10, 2, MagicMock())
    assert status_calls == [routes.STATUS_PUBLICADO]
    assert out["portalUrl"].endswith("abc")
    assert out["versao"] == 2
    assert out["record"]["isDraft"] is False


def test_descartar_rejects_publicado(monkeypatch: pytest.MonkeyPatch) -> None:
    from routers import prova_web_routes as routes

    monkeypatch.setattr(routes, "_require_prova_web", lambda _r: None)
    monkeypatch.setattr(
        routes,
        "get_prova_web_record_by_versao",
        lambda *_a, **_k: {"isDraft": False, "versao": 1},
    )
    with pytest.raises(HTTPException) as ei:
        routes.descartar_prova_web(2026, 1, 1, MagicMock())
    assert ei.value.status_code == 409


def test_descartar_deletes_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    from routers import prova_web_routes as routes

    monkeypatch.setattr(routes, "_require_prova_web", lambda _r: None)
    monkeypatch.setattr(
        routes,
        "get_prova_web_record_by_versao",
        lambda *_a, **_k: {
            "isDraft": True,
            "versao": 1,
            "pastaRender": "Prova1",
        },
    )
    monkeypatch.setattr(routes, "_os_folder", lambda *_a: None)
    expire_calls: list[tuple] = []
    delete_calls: list[tuple] = []
    monkeypatch.setattr(
        routes,
        "_expire_prova_web_tokens",
        lambda *a: expire_calls.append(a),
    )
    monkeypatch.setattr(
        routes,
        "delete_prova_web_version",
        lambda *a: delete_calls.append(a) or True,
    )
    monkeypatch.setattr(routes, "_get_record", lambda *_a: None)
    monkeypatch.setattr(routes, "count_prova_web_versions", lambda *_a: 0)

    out = routes.descartar_prova_web(2026, 10, 1, MagicMock())
    assert expire_calls == [(2026, 10, 1)]
    assert delete_calls == [(2026, 10, 1)]
    assert out["ok"] is True
    assert out["record"] is None

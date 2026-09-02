"""Lookup GAL de nome por ponto no portal de prova."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from services.proof_gal_lookup_service import pick_gal_display_name


class TestPickGalDisplayName:
    def test_prefers_full_name_over_ponto_label(self):
        items = [
            {"name": "P_6220", "email": "p_6220@camara.leg.br"},
            {"name": "Maria Souza", "email": "p_6220@camara.leg.br"},
        ]
        assert pick_gal_display_name(items, "6220") == "Maria Souza"

    def test_skips_ponto_only_label(self):
        items = [{"name": "P_6220", "email": "p_6220@camara.leg.br"}]
        assert pick_gal_display_name(items, "6220") is None

    def test_accepts_display_name_when_email_is_not_ponto(self):
        items = [
            {"name": "Maria Souza", "email": "maria.souza@camara.leg.br"},
        ]
        assert pick_gal_display_name(items, "6220") == "Maria Souza"

    def test_empty_returns_none(self):
        assert pick_gal_display_name([], "6220") is None


class TestLookupDisplayNameForPonto:
    def test_calls_resolve_names_with_p_prefix(self, monkeypatch):
        from services import proof_gal_lookup_service as svc

        captured = {}

        class FakeEws:
            def __init__(self, **kwargs):
                captured["timeout"] = kwargs.get("timeout")

            def resolve_names(self, query, max_results=20):
                captured["query"] = query
                return [{"name": "Joao da Silva", "email": "p_918713@camara.leg.br"}]

        monkeypatch.setattr(
            "services.proof_gal_lookup_service.get_runtime_config",
            lambda _p: None,
        )
        monkeypatch.setattr(
            "services.proof_gal_lookup_service.get_default_runtime_config",
            lambda: type("C", (), {"ews_url": "https://example.test/EWS", "verify_ssl": False})(),
        )

        import services.ews_service as ews_mod

        monkeypatch.setattr(ews_mod, "EWSService", FakeEws)

        nome = svc.lookup_display_name_for_ponto("918713")
        assert captured["query"] == "P_918713"
        assert captured["timeout"] == 8
        assert nome == "Joao da Silva"

    def test_unavailable_returns_none(self, monkeypatch):
        from services import proof_gal_lookup_service as svc
        from services.ews_service import EWSUnavailableError

        class FakeEws:
            def __init__(self, **kwargs):
                pass

            def resolve_names(self, query, max_results=20):
                raise EWSUnavailableError("timeout")

        monkeypatch.setattr(
            "services.proof_gal_lookup_service.get_runtime_config",
            lambda _p: None,
        )
        monkeypatch.setattr(
            "services.proof_gal_lookup_service.get_default_runtime_config",
            lambda: type("C", (), {"ews_url": "https://example.test/EWS", "verify_ssl": False})(),
        )
        import services.ews_service as ews_mod

        monkeypatch.setattr(ews_mod, "EWSService", FakeEws)

        assert svc.lookup_display_name_for_ponto("918713") is None


class TestLookupProofPessoaRoute:
    def test_invalid_token_403(self, monkeypatch):
        from routers.proof_portal_routes import lookup_proof_pessoa

        def boom(*_a, **_k):
            raise HTTPException(status_code=403, detail="Token inválido ou expirado.")

        monkeypatch.setattr("routers.proof_portal_routes._validate_proof_token", boom)
        with pytest.raises(HTTPException) as exc:
            lookup_proof_pessoa(2026, 100, "bad-token", "918713")
        assert exc.value.status_code == 403

    def test_invalid_ponto_400(self, monkeypatch):
        from routers.proof_portal_routes import lookup_proof_pessoa

        monkeypatch.setattr(
            "routers.proof_portal_routes._validate_proof_token",
            lambda *_a, **_k: {"ID": 1},
        )
        with pytest.raises(HTTPException) as exc:
            lookup_proof_pessoa(2026, 100, "valid-token", "12")
        assert exc.value.status_code == 400

    def test_returns_nome_from_gal(self, monkeypatch):
        from routers.proof_portal_routes import lookup_proof_pessoa

        monkeypatch.setattr(
            "routers.proof_portal_routes._validate_proof_token",
            lambda *_a, **_k: {"ID": 1},
        )
        monkeypatch.setattr(
            "services.proof_gal_lookup_service.lookup_display_name_for_ponto",
            lambda digits: "Maria Souza" if digits == "6220" else None,
        )
        result = lookup_proof_pessoa(2026, 100, "valid-token", "P_6220")
        assert result == {"nome": "Maria Souza"}

    def test_empty_gal_returns_null_nome(self, monkeypatch):
        from routers.proof_portal_routes import lookup_proof_pessoa

        monkeypatch.setattr(
            "routers.proof_portal_routes._validate_proof_token",
            lambda *_a, **_k: {"ID": 1},
        )
        monkeypatch.setattr(
            "services.proof_gal_lookup_service.lookup_display_name_for_ponto",
            lambda _digits: None,
        )
        result = lookup_proof_pessoa(2026, 100, "valid-token", "918713")
        assert result == {"nome": None}

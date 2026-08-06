"""Testes — admin de modelos Papelaria (upload .cdr)."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def admin_svc():
    from services import papelaria_modelo_admin_service as svc

    return svc


class TestResolveCdrDir:
    def test_dev_usa_pasta_local(self, admin_svc, monkeypatch):
        from config_manager import config_manager

        monkeypatch.setattr(config_manager, "is_development", lambda: True)
        monkeypatch.delenv("SAGRA_PAPELARIA_MODELS_DIR", raising=False)
        dest = admin_svc._resolve_cdr_dir()
        assert "Modelos" in str(dest)
        assert dest.name == "cdr"

    def test_producao_usa_unc_web(self, admin_svc, monkeypatch):
        from config_manager import config_manager

        monkeypatch.setattr(config_manager, "is_development", lambda: False)
        monkeypatch.delenv("SAGRA_PAPELARIA_MODELS_DIR", raising=False)
        dest = admin_svc._resolve_cdr_dir()
        assert str(dest).startswith("\\\\")
        assert dest.name == "WEB"

    def test_env_override(self, admin_svc, monkeypatch, tmp_path):
        monkeypatch.setenv("SAGRA_PAPELARIA_MODELS_DIR", str(tmp_path))
        assert admin_svc._resolve_cdr_dir() == tmp_path

    def test_save_cdr_upload_grava_arquivo(self, admin_svc, monkeypatch, tmp_path):
        monkeypatch.setenv("SAGRA_PAPELARIA_MODELS_DIR", str(tmp_path))
        name = admin_svc.save_cdr_upload("Cartao.cdr", b"RIFF")
        assert name == "Cartao.cdr"
        assert (tmp_path / "Cartao.cdr").read_bytes() == b"RIFF"


class TestCreateModeloFromCdr:
    def test_insert_com_colunas_legadas(self, admin_svc, monkeypatch, tmp_path):
        from services import papelaria_models_service as models_svc

        monkeypatch.setenv("SAGRA_PAPELARIA_MODELS_DIR", str(tmp_path))
        monkeypatch.setattr(models_svc, "ensure_papelaria_modelos_table", lambda: None)
        monkeypatch.setattr(
            "services.papelaria_models_service._table_has_column",
            lambda col: col
            in {
                "NomeProduto",
                "NomeArquivo",
                "ConfigCampos",
                "MockupConfigJson",
                "PreviewConfigJson",
            },
        )
        monkeypatch.setattr(
            "services.papelaria_modelo_admin_service.get_modelo_admin_by_id",
            lambda mid: {"id": mid, "produto": "Ct Visita", "nome_exibicao": "Ct Visita"},
        )

        captured: dict = {}

        def fake_query(sql, params=None):
            sql_norm = " ".join(sql.split())
            if "INSERT INTO tabPapelariaModelos" in sql_norm:
                captured["insert_sql"] = sql_norm
                captured["insert_params"] = params
            elif "SELECT COALESCE(MAX(Ordem)" in sql_norm:
                return [{"max_ordem": 10}]
            elif "SELECT ID FROM tabPapelariaModelos" in sql_norm and "ORDER BY ID DESC" in sql_norm:
                return [{"ID": 99}]
            return []

        monkeypatch.setattr(admin_svc.db, "execute_query", fake_query)

        result = admin_svc.create_modelo_from_cdr(
            produto="Ct Visita",
            frente_verso="Frente",
            cores="Policromia",
            filename="CtVisitaFV.cdr",
            content=b"RIFF",
        )

        assert result["id"] == 99
        assert "NomeProduto" in captured["insert_sql"]
        assert "NomeArquivo" in captured["insert_sql"]
        assert "ConfigCampos" in captured["insert_sql"]

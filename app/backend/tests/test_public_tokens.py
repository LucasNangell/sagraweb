"""Tokens públicos de portal — validação isolada (mock DB)."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException


class TestProofPortalToken:
    def test_valid_token_returns_row(self, monkeypatch):
        from routers.proof_portal_routes import _validate_proof_token

        row = {
            "ID": 1,
            "Versao": "1",
            "ArquivoProva": None,
            "Aprovado": None,
            "DataExpiracao": None,
        }
        monkeypatch.setattr(
            "routers.proof_portal_routes.db.execute_query",
            lambda *_a, **_k: [row],
        )
        result = _validate_proof_token(100, 2025, "valid-token")
        assert result["Versao"] == "1"

    def test_expired_token_rejected(self, monkeypatch):
        from routers.proof_portal_routes import _validate_proof_token

        row = {
            "ID": 1,
            "Versao": "1",
            "Aprovado": None,
            "DataExpiracao": datetime.now() - timedelta(days=1),
        }
        monkeypatch.setattr(
            "routers.proof_portal_routes.db.execute_query",
            lambda *_a, **_k: [row],
        )
        with pytest.raises(HTTPException) as exc:
            _validate_proof_token(100, 2025, "expired-token")
        assert exc.value.status_code == 403

    def test_wrong_os_rejected(self, monkeypatch):
        from routers.proof_portal_routes import _validate_proof_token

        monkeypatch.setattr(
            "routers.proof_portal_routes.db.execute_query",
            lambda *_a, **_k: [],
        )
        with pytest.raises(HTTPException) as exc:
            _validate_proof_token(999, 2025, "other-os-token")
        assert exc.value.status_code == 403

    def test_respond_reject_without_observacao_rejected(self, monkeypatch):
        from routers.proof_portal_routes import ProofResponseRequest, respond_proof

        row = {
            "ID": 1,
            "Versao": "1",
            "ArquivoProva": None,
            "Aprovado": None,
            "DataExpiracao": None,
        }
        monkeypatch.setattr(
            "routers.proof_portal_routes.db.execute_query",
            lambda *_a, **_k: [row],
        )
        req = ProofResponseRequest(
            token="valid-token-1234567890",
            os_id=100,
            ano=2025,
            aprovado=False,
            observacao="",
            nome_cliente="Cliente Teste",
            ponto="918713",
        )

        class DummyRequest:
            headers = {}
            client = type("C", (), {"host": "127.0.0.1"})()

        with pytest.raises(HTTPException) as exc:
            respond_proof(req, DummyRequest())
        assert exc.value.status_code == 400
        assert "Observações" in exc.value.detail


class TestProofAndamentoRegistration:
    def _mock_transaction(self, monkeypatch):
        captured = {}

        def fake_transaction(fns):
            class Cursor:
                def execute(self, sql, params=None):
                    sql_str = str(sql)
                    if "INSERT INTO tabAndamento" in sql_str:
                        captured["insert"] = params
                    elif "SELECT MAX" in sql_str:
                        captured["max_cod"] = True

                def fetchone(self):
                    return None

            for fn in fns:
                fn(Cursor())
            return ["0012025-01"]

        monkeypatch.setattr(
            "routers.proof_portal_routes.db.execute_transaction",
            fake_transaction,
        )
        monkeypatch.setattr(
            "routers.proof_portal_routes.log_andamento_added",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "routers.mdb_writer.push_andamento_to_mdb_after_mysql",
            lambda *args, **kwargs: None,
        )
        return captured

    def test_approve_obs_includes_cliente_and_ponto(self, monkeypatch):
        from routers.proof_portal_routes import _register_proof_andamento

        self._mock_transaction(monkeypatch)
        result = _register_proof_andamento(
            os_id=100,
            ano=2025,
            versao="2",
            aprovado=True,
            observacao="",
            nome_cliente="João Silva",
            ponto_cliente="918713",
            client_ip="127.0.0.1",
        )

        assert result["situacao"] == "Em Execução"
        assert "Prova v2 aprovada pelo cliente (João Silva - 918.713)" in result["obs"]

    def test_reject_registers_em_execucao_sefoc_with_alteracoes(self, monkeypatch):
        from routers.proof_portal_routes import _register_proof_andamento

        captured = self._mock_transaction(monkeypatch)
        result = _register_proof_andamento(
            os_id=100,
            ano=2025,
            versao="1",
            aprovado=False,
            observacao="Trocar cor do logo\nAjustar margem",
            nome_cliente="Maria Souza",
            ponto_cliente="12345",
            client_ip="127.0.0.1",
        )

        assert result["situacao"] == "Em Execução"
        assert (
            "O cliente (Maria Souza - 12.345) solicitou as seguintes alterações:"
            in result["obs"]
        )
        assert "Trocar cor do logo" in result["obs"]
        assert "Ajustar margem" in result["obs"]

        insert = captured["insert"]
        assert insert[3] == "Em Execução"
        assert insert[4] == "SEFOC"
        assert insert[6] == "12.345"

    def test_reject_papelaria_registers_alterar_prova(self, monkeypatch):
        from routers.proof_portal_routes import _register_proof_andamento

        captured = self._mock_transaction(monkeypatch)
        result = _register_proof_andamento(
            os_id=5001,
            ano=2025,
            versao="3",
            aprovado=False,
            observacao="",
            nome_cliente="Cliente Papelaria",
            ponto_cliente="918713",
            client_ip="127.0.0.1",
            papelaria_alteracao=True,
        )

        assert result["situacao"] == "Em Execução"
        assert "Alterar Prova 3" in result["obs"]
        insert = captured["insert"]
        assert insert[3] == "Em Execução"
        assert insert[4] == "SEFOC"


class TestOsArquivosToken:
    def test_valid_token_for_os(self, monkeypatch):
        from services.os_arquivos_service import validate_os_arquivos_token

        monkeypatch.setattr(
            "services.os_arquivos_service.ensure_tokens_table",
            lambda: None,
        )
        monkeypatch.setattr(
            "services.os_arquivos_service.db.execute_query",
            lambda *_a, **_k: [{"ID": 1, "DataExpiracao": None}],
        )
        row = validate_os_arquivos_token(100, 2025, "tok-abc")
        assert row["ID"] == 1

    def test_token_for_other_os_rejected(self, monkeypatch):
        from services.os_arquivos_service import validate_os_arquivos_token

        monkeypatch.setattr(
            "services.os_arquivos_service.ensure_tokens_table",
            lambda: None,
        )
        monkeypatch.setattr(
            "services.os_arquivos_service.db.execute_query",
            lambda *_a, **_k: [],
        )
        with pytest.raises(ValueError, match="inválido"):
            validate_os_arquivos_token(200, 2025, "tok-abc")

    def test_expired_arquivos_token_rejected(self, monkeypatch):
        from services.os_arquivos_service import validate_os_arquivos_token

        monkeypatch.setattr(
            "services.os_arquivos_service.ensure_tokens_table",
            lambda: None,
        )
        monkeypatch.setattr(
            "services.os_arquivos_service.db.execute_query",
            lambda *_a, **_k: [{"ID": 1, "DataExpiracao": datetime.now()}],
        )
        with pytest.raises(ValueError, match="expirado"):
            validate_os_arquivos_token(100, 2025, "tok-expired")


class TestClientAnalysisToken:
    def test_client_token_wrong_os(self, monkeypatch):
        from routers.analise_routes import _validate_client_token_row

        monkeypatch.setattr(
            "routers.analise_routes.db.execute_query",
            lambda *_a, **_k: [],
        )
        with pytest.raises(HTTPException) as exc:
            _validate_client_token_row(999, 2025, "client-tok")
        assert exc.value.status_code == 403

"""Testes — seleção de PDF de prova no envio de e-mail e portal tokenizado."""
from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


class TestValidateProofFilename:
    def test_rejects_path_traversal(self):
        from services.proof_files_service import validate_proof_filename

        with pytest.raises(HTTPException) as exc:
            validate_proof_filename("../secret.pdf")
        assert exc.value.status_code == 400

    def test_rejects_non_pdf(self):
        from services.proof_files_service import validate_proof_filename

        with pytest.raises(HTTPException) as exc:
            validate_proof_filename("arquivo.txt")
        assert exc.value.status_code == 400

    def test_accepts_basename(self):
        from services.proof_files_service import validate_proof_filename

        assert validate_proof_filename("prova_v2.pdf") == "prova_v2.pdf"


class TestListProofPdfFiles:
    def test_lists_only_pdf_names_without_unc(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        pdf_a = sefoc / "prova_a.pdf"
        pdf_b = sefoc / "prova_b.pdf"
        pdf_a.write_bytes(b"%PDF-1.4 test")
        pdf_b.write_bytes(b"%PDF-1.4 test")
        (sefoc / "nota.txt").write_text("x", encoding="utf-8")

        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: str(sefoc))

        result = svc.list_proof_pdf_files(2026, 1234)
        assert result["os"] == 1234
        assert result["ano"] == 2026
        names = {f["name"] for f in result["files"]}
        assert names == {"prova_a.pdf", "prova_b.pdf"}
        for entry in result["files"]:
            assert "path" not in entry
            assert "\\\\" not in entry["name"]
        assert result["suggested"] in names

    def test_empty_when_no_sefoc(self, monkeypatch):
        from services import proof_files_service as svc

        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: None)
        result = svc.list_proof_pdf_files(2026, 999)
        assert result["files"] == []
        assert result["suggested"] is None

    def test_suggested_prefers_highest_prova_sefoc_over_mtime(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        older = sefoc / "6093-ProvaSefoc 3.pdf"
        newer = sefoc / "6093-ProvaSefoc 4.pdf"
        older.write_bytes(b"%PDF-1.4 v3")
        newer.write_bytes(b"%PDF-1.4 v4")
        # Touch older last so mtime alone preferiria a 3
        os.utime(newer, (1_700_000_000, 1_700_000_000))
        os.utime(older, (1_800_000_000, 1_800_000_000))

        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: str(sefoc))
        result = svc.list_proof_pdf_files(2026, 6093)
        assert result["suggested"] == "6093-ProvaSefoc 4.pdf"

    def test_suggested_falls_back_to_mtime_without_prova_pattern(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        a = sefoc / "alpha.pdf"
        b = sefoc / "beta.pdf"
        a.write_bytes(b"%PDF-a")
        b.write_bytes(b"%PDF-b")
        os.utime(a, (1_700_000_000, 1_700_000_000))
        os.utime(b, (1_800_000_000, 1_800_000_000))

        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: str(sefoc))
        result = svc.list_proof_pdf_files(2026, 100)
        assert result["suggested"] == "beta.pdf"


class TestExtractProvaVersionFromFilename:
    def test_prova_sefoc_pattern(self):
        from services.proof_files_service import extract_prova_version_from_filename

        assert (
            extract_prova_version_from_filename(
                "6093-26-Nome-ProvaSefoc 4.pdf"
            )
            == 4
        )

    def test_legacy_pattern(self):
        from services.proof_files_service import extract_prova_version_from_filename

        assert extract_prova_version_from_filename("05024-Prova2_SEFOC.pdf") == 2

    def test_no_pattern(self):
        from services.proof_files_service import extract_prova_version_from_filename

        assert extract_prova_version_from_filename("prova_livre.pdf") is None


class TestResolveProofPdfPath:
    def test_resolves_under_sefoc(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        pdf = sefoc / "escolhido.pdf"
        pdf.write_bytes(b"%PDF")

        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: str(sefoc))
        path = svc.resolve_proof_pdf_path(2026, 100, "escolhido.pdf")
        assert path == str(pdf)

    def test_resolves_subfolder_under_sefoc(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        offset = sefoc / "Offset"
        offset.mkdir(parents=True)
        pdf = offset / "escolhido.pdf"
        pdf.write_bytes(b"%PDF")

        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: str(sefoc))
        path = svc.resolve_proof_pdf_path(2026, 100, "Offset/escolhido.pdf")
        assert path == str(pdf)

    def test_missing_file_404(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: str(sefoc))

        with pytest.raises(HTTPException) as exc:
            svc.resolve_proof_pdf_path(2026, 100, "ausente.pdf")
        assert exc.value.status_code == 404


class TestEnsureProofToken:
    def test_reuses_same_file_and_version(self, monkeypatch):
        from routers import proof_portal_routes as routes

        calls: list[tuple] = []

        def fake_query(sql, params=None):
            sql_norm = " ".join(sql.split())
            if "SELECT ID, Token, Versao, ArquivoProva" in sql_norm:
                return [
                    {
                        "ID": 1,
                        "Token": "existing-token",
                        "Versao": "2",
                        "ArquivoProva": "prova.pdf",
                    }
                ]
            if "UPDATE tabProofTokens" in sql_norm and "PontoEnvio" in sql_norm:
                calls.append(("update", params))
                return []
            return []

        monkeypatch.setattr(routes.db, "execute_query", fake_query)

        token = routes.ensure_proof_token(
            100, 2026, "2", "prova.pdf", ponto_envio="918713"
        )
        assert token == "existing-token"
        assert any(c[0] == "update" for c in calls)

    def test_expires_and_creates_new_when_file_differs(self, monkeypatch):
        from routers import proof_portal_routes as routes

        sql_log: list[str] = []

        def fake_query(sql, params=None):
            sql_norm = " ".join(sql.split())
            sql_log.append(sql_norm)
            if "SELECT ID, Token, Versao, ArquivoProva" in sql_norm:
                return [
                    {
                        "ID": 1,
                        "Token": "old-token",
                        "Versao": "1",
                        "ArquivoProva": "antigo.pdf",
                    }
                ]
            if sql_norm.startswith("UPDATE tabProofTokens SET DataExpiracao"):
                return []
            if sql_norm.startswith("INSERT INTO tabProofTokens"):
                return []
            return []

        monkeypatch.setattr(routes.db, "execute_query", fake_query)
        monkeypatch.setattr(routes.secrets, "token_urlsafe", lambda _n: "new-token-xyz")

        token = routes.ensure_proof_token(100, 2026, "2", "novo.pdf")
        assert token == "new-token-xyz"
        assert any("DataExpiracao = NOW()" in s for s in sql_log)
        assert any(s.startswith("INSERT INTO tabProofTokens") for s in sql_log)

    def test_expires_token_prova3_when_publishing_prova4(self, monkeypatch):
        """Regressão: reenvio com ProvaSefoc 4 invalida token pendente da 3."""
        from routers import proof_portal_routes as routes

        sql_log: list[str] = []
        insert_params: list = []

        def fake_query(sql, params=None):
            sql_norm = " ".join(sql.split())
            sql_log.append(sql_norm)
            if "SELECT ID, Token, Versao, ArquivoProva" in sql_norm:
                return [
                    {
                        "ID": 10,
                        "Token": "token-prova-3",
                        "Versao": "3",
                        "ArquivoProva": "6093-ProvaSefoc 3.pdf",
                    }
                ]
            if sql_norm.startswith("UPDATE tabProofTokens SET DataExpiracao"):
                return []
            if sql_norm.startswith("INSERT INTO tabProofTokens"):
                insert_params.append(params)
                return []
            return []

        monkeypatch.setattr(routes.db, "execute_query", fake_query)
        monkeypatch.setattr(routes.secrets, "token_urlsafe", lambda _n: "token-prova-4")

        token = routes.ensure_proof_token(
            6093, 2026, "4", "6093-ProvaSefoc 4.pdf", ponto_envio="918713"
        )
        assert token == "token-prova-4"
        assert any("DataExpiracao = NOW()" in s for s in sql_log)
        assert insert_params
        # params may be tuple/list/dict depending on call site
        flat = insert_params[0]
        if isinstance(flat, dict):
            assert flat.get("Versao") == "4" or "4" in flat.values()
            assert any(
                "ProvaSefoc 4" in str(v) for v in flat.values()
            )
        else:
            assert "4" in flat
            assert any("ProvaSefoc 4" in str(p) for p in flat)


class TestResolveProofPdfForTokenRow:
    def test_uses_arquivo_prova_when_set(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        pdf = sefoc / "vinculado.pdf"
        pdf.write_bytes(b"%PDF")

        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: str(sefoc))

        path, name = svc.resolve_proof_pdf_for_token_row(
            {"ArquivoProva": "vinculado.pdf"},
            2026,
            100,
        )
        assert path == str(pdf)
        assert name == "vinculado.pdf"

    def test_legacy_fallback_without_arquivo(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        pdf = sefoc / "latest.pdf"
        pdf.write_bytes(b"%PDF")

        monkeypatch.setattr(svc, "_sefoc_dir", lambda _a, _o: str(sefoc))

        path, name = svc.resolve_proof_pdf_for_token_row({}, 2026, 100)
        assert path == str(pdf)
        assert name == "latest.pdf"


class TestSendPtProofValidation:
    def test_proof_without_filename_rejected(self, monkeypatch):
        from routers.email_routes import EmailPTRequest, send_pt_email

        session = MagicMock()
        session.ponto = "918713"

        req = EmailPTRequest(
            os=100,
            ano=2026,
            versao="1",
            to=["a@b.com"],
            ponto="918713",
            type="proof",
            proof_filename=None,
        )

        with pytest.raises(HTTPException) as exc:
            send_pt_email(req, session)
        assert exc.value.status_code == 400
        assert "PDF" in exc.value.detail


class TestProofPortalValidateToken:
    def test_valid_token_includes_arquivo_prova(self, monkeypatch):
        from routers.proof_portal_routes import _validate_proof_token

        row = {
            "ID": 1,
            "Versao": "1",
            "ArquivoProva": "prova.pdf",
            "Aprovado": None,
            "DataExpiracao": None,
        }
        monkeypatch.setattr(
            "routers.proof_portal_routes.db.execute_query",
            lambda *_a, **_k: [row],
        )
        result = _validate_proof_token(100, 2025, "valid-token")
        assert result["ArquivoProva"] == "prova.pdf"

    def test_expired_token_rejected(self, monkeypatch):
        from routers.proof_portal_routes import _validate_proof_token

        row = {
            "ID": 1,
            "Versao": "1",
            "ArquivoProva": None,
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

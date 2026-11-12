"""Testes do recebimento automático de e-mails."""
from __future__ import annotations

from pathlib import Path

from services.email_auto_receive_service import (
    build_prova_obs,
    classify_email,
    count_original_folders,
    is_os_enabled_for_settings,
    next_original_folder_name,
    strip_blank_lines,
)


class TestClassifyEmail:
    def test_prova_aprovacao_requires_approval_and_ponto(self):
        kind = classify_email(
            subject="Prova OS 1234/2026",
            body="Aprovado pelo gabinete.\nPonto P_918713",
        )
        assert kind == "prova_aprovacao"

    def test_prova_aprovacao_autorizada_lowercase_ponto(self):
        kind = classify_email(
            subject="RE: prova 05001/26",
            body="Documento autorizada.\np_12345",
        )
        assert kind == "prova_aprovacao"

    def test_prova_aprovacao_missing_ponto_skipped(self):
        assert (
            classify_email(
                subject="Prova 100/2026",
                body="Aprovado sem ponto.",
            )
            is None
        )

    def test_prova_aprovacao_missing_approval_skipped(self):
        assert (
            classify_email(
                subject="Prova 100/2026",
                body="Ok P_918713",
            )
            is None
        )

    def test_prova_alteracao(self):
        kind = classify_email(
            subject="Prova SP 5123/2026",
            body="Favor alterar a foto da capa.",
        )
        assert kind == "prova_alteracao"

    def test_prova_alteracao_sinonimo_correcao(self):
        kind = classify_email(
            subject="Prova 200/26",
            body="Precisa de correção no texto.",
        )
        assert kind == "prova_alteracao"

    def test_prova_alteracao_without_ponto_ok(self):
        kind = classify_email(
            subject="Prova 200/26",
            body="Mudanças necessárias no layout.",
        )
        assert kind == "prova_alteracao"

    def test_problemas_tecnicos_with_pdf(self):
        kind = classify_email(
            subject="Problemas técnicos OS 1396/2026",
            body="Segue arquivo.",
            attachment_names=["relatorio.PDF", "nota.txt"],
        )
        assert kind == "problemas_tecnicos"

    def test_problemas_tecnicos_without_pdf_skipped(self):
        assert (
            classify_email(
                subject="Problemas técnicos OS 1396/2026",
                body="Sem anexo útil.",
                attachment_names=["imagem.png"],
            )
            is None
        )

    def test_unrelated_subject_skipped(self):
        assert (
            classify_email(
                subject="Pedido de informação",
                body="Aprovado P_918713",
                attachment_names=["a.pdf"],
            )
            is None
        )


class TestBodyAndObs:
    def test_strip_blank_lines_and_html(self):
        body = "<p>Linha 1</p><p><br></p><p>Linha 2</p>\n\n\nLinha 3"
        assert strip_blank_lines(body) == "Linha 1\nLinha 2\nLinha 3"

    def test_build_prova_obs(self):
        obs = build_prova_obs("Aprovado\n\nP_918713")
        assert obs == "Dar prosseguimento:\n\nAprovado\nP_918713"


class TestOriginalFolders:
    def test_count_and_next_version(self, tmp_path: Path):
        (tmp_path / "Original").mkdir()
        (tmp_path / "Original V2").mkdir()
        (tmp_path / "Foo Original").mkdir()
        (tmp_path / "Sefoc").mkdir()
        (tmp_path / "Original-not-dir.txt").write_text("x", encoding="utf-8")

        assert count_original_folders(str(tmp_path)) == 2
        name, version = next_original_folder_name(str(tmp_path))
        assert version == 3
        assert name == "Original v3"

    def test_first_version_when_empty(self, tmp_path: Path):
        name, version = next_original_folder_name(str(tmp_path))
        assert version == 1
        assert name == "Original v1"


class TestOsSpGate:
    def test_os_toggle(self):
        assert is_os_enabled_for_settings(100, enabled_os=True, enabled_sp=False) is True
        assert is_os_enabled_for_settings(100, enabled_os=False, enabled_sp=True) is False

    def test_sp_toggle(self):
        assert is_os_enabled_for_settings(5000, enabled_os=False, enabled_sp=True) is True
        assert is_os_enabled_for_settings(5123, enabled_os=True, enabled_sp=False) is False


class TestAutoReceiveSettings:
    def test_defaults_and_save_validation(self, monkeypatch, tmp_path: Path):
        from services import email_template_service as svc

        store: dict = {"templates": {}}

        def fake_load():
            return dict(store)

        def fake_save(data):
            store.clear()
            store.update(data)

        monkeypatch.setattr(svc, "_load_raw", fake_load)
        monkeypatch.setattr(svc, "_save_raw", fake_save)

        defaults = svc.get_auto_receive_settings()
        assert defaults == {
            "enabled_os": False,
            "enabled_sp": False,
            "ponto": "",
        }

        try:
            svc.save_auto_receive_settings(
                enabled_os=True,
                enabled_sp=False,
                ponto="",
            )
            raised = False
        except ValueError:
            raised = True
        assert raised

        saved = svc.save_auto_receive_settings(
            enabled_os=True,
            enabled_sp=True,
            ponto="918713",
        )
        assert saved == {
            "enabled_os": True,
            "enabled_sp": True,
            "ponto": "918713",
        }
        assert store["auto_receive"]["ponto"] == "918713"

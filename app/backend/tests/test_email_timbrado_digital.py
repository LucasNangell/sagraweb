"""Testes — resolução de DOCX Timbrado A4 Digital e seed do modelo de e-mail."""
from __future__ import annotations

import pytest
from fastapi import HTTPException


class TestResolveTimbradoDigitalDocx:
    def test_resolve_pair_under_sefoc(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        cor = sefoc / "05954-Pasta-TimbradoA4Digital-Cor.docx"
        pb = sefoc / "05954-Pasta-TimbradoA4Digital-PB.docx"
        cor.write_bytes(b"cor")
        pb.write_bytes(b"pb")

        monkeypatch.setattr(svc, "_sefoc_dir", lambda ano, os_id: str(sefoc))

        resolved = svc.resolve_timbrado_digital_docx_paths(2026, 5954)
        assert resolved["cor_name"].endswith("-TimbradoA4Digital-Cor.docx")
        assert resolved["pb_name"].endswith("-TimbradoA4Digital-PB.docx")
        assert len(resolved["files"]) == 2

    def test_missing_pb_raises(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        (sefoc / "05954-Pasta-TimbradoA4Digital-Cor.docx").write_bytes(b"cor")

        monkeypatch.setattr(svc, "_sefoc_dir", lambda ano, os_id: str(sefoc))

        with pytest.raises(HTTPException) as exc:
            svc.resolve_timbrado_digital_docx_paths(2026, 5954)
        assert exc.value.status_code == 404

    def test_prefers_matching_prefix(self, monkeypatch, tmp_path):
        from services import proof_files_service as svc
        import time

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        old_cor = sefoc / "old-TimbradoA4Digital-Cor.docx"
        old_pb = sefoc / "old-TimbradoA4Digital-PB.docx"
        new_cor = sefoc / "new-TimbradoA4Digital-Cor.docx"
        new_pb = sefoc / "new-TimbradoA4Digital-PB.docx"
        old_cor.write_bytes(b"old")
        old_pb.write_bytes(b"old")
        time.sleep(0.02)
        new_cor.write_bytes(b"new")
        new_pb.write_bytes(b"new")

        monkeypatch.setattr(svc, "_sefoc_dir", lambda ano, os_id: str(sefoc))

        resolved = svc.resolve_timbrado_digital_docx_paths(2026, 5954)
        assert resolved["cor_name"].startswith("new-")
        assert resolved["pb_name"].startswith("new-")


class TestTimbradoEmailTemplateSeed:
    def test_grupo_in_valid_grupos(self):
        from services.email_template_model_service import VALID_GRUPOS

        assert "timbrado_a4_digital" in VALID_GRUPOS

    def test_seed_spec_present(self):
        from services.email_template_model_service import (
            DEFAULT_TIMBRADO_A4_DIGITAL_SUBJECT,
            _SEED_SPECS,
        )

        specs = [s for s in _SEED_SPECS if s["grupo"] == "timbrado_a4_digital"]
        assert len(specs) == 1
        assert specs[0]["variante"] == "sem_portal"
        assert specs[0]["anexar_pdf"] == 1
        assert specs[0]["assunto_override"] == DEFAULT_TIMBRADO_A4_DIGITAL_SUBJECT
        assert "Timbrado A4 digital" in specs[0]["html_override"]

    def test_resolve_send_plan_uses_active_model(self, monkeypatch):
        from services import email_template_model_service as svc

        monkeypatch.setattr(
            svc,
            "resolve_active_email_template_for_grupo",
            lambda grupo: {
                "id": 99,
                "grupo": "timbrado_a4_digital",
                "variante": "sem_portal",
                "anexar_pdf": True,
                "assunto": "subj",
                "html": "<p>x</p>",
            }
            if grupo == "timbrado_a4_digital"
            else None,
        )
        plan = svc.resolve_timbrado_digital_send_plan()
        assert plan["use_attachment"] is True
        assert plan["model"]["id"] == 99

    def test_render_fallback_without_model(self, monkeypatch):
        from services import email_template_model_service as svc

        monkeypatch.setattr(
            svc,
            "resolve_timbrado_digital_send_plan",
            lambda: {
                "grupo": "timbrado_a4_digital",
                "variante": "sem_portal",
                "model": None,
                "use_attachment": True,
                "legacy_fallback": True,
            },
        )
        subject, html = svc.render_timbrado_digital_email(
            {"nr_os": 5954, "ano": 2026, "produto": "Timbrado A4 (Digital)"}
        )
        assert "5954/2026" in subject
        assert "Timbrado A4 digital" in html

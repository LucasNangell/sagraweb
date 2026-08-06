"""Pendências de prova na linha do tempo do portal do cliente."""
from __future__ import annotations

from services.cliente_os_timeline_service import (
    PROOF_APPROVED_PENDENCIA_MENSAGEM,
    _build_milestones,
    _resolve_pendencia_for_step,
)


class TestProofPendenciaTimeline:
    def test_pending_proof_shows_view_button_payload(self, monkeypatch):
        monkeypatch.setattr(
            "services.cliente_os_timeline_service._fetch_proof_token",
            lambda *_a, **_k: ("token-abc", "2"),
        )
        monkeypatch.setattr(
            "services.cliente_os_timeline_service._is_proof_approved",
            lambda *_a, **_k: False,
        )
        monkeypatch.setattr(
            "services.cliente_os_timeline_service._resolve_pendencia_url",
            lambda *_a, **_k: "https://example.test/prova",
        )

        steps = [
            {"situacao": "Saída p/", "setor": "SEFOC", "observacao": ""},
            {
                "situacao": "Aguard. Aprovação",
                "setor": "SEFOC",
                "observacao": "Prova enviada por e-mail",
            },
        ]
        payload = _resolve_pendencia_for_step(
            "preparacao_arquivo",
            steps,
            100,
            2025,
            2,
            _build_milestones(),
        )

        assert payload["pendencia_mensagem"] == "Arquivo aguardando aprovação do cliente"
        assert payload["pendencia_label"] == "Visualizar prova"
        assert payload["pendencia_url"] == "https://example.test/prova"

    def test_approved_proof_hides_button_and_updates_message(self, monkeypatch):
        monkeypatch.setattr(
            "services.cliente_os_timeline_service._fetch_proof_token",
            lambda *_a, **_k: (None, "1"),
        )
        monkeypatch.setattr(
            "services.cliente_os_timeline_service._is_proof_approved",
            lambda *_a, **_k: True,
        )

        steps = [
            {"situacao": "Saída p/", "setor": "SEFOC", "observacao": ""},
            {
                "situacao": "Aguard. Aprovação",
                "setor": "SEFOC",
                "observacao": "Prova enviada por e-mail",
            },
            {
                "situacao": "Em Execução",
                "setor": "SEFOC",
                "observacao": "Prova v1 aprovada pelo cliente (João - 918.713)",
            },
        ]
        payload = _resolve_pendencia_for_step(
            "preparacao_arquivo",
            steps,
            100,
            2025,
            2,
            _build_milestones(),
        )

        assert payload == {
            "pendencia_mensagem": PROOF_APPROVED_PENDENCIA_MENSAGEM,
        }

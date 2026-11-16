"""cliente_alteracao_ainda_pendente — destaque só até gerar nova prova."""
from __future__ import annotations


def test_pendente_quando_ultima_prova_e_a_rejeitada(monkeypatch):
    from services import proof_papelaria_service as svc

    monkeypatch.setattr(
        svc,
        "list_jobs_for_os",
        lambda *_a, **_k: [
            {
                "id": 42,
                "status": "completed",
                "versao": 2,
                "tipo_job": "create",
                "prova_revisao": "pending",
            }
        ],
    )
    assert (
        svc.cliente_alteracao_ainda_pendente(
            2026, 5024, {"versao": "2", "job_id": 42}
        )
        is True
    )


def test_nao_pendente_quando_existe_prova_mais_nova(monkeypatch):
    from services import proof_papelaria_service as svc

    monkeypatch.setattr(
        svc,
        "list_jobs_for_os",
        lambda *_a, **_k: [
            {
                "id": 50,
                "status": "completed",
                "versao": 3,
                "tipo_job": "create",
                "prova_revisao": "pending",
            },
            {
                "id": 42,
                "status": "completed",
                "versao": 2,
                "tipo_job": "create",
                "prova_revisao": "pending",
            },
        ],
    )
    assert (
        svc.cliente_alteracao_ainda_pendente(
            2026, 5024, {"versao": "2", "job_id": 42}
        )
        is False
    )

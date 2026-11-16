"""Fases do resumo Prova/Imposição da lista de SPs."""
from __future__ import annotations


def test_resolve_prova_none():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(latest_prova_job=None, has_alteracao=False)
    assert out == {"phase": "none", "versao": None, "job_id": None}


def test_resolve_prova_queued_and_processing():
    from services.papelaria_sp_status_service import resolve_prova_phase

    queued = resolve_prova_phase(
        latest_prova_job={
            "ID": 10,
            "Status": "pending",
            "Versao": 2,
            "ArquivoPdfGerado": None,
            "ProvaRevisao": None,
        },
        has_alteracao=True,
    )
    assert queued["phase"] == "queued"
    assert queued["versao"] == 2

    processing = resolve_prova_phase(
        latest_prova_job={
            "ID": 11,
            "Status": "processing",
            "Versao": 3,
            "ArquivoPdfGerado": None,
            "ProvaRevisao": None,
        },
        has_alteracao=False,
    )
    assert processing["phase"] == "processing"


def test_resolve_prova_ready_send_alteracao_approved():
    from services.papelaria_sp_status_service import resolve_prova_phase

    ready = resolve_prova_phase(
        latest_prova_job={
            "ID": 12,
            "Status": "completed",
            "Versao": 4,
            "ArquivoPdfGerado": "x-ProvaSefoc 4.pdf",
            "ProvaRevisao": "pending",
        },
        has_alteracao=False,
    )
    assert ready == {"phase": "ready_send", "versao": 4, "job_id": 12}

    alteracao = resolve_prova_phase(
        latest_prova_job={
            "ID": 12,
            "Status": "completed",
            "Versao": 4,
            "ArquivoPdfGerado": "x-ProvaSefoc 4.pdf",
            "ProvaRevisao": "approved",
        },
        has_alteracao=True,
        alteracao_versao=4,
    )
    assert alteracao["phase"] == "alteracao"
    assert alteracao["versao"] == 4

    approved = resolve_prova_phase(
        latest_prova_job={
            "ID": 13,
            "Status": "completed",
            "Versao": 5,
            "ArquivoPdfGerado": "x.pdf",
            "ProvaRevisao": "approved",
        },
        has_alteracao=False,
    )
    assert approved == {"phase": "approved", "versao": 5, "job_id": 13}


def test_resolve_imposicao_phases():
    from services.papelaria_sp_status_service import resolve_imposicao_phase

    assert resolve_imposicao_phase(
        prova_phase="ready_send",
        latest_imposicao_job=None,
    ) == {"phase": "hidden", "job_id": None}

    assert resolve_imposicao_phase(
        prova_phase="approved",
        latest_imposicao_job=None,
    ) == {"phase": "pending", "job_id": None}

    waiting = resolve_imposicao_phase(
        prova_phase="approved",
        latest_imposicao_job={
            "ID": 20,
            "TipoJob": "imposicao",
            "Status": "completed",
            "ArquivoPdfGerado": None,
            "DadosJson": '{"aguardando_apogee": true}',
        },
    )
    assert waiting == {"phase": "waiting_apogee", "job_id": 20}

    ready = resolve_imposicao_phase(
        prova_phase="approved",
        latest_imposicao_job={
            "ID": 21,
            "TipoJob": "imposicao",
            "Status": "completed",
            "ArquivoPdfGerado": r"J:\\x\\Digital\\a_Digit_10Up_A4.pdf",
            "DadosJson": '{"aguardando_apogee": false}',
        },
    )
    assert ready == {"phase": "ready", "job_id": 21}

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
        andamento={"situacao": "Aguard. Aprovação", "observacao": ""},
    )
    assert processing["phase"] == "processing"


def test_extract_versao_prefers_provasefoc_filename():
    from services.papelaria_sp_status_service import _extract_versao

    assert (
        _extract_versao(1, "06089-Nome-ProvaSefoc 3.pdf")
        == 3
    )


def test_resolve_prova_ready_send_alteracao_approved():
    from services.papelaria_sp_status_service import resolve_prova_phase

    ready = resolve_prova_phase(
        latest_prova_job={
            "ID": 12,
            "Status": "completed",
            "Versao": 1,
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


def test_resolve_prova_waiting_client_from_andamento():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        latest_prova_job={
            "ID": 14,
            "Status": "completed",
            "Versao": 2,
            "ArquivoPdfGerado": "x-ProvaSefoc 2.pdf",
            "ProvaRevisao": "approved",
        },
        andamento={
            "situacao": "Aguard. Aprovação",
            "observacao": "P2 enviada para: cliente@x.com",
        },
        folder_prova_versao=2,
    )
    assert out["phase"] == "waiting_client"
    assert out["versao"] == 2


def test_resolve_prova_encam_is_ready_send_not_approved():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        latest_prova_job={
            "ID": 15,
            "Status": "completed",
            "Versao": 3,
            "ArquivoPdfGerado": "x-ProvaSefoc 3.pdf",
            "ProvaRevisao": "approved",
        },
        andamento={
            "situacao": "Encam. de Docum.",
            "observacao": "Enviar Prova 3",
        },
    )
    assert out["phase"] == "ready_send"
    assert out["versao"] == 3


def test_resolve_prova_alteracao_from_andamento_obs():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        latest_prova_job={
            "ID": 16,
            "Status": "completed",
            "Versao": 1,
            "ArquivoPdfGerado": "x-ProvaSefoc 1.pdf",
            "ProvaRevisao": "approved",
        },
        andamento={
            "situacao": "Saída p/",
            "observacao": "Alterar Prova 1",
        },
    )
    assert out["phase"] == "alteracao"
    assert out["versao"] == 1

    exec_alt = resolve_prova_phase(
        andamento={
            "situacao": "Em Execução",
            "observacao": "Dar prosseguimento:\n\nMudar logo",
        },
        folder_prova_versao=2,
    )
    assert exec_alt["phase"] == "alteracao"
    assert exec_alt["versao"] == 2


def test_resolve_prova_aprovacao_from_andamento_obs():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        andamento={
            "situacao": "Saída p/",
            "observacao": "Prova v2 aprovada pelo cliente (gabinete)",
        },
    )
    assert out["phase"] == "approved"
    assert out["versao"] == 2


def test_resolve_prova_folder_sem_job():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(folder_prova_versao=4)
    assert out == {"phase": "ready_send", "versao": 4, "job_id": None}


def test_resolve_prova_recebido_em_execucao_sem_pdf():
    from services.papelaria_sp_status_service import resolve_prova_phase

    for situacao in ("Recebido", "Em Execução", "Tramit. de Prova p/ SEFOC"):
        out = resolve_prova_phase(
            andamento={"situacao": situacao, "observacao": "Preparando Prova"},
        )
        assert out["phase"] == "none", situacao


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


def test_resolve_imposicao_digital_folder_ready():
    from services.papelaria_sp_status_service import resolve_imposicao_phase

    out = resolve_imposicao_phase(
        prova_phase="approved",
        latest_imposicao_job={
            "ID": 22,
            "TipoJob": "imposicao",
            "Status": "completed",
            "ArquivoPdfGerado": None,
            "DadosJson": '{"aguardando_apogee": true}',
        },
        has_digital_pdf=True,
    )
    assert out == {"phase": "ready", "job_id": 22}

    only_folder = resolve_imposicao_phase(
        prova_phase="approved",
        latest_imposicao_job=None,
        has_digital_pdf=True,
    )
    assert only_folder == {"phase": "ready", "job_id": None}


def test_scan_folder_signals(tmp_path, monkeypatch):
    from services import papelaria_sp_status_service as svc

    sefoc = tmp_path / "Sefoc"
    digital = sefoc / "Digital"
    digital.mkdir(parents=True)
    (sefoc / "05954-X-ProvaSefoc 2.pdf").write_bytes(b"%PDF")
    (sefoc / "05954-X-ProvaSefoc 5.pdf").write_bytes(b"%PDF")
    (digital / "x.pdf").write_bytes(b"%PDF")

    monkeypatch.setattr(
        "services.papelaria_jobs_service.resolve_os_papelaria_dir",
        lambda ano, nro, create=False: str(sefoc),
    )
    out = svc._scan_folder_signals(2026, 5954)
    assert out["prova_versao"] == 5
    assert out["has_digital_pdf"] is True

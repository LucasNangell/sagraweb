"""Modo de prova da papelaria: persistência, aliases CSP e filtro de modelos."""
from __future__ import annotations

from unittest.mock import patch

import pytest


def test_resolve_aliases_e_modelos_sem_csp():
    from services.papelaria_prova_modo import resolve_arquivo_email

    assert resolve_arquivo_email("CtVisita.cdr") == "CtVisitaF.cdr"
    assert resolve_arquivo_email("CtVisitaFV.cdr") == "CtVisita.cdr"
    assert resolve_arquivo_email("ctvisitarS.cdr") == "CtVisitaR.cdr"
    assert resolve_arquivo_email("PastaCBolso") == "PastaAvulsocBolso.cdr"
    assert resolve_arquivo_email("BlocoA5.cdr") == "BlocoA5.cdr"
    assert resolve_arquivo_email("CtVisitaFVAssissor.cdr") is None
    assert resolve_arquivo_email("CtVisitaFVIngles.cdr") is None
    assert resolve_arquivo_email("CtVisitaFV-Instagram.cdr") is None
    assert resolve_arquivo_email("PastaCBolsoLogo.cdr") is None


def test_modo_padrao_e_persistencia(tmp_path, monkeypatch):
    from services import papelaria_prova_modo as modo

    monkeypatch.setattr(modo, "_SETTINGS_PATH", tmp_path / "papelaria_settings.json")
    assert modo.get_modo() == modo.MODO_PROVA_WEB
    modo.set_modo(modo.MODO_PROVA_EMAIL)
    assert modo.get_public_settings() == {"modo": modo.MODO_PROVA_EMAIL}
    with pytest.raises(ValueError, match="inválido"):
        modo.set_modo("outro")


def test_filtro_email_oculta_sem_equivalente(monkeypatch):
    from services import papelaria_prova_modo as modo

    monkeypatch.setattr(modo, "get_modo", lambda: modo.MODO_PROVA_EMAIL)
    modelos = [
        {"id": 1, "arquivo_modelo": "CtVisitaFV.cdr"},
        {"id": 2, "arquivo_modelo": "CtVisitaFVAssissor.cdr"},
    ]
    visiveis, avisos = modo.filtrar_modelos_para_modo(modelos)
    assert [m["id"] for m in visiveis] == [1]
    assert avisos and "CtVisitaFVAssissor.cdr" in avisos[0]


def test_filtro_web_mantem_lista(monkeypatch):
    from services import papelaria_prova_modo as modo

    monkeypatch.setattr(modo, "get_modo", lambda: modo.MODO_PROVA_WEB)
    modelos = [{"id": 2, "arquivo_modelo": "PastaCBolsoLogo.cdr"}]
    visiveis, avisos = modo.filtrar_modelos_para_modo(modelos)
    assert visiveis == modelos
    assert avisos == []


def test_create_job_recusa_modelo_indisponivel(monkeypatch):
    from services import papelaria_jobs_service as svc

    monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
    monkeypatch.setattr(svc, "_validate_os_exists", lambda ano, nro: {"produto": "Ct Visita"})
    monkeypatch.setattr(
        "services.papelaria_prova_modo.get_modo",
        lambda: "prova_email",
    )
    modelo = {
        "id": 15,
        "produto": "Ct Visita",
        "arquivo_modelo": "CtVisitaFVIngles.cdr",
        "campos_formulario": [],
    }
    with patch(
        "services.papelaria_models_service.get_modelo_by_id",
        return_value=modelo,
    ):
        with pytest.raises(ValueError, match="Prova e-mail"):
            svc.create_job(
                ano=2026,
                nro=5954,
                modelo_id=15,
                dados={"nome_deputado": "Ana"},
                solicitado_por="918713",
            )


def test_payload_create_email_envia_arquivo_csp(monkeypatch, tmp_path):
    from services import papelaria_jobs_service as svc

    job = {
        "id": 77,
        "ano_protocolo": 2026,
        "nro_protocolo": 5954,
        "tipo_job": svc.TIPO_JOB_CREATE,
        "produto": "Ct Visita",
        "modelo_id": 1,
        "arquivo_modelo": "CtVisitaFV.cdr",
        "dados": {"nome_deputado": "Ana"},
        "tentativas": 0,
    }
    monkeypatch.setattr(svc, "get_job", lambda job_id: job if job_id == 77 else None)
    monkeypatch.setattr(svc, "resolve_os_papelaria_dir", lambda *a, **k: str(tmp_path))
    monkeypatch.setattr(
        svc,
        "build_output_filenames",
        lambda ano, nro: ("os.cdr", "05954-Nome-ProvaSefoc 2.pdf"),
    )
    monkeypatch.setattr(
        "services.papelaria_prova_modo.get_modo",
        lambda: "prova_email",
    )
    with patch(
        "services.papelaria_models_service.get_modelo_by_id",
        return_value={
            "id": 1,
            "produto": "Ct Visita",
            "arquivo_modelo": "CtVisitaFV.cdr",
            "campos": {},
            "frente_versao": "Frente e Verso",
            "cores": "Policromia",
        },
    ):
        payload = svc.build_worker_job_payload(77)

    assert payload["prova_modo"] == "prova_email"
    assert payload["arquivo_modelo"] == "CtVisitaFV.cdr"
    assert payload["arquivo_modelo_email"] == "CtVisita.cdr"
    assert payload["prova_numero"] == 2


def test_payload_create_email_ct_visita_f_usa_ctvisitaf(monkeypatch, tmp_path):
    from services import papelaria_jobs_service as svc

    job = {
        "id": 78,
        "ano_protocolo": 2026,
        "nro_protocolo": 5954,
        "tipo_job": svc.TIPO_JOB_CREATE,
        "produto": "Ct Visita",
        "modelo_id": 15,
        "arquivo_modelo": "CtVisita.cdr",
        "dados": {"nome_deputado": "Ana"},
        "tentativas": 0,
    }
    monkeypatch.setattr(svc, "get_job", lambda job_id: job if job_id == 78 else None)
    monkeypatch.setattr(svc, "resolve_os_papelaria_dir", lambda *a, **k: str(tmp_path))
    monkeypatch.setattr(
        svc,
        "build_output_filenames",
        lambda ano, nro: ("os.cdr", "05954-Nome-ProvaSefoc 2.pdf"),
    )
    monkeypatch.setattr(
        "services.papelaria_prova_modo.get_modo",
        lambda: "prova_email",
    )
    with patch(
        "services.papelaria_models_service.get_modelo_by_id",
        return_value={
            "id": 15,
            "produto": "Ct Visita",
            "arquivo_modelo": "CtVisita.cdr",
            "campos": {},
            "frente_versao": "Somente Frente",
            "cores": "Policromia",
            "nome_exibicao": "Ct Visita F",
        },
    ):
        payload = svc.build_worker_job_payload(78)

    assert payload["arquivo_modelo"] == "CtVisita.cdr"
    assert payload["arquivo_modelo_email"] == "CtVisitaF.cdr"


def test_payload_create_sem_csp_falha(monkeypatch, tmp_path):
    from services import papelaria_jobs_service as svc

    job = {
        "id": 78,
        "ano_protocolo": 2026,
        "nro_protocolo": 5954,
        "tipo_job": svc.TIPO_JOB_CREATE,
        "produto": "Ct Visita",
        "modelo_id": 16,
        "arquivo_modelo": "CtVisitaFV-Instagram.cdr",
        "dados": {},
        "tentativas": 0,
    }
    monkeypatch.setattr(svc, "get_job", lambda job_id: job if job_id == 78 else None)
    monkeypatch.setattr(svc, "resolve_os_papelaria_dir", lambda *a, **k: str(tmp_path))
    monkeypatch.setattr(svc, "build_output_filenames", lambda ano, nro: ("os.cdr", "os.pdf"))
    monkeypatch.setattr(
        "services.papelaria_prova_modo.get_modo",
        lambda: "prova_email",
    )
    with patch(
        "services.papelaria_models_service.get_modelo_by_id",
        return_value={"id": 16, "campos": {}, "frente_versao": None, "cores": None},
    ):
        with pytest.raises(ValueError, match="pasta CSP"):
            svc.build_worker_job_payload(78)


def test_contexto_omite_modelo_sem_csp(monkeypatch):
    from services import papelaria_models_service as svc

    monkeypatch.setattr(
        svc.db,
        "execute_query",
        lambda sql, params=None: [
            {
                "NroProtocolo": 5999,
                "AnoProtocolo": 2026,
                "NomeUsuario": "Teste",
                "Titular": "Nome Teste",
                "SiglaOrgao": "PL/DF",
                "GabSalaUsuario": "716",
                "RamalUsuario": "55716",
                "Titulo": "Titulo",
                "TipoPublicacaoLink": "Ct Visita",
                "Cores": "",
                "CoresDescricao": None,
                "FrenteVerso": "",
                "Observ": "",
            }
        ],
    )
    monkeypatch.setattr(svc, "build_prefill_corel", lambda *_a, **_k: {})
    monkeypatch.setattr(
        svc,
        "list_modelos",
        lambda *a, **k: [
            {
                "id": 14,
                "produto": "Ct Visita",
                "frente_versao": "Frente e Verso",
                "cores": "Policromia",
                "arquivo_modelo": "CtVisitaFV.cdr",
                "variaveis": [],
                "nome_exibicao": "Visita FV",
                "ordem": 1,
            },
            {
                "id": 15,
                "produto": "Ct Visita",
                "frente_versao": "Frente e Verso",
                "cores": "Policromia",
                "arquivo_modelo": "CtVisitaFVAssissor.cdr",
                "variaveis": [],
                "nome_exibicao": "Assessor",
                "ordem": 2,
            },
        ],
    )
    monkeypatch.setattr(
        "services.papelaria_prova_modo.get_modo",
        lambda: "prova_email",
    )

    ctx = svc.build_os_context(2026, 5999)
    assert [m["id"] for m in ctx["modelos"]] == [14]
    assert ctx["autoSelectedModelId"] == 14
    assert ctx["prova_modo"] == "prova_email"
    assert any("CtVisitaFVAssissor.cdr" in w for w in ctx["warnings"])

"""Fases do resumo Prova/Imposição da lista de SPs (cronologia compartilhada)."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

T0 = datetime(2026, 11, 10, 9, 0, 0)


def _t(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


def _folder(count: int, versao=None, at: int | None = 0, digital_at: int | None = None):
    return {
        "prova_count": count,
        "prova_versao": versao if versao is not None else (count or None),
        "prova_mtime": _t(at).timestamp() if (count and at is not None) else None,
        "digital_mtime": _t(digital_at).timestamp() if digital_at is not None else None,
    }


def _and(situacao: str, obs: str = "", at: int = 0):
    return {"situacao": situacao, "observacao": obs, "data": _t(at)}


def _job(id_, status="completed", revisao="approved", at=0, tipo="create", pdf="x-BaseSefoc.pdf", dados=None):
    import json

    return {
        "ID": id_,
        "TipoJob": tipo,
        "Status": status,
        "ProvaRevisao": revisao,
        "ArquivoPdfGerado": pdf,
        "DadosJson": json.dumps(dados or {}),
        "SolicitadoEm": _t(at),
        "ConcluidoEm": _t(at + 1),
        "SolicitadoPor": "918713",
    }


# --------------------------------------------------------------------------
# Nome dos arquivos de prova
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected",
    [
        ("06089-Nome-ProvaSefoc 3.pdf", 3),
        ("06089-Nome-Prova3_SEFOC.pdf", 3),
        ("06089-Nome-Prova12.pdf", 12),
        ("06089 Nome Prova 2.pdf", 2),
        ("06089-Nome-Prova.pdf", None),
        ("06089-Nome-Aprovado.pdf", None),
        ("06089-Nome-BaseSefoc.pdf", None),
    ],
)
def test_extract_prova_version(name, expected):
    from services.proof_files_service import extract_prova_version_from_filename

    assert extract_prova_version_from_filename(name) == expected


def test_is_prova_filename_ignora_aprovado():
    from services.proof_files_service import is_prova_filename

    assert is_prova_filename("x-Prova1.pdf")
    assert is_prova_filename("x-ProvaSefoc 2.pdf")
    assert not is_prova_filename("x-Aprovado.pdf")
    assert not is_prova_filename("x-BaseSefoc.pdf")
    assert not is_prova_filename("x-Prova1.cdr")


def test_summarize_prova_files_maior_numero_e_contagem():
    from services.proof_files_service import summarize_prova_files

    out = summarize_prova_files(
        [("a-Prova1.pdf", 10), ("a-ProvaSefoc 3.pdf", 5), ("a-BaseSefoc.pdf", 99)]
    )
    assert out["count"] == 2
    assert out["versao"] == 3
    assert out["latest"] == "a-ProvaSefoc 3.pdf"
    assert out["latest_mtime"] == 10

    sem_numero = summarize_prova_files([("a-Prova.pdf", 1), ("a-Prova final.pdf", 2)])
    assert sem_numero["count"] == 2
    assert sem_numero["versao"] == 2
    assert sem_numero["latest"] == "a-Prova final.pdf"

    vazio = summarize_prova_files([("a-BaseSefoc.pdf", 1)])
    assert vazio == {"count": 0, "versao": None, "latest": None, "latest_mtime": None}


def test_extract_versao_prefers_filename():
    from services.papelaria_sp_status_service import _extract_versao

    assert _extract_versao(1, "06089-Nome-ProvaSefoc 3.pdf") == 3
    assert _extract_versao("2") == 2


# --------------------------------------------------------------------------
# Prova
# --------------------------------------------------------------------------


def test_prova_none_sem_prova_na_pasta():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase()
    assert out["phase"] == "none"
    assert out["versao"] is None
    assert out["count"] == 0

    preparando = resolve_prova_phase(andamento=_and("Em Execução", "Preparando Prova"))
    assert preparando["phase"] == "none"


def test_prova_job_em_voo_tem_prioridade():
    from services.papelaria_sp_status_service import resolve_prova_phase

    queued = resolve_prova_phase(
        busy_job=_job(10, status="pending"),
        folder=_folder(2),
        andamento=_and("Aguard. Aprovação"),
    )
    assert queued["phase"] == "queued"
    assert queued["job_id"] == 10
    assert queued["por"] == "918713"

    processing = resolve_prova_phase(busy_job=_job(11, status="processing"))
    assert processing["phase"] == "processing"


def test_prova_gerada_aguardando_ok_e_review():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        prova_job=_job(12, revisao="pending", at=30),
        folder=_folder(2, at=31),
        andamento=_and("Saída p/", "Alterar Prova 1", at=0),
    )
    assert out["phase"] == "review"
    assert out["versao"] == 2


def test_prova_encam_e_envio_nao_aprovacao():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        prova_job=_job(15, revisao="approved", at=0),
        folder=_folder(3, at=1),
        andamento=_and("Encam. de Docum.", "Enviar Prova 3", at=2),
    )
    assert out["phase"] == "ready_send"
    assert out["versao"] == 3


def test_prova_encam_timbrado_nao_e_envio_de_prova():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        folder=_folder(1, at=0),
        andamento=_and("Encam. de Docum.", "Enviar Timbrado Digital", at=5),
    )
    assert out["phase"] == "pending"


def test_prova_aguard_aprovacao_e_relogio():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        prova_job=_job(14, at=0),
        folder=_folder(2, at=1),
        andamento=_and("Aguard. Aprovação", "P2 enviada para:\n- x@y", at=3),
    )
    assert out["phase"] == "waiting_client"
    assert out["versao"] == 2


def test_prova_aprovada_pelo_cliente():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        folder=_folder(2, at=0),
        andamento=_and("Saída p/", "Prova v2 aprovada pelo cliente (gabinete)", at=5),
    )
    assert out["phase"] == "approved"
    assert out["versao"] == 2

    juntada = resolve_prova_phase(
        folder=_folder(1, at=0),
        andamento=_and("Aguard. Juntada", "Prova v1 aprovada pelo cliente", at=5),
    )
    assert juntada["phase"] == "approved"


def test_prova_alteracao_numero_com_pendente():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        folder=_folder(1, at=0),
        andamento=_and("Saída p/", "Alterar Prova 1", at=5),
    )
    assert out["phase"] == "alteracao"
    assert out["versao"] == 1

    email = resolve_prova_phase(
        folder=_folder(2, at=0),
        andamento=_and("Em Execução", "Dar prosseguimento:\n\nMudar logo", at=5),
    )
    assert email["phase"] == "alteracao"
    assert email["versao"] == 2


def test_alteracao_antiga_nao_gruda_apos_nova_prova():
    """Pedido de alteração anterior não pode vencer uma prova mais nova."""
    from services.papelaria_sp_status_service import resolve_prova_phase

    # Cliente pediu alteração na prova 1 (t=10); prova 2 gerada (t=20) e enviada.
    out = resolve_prova_phase(
        prova_job=_job(20, at=19),
        folder=_folder(2, at=20),
        andamento=_and("Aguard. Aprovação", "P2 enviada", at=25),
        last_response={"aprovado": False, "versao": "1", "data": _t(10)},
    )
    assert out["phase"] == "waiting_client"
    assert out["versao"] == 2

    # Andamento genérico: a resposta antiga é ignorada (prova 2 é mais nova).
    generico = resolve_prova_phase(
        folder=_folder(2, at=20),
        andamento=_and("Recebido", "", at=25),
        last_response={"aprovado": False, "versao": "1", "data": _t(10)},
    )
    assert generico["phase"] == "pending"


def test_resposta_do_portal_mais_nova_que_a_prova():
    from services.papelaria_sp_status_service import resolve_prova_phase

    aprovada = resolve_prova_phase(
        folder=_folder(2, at=0),
        andamento=_and("Recebido", "", at=1),
        last_response={"aprovado": True, "versao": "2", "data": _t(30)},
    )
    assert aprovada["phase"] == "approved"

    alteracao = resolve_prova_phase(
        folder=_folder(2, at=0),
        andamento=_and("Recebido", "", at=1),
        last_response={"aprovado": False, "versao": "2", "data": _t(30)},
    )
    assert alteracao["phase"] == "alteracao"


def test_imposicao_feita_implica_prova_aprovada():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(
        folder=_folder(3, at=0),
        andamento=_and("Em Execução", "", at=60),
        imposicao_feita=True,
    )
    assert out["phase"] == "approved"
    assert out["versao"] == 3


def test_ultima_geracao_falhou_marca_flag():
    from services.papelaria_sp_status_service import resolve_prova_phase

    out = resolve_prova_phase(failed_job=_job(9, status="failed"))
    assert out["phase"] == "none"
    assert out["falhou"] is True


# --------------------------------------------------------------------------
# Imposição
# --------------------------------------------------------------------------


def test_imposicao_oculta_antes_da_aprovacao():
    from services.papelaria_sp_status_service import resolve_imposicao_phase

    assert resolve_imposicao_phase(prova_phase="waiting_client") == {
        "phase": "hidden",
        "job_id": None,
    }


def test_imposicao_pendente_e_juntada():
    from services.papelaria_sp_status_service import resolve_imposicao_phase

    assert resolve_imposicao_phase(prova_phase="approved")["phase"] == "pending"
    juntada = resolve_imposicao_phase(
        prova_phase="approved", andamento=_and("Aguard. Juntada", "", at=5)
    )
    assert juntada["phase"] == "waiting_juntada"


def test_imposicao_job_fases():
    from services.papelaria_sp_status_service import resolve_imposicao_phase

    prova_ts = _t(0).timestamp()
    queued = resolve_imposicao_phase(
        prova_phase="approved",
        imposicao_job=_job(30, status="pending", tipo="imposicao", at=10, pdf=None),
        prova_ts=prova_ts,
        andamento=_and("Aguard. Juntada"),
    )
    assert queued["phase"] == "queued"

    waiting = resolve_imposicao_phase(
        prova_phase="approved",
        imposicao_job=_job(
            31, tipo="imposicao", at=10, pdf=None, dados={"aguardando_apogee": True}
        ),
        prova_ts=prova_ts,
    )
    assert waiting["phase"] == "waiting_apogee"

    ready_folder = resolve_imposicao_phase(
        prova_phase="approved",
        imposicao_job=_job(
            31, tipo="imposicao", at=10, pdf=None, dados={"aguardando_apogee": True}
        ),
        prova_ts=prova_ts,
        digital_ts=_t(20).timestamp(),
    )
    assert ready_folder["phase"] == "ready"

    ready = resolve_imposicao_phase(
        prova_phase="approved",
        imposicao_job=_job(
            32,
            tipo="imposicao",
            at=10,
            pdf=r"J:\x\Digital\a_Digit_10Up_A4.pdf",
            dados={"aguardando_apogee": False, "ancora": {"ano": 2026, "nro": 6000}},
        ),
        prova_ts=prova_ts,
    )
    assert ready["phase"] == "ready"
    assert ready["ancora"] == {"ano": 2026, "nro": 6000}


def test_imposicao_antiga_nao_conta_para_prova_mais_nova():
    from services.papelaria_sp_status_service import (
        imposicao_job_relevante,
        resolve_imposicao_phase,
    )

    old_job = _job(33, tipo="imposicao", at=0, pdf=r"J:\x.pdf")
    prova_ts = _t(50).timestamp()
    assert not imposicao_job_relevante(old_job, prova_ts)
    out = resolve_imposicao_phase(
        prova_phase="approved", imposicao_job=old_job, prova_ts=prova_ts
    )
    assert out["phase"] == "pending"


def test_imposicao_falha_marca_flag():
    from services.papelaria_sp_status_service import resolve_imposicao_phase

    out = resolve_imposicao_phase(
        prova_phase="approved",
        imposicao_job=_job(34, status="failed", tipo="imposicao", at=10, pdf=None),
        prova_ts=_t(0).timestamp(),
    )
    assert out["phase"] == "pending"
    assert out["falhou"] is True


# --------------------------------------------------------------------------
# Atividades compartilhadas e montagem do lote
# --------------------------------------------------------------------------


def test_apply_activity_vira_loading():
    from services.papelaria_sp_status_service import apply_activity

    prova, imp = apply_activity(
        {"phase": "pending", "versao": 1},
        {"phase": "hidden"},
        {"prova": {"label": "Aprovando prova", "ponto": "1"}},
    )
    assert prova["phase"] == "processing"
    assert prova["atividade"] == "Aprovando prova"
    assert imp["phase"] == "hidden"

    prova, imp = apply_activity(
        {"phase": "approved", "versao": 1},
        {"phase": "pending"},
        {"imposicao": {"label": "Gerando imposição (JDF)", "ponto": "2"}},
    )
    assert prova["phase"] == "approved"
    assert imp["phase"] == "processing"
    assert imp["por"] == "2"


def test_sp_activity_registry_compartilhado(monkeypatch):
    from services import papelaria_sp_activity as act

    act.reset_for_tests()
    monkeypatch.setattr(act, "_broadcast", lambda *a, **k: None)
    with act.sp_activity([(2026, 6000), (2026, 6001)], "imposicao", "JDF", "9"):
        snap = act.snapshot([(2026, 6000), (2026, 6001), (2026, 7)])
        assert set(snap) == {"2026-6000", "2026-6001"}
        assert snap["2026-6000"]["imposicao"]["label"] == "JDF"
    assert act.snapshot() == {}


def test_build_resumo_juntada_e_atividade(monkeypatch):
    from services import papelaria_sp_activity as act
    from services import papelaria_sp_status_service as svc

    act.reset_for_tests()
    monkeypatch.setattr(act, "_broadcast", lambda *a, **k: None)
    monkeypatch.setattr(
        "services.papelaria_jobs_service.ensure_papelaria_jobs_tables", lambda: None
    )
    ancora_job = _job(
        40,
        status="processing",
        tipo="imposicao",
        at=30,
        pdf=None,
        dados={
            "ancora": {"ano": 2026, "nro": 6000},
            "juntada_membros": [{"ano": 2026, "nro": 6001}],
        },
    )
    ancora_job.update({"AnoProtocolo": 2026, "NroProtocolo": 6000})
    monkeypatch.setattr(svc, "_fetch_jobs_for_pairs", lambda pairs: [ancora_job])
    monkeypatch.setattr(svc, "_fetch_juntada_jobs", lambda: [ancora_job])
    monkeypatch.setattr(svc, "_fetch_last_responses_for_pairs", lambda pairs: {})
    monkeypatch.setattr(
        svc,
        "_fetch_andamentos_for_pairs",
        lambda pairs: {
            "2026-6000": _and("Aguard. Juntada", "Prova v1 aprovada pelo cliente", at=5),
            "2026-6001": _and("Aguard. Juntada", "Prova v2 aprovada pelo cliente", at=5),
            "2026-6002": _and("Em Execução", "Preparando Prova", at=5),
        },
    )
    monkeypatch.setattr(
        svc,
        "_fetch_folder_signals_for_pairs",
        lambda pairs: {
            "2026-6000": _folder(1, at=0),
            "2026-6001": _folder(2, at=0),
            "2026-6002": _folder(0),
        },
    )
    with act.sp_activity([(2026, 6002)], "prova", "Enviando prova para geração", "7"):
        out = svc.build_sp_status_resumo(
            [{"ano": 2026, "nro": n} for n in (6000, 6001, 6002)]
        )
    by = {item["nro"]: item for item in out["items"]}
    assert by[6000]["prova"]["phase"] == "approved"
    assert by[6000]["imposicao"]["phase"] == "processing"
    # Membro da juntada herda o job da âncora.
    assert by[6001]["prova"]["versao"] == 2
    assert by[6001]["imposicao"]["phase"] == "processing"
    assert by[6001]["imposicao"]["ancora"] == {"ano": 2026, "nro": 6000}
    # Atividade síncrona registrada por outro usuário.
    assert by[6002]["prova"]["phase"] == "processing"
    assert by[6002]["prova"]["por"] == "7"


def test_scan_folder_signals(tmp_path, monkeypatch):
    from services import papelaria_sp_status_service as svc

    sefoc = tmp_path / "Sefoc"
    digital = sefoc / "Digital"
    digital.mkdir(parents=True)
    (sefoc / "05954-X-ProvaSefoc 2.pdf").write_bytes(b"%PDF")
    (sefoc / "05954-X-Prova5.pdf").write_bytes(b"%PDF")
    (sefoc / "05954-X-BaseSefoc.pdf").write_bytes(b"%PDF")
    (digital / "x.pdf").write_bytes(b"%PDF")

    monkeypatch.setattr(
        "services.papelaria_jobs_service.resolve_os_papelaria_dir",
        lambda ano, nro, create=False: str(sefoc),
    )
    out = svc._scan_folder_signals(2026, 5954)
    assert out["prova_count"] == 2
    assert out["prova_versao"] == 5
    assert out["prova_latest"] == "05954-X-Prova5.pdf"
    assert out["has_digital_pdf"] is True
    assert out["digital_mtime"] is not None


def test_list_proof_files_suggested_ultima_prova(tmp_path, monkeypatch):
    from services import proof_files_service as svc

    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    (sefoc / "a-Prova1.pdf").write_bytes(b"%PDF")
    (sefoc / "a-Prova 3.pdf").write_bytes(b"%PDF")
    (sefoc / "a-BaseSefoc.pdf").write_bytes(b"%PDF")
    monkeypatch.setattr(svc, "_sefoc_dir", lambda ano, os_id: str(sefoc))
    out = svc.list_proof_pdf_files(2026, 1)
    assert out["suggested"] == "a-Prova 3.pdf"


def test_estado_da_sp_junta_andamento_e_fase(monkeypatch):
    """Página Papelaria: situação atual e fase da prova de uma SP (nunca levanta)."""
    from datetime import datetime

    from services import papelaria_sp_status_service as svc

    monkeypatch.setattr(
        svc,
        "_fetch_andamentos_for_pairs",
        lambda pairs: {
            svc._sp_key(2026, 5954): {
                "situacao": "Saída p/",
                "observacao": "Alterar Prova 2",
                "data": datetime(2026, 11, 20, 10, 0),
            }
        },
    )
    monkeypatch.setattr(
        svc,
        "build_sp_status_resumo",
        lambda items: {"items": [{"ano": 2026, "nro": 5954, "prova": {"phase": "alteracao", "versao": 2}}]},
    )
    r = svc.estado_da_sp(2026, 5954)
    assert r["andamento"]["situacao"] == "Saída p/"
    assert r["andamento"]["data"].startswith("2026-11-20")
    assert r["prova_status"] == {"phase": "alteracao", "versao": 2}


def test_estado_da_sp_falha_vira_none(monkeypatch):
    from services import papelaria_sp_status_service as svc

    def _erro(*_a, **_k):
        raise RuntimeError("banco fora")

    monkeypatch.setattr(svc, "_fetch_andamentos_for_pairs", _erro)
    monkeypatch.setattr(svc, "build_sp_status_resumo", _erro)
    assert svc.estado_da_sp(2026, 5954) == {"andamento": None, "prova_status": None}

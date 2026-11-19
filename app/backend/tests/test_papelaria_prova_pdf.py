"""Modo «Prova PDF»: prova gerada no servidor a partir do PDF do modelo."""
from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

fitz = pytest.importorskip("fitz")

_FONTE = r"C:\Windows\Fonts\arial.ttf"


def _pdf_modelo() -> bytes:
    """Cartão 90×50 mm com fonte TrueType embutida inteira (Type0/Identity-H)."""
    if not os.path.isfile(_FONTE):
        pytest.skip("fonte Arial indisponível")
    doc = fitz.open()
    page = doc.new_page(width=255.1, height=141.7)
    page.insert_font(fontname="F1", fontfile=_FONTE)
    page.insert_text((20, 40), "NOMETITULAR", fontname="F1", fontsize=11)
    page.insert_text((20, 60), "Fixo Maria José", fontname="F1", fontsize=8)
    data = doc.tobytes()
    doc.close()
    return data


def _textos(pdf: bytes) -> str:
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        return " ".join(p.get_text() for p in doc).replace(" ", " ")
    finally:
        doc.close()


def test_analisar_pdf_lista_textos_e_fonte():
    from services import papelaria_prova_pdf_service as svc

    analise = svc.analisar_pdf(_pdf_modelo())
    marcadores = [t["marcador"] for t in analise["textos"]]
    assert "NOMETITULAR" in marcadores
    assert "Fixo Maria José" in marcadores
    assert analise["fontes"] and analise["fontes"][0]["editavel"] is True


def test_renderizar_troca_marcador_e_mantem_fixo():
    from services import papelaria_prova_pdf_service as svc

    campos = [
        {
            "marcador": "NOMETITULAR",
            "pagina": 1,
            "template": "{nome_deputado}",
            "alinhamento": "auto",
            "ancora": "auto",
            "entrelinha": 1.2,
            "reduzir_para_caber": True,
        }
    ]
    saida = svc.renderizar(_pdf_modelo(), campos, {"nome_deputado": "José Maria"})
    texto = _textos(saida)
    assert "José Maria" in texto
    assert "NOMETITULAR" not in texto
    assert "Fixo Maria José" in texto


def test_salvar_campos_ignora_marcador_inexistente(tmp_path, monkeypatch):
    from services import papelaria_prova_pdf_service as svc

    monkeypatch.setattr(svc, "RAIZ_MODELOS_PDF", tmp_path)
    svc.salvar_pdf_modelo(7, filename="modelo.pdf", content=_pdf_modelo())
    assert svc.tem_modelo_pdf(7) is False  # sem campo ligado ainda
    res = svc.salvar_campos(
        7,
        [
            {"marcador": "NOMETITULAR", "pagina": 1, "template": "{nome_deputado}"},
            {"marcador": "Não existe", "pagina": 1, "template": "{x}"},
        ],
    )
    assert [c["marcador"] for c in res["campos"]] == ["NOMETITULAR"]
    assert svc.tem_modelo_pdf(7) is True
    svc.remover_modelo_pdf(7)
    assert svc.tem_modelo_pdf(7) is False


def test_salvar_pdf_rejeita_arquivo_invalido(tmp_path, monkeypatch):
    from services import papelaria_prova_pdf_service as svc

    monkeypatch.setattr(svc, "RAIZ_MODELOS_PDF", tmp_path)
    with pytest.raises(Exception):
        svc.salvar_pdf_modelo(7, filename="x.pdf", content=b"nao e pdf")


def test_modo_prova_pdf_persiste(tmp_path, monkeypatch):
    from services import papelaria_prova_modo as modo

    monkeypatch.setattr(modo, "_SETTINGS_PATH", tmp_path / "papelaria_settings.json")
    modo.set_modo(modo.MODO_PROVA_PDF)
    assert modo.get_modo() == "prova_pdf"


# --------------------------------------------------------------------------
# create_job: só desvia para o servidor quando o modo é prova_pdf E há PDF.
# --------------------------------------------------------------------------


def _run_create(monkeypatch, *, modo: str, tem_pdf: bool):
    from services import papelaria_jobs_service as svc

    inserted: dict = {}
    executados: list[str] = []
    logs: list[str] = []
    gerados: list[int] = []

    class _FakeCursor:
        lastrowid = 42

        def execute(self, sql, params=None):
            executados.append(sql)
            if "INSERT INTO tabPapelariaJobs" in sql:
                inserted.update(params)

    def fake_query(sql, params=None):
        if "FROM tabProtocolos" in sql:
            return [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
        if "MAX(OrdemFila)" in sql:
            return [{"next_pos": 3}]
        if "INSERT INTO tabPapelariaJobLog" in sql:
            logs.append(params["msg"])
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_query)
    monkeypatch.setattr(
        svc.db, "execute_transaction", lambda ops: [op(_FakeCursor()) for op in ops]
    )
    monkeypatch.setattr(
        svc,
        "get_job",
        lambda job_id: {"id": job_id, "ano_protocolo": 2026, "nro_protocolo": 5954, "status": "pending", "dados": {}},
    )
    cdrs_consultados: list[int] = []

    def _cdrs(ano, nro):
        cdrs_consultados.append(nro)
        return []

    monkeypatch.setattr(svc, "list_os_usable_cdrs", _cdrs)
    monkeypatch.setattr("services.papelaria_prova_modo.get_modo", lambda: modo)
    monkeypatch.setattr(
        "services.papelaria_prova_pdf_service.tem_modelo_pdf", lambda modelo_id: tem_pdf
    )

    def _gerar(job_id):
        gerados.append(job_id)
        return {"id": job_id, "status": "completed"}

    monkeypatch.setattr("services.papelaria_prova_pdf_service.gerar_prova_do_job", _gerar)
    from tests.test_papelaria_jobs_service import MODEL_SAMPLE

    with patch.object(svc, "broadcast_job_update"), patch(
        "services.papelaria_models_service.get_modelo_by_id", return_value=MODEL_SAMPLE
    ):
        job = svc.create_job(
            ano=2026,
            nro=5954,
            modelo_id=1,
            dados={"nome_deputado": "Fulano", "email": "a@b.c"},
            solicitado_por="918713",
        )
    return {
        "job": job,
        "inserted": inserted,
        "sql": executados,
        "logs": logs,
        "gerados": gerados,
        "cdrs": cdrs_consultados,
    }


def test_create_prova_pdf_com_modelo_gera_no_servidor(monkeypatch):
    from services import papelaria_jobs_service as svc

    r = _run_create(monkeypatch, modo="prova_pdf", tem_pdf=True)
    assert r["inserted"]["status"] == svc.STATUS_PROCESSING
    assert any("WorkerID" in s for s in r["sql"])
    assert r["gerados"] == [42]
    assert r["cdrs"] == []  # não procura Corel na pasta
    assert r["job"]["status"] == "completed"


def test_create_prova_pdf_sem_modelo_vai_para_worker(monkeypatch):
    from services import papelaria_jobs_service as svc

    r = _run_create(monkeypatch, modo="prova_pdf", tem_pdf=False)
    assert r["inserted"]["status"] == svc.STATUS_PENDING
    assert r["gerados"] == []
    assert any("gerado pelo CorelDRAW" in m for m in r["logs"])


@pytest.mark.parametrize("modo", ["prova_web", "prova_email"])
def test_create_outros_modos_inalterados(monkeypatch, modo):
    from services import papelaria_jobs_service as svc

    r = _run_create(monkeypatch, modo=modo, tem_pdf=True)
    assert r["inserted"]["status"] == svc.STATUS_PENDING
    assert r["gerados"] == []
    assert not any("WorkerID" in s for s in r["sql"])
    assert not any("Prova PDF" in m for m in r["logs"])
    assert json.loads(r["inserted"]["dados"])["nome_deputado"] == "Fulano"

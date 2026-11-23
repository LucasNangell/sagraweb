"""Frente e verso independentes: fontes de face, padrões e composição no Prova PDF."""
from __future__ import annotations

import json
import os

import pytest

fitz = pytest.importorskip("fitz")

_FONTE = r"C:\Windows\Fonts\arial.ttf"


def _modelo(mid: int, fv: str, *, produto="Ct Visita", cores="Policromia", **extra) -> dict:
    return {
        "id": mid,
        "produto": produto,
        "cores": cores,
        "frente_versao": fv,
        "nome_exibicao": f"Modelo {mid}",
        "arquivo_modelo": f"m{mid}.cdr",
        **extra,
    }


@pytest.mark.parametrize(
    "fv,frente,verso",
    [
        ("Frente e Verso", 1, 2),
        ("Somente Frente", 1, None),
        ("Frente", 1, None),
        ("Verso", None, 1),
    ],
)
def test_pagina_da_face(fv, frente, verso):
    from services import papelaria_faces_service as svc

    assert svc.pagina_da_face(fv, "frente") == frente
    assert svc.pagina_da_face(fv, "verso") == verso


@pytest.fixture
def modelos_ct_visita(monkeypatch):
    from services import papelaria_faces_service as svc
    from services import papelaria_prova_pdf_service as pdf_svc

    modelos = [
        _modelo(1, "Frente e Verso", padrao_verso=True),
        _modelo(2, "Frente e Verso", padrao_frente=True),
        _modelo(3, "Verso"),
        _modelo(4, "Somente Frente"),
        _modelo(5, "Frente e Verso", cores="Port/Inglês"),  # outro recorte
        _modelo(6, "Frente e Verso"),  # sem PDF
    ]
    com_pdf = {1: 2, 2: 2, 3: 1, 4: 1, 5: 2}
    monkeypatch.setattr(pdf_svc, "tem_modelo_pdf", lambda mid: int(mid) in com_pdf)
    monkeypatch.setattr(svc, "_paginas_pdf", lambda mid: com_pdf.get(int(mid), 0))
    return modelos


def test_listar_fontes_por_produto_e_cores(modelos_ct_visita):
    from services import papelaria_faces_service as svc

    r = svc.listar_fontes("Ct Visita", "Policromia", modelos=modelos_ct_visita)
    frentes = {(f["modelo_id"], f["pagina"]) for f in r["frente"]}
    versos = {(f["modelo_id"], f["pagina"]) for f in r["verso"]}
    assert frentes == {(1, 1), (2, 1), (4, 1), (6, 1)}
    assert versos == {(1, 2), (2, 2), (3, 1), (6, 2)}
    assert r["disponivel"] is True
    assert r["padrao"] == {
        "frente": {"modelo_id": 2, "pagina": 1},
        "verso": {"modelo_id": 1, "pagina": 2},
    }
    # Padrão primeiro; sem PDF por último.
    assert r["frente"][0]["modelo_id"] == 2
    assert r["frente"][-1]["tem_pdf"] is False


def test_validar_composicao(modelos_ct_visita, monkeypatch):
    from services import papelaria_faces_service as svc
    from services import papelaria_models_service as models_svc

    monkeypatch.setattr(models_svc, "list_modelos_admin", lambda: modelos_ct_visita)
    base = modelos_ct_visita[1]  # modelo 2
    ok = {"frente": {"modelo_id": 2, "pagina": 1}, "verso": {"modelo_id": 3, "pagina": 1}}
    assert svc.validar_composicao(json.dumps(ok), base) == ok

    with pytest.raises(svc.ComposicaoError, match="não tem PDF"):
        svc.validar_composicao(
            {"frente": {"modelo_id": 2, "pagina": 1}, "verso": {"modelo_id": 6, "pagina": 2}}, base
        )
    with pytest.raises(svc.ComposicaoError, match="não pertence"):
        svc.validar_composicao(
            {"frente": {"modelo_id": 2, "pagina": 1}, "verso": {"modelo_id": 5, "pagina": 2}}, base
        )
    with pytest.raises(svc.ComposicaoError, match="frente da composição"):
        svc.validar_composicao(
            {"frente": {"modelo_id": 4, "pagina": 1}, "verso": {"modelo_id": 3, "pagina": 1}}, base
        )


def test_sanitizar_dados_aceita_e_valida_composicao():
    from services import papelaria_jobs_service as jobs

    comp = {"frente": {"modelo_id": "2", "pagina": 1}, "verso": {"modelo_id": 3, "pagina": "1"}}
    limpos = jobs._sanitize_dados({"nome_deputado": "Ana", "__composicao": json.dumps(comp)})
    assert json.loads(limpos["__composicao"]) == {
        "frente": {"modelo_id": 2, "pagina": 1},
        "verso": {"modelo_id": 3, "pagina": 1},
    }
    with pytest.raises(ValueError):
        jobs._sanitize_dados({"__composicao": '{"frente": {"modelo_id": 2}}'})


# --------------------------------------------------------------- composição


def _pdf(paginas: list[str]) -> bytes:
    if not os.path.isfile(_FONTE):
        pytest.skip("fonte Arial indisponível")
    doc = fitz.open()
    for texto in paginas:
        page = doc.new_page(width=255.1, height=141.7)
        page.insert_font(fontname="F1", fontfile=_FONTE)
        page.insert_text((20, 40), texto, fontname="F1", fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


def test_renderizar_composicao_junta_frente_e_verso(tmp_path, monkeypatch):
    from services import papelaria_prova_pdf_service as svc

    monkeypatch.setattr(svc, "RAIZ_MODELOS_PDF", tmp_path)
    svc.salvar_pdf_modelo(10, filename="fv.pdf", content=_pdf(["FRENTEA", "VERSOA"]))
    svc.salvar_campos(
        10,
        [
            {"marcador": "FRENTEA", "pagina": 1, "template": "Frente {nome_deputado}"},
            {"marcador": "VERSOA", "pagina": 2, "template": "Verso A {nome_deputado}"},
        ],
    )
    svc.salvar_pdf_modelo(11, filename="verso.pdf", content=_pdf(["VERSOB"]))
    svc.salvar_campos(11, [{"marcador": "VERSOB", "pagina": 1, "template": "Verso B {email}"}])

    comp = {"frente": {"modelo_id": 10, "pagina": 1}, "verso": {"modelo_id": 11, "pagina": 1}}
    out = svc.renderizar_composicao(comp, {"nome_deputado": "Ana", "email": "a@b.c"})
    doc = fitz.open(stream=out, filetype="pdf")
    try:
        assert doc.page_count == 2
        p1, p2 = (doc[i].get_text().replace(" ", " ") for i in (0, 1))
    finally:
        doc.close()
    assert "Frente Ana" in p1 and "FRENTEA" not in p1
    assert "Verso B a@b.c" in p2
    assert "Verso A" not in p2 and "VERSOA" not in p2


def test_renderizar_composicao_pagina_sem_campos_sai_como_no_pdf(tmp_path, monkeypatch):
    from services import papelaria_prova_pdf_service as svc

    monkeypatch.setattr(svc, "RAIZ_MODELOS_PDF", tmp_path)
    svc.salvar_pdf_modelo(10, filename="fv.pdf", content=_pdf(["FRENTEA", "VERSO FIXO"]))
    svc.salvar_campos(10, [{"marcador": "FRENTEA", "pagina": 1, "template": "{nome_deputado}"}])
    comp = {"frente": {"modelo_id": 10, "pagina": 1}, "verso": {"modelo_id": 10, "pagina": 2}}
    out = svc.renderizar_composicao(comp, {"nome_deputado": "Ana"})
    doc = fitz.open(stream=out, filetype="pdf")
    try:
        assert "Ana" in doc[0].get_text()
        assert "VERSO FIXO" in doc[1].get_text().replace(" ", " ")
    finally:
        doc.close()


def test_os_frente_e_verso_sem_modelo_combinado_lista_as_frentes():
    from services import papelaria_models_service as models_svc

    modelos = [
        _modelo(1, "Somente Frente"),
        _modelo(2, "Verso"),
        _modelo(3, "Somente Frente", produto="Bloco A5"),
    ]
    lista, _avisos, _auto = models_svc.match_modelos_para_os(
        "Ct Visita", "Policromia", "Frente e Verso", modelos
    )
    assert [m["id"] for m in lista] == [1]


def test_os_frente_e_verso_com_combinado_mantem_so_combinados():
    from services import papelaria_models_service as models_svc

    modelos = [_modelo(1, "Somente Frente"), _modelo(2, "Verso"), _modelo(4, "Frente e Verso")]
    lista, _avisos, auto = models_svc.match_modelos_para_os(
        "Ct Visita", "Policromia", "Frente e Verso", modelos
    )
    assert [m["id"] for m in lista] == [4]
    assert auto == 4


def test_remover_face(monkeypatch):
    from services import papelaria_faces_service as svc
    from services import papelaria_models_service as models_svc

    estado = {
        1: _modelo(1, "Frente e Verso"),
        2: _modelo(2, "Verso"),
        3: _modelo(3, "Frente e Verso", ocultar_verso=True),
    }
    sqls: list[tuple[str, dict]] = []
    excluidos: list[int] = []
    monkeypatch.setattr(models_svc, "ensure_papelaria_modelos_table", lambda: None)
    monkeypatch.setattr(models_svc, "get_modelo_by_id", lambda mid: estado.get(int(mid)))
    monkeypatch.setattr(models_svc, "delete_modelo_admin", lambda mid: excluidos.append(int(mid)))
    monkeypatch.setattr(svc.db, "execute_query", lambda sql, params=None: sqls.append((sql, params)))

    # Modelo de 2 páginas: remover o verso só oculta o verso (e tira o padrão).
    r = svc.remover_face(1, "verso")
    assert r["excluido"] is False
    assert "OcultarVerso = 1" in sqls[-1][0] and "PadraoVerso = 0" in sqls[-1][0]
    # Modelo só de verso: remover o verso exclui o modelo.
    assert svc.remover_face(2, "verso")["excluido"] is True
    # Modelo de 2 páginas com o verso já removido: remover a frente exclui o modelo.
    assert svc.remover_face(3, "frente")["excluido"] is True
    assert excluidos == [2, 3]
    with pytest.raises(svc.ComposicaoError):
        svc.remover_face(2, "frente")


def test_face_oculta_some_das_opcoes(modelos_ct_visita):
    from services import papelaria_faces_service as svc

    modelos = [dict(m) for m in modelos_ct_visita]
    modelos[0]["ocultar_verso"] = True  # modelo 1 perde o verso
    r = svc.listar_fontes("Ct Visita", "Policromia", modelos=modelos)
    assert (1, 2) not in {(f["modelo_id"], f["pagina"]) for f in r["verso"]}
    assert (1, 1) in {(f["modelo_id"], f["pagina"]) for f in r["frente"]}


def _gerar_corel_com_pdf(monkeypatch, tmp_path, render=None):
    from services import papelaria_jobs_service as jobs
    from services import papelaria_prova_pdf_service as pdf_svc
    from tests.test_papelaria_prova_pdf import _run_create

    renderizados: list[dict] = []

    def _render(modelo_id, dados, modelo, avisos=None):
        renderizados.append(dict(dados))
        return b"%PDF-final", 3

    monkeypatch.setattr(pdf_svc, "renderizar_pdf_final", render or _render)
    monkeypatch.setattr(jobs, "resolve_os_papelaria_dir", lambda ano, nro, create=False: str(tmp_path))
    monkeypatch.setattr(jobs, "get_os_folder_basename", lambda ano, nro: "05954-Pasta")
    original = jobs.create_job
    monkeypatch.setattr(jobs, "create_job", lambda **kw: original(**{**kw, "gerar_corel": True}))
    r = _run_create(monkeypatch, modo="prova_pdf", tem_pdf=True)
    return r, renderizados


def test_create_job_gerar_corel_parte_do_pdf_final(monkeypatch, tmp_path):
    """«Gerar Corel» com PDF do modelo: o servidor monta o PDF final e o worker o importa."""
    from services import papelaria_jobs_service as jobs

    r, renderizados = _gerar_corel_com_pdf(monkeypatch, tmp_path)
    assert r["inserted"]["status"] == jobs.STATUS_PENDING
    assert r["gerados"] == []  # a prova não é gerada no servidor
    assert r["cdrs"] == []  # não usa o Corel da pasta da OS
    assert renderizados and renderizados[0]["nome_deputado"] == "Fulano"
    dados = json.loads(r["inserted"]["dados"])
    assert dados[jobs.PDF_FONTE_COREL_DADOS_KEY] == "05954-Pasta-BaseSefoc.pdf"
    assert (tmp_path / "05954-Pasta-BaseSefoc.pdf").read_bytes() == b"%PDF-final"
    assert any("importa no CorelDRAW" in m for m in r["logs"])


def test_create_job_gerar_corel_erro_do_pdf_nao_cria_job(monkeypatch, tmp_path):
    from services import papelaria_prova_pdf_service as pdf_svc

    def _erro(*_a, **_k):
        raise pdf_svc.ProvaPdfError("A fonte não tem os caracteres ŵ")

    with pytest.raises(ValueError, match="caracteres"):
        _gerar_corel_com_pdf(monkeypatch, tmp_path, render=_erro)
    assert not list(tmp_path.iterdir())


def test_payload_do_worker_aponta_o_pdf_final(monkeypatch, tmp_path):
    from unittest.mock import patch as _patch

    from services import papelaria_jobs_service as jobs
    from tests.test_papelaria_jobs_service import MODEL_SAMPLE

    job = {
        "id": 90,
        "ano_protocolo": 2026,
        "nro_protocolo": 5954,
        "tipo_job": jobs.TIPO_JOB_CREATE,
        "produto": MODEL_SAMPLE["produto"],
        "modelo_id": 1,
        "arquivo_modelo": MODEL_SAMPLE["arquivo_modelo"],
        "dados": {"nome_deputado": "Ana", jobs.PDF_FONTE_COREL_DADOS_KEY: "05954-Pasta-BaseSefoc.pdf"},
        "tentativas": 0,
    }
    monkeypatch.setattr(jobs, "get_job", lambda job_id: job if job_id == 90 else None)
    monkeypatch.setattr(jobs, "resolve_os_papelaria_dir", lambda ano, nro, create=False: str(tmp_path))
    monkeypatch.setattr(jobs, "get_os_folder_basename", lambda ano, nro: "05954-Pasta")
    monkeypatch.setattr("routers.os_routes._get_os_folder_path", lambda ano, nro: str(tmp_path))
    with _patch("services.papelaria_models_service.get_modelo_by_id", return_value=MODEL_SAMPLE):
        payload = jobs.build_worker_job_payload(90)
    assert payload["source_pdf_path"] == str(tmp_path / "05954-Pasta-BaseSefoc.pdf")
    assert jobs.PDF_FONTE_COREL_DADOS_KEY not in payload["dados"]
    assert "base_cdr_path" not in payload


# --------------------------------------------------------------- modelo só PDF


def test_criar_modelo_de_pdf_e_campos_dos_textos_ligados(tmp_path, monkeypatch):
    from services import papelaria_modelo_admin_service as admin
    from services import papelaria_models_service as models_svc
    from services import papelaria_prova_pdf_service as pdf_svc

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path)
    monkeypatch.setattr(admin, "ensure_papelaria_modelos_table", lambda: None)
    monkeypatch.setattr(models_svc, "_table_has_column", lambda col: col == "NomeExibicao")
    linhas: dict[int, dict] = {}
    updates: list[dict] = []

    def execute_query(sql, params=None):
        sql_n = " ".join(sql.split())
        if sql_n.startswith("SELECT COALESCE(MAX(Ordem)"):
            return [{"max_ordem": 50}]
        if sql_n.startswith("INSERT INTO tabPapelariaModelos"):
            linhas[77] = dict(params)
            return []
        if sql_n.startswith("SELECT ID FROM tabPapelariaModelos"):
            return [{"ID": 77}]
        if sql_n.startswith("UPDATE tabPapelariaModelos SET VariaveisJson"):
            updates.append(dict(params))
            return []
        raise AssertionError(sql_n)

    monkeypatch.setattr(admin.db, "execute_query", execute_query)
    registro = {"id": 77, "produto": "Ct Visita", "frente_versao": "Verso", "arquivo_modelo": "verso-assessor.pdf"}
    monkeypatch.setattr(admin, "get_modelo_admin_by_id", lambda mid: registro)
    monkeypatch.setattr(models_svc, "get_modelo_by_id", lambda mid: registro)

    r = admin.create_modelo_from_pdf(
        produto="Ct Visita",
        frente_verso="Verso",
        cores="Policromia",
        filename="Verso Assessor (final).pdf",
        content=_pdf(["NOMEASSESSOR"]),
    )
    assert r["id"] == 77
    assert linhas[77]["fv"] == "Verso" and linhas[77]["arquivo"] == "Verso-Assessor-final.pdf"
    assert pdf_svc.caminho_pdf(77).is_file()

    pdf_svc.salvar_campos(
        77, [{"marcador": "NOMEASSESSOR", "pagina": 1, "template": "{nome_assessor} — {genero_curto}"}]
    )
    assert updates, "deveria atualizar os campos do formulário"
    assert set(json.loads(updates[-1]["v"])) == {"nome_assessor", "genero"}

    with pytest.raises(ValueError, match="PDF"):
        admin.create_modelo_from_pdf(
            produto="Ct Visita", frente_verso="Verso", cores="", filename="x.pdf", content=b"nada"
        )


def test_modelo_so_pdf_nao_vai_para_o_worker(monkeypatch):
    from tests.test_papelaria_prova_pdf import _run_create
    from services import papelaria_jobs_service as jobs
    from tests.test_papelaria_jobs_service import MODEL_SAMPLE

    so_pdf = {**MODEL_SAMPLE, "arquivo_modelo": "verso.pdf"}
    monkeypatch.setattr("tests.test_papelaria_jobs_service.MODEL_SAMPLE", so_pdf)
    with pytest.raises(ValueError, match="textos ligados"):
        _run_create(monkeypatch, modo="prova_pdf", tem_pdf=False)
    original = jobs.create_job
    monkeypatch.setattr(jobs, "create_job", lambda **kw: original(**{**kw, "gerar_corel": True}))
    # «Gerar Corel» de modelo só PDF ainda sem textos configurados: não há de onde partir.
    with pytest.raises(ValueError, match="textos ligados"):
        _run_create(monkeypatch, modo="prova_pdf", tem_pdf=False)

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

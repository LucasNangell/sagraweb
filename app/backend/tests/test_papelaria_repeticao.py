"""Repetição de SP: base da nova prova recortada da prova antiga."""
from __future__ import annotations

import json
import os

import pytest

fitz = pytest.importorskip("fitz")

MM = 72 / 25.4
_FONTE = r"C:\Windows\Fonts\arial.ttf"


def _fonte_ok():
    if not os.path.isfile(_FONTE):
        pytest.skip("fonte Arial indisponível")


def _prova_a4(*, verso: bool = True, escala: float = 1.0) -> bytes:
    """Folha A4 de prova antiga: molduras 85×50 rotuladas, carimbo fora."""
    _fonte_ok()
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="F1", fontfile=_FONTE)
    w, h = 85 * MM * escala, 50 * MM * escala
    molduras = [("Frente", fitz.Rect(150, 120, 150 + w, 120 + h))]
    if verso:
        molduras.append(("Verso", fitz.Rect(150, 360, 150 + w, 360 + h)))
    for rotulo, r in molduras:
        page.insert_text((r.x0, r.y0 - 8), rotulo, fontname="F1", fontsize=9)
        page.draw_rect(r, color=(0.14, 0.12, 0.13), width=0.3)
        page.insert_text((r.x0 + 20 * escala, r.y0 + 40 * escala), f"Texto da {rotulo}", fontname="F1", fontsize=10 * escala)
    page.insert_text((60, 780), "Prova SEFOC carimbo", fontname="F1", fontsize=9)
    page.draw_rect(fitz.Rect(40, 700, 300, 800), color=(1, 0, 0), fill=(1, 0.9, 0.9))
    data = doc.tobytes()
    doc.close()
    return data


def _textos(pdf: bytes) -> list[list[str]]:
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        # PDFs de teste com Arial: o espaço sai como NBSP na extração.
        return [[t.replace("\xa0", " ") for t in p.get_text().split("\n") if t.strip()] for p in doc]
    finally:
        doc.close()


def test_detectar_repeticao_formatos():
    from services.papelaria_repeticao_service import detectar_repeticao

    assert detectar_repeticao("---- Repetição da OS 1234/25 ----\n      Arquivos movidos") == {
        "origem_nro": 1234,
        "origem_ano": 2025,
        "rotulo": "1234/25",
    }
    assert detectar_repeticao("Repeticao da OS 6254/2026")["origem_ano"] == 2026
    assert detectar_repeticao("REPETIÇÃO") == {"origem_nro": None, "origem_ano": None, "rotulo": None}
    assert detectar_repeticao("Partido: PL") is None
    assert detectar_repeticao(None) is None


def test_base_de_prova_a4_frente_e_verso():
    from services import papelaria_repeticao_service as rep

    base, molduras = rep.montar_base(_prova_a4(), (85, 50), 2)
    assert [m.face for m in molduras] == ["frente", "verso"]
    doc = fitz.open(stream=base, filetype="pdf")
    try:
        assert doc.page_count == 2
        for p in doc:
            assert p.rect.width == pytest.approx(85 * MM, abs=0.05)
            assert p.rect.height == pytest.approx(50 * MM, abs=0.05)
            # A moldura (contorno) não sobra na página.
            assert not [d for d in p.get_drawings() if d["rect"].width > 200]
    finally:
        doc.close()
    textos = _textos(base)
    assert textos[0] == ["Texto da Frente"] and textos[1] == ["Texto da Verso"]
    # Rótulos e carimbo de fora não vêm junto.
    assert "Prova SEFOC carimbo" not in str(textos) and "Frente" not in textos[1]


def test_texto_mantem_posicao_relativa_e_fonte():
    from services import papelaria_repeticao_service as rep

    base, _ = rep.montar_base(_prova_a4(verso=False), (85, 50), 1)
    doc = fitz.open(stream=base, filetype="pdf")
    try:
        span = doc[0].get_text("dict")["blocks"][0]["lines"][0]["spans"][0]
        assert span["origin"][0] == pytest.approx(20, abs=0.3)
        assert span["origin"][1] == pytest.approx(40, abs=0.3)
        assert span["size"] == pytest.approx(10, abs=0.01)
        assert "Arial" in span["font"]
    finally:
        doc.close()


def test_prova_reduzida_volta_ao_tamanho():
    from services import papelaria_repeticao_service as rep

    base, molduras = rep.montar_base(_prova_a4(verso=False, escala=0.5), (85, 50), 1)
    assert molduras[0].escala == pytest.approx(2.0, abs=0.01)
    doc = fitz.open(stream=base, filetype="pdf")
    try:
        span = doc[0].get_text("dict")["blocks"][0]["lines"][0]["spans"][0]
        assert span["size"] == pytest.approx(10, abs=0.05)
        assert span["origin"][0] == pytest.approx(20, abs=0.5)
    finally:
        doc.close()


def test_prova_ja_no_formato_usa_as_paginas():
    from services import papelaria_repeticao_service as rep

    _fonte_ok()
    doc = fitz.open()
    for rotulo in ("Frente", "Verso"):
        p = doc.new_page(width=85 * MM, height=50 * MM)
        p.insert_font(fontname="F1", fontfile=_FONTE)
        p.insert_text((10, 20), f"Pag {rotulo}", fontname="F1", fontsize=8)
    pdf = doc.tobytes()
    doc.close()
    base, molduras = rep.montar_base(pdf, (85, 50), 2)
    assert all(m.pagina_inteira for m in molduras)
    assert _textos(base) == [["Pag Frente"], ["Pag Verso"]]


def test_sem_moldura_do_produto_da_erro_claro():
    from services import papelaria_repeticao_service as rep

    with pytest.raises(rep.RepeticaoError, match="moldura do produto"):
        rep.montar_base(_prova_a4(), (148, 210), 1)


def test_base_editavel_so_redesenha_o_texto_editado(tmp_path, monkeypatch):
    from services import papelaria_prova_pdf_service as pdf_svc
    from services import papelaria_repeticao_service as rep

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path)
    base, _ = rep.montar_base(_prova_a4(), (85, 50), 2)
    campos, _avisos = rep.campos_editaveis(base)
    pasta = rep._pasta_base(2026, 6255)
    pasta.mkdir(parents=True)
    rep.caminho_base(2026, 6255).write_bytes(base)
    (pasta / "config.json").write_text(json.dumps({"campos": campos}), encoding="utf-8")

    r = pdf_svc.previa_repeticao(2026, 6255, {}, dpi=30)
    assert {x["chave"] for x in r["regioes"]} == {"0:1:Texto da Frente", "0:2:Texto da Verso"}
    assert not any(x["editado"] for x in r["regioes"])

    sem_edicao, _ = pdf_svc.renderizar_pdf_final(1, {"__repeticao": "2026-6255"}, {})
    assert _textos(sem_edicao) == _textos(base)

    editado, n = pdf_svc.renderizar_pdf_final(
        1,
        {"__repeticao": "2026-6255", "__textos": json.dumps({"0:2:Texto da Verso": "Novo verso"})},
        {},
    )
    assert n == 1
    assert _textos(editado) == [["Texto da Frente"], ["Novo verso"]]


def test_fonte_simples_winansi_e_editavel():
    """Provas antigas do Corel usam Type1/CFF com WinAnsi (1 byte por letra)."""
    from services import papelaria_prova_pdf_service as svc

    doc = fitz.open()
    page = doc.new_page(width=200, height=100)
    page.insert_text((10, 50), "Abc", fontname="helv", fontsize=10)
    xref = [f for f in page.get_fonts(full=True) if f[2] == "Type1"][0][0]
    fonte = fitz.Font("helv")
    larguras = " ".join(str(int(fonte.glyph_advance(c) * 1000)) for c in range(32, 127))
    doc.xref_set_key(xref, "FirstChar", "32")
    doc.xref_set_key(xref, "LastChar", "126")
    doc.xref_set_key(xref, "Widths", f"[{larguras}]")
    emb = svc.ler_fonte_embutida(doc, xref)
    assert emb is not None and emb.simples
    assert emb.codificar("Ab") == "4162"
    assert emb.faltando("Aé") == ["é"]  # fora da tabela /Widths


def test_create_job_repeticao_exige_base_da_propria_os(monkeypatch, tmp_path):
    from services import papelaria_jobs_service as jobs
    from services import papelaria_prova_pdf_service as pdf_svc
    from tests.test_papelaria_prova_pdf import _run_create

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path)
    original = jobs.create_job
    monkeypatch.setattr(
        jobs,
        "create_job",
        lambda **kw: original(**{**kw, "dados": {**kw["dados"], "__repeticao": "2026-5954"}}),
    )
    with pytest.raises(ValueError, match="base da repetição"):
        _run_create(monkeypatch, modo="prova_pdf", tem_pdf=False)


def test_os_antiga_so_frente_recebe_verso_do_modelo(tmp_path, monkeypatch):
    """OS nova frente e verso, OS antiga só frente: verso vem do modelo escolhido."""
    from services import papelaria_models_service as models_svc
    from services import papelaria_prova_pdf_service as pdf_svc
    from services import papelaria_repeticao_service as rep
    from tests.test_papelaria_prova_pdf import _pdf_modelo

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path)
    base, molduras = rep.montar_base(_prova_a4(verso=False), (85, 50), 2)
    assert [m.face for m in molduras] == ["frente"]
    campos, _ = rep.campos_editaveis(base)
    pasta = rep._pasta_base(2026, 6300)
    pasta.mkdir(parents=True)
    rep.caminho_base(2026, 6300).write_bytes(base)
    (pasta / "config.json").write_text(json.dumps({"campos": campos}), encoding="utf-8")
    # Modelo do verso com um campo do formulário.
    pdf_svc.salvar_pdf_modelo(9, filename="verso.pdf", content=_pdf_modelo())
    pdf_svc.salvar_campos(9, [{"marcador": "NOMETITULAR", "pagina": 1, "template": "{nome_assessor}"}])
    monkeypatch.setattr(models_svc, "get_modelo_by_id", lambda mid: {"id": mid, "campos": {}})

    comp = {"frente": {"modelo_id": 0, "pagina": 1}, "verso": {"modelo_id": 9, "pagina": 1}}
    dados = {"__repeticao": "2026-6300", "__composicao": json.dumps(comp), "nome_assessor": "Joelson"}
    final, _ = pdf_svc.renderizar_pdf_final(1, dados, {})
    textos = _textos(final)
    assert len(textos) == 2
    assert textos[0] == ["Texto da Frente"]
    assert "Joelson" in textos[1] and "NOMETITULAR" not in str(textos[1])

    previa = pdf_svc.previa_repeticao(2026, 6300, dados, dpi=30)
    assert {(r["modelo_id"], r["pagina_saida"]) for r in previa["regioes"]} == {(0, 0), (9, 1)}
    # Sem verso escolhido: só a frente.
    so_frente, _ = pdf_svc.renderizar_pdf_final(1, {"__repeticao": "2026-6300"}, {})
    assert len(_textos(so_frente)) == 1


def test_frente_e_verso_misturam_repeticao_e_modelo(tmp_path, monkeypatch):
    """Origem frente e verso: cada face vem da repetição (modelo 0) ou de um modelo."""
    from services import papelaria_models_service as models_svc
    from services import papelaria_prova_pdf_service as pdf_svc
    from services import papelaria_repeticao_service as rep
    from services.papelaria_faces_service import ComposicaoError, normalizar_composicao
    from tests.test_papelaria_prova_pdf import _pdf_modelo

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path)
    base, _ = rep.montar_base(_prova_a4(), (85, 50), 2)
    campos, _ = rep.campos_editaveis(base)
    pasta = rep._pasta_base(2026, 6301)
    pasta.mkdir(parents=True)
    rep.caminho_base(2026, 6301).write_bytes(base)
    (pasta / "config.json").write_text(json.dumps({"campos": campos}), encoding="utf-8")
    pdf_svc.salvar_pdf_modelo(9, filename="frente.pdf", content=_pdf_modelo())
    pdf_svc.salvar_campos(9, [{"marcador": "NOMETITULAR", "pagina": 1, "template": "{nome_deputado}"}])
    monkeypatch.setattr(models_svc, "get_modelo_by_id", lambda mid: {"id": mid, "campos": {}})

    def render(comp):
        dados = {"__repeticao": "2026-6301", "__composicao": json.dumps(comp), "nome_deputado": "Ana"}
        return _textos(pdf_svc.renderizar_pdf_final(1, dados, {})[0])

    # Frente do modelo + verso da repetição.
    t = render({"frente": {"modelo_id": 9, "pagina": 1}, "verso": {"modelo_id": 0, "pagina": 2}})
    assert "Ana" in t[0] and t[1] == ["Texto da Verso"]
    # Frente da repetição + verso do modelo.
    t = render({"frente": {"modelo_id": 0, "pagina": 1}, "verso": {"modelo_id": 9, "pagina": 1}})
    assert t[0] == ["Texto da Frente"] and "Ana" in t[1]
    # As duas da repetição.
    t = render({"frente": {"modelo_id": 0, "pagina": 1}, "verso": {"modelo_id": 0, "pagina": 2}})
    assert t == [["Texto da Frente"], ["Texto da Verso"]]
    # Modelo 0 só vale com repetição.
    with pytest.raises(ComposicaoError):
        normalizar_composicao({"frente": {"modelo_id": 0, "pagina": 1}, "verso": {"modelo_id": 9, "pagina": 1}})


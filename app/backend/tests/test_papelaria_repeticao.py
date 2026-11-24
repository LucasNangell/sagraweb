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



# --- Prova da própria OS no padrão antigo (A4): imposição e alteração ---------------------------


def _prova_no_formato() -> bytes:
    _fonte_ok()
    doc = fitz.open()
    page = doc.new_page(width=85 * MM, height=50 * MM)
    page.insert_font(fontname="F1", fontfile=_FONTE)
    page.insert_text((20, 40), "Prova nova", fontname="F1", fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


def _os_com_prova(tmp_path, monkeypatch, prova: bytes):
    """Pasta Sefoc em tmp, OS 85×50 frente e verso e a última prova dada."""
    from services import papelaria_jobs_service as jobs
    from services import papelaria_repeticao_service as rep

    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    caminho = sefoc / "06242-Fulano-CtVisita-Prova1_SEFOC.pdf"
    caminho.write_bytes(prova)
    monkeypatch.setattr(rep, "ultima_prova_da_os", lambda ano, nro: str(caminho))
    monkeypatch.setattr(rep, "formato_do_produto", lambda ano, nro: ((85.0, 50.0), 2, 15))
    monkeypatch.setattr(jobs, "resolve_os_papelaria_dir", lambda ano, nro, create=False: str(sefoc))
    monkeypatch.setattr(jobs, "get_os_folder_basename", lambda ano, nro: "06242-Fulano-CtVisita")
    return sefoc, caminho


def _tamanhos_mm(caminho) -> list[tuple[float, float]]:
    with fitz.open(caminho) as doc:
        return [(round(p.rect.width / MM), round(p.rect.height / MM)) for p in doc]


def test_prova_antiga_da_os_so_quando_fora_do_formato(tmp_path, monkeypatch):
    from services import papelaria_repeticao_service as rep

    _sefoc, caminho = _os_com_prova(tmp_path, monkeypatch, _prova_a4())
    assert rep.prova_antiga_da_os(2026, 6242) == {"arquivo": caminho.name, "caminho": str(caminho)}
    caminho.write_bytes(_prova_no_formato())
    os.utime(caminho, (os.path.getmtime(caminho) + 5,) * 2)
    assert rep.prova_antiga_da_os(2026, 6242) is None


def test_imposicao_monta_base_sefoc_no_formato_da_prova_antiga(tmp_path, monkeypatch):
    from services import papelaria_jobs_service as jobs

    sefoc, _prova = _os_com_prova(tmp_path, monkeypatch, _prova_a4())
    caminho = jobs.resolve_base_sefoc_pdf_path(2026, 6242)
    assert os.path.basename(caminho) == "06242-Fulano-CtVisita-BaseSefoc.pdf"
    assert _tamanhos_mm(caminho) == [(85, 50), (85, 50)]
    assert _textos(open(caminho, "rb").read()) == [["Texto da Frente"], ["Texto da Verso"]]
    # Segunda vez reaproveita o arquivo já montado.
    mtime = os.path.getmtime(caminho)
    assert jobs.resolve_base_sefoc_pdf_path(2026, 6242) == caminho
    assert os.path.getmtime(caminho) == mtime


def test_imposicao_nao_sobrescreve_base_sefoc_antiga(tmp_path, monkeypatch):
    from services import papelaria_jobs_service as jobs

    sefoc, _prova = _os_com_prova(tmp_path, monkeypatch, _prova_a4())
    antiga = sefoc / "06242-Fulano-CtVisita-BaseSefoc.pdf"
    antiga.write_bytes(_prova_a4())
    caminho = jobs.resolve_base_sefoc_pdf_path(2026, 6242)
    assert os.path.basename(caminho) == "06242-Fulano-CtVisita-BaseSefoc-Formato.pdf"
    assert _tamanhos_mm(caminho) == [(85, 50), (85, 50)]
    assert _tamanhos_mm(antiga) == [(210, 297)]


def test_imposicao_usa_base_sefoc_que_ja_esta_no_formato(tmp_path, monkeypatch):
    from services import papelaria_jobs_service as jobs

    sefoc, _prova = _os_com_prova(tmp_path, monkeypatch, _prova_a4())
    base = sefoc / "06242-Fulano-CtVisita-BaseSefoc.pdf"
    base.write_bytes(_prova_no_formato())
    assert jobs.resolve_base_sefoc_pdf_path(2026, 6242) == os.path.normpath(str(base))
    assert not (sefoc / "06242-Fulano-CtVisita-BaseSefoc-Formato.pdf").exists()


def test_alteracao_monta_base_editavel_da_propria_prova(tmp_path, monkeypatch):
    from services import papelaria_models_service as models_svc
    from services import papelaria_prova_pdf_service as pdf_svc
    from services import papelaria_repeticao_service as rep

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path / "raiz")
    _sefoc, caminho = _os_com_prova(tmp_path, monkeypatch, _prova_a4())
    # Contexto antes de montar: aponta a prova antiga, sem base.
    ctx = models_svc._repeticao_da_sp(2026, 6242, "")
    assert ctx["propria"] is True and ctx["base"] is None and ctx["prova_antiga"] == caminho.name

    r = rep.criar_base(ano=2026, nro=6242, origem_ano=2026, origem_nro=6242, alvo_mm=(85, 50), faces=2, propria=True)
    assert r["propria"] is True and r["arquivo_origem"] == caminho.name
    assert [f["face"] for f in r["faces"]] == ["frente", "verso"]
    previa = pdf_svc.previa_repeticao(2026, 6242, {}, dpi=30)
    assert {x["chave"] for x in previa["regioes"]} == {"0:1:Texto da Frente", "0:2:Texto da Verso"}
    # Depois: a base própria vem no contexto (mesmo com «Repetição» na observação).
    ctx = models_svc._repeticao_da_sp(2026, 6242, "Repetição da OS 1234/25")
    assert ctx["propria"] is True and ctx["base"]["propria"] is True and ctx["origem_nro"] == 6242


# --- Moldura não vai para a base nova (contorno em cm relativo, polilinha, partido) -------------

_W, _H = 85 * MM, 50 * MM  # moldura do produto (pt)
_X, _Y = 150.0, 500.0  # canto inferior esquerdo da moldura (coordenadas PDF)


def _prova_com_conteudo(moldura: str) -> bytes:
    """A4 com um texto dentro da moldura e a moldura desenhada pelo conteúdo cru dado."""
    _fonte_ok()
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="F1", fontfile=_FONTE)
    # Texto dentro da moldura (coordenadas da página, origem no topo).
    page.insert_text((_X + 20, 842 - _Y - 60), "Conteudo interno", fontname="F1", fontsize=10)
    page.insert_text((_X, 842 - _Y - _H - 8), "Frente", fontname="F1", fontsize=9)
    xref = doc.get_new_xref()
    doc.update_object(xref, "<<>>")
    doc.update_stream(xref, ("q 0 0 0 1 K .3 w " + moldura + " Q\n").encode("latin-1"))
    atuais = page.get_contents()
    doc.xref_set_key(page.xref, "Contents", "[" + " ".join(f"{x} 0 R" for x in [*atuais, xref]) + "]")
    data = doc.tobytes()
    doc.close()
    return data


def _sem_moldura(base: bytes) -> None:
    doc = fitz.open(stream=base, filetype="pdf")
    try:
        for page in doc:
            pr = page.rect
            for d in page.get_drawings():
                r = d["rect"]
                assert not (d.get("type") == "s" and r.width > pr.width * 0.9 and r.height > pr.height * 0.9), d
            pix = page.get_pixmap(dpi=150)
            w, h, n, s = pix.width, pix.height, pix.n, pix.samples
            escuros = [
                (x, y)
                for y in range(h)
                for x in range(w)
                if (x < 3 or y < 3 or x >= w - 3 or y >= h - 3) and sum(s[(y * w + x) * n:(y * w + x) * n + 3]) < 600
            ]
            assert not escuros, escuros[:5]
    finally:
        doc.close()


@pytest.mark.parametrize(
    "moldura",
    [
        # Corel: «cm» de translação e «re» relativo; a segunda moldura com cm acumulado.
        f"q 1 0 0 1 {_X} {_Y} cm 0 0 m 0 0 {_W:.3f} {_H:.3f} re S 1 0 0 1 0 -200 cm 0 0 m 0 0 {_W:.3f} {_H:.3f} re S Q",
        # Polilinha m/l/l/l a partir do canto superior direito (como nas pastas).
        f"q 1 0 0 1 {_X + _W:.3f} {_Y} cm 0 0 m 0 {_H:.3f} l {-_W:.3f} {_H:.3f} l {-_W:.3f} 0 l h S Q",
        # Partida em dois caminhos.
        f"{_X} {_Y + _H:.3f} m {_X + _W:.3f} {_Y + _H:.3f} l {_X + _W:.3f} {_Y} l S "
        f"{_X + _W:.3f} {_Y} m {_X} {_Y} l {_X} {_Y + _H:.3f} l S",
        # Escalada (unidades de 1/10 pt, estilo Illustrator).
        f"q 0.1 0 0 0.1 0 0 cm {_X * 10} {_Y * 10} {_W * 10:.2f} {_H * 10:.2f} re S Q",
    ],
    ids=["cm-relativo", "polilinha", "partida", "escalada"],
)
def test_moldura_nao_vai_para_a_base(moldura):
    from services import papelaria_repeticao_service as rep

    prova = _prova_com_conteudo(moldura)
    # O contorno é achado no conteúdo (não depende do recorte de reserva).
    with fitz.open(stream=prova, filetype="pdf") as doc:
        r = fitz.Rect(_X, 842 - _Y - _H, _X + _W, 842 - _Y)
        assert rep._apagar_contorno(doc, doc[0], r) >= 1
    base, molduras = rep.montar_base(prova, (85, 50), 1)
    assert molduras[0].metodo == "tamanho do produto"
    _sem_moldura(base)
    assert _textos(base) == [["Conteudo interno"]]
    with fitz.open(stream=base, filetype="pdf") as doc:
        assert doc.metadata["keywords"] == rep.MARCA_MONTAGEM


def test_moldura_no_mesmo_traco_de_outro_desenho_so_ela_sai():
    from services import papelaria_repeticao_service as rep

    moldura = (
        f"{_X} {_Y} {_W:.3f} {_H:.3f} re "
        f"{_X + 30} {_Y + 20} m {_X + 130} {_Y + 20} l S"  # linha interna no mesmo «S»
    )
    doc = fitz.open(stream=_prova_com_conteudo(moldura), filetype="pdf")
    page = doc[0]
    r = fitz.Rect(_X, 842 - _Y - _H, _X + _W, 842 - _Y)
    assert rep._apagar_contorno(doc, page, r) == 1
    linhas = [d["rect"] for d in page.get_drawings() if d.get("type") == "s"]
    doc.close()
    # A moldura saiu; a linha interna (100 pt) ficou.
    assert not any(abs(x.width - _W) < 1 for x in linhas), linhas
    assert any(abs(x.width - 100) < 1 and x.height < 1 for x in linhas), linhas


def test_base_montada_antes_da_correcao_e_limpa_ao_ser_usada(tmp_path, monkeypatch):
    """Base guardada por versão antiga (com a moldura): limpa ao carregar a config."""
    from services import papelaria_prova_pdf_service as pdf_svc
    from services import papelaria_repeticao_service as rep

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path)
    # Simula a montagem antiga: página no formato com a moldura sobre as bordas.
    doc = fitz.open()
    page = doc.new_page(width=_W, height=_H)
    page.draw_rect(page.rect, color=(0, 0, 0), width=0.3)
    page.insert_text((20, 40), "Texto", fontsize=10)
    antiga = doc.tobytes()
    doc.close()
    pasta = rep._pasta_base(2026, 7001)
    pasta.mkdir(parents=True)
    rep.caminho_base(2026, 7001).write_bytes(antiga)
    (pasta / "config.json").write_text(json.dumps({"campos": []}), encoding="utf-8")

    cfg = rep.carregar_config_base(2026, 7001)
    assert cfg["versao_montagem"] == rep.VERSAO_MONTAGEM
    _sem_moldura(rep.caminho_base(2026, 7001).read_bytes())
    assert rep.montagem_atual(str(rep.caminho_base(2026, 7001)))
    assert json.loads((pasta / "config.json").read_text(encoding="utf-8"))["versao_montagem"] == rep.VERSAO_MONTAGEM


def test_imposicao_limpa_base_sefoc_montada_antes_da_correcao(tmp_path, monkeypatch):
    from services import papelaria_jobs_service as jobs

    sefoc, _prova = _os_com_prova(tmp_path, monkeypatch, _prova_a4())
    base = sefoc / "06242-Fulano-CtVisita-BaseSefoc.pdf"
    doc = fitz.open()
    for _ in range(2):
        page = doc.new_page(width=_W, height=_H)
        page.draw_rect(page.rect, color=(0, 0, 0), width=0.3)
    base.write_bytes(doc.tobytes())
    doc.close()
    assert jobs.resolve_base_sefoc_pdf_path(2026, 6242) == os.path.normpath(str(base))
    _sem_moldura(base.read_bytes())

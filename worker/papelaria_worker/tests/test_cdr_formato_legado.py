"""Regras de reconstrução do Corel antigo (sem COM)."""
from __future__ import annotations

import sys

import pytest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import cdr_formato_legado as leg  # noqa: E402
from cdr_formato_legado import ShapeInfo  # noqa: E402

RECT = leg.CDR_RECTANGLE_SHAPE
TEXT = leg.CDR_TEXT_SHAPE
GROUP = 7


def _b(left, bottom, w, h):
    return (left, bottom, left + w, bottom + h)


def _sample_shapes():
    """Estrutura do 06592 CtVisita: A4 com bordas sem nome em «Linhas»."""
    return [
        ShapeInfo("", TEXT, _b(62.07, 202.17, 12.42, 3.59), "Arte", texto="Verso"),
        ShapeInfo("", TEXT, _b(62.45, 265.17, 13.66, 3.59), "Arte", texto="Frente"),
        ShapeInfo("Contato", TEXT, _b(85.47, 215.45, 39.05, 2.26), "Arte", texto="dep@x"),
        ShapeInfo("NomeDep", TEXT, _b(72.35, 167.98, 27.23, 12.85), "Arte", texto="Everton"),
        ShapeInfo("Brasao", GROUP, _b(68.67, 254.95, 14.73, 16.0), "BrasaoPB"),
        ShapeInfo("", RECT, _b(65.5, 152.4, 79.0, 44.0), "Base"),
        ShapeInfo("", RECT, _b(65.5, 215.4, 79.0, 44.0), "Base"),
        ShapeInfo("", RECT, _b(62.5, 149.4, 85.0, 50.0), "Linhas"),
        ShapeInfo("", RECT, _b(62.5, 212.4, 85.0, 50.0), "Linhas"),
        ShapeInfo("", RECT, _b(0.0, 0.0, 210.0, 297.0), "Linhas"),
        ShapeInfo("OSint", TEXT, _b(21.5, 49.4, 17.9, 2.8), "ProvaSefoc", texto="06592/2025"),
    ]


def test_formato_difere():
    assert leg.formato_difere((210.0, 297.0), (85.0, 50.0))
    assert not leg.formato_difere((85.4, 49.7), (85.0, 50.0))
    assert not leg.formato_difere((210.0, 297.0), None)


def test_detecta_bordas_sem_nome_pelos_rotulos():
    bordas = leg.detectar_bordas(_sample_shapes(), (85.0, 50.0))
    assert [b.face for b in bordas] == ["Frente", "Verso"]
    assert bordas[0].bounds == _b(62.5, 212.4, 85.0, 50.0)
    assert bordas[1].bounds == _b(62.5, 149.4, 85.0, 50.0)


def test_bordas_sem_rotulo_de_cima_para_baixo():
    shapes = [s for s in _sample_shapes() if s.texto not in ("Frente", "Verso")]
    bordas = leg.detectar_bordas(shapes, (85.0, 50.0))
    assert [b.face for b in bordas] == ["Frente", "Verso"]
    assert bordas[0].bounds[1] == 212.4


def test_bordas_nomeadas_tem_prioridade():
    shapes = [
        ShapeInfo("BordaV", RECT, _b(0, 0, 90, 55), "Linhas"),
        ShapeInfo("BordaF", RECT, _b(0, 100, 90, 55), "Linhas"),
        ShapeInfo("", RECT, _b(0, 200, 85, 50), "Linhas"),
    ]
    bordas = leg.detectar_bordas(shapes, (85.0, 50.0))
    assert [(b.face, b.nome) for b in bordas] == [("Frente", "BordaF"), ("Verso", "BordaV")]


def test_sem_borda_nem_retangulo_do_produto():
    shapes = [ShapeInfo("", RECT, _b(0, 0, 40, 40), "Linhas")]
    assert leg.detectar_bordas(shapes, (85.0, 50.0)) == []
    assert leg.detectar_bordas(shapes, None) == []


def test_conteudo_sem_bordas_fundo_nem_moldura():
    shapes = _sample_shapes()
    bordas = leg.detectar_bordas(shapes, (85.0, 50.0))
    frente = leg.selecionar_conteudo(shapes, bordas[0], bordas)
    verso = leg.selecionar_conteudo(shapes, bordas[1], bordas)
    assert [s.nome for s in frente] == ["Contato"]  # Brasão PB fica fora (centro acima)
    assert [s.nome for s in verso] == ["NomeDep"]
    todos = frente + verso
    assert not any(s.camada in ("Base", "Linhas") for s in todos)
    assert not any(s.texto in ("Frente", "Verso") for s in todos)


def test_grupo_com_borda_dentro_e_aberto():
    borda = ShapeInfo("BordaF", RECT, _b(0, 0, 85, 50), "Arte")
    texto = ShapeInfo("NomeDep", TEXT, _b(10, 10, 20, 5), "Arte")
    grupo = ShapeInfo("", GROUP, _b(0, 0, 85, 50), "Arte", filhos=[borda, texto])
    bordas = leg.detectar_bordas([grupo], (85.0, 50.0))
    assert [s.nome for s in leg.selecionar_conteudo([grupo], bordas[0], bordas)] == ["NomeDep"]


def test_deslocamento_mantem_posicao_relativa_e_centraliza():
    assert leg.deslocamento(_b(62.5, 212.4, 85, 50), (0, 0, 85, 50)) == pytest.approx((-62.5, -212.4))
    dx, dy = leg.deslocamento(_b(10, 10, 80, 40), (0, 0, 90, 50))
    assert (round(dx, 6), round(dy, 6)) == (-5.0, -5.0)


def test_destino_admin_docs_com_sufixo(tmp_path):
    cdr = tmp_path / "Sefoc" / "x_Base.cdr"
    existentes = {str(tmp_path / "Sefoc" / "AdminDocs" / "x_Base.cdr")}
    alvo = leg.destino_admin_docs(str(cdr), existe=lambda p: p in existentes)
    assert alvo == str(tmp_path / "Sefoc" / "AdminDocs" / "x_Base (2).cdr")


def test_mover_para_admin_docs(tmp_path):
    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    cdr = sefoc / "antigo.cdr"
    cdr.write_bytes(b"cdr")
    novo = leg.mover_para_admin_docs(str(cdr))
    assert not cdr.exists()
    assert Path(novo) == sefoc / "AdminDocs" / "antigo.cdr"
    assert Path(novo).read_bytes() == b"cdr"


def test_parear_ocorrencias_por_face_e_proximidade():
    ocs = [(0, "Frente", 65.9, 12.2), (1, "Frente", 17.7, 12.2), (2, "Verso", 23.5, 25.0)]
    entradas = [
        {"face": "Frente", "x": 17.69, "y": 12.18, "key": "obj_endereco_1"},
        {"face": "Frente", "x": 65.89, "y": 12.18, "key": "obj_endereco_2"},
        {"face": "Verso", "x": 23.46, "y": 25.0, "key": "obj_nomedep_2"},
    ]
    pares = leg.parear_ocorrencias(ocs, entradas)
    assert pares[0]["key"] == "obj_endereco_2"
    assert pares[1]["key"] == "obj_endereco_1"
    assert pares[2]["key"] == "obj_nomedep_2"
    # Mais ocorrências que entradas: as que sobram ficam sem campo.
    assert 1 not in leg.parear_ocorrencias(ocs[:2], entradas[1:2])


def test_nome_face():
    assert [leg.nome_face(p) for p in (1, 2, 3)] == ["Frente", "Verso", "Página 3"]


def test_planejar_troca_de_linhas_preserva_estrutura():
    from corel_generator import planejar_troca_de_linhas

    antigo = "Everton Rocha\rChefe de Gabinete\r\rFone: (84) 3113-0944\r\r"
    novo = "Maria Teste\nAssessora Parlamentar\n\nFone: (84) 3113-0000"
    trocas = planejar_troca_de_linhas(antigo, novo)
    # Da última para a primeira, só as linhas que mudaram (offsets do Corel).
    assert trocas == [
        (33, 53, "Fone: (84) 3113-0000"),
        (14, 31, "Assessora Parlamentar"),
        (0, 13, "Maria Teste"),
    ]
    # Número de linhas diferente: troca o texto inteiro (None).
    assert planejar_troca_de_linhas(antigo, "Só uma linha") is None
    assert planejar_troca_de_linhas("uma linha", "outra") is None


class _FakeRange:
    def __init__(self, itens):
        self.itens = itens
        self.Count = len(itens)

    def Item(self, i):
        return self.itens[i - 1]


class _FakeShape:
    def __init__(self, nome, tipo=6, filhos=()):
        self.Name = nome
        self.Type = tipo
        self.Shapes = _FakeRange(list(filhos))
        self.LeftX, self.BottomY, self.SizeWidth, self.SizeHeight = 0.0, 0.0, 10.0, 10.0
        self.Text = type("T", (), {"Story": type("S", (), {"Text": nome})()})()


class _FakePageShapes:
    def __init__(self, por_nome):
        self.por_nome = por_nome
        self.chamadas = []

    def FindShapes(self, nome):
        self.chamadas.append(nome)
        return _FakeRange(self.por_nome.get(nome, []))


class _FakePage:
    def __init__(self, por_nome):
        self.Shapes = _FakePageShapes(por_nome)


def test_variantes_nome_cobrem_maiusculas_e_espacos():
    assert leg.variantes_nome("Nome Dep")[:3] == ["Nome Dep", "NomeDep", "nome dep"]
    assert "NOMEDEP" in leg.variantes_nome("nomedep")
    assert leg.variantes_nome("") == []


def test_buscar_por_nome_tenta_variantes_e_para_no_primeiro_achado():
    alvo = _FakeShape("nomedep")
    page = _FakePage({"nomedep": [alvo]})
    assert leg.buscar_por_nome(page, "NomeDep") == [alvo]
    assert page.Shapes.chamadas == ["NomeDep", "nomedep"]
    assert leg.buscar_por_nome(_FakePage({}), "X") == []


def test_expandir_grupos_so_abre_grupo_que_envolve_borda():
    borda = leg.Borda("Frente", (0, 0, 85, 50))
    filho = _FakeShape("NomeDep")
    grande = ShapeInfo("", 7, (0, 0, 100, 60), "Arte", ref=_FakeShape("", 7, [filho]))
    pequeno = ShapeInfo("", 7, (10, 10, 20, 20), "Arte", ref=_FakeShape("", 7, [filho]))
    leg.expandir_grupos([grande, pequeno], [borda])
    assert [f.nome for f in grande.filhos] == ["NomeDep"]
    assert pequeno.filhos == []


def test_tamanho_modelo_com_cache(tmp_path, monkeypatch):
    modelo = tmp_path / "CtVisitaFV.cdr"
    modelo.write_bytes(b"cdr")
    chamadas = []
    monkeypatch.setattr(leg, "ler_tamanho_primeira_pagina", lambda corel, p: chamadas.append(p) or (85.0, 50.0))
    cache = tmp_path / "cache"
    assert leg.tamanho_modelo_com_cache(None, str(modelo), str(cache)) == (85.0, 50.0)
    assert leg.tamanho_modelo_com_cache(None, str(modelo), str(cache)) == (85.0, 50.0)
    assert len(chamadas) == 1  # segunda vez veio do cache
    modelo.write_bytes(b"cdr alterado")
    leg.tamanho_modelo_com_cache(None, str(modelo), str(cache))
    assert len(chamadas) == 2  # arquivo mudou: relê


def test_indice_por_nomes_usa_busca_nativa(monkeypatch):
    import corel_generator as cg

    nome1 = _FakeShape("NomeDep")
    nome2 = _FakeShape("NomeDep")
    paginas = [_FakePage({"NomeDep": [nome1]}), _FakePage({"NomeDep": [nome2], "Contato": []})]
    doc = type("D", (), {})()
    doc.Pages = type("P", (), {"Count": 2, "Item": lambda self, i: paginas[i - 1]})()
    idx = cg.construir_indice_por_nomes(doc, ["NomeDep", "Contato", "NomeDep"])
    assert [o["pagina"] for o in idx["NomeDep"]] == [1, 2]
    assert "Contato" not in idx

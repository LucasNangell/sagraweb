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

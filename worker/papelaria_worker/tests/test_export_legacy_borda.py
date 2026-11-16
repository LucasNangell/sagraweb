"""Detecção de CDR legado (BordaF) e metadados da exportação."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from corel_generator import (  # noqa: E402
    _eh_shape_borda_referencia,
    _listar_shapes_conteudo_na_pagina,
    _nome_igual,
    _normalizar_nome_shape,
    documento_tem_borda_f,
    encontrar_shapes_por_nome,
)


def test_documento_tem_borda_f_true(monkeypatch):
    import corel_generator as cg

    monkeypatch.setattr(
        cg,
        "encontrar_shapes_no_documento",
        lambda doc, nome: [{"pagina": 1, "shape": object()}] if nome == "BordaF" else [],
    )
    assert documento_tem_borda_f(MagicMock()) is True


def test_documento_tem_borda_f_false(monkeypatch):
    import corel_generator as cg

    monkeypatch.setattr(
        cg,
        "encontrar_shapes_no_documento",
        lambda doc, nome: [],
    )
    assert documento_tem_borda_f(MagicMock()) is False


def test_documento_tem_borda_f_resiste_a_erro(monkeypatch):
    import corel_generator as cg

    def _boom(doc, nome):
        raise RuntimeError("COM down")

    monkeypatch.setattr(cg, "encontrar_shapes_no_documento", _boom)
    assert documento_tem_borda_f(MagicMock()) is False


def test_normalizar_nome_shape_ignora_case_e_espacos():
    assert _normalizar_nome_shape("BordaF") == "bordaf"
    assert _normalizar_nome_shape(" borda f ") == "bordaf"
    assert _normalizar_nome_shape("BORDAV") == "bordav"
    assert _nome_igual("Borda F", "bordaf")
    assert _nome_igual("BordaV", "borda v")


def test_encontrar_shapes_por_nome_case_insensitive():
    child = MagicMock()
    child.Name = "bordaf"
    child.Shapes.Count = 0

    shapes = MagicMock()
    shapes.Count = 1
    shapes.Item.return_value = child

    found = encontrar_shapes_por_nome(shapes, "BordaF")
    assert found == [child]


def test_eh_shape_borda_referencia_aceita_variacoes():
    for nome in ("BordaF", "bordaf", "Borda F", "BordaV", "borda v"):
        shape = MagicMock()
        shape.Name = nome
        assert _eh_shape_borda_referencia(shape) is True

    other = MagicMock()
    other.Name = "arte1"
    assert _eh_shape_borda_referencia(other) is False


def _mock_layer(name: str, shapes: list[MagicMock]) -> MagicMock:
    layer = MagicMock()
    layer.Name = name
    coll = MagicMock()
    coll.Count = len(shapes)
    coll.Item.side_effect = lambda i: shapes[i - 1]
    layer.Shapes = coll
    return layer


def test_listar_conteudo_fallback_quando_arte_vazia_e_borda_em_linhas():
    """BordaF em 'linhas' + arte fora de 'arte' → coleta todas as camadas."""
    borda = MagicMock()
    borda.Name = "BordaF"
    borda.Shapes.Count = 0

    arte_obj = MagicMock()
    arte_obj.Name = "Logo"
    arte_obj.Shapes.Count = 0

    page = MagicMock()
    layers = [
        _mock_layer("linhas", [borda]),
        _mock_layer("conteudo", [arte_obj]),
    ]
    layers_coll = MagicMock()
    layers_coll.Count = len(layers)
    layers_coll.Item.side_effect = lambda i: layers[i - 1]
    page.Layers = layers_coll

    logs: list[str] = []
    out = _listar_shapes_conteudo_na_pagina(page, logs)
    assert arte_obj in out
    assert borda not in out
    assert any("todas as camadas" in msg for msg in logs)


def test_listar_conteudo_prefere_camada_arte():
    arte_obj = MagicMock()
    arte_obj.Name = "Texto"
    arte_obj.Shapes.Count = 0

    outro = MagicMock()
    outro.Name = "Guia"
    outro.Shapes.Count = 0

    page = MagicMock()
    layers = [
        _mock_layer("arte", [arte_obj]),
        _mock_layer("linhas", [outro]),
    ]
    layers_coll = MagicMock()
    layers_coll.Count = len(layers)
    layers_coll.Item.side_effect = lambda i: layers[i - 1]
    page.Layers = layers_coll

    logs: list[str] = []
    out = _listar_shapes_conteudo_na_pagina(page, logs)
    assert out == [arte_obj]

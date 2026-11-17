"""Testes — extração e edição de textos do .cdr da OS (fakes COM, sem Corel)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from corel_generator import (  # noqa: E402
    CDR_TEXT_SHAPE_TYPE,
    CorelGenerationError,
    aplicar_edicoes_cdr,
    encontrar_shape_por_static_id,
    extrair_objetos_texto,
)


class FakeCollection:
    def __init__(self, items):
        self._items = list(items)

    @property
    def Count(self):
        return len(self._items)

    def Item(self, i):
        return self._items[i - 1]


class FakeStory:
    def __init__(self, text):
        self.Text = text


class FakeText:
    def __init__(self, text, tipo=0):
        self.Story = FakeStory(text)
        self.Type = tipo


class FakeShape:
    def __init__(self, static_id, *, name="", text=None, children=None):
        self.StaticID = static_id
        self.Name = name
        if text is not None:
            self.Type = CDR_TEXT_SHAPE_TYPE
            self.Text = FakeText(text)
            self.Shapes = FakeCollection([])
        else:
            self.Type = 7  # grupo
            self.Shapes = FakeCollection(children or [])

    @property
    def PowerClip(self):
        return None


class FakeLayer:
    def __init__(self, name, shapes, guides=False):
        self.Name = name
        self.Shapes = FakeCollection(shapes)
        self.IsGuidesLayer = guides
        self.IsDesktopLayer = False
        self.IsGridLayer = False


class FakePage:
    def __init__(self, layers):
        self.Layers = FakeCollection(layers)


class FakeDoc:
    def __init__(self, pages):
        self.Pages = FakeCollection(pages)


def _doc():
    nome_p1 = FakeShape(101, name="Nome", text="Fulano")
    grupo = FakeShape(200, children=[FakeShape(102, text="Rua A, 10\r")])
    guia = FakeShape(999, text="guia")
    nome_p2 = FakeShape(301, name="Nome", text="Fulano")
    return FakeDoc(
        [
            FakePage([FakeLayer("Camada 1", [nome_p1, grupo]), FakeLayer("Guias", [guia], guides=True)]),
            FakePage([FakeLayer("Camada 1", [nome_p2])]),
        ]
    )


def test_extrai_textos_nomeados_e_aninhados_ignorando_guias():
    objetos = extrair_objetos_texto(_doc())
    assert [(o["pagina"], o["static_id"], o["nome"], o["texto"]) for o in objetos] == [
        (1, 101, "Nome", "Fulano"),
        (1, 102, "", "Rua A, 10"),
        (2, 301, "Nome", "Fulano"),
    ]
    assert objetos[0]["camada"] == "Camada 1"


def test_encontra_shape_por_static_id_em_grupo_e_outra_pagina():
    doc = _doc()
    assert encontrar_shape_por_static_id(doc, 1, 102).StaticID == 102
    # Página errada: cai para busca no documento inteiro.
    assert encontrar_shape_por_static_id(doc, 1, 301).StaticID == 301
    assert encontrar_shape_por_static_id(doc, 1, 555) is None


def test_aplica_texto_e_nome():
    doc = _doc()
    logs: list[str] = []
    stats = aplicar_edicoes_cdr(
        doc,
        [
            {"static_id": 101, "pagina": 1, "nome_atual": "Nome", "texto": "Beltrano"},
            {"static_id": 102, "pagina": 1, "nome_atual": "", "novo_nome": "Endereco"},
        ],
        logs,
    )
    assert stats == {"textos": 1, "nomes": 1}
    assert encontrar_shape_por_static_id(doc, 1, 101).Text.Story.Text == "Beltrano"
    assert encontrar_shape_por_static_id(doc, 1, 102).Name == "Endereco"


def test_objeto_ausente_aborta():
    with pytest.raises(CorelGenerationError, match="não encontrado"):
        aplicar_edicoes_cdr(_doc(), [{"static_id": 555, "pagina": 1, "texto": "x"}], [])

"""Testes — contornos CMYK(38,99,73,2) sem preenchimento fora do PDF Base (JDF)."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import corel_generator as cg  # noqa: E402
from corel_generator import (  # noqa: E402
    encontrar_contornos_referencia,
    exportar_pdf_base_e_prova,
    shape_e_contorno_referencia,
)


class FakeCollection:
    def __init__(self, items):
        self._items = list(items)

    @property
    def Count(self):
        return len(self._items)

    def Item(self, i):
        return self._items[i - 1]


class FakeColor:
    def __init__(self, cmyk, tipo=2):
        self.Type = tipo
        self.CMYKCyan, self.CMYKMagenta, self.CMYKYellow, self.CMYKBlack = cmyk


class FakeFill:
    def __init__(self, tipo):
        self.Type = tipo


class FakeOutline:
    def __init__(self, cmyk, tipo=1, width=0.2):
        self.Type = tipo
        self.Width = width
        self.Color = FakeColor(cmyk)


class FakeShape:
    def __init__(self, *, fill=0, outline=(38, 99, 73, 2), outline_tipo=1, children=None):
        self.Visible = True
        self.Fill = FakeFill(fill)
        self.Outline = FakeOutline(outline, tipo=outline_tipo)
        self.Shapes = FakeCollection(children or [])
        self.Type = 7 if children else 3
        self.PowerClip = None


class FakeLayer:
    def __init__(self, shapes):
        self.Shapes = FakeCollection(shapes)


class FakePage:
    def __init__(self, layers):
        self.Layers = FakeCollection(layers)


class FakeDoc:
    def __init__(self, pages):
        self.Pages = FakeCollection(pages)


def test_criterio_contorno_referencia():
    assert shape_e_contorno_referencia(FakeShape())
    # Com preenchimento: fica no PDF.
    assert not shape_e_contorno_referencia(FakeShape(fill=1))
    # Outra cor de contorno.
    assert not shape_e_contorno_referencia(FakeShape(outline=(0, 0, 0, 100)))
    # Sem contorno.
    assert not shape_e_contorno_referencia(FakeShape(outline_tipo=0))


def test_encontra_inclusive_dentro_de_grupo():
    alvo_grupo = FakeShape()
    doc = FakeDoc(
        [
            FakePage(
                [
                    FakeLayer(
                        [
                            FakeShape(),
                            FakeShape(fill=1),
                            FakeShape(children=[alvo_grupo, FakeShape(fill=1)]),
                        ]
                    )
                ]
            )
        ]
    )
    achados = encontrar_contornos_referencia(doc)
    assert len(achados) == 2
    assert alvo_grupo in achados


def test_exporta_prova_completa_e_base_sem_contorno():
    contorno = FakeShape()
    doc = FakeDoc([FakePage([FakeLayer([contorno, FakeShape(fill=1)])])])
    visibilidade_no_export: dict[str, bool] = {}

    def fake_export(_corel, _doc, caminho, _logs):
        visibilidade_no_export[caminho] = contorno.Visible

    logs: list[str] = []
    with patch.object(cg, "exportar_pdf", side_effect=fake_export):
        separou = exportar_pdf_base_e_prova(None, doc, "base.pdf", "prova.pdf", logs)

    assert separou is True
    assert visibilidade_no_export == {"prova.pdf": True, "base.pdf": False}
    assert contorno.Visible is True  # restaurado após o PDF Base
    assert any("fora do PDF" in m for m in logs)


def test_sem_contorno_exporta_um_pdf_so():
    doc = FakeDoc([FakePage([FakeLayer([FakeShape(fill=1)])])])
    chamadas: list[str] = []
    with patch.object(
        cg, "exportar_pdf", side_effect=lambda _c, _d, caminho, _l: chamadas.append(caminho)
    ):
        separou = exportar_pdf_base_e_prova(None, doc, "base.pdf", "prova.pdf", [])
    assert separou is False
    assert chamadas == ["base.pdf"]

"""Detecção de CDR legado (BordaF) e metadados da exportação."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from corel_generator import documento_tem_borda_f  # noqa: E402


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

"""Testes do Análise Lab (schema soft + pasta + marcas)."""
from __future__ import annotations

import pytest

from services import analise_lab_service as lab
from services import prova_web_render_service as render_svc


def test_validate_pasta_render_accepts_analise_lab() -> None:
    assert render_svc.validate_pasta_render("AnaliseLab") == "AnaliseLab"
    assert render_svc.validate_pasta_render("Prova1") == "Prova1"
    assert render_svc.LAB_PASTA_RENDER == "AnaliseLab"


def test_validate_pasta_render_rejects_bad() -> None:
    with pytest.raises(ValueError):
        render_svc.validate_pasta_render("../x")
    with pytest.raises(ValueError):
        render_svc.validate_pasta_render("Prova0")
    with pytest.raises(ValueError):
        render_svc.validate_pasta_render("AnaliseLab2")


def test_validate_geometry_offset() -> None:
    g = lab._validate_geometry("offset_corte", {"edge": "top", "offsetMm": 7})
    assert g == {"edge": "top", "offsetMm": 7.0}


def test_validate_geometry_rejects_bad_type() -> None:
    with pytest.raises(ValueError, match="Tipo"):
        lab._validate_geometry("xyz", {})


def test_validate_geometry_grade_bounds() -> None:
    with pytest.raises(ValueError):
        lab._validate_geometry("grade", {"stepMm": 0.5})
    g = lab._validate_geometry("grade", {"stepMm": 10})
    assert g["stepMm"] == 10.0


def test_add_mark_rejects_invalid_tipo(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="Tipo"):
        lab.add_mark(
            1,
            pagina=0,
            tipo="invalido",
            geometria={},
            rotulo=None,
            cor="red",
            ponto=None,
        )

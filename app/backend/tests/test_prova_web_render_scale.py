"""Escala de raster da Prova WEB: 4.0 abaixo de 50 páginas-fonte."""

from __future__ import annotations

import pytest

from services.prova_web_render_service import render_scale


@pytest.fixture(autouse=True)
def _clear_scale_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SAGRA_PROVA_WEB_RENDER_SCALE", raising=False)


def test_render_scale_high_for_short_docs() -> None:
    assert render_scale(49) == 4.0
    assert render_scale(1) == 4.0


def test_render_scale_default_for_long_docs() -> None:
    assert render_scale(50) == 3.0
    assert render_scale(80) == 3.0
    assert render_scale() == 3.0
    assert render_scale(None) == 3.0


def test_render_scale_env_overrides_any_page_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SAGRA_PROVA_WEB_RENDER_SCALE", "2.0")
    assert render_scale(1) == 2.0
    assert render_scale(80) == 2.0
    assert render_scale() == 2.0


def test_render_scale_env_clamped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SAGRA_PROVA_WEB_RENDER_SCALE", "9")
    assert render_scale(1) == 4.0
    monkeypatch.setenv("SAGRA_PROVA_WEB_RENDER_SCALE", "0.5")
    assert render_scale(80) == 1.0


def test_render_scale_invalid_env_falls_back_to_page_heuristic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SAGRA_PROVA_WEB_RENDER_SCALE", "abc")
    assert render_scale(10) == 4.0
    assert render_scale(50) == 3.0

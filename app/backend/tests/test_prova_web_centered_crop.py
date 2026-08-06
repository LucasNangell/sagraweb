"""Testes do crop centralizado por formato OS (Prova WEB)."""
from __future__ import annotations

import pytest

from services import prova_web_crop_service as crop_svc


def test_centered_crop_exact_fit() -> None:
    crop = crop_svc.centered_crop_mm(210, 297, 210, 297)
    assert crop is not None
    assert crop["top"] == 0
    assert crop["left"] == 0
    assert crop["source"] == "formato"


def test_centered_crop_with_margins() -> None:
    # Media 230×317, alvo 210×297 → 10 mm em cada lado
    crop = crop_svc.centered_crop_mm(230, 317, 210, 297)
    assert crop is not None
    assert crop["left"] == pytest.approx(10.0, abs=0.05)
    assert crop["right"] == pytest.approx(10.0, abs=0.05)
    assert crop["top"] == pytest.approx(10.0, abs=0.05)
    assert crop["bottom"] == pytest.approx(10.0, abs=0.05)


def test_centered_crop_tries_swapped_orientation() -> None:
    # Convenção A4 do sistema: altura 210 × largura 297; PDF portrait 210×297
    crop = crop_svc.centered_crop_mm(210, 297, 297, 210)
    assert crop is not None
    remain_w = 210 - crop["left"] - crop["right"]
    remain_h = 297 - crop["top"] - crop["bottom"]
    assert remain_w == pytest.approx(210.0, abs=0.1)
    assert remain_h == pytest.approx(297.0, abs=0.1)


def test_centered_crop_rejects_oversized() -> None:
    assert crop_svc.centered_crop_mm(100, 100, 200, 200) is None

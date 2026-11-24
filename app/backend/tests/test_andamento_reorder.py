"""Testes do mapeamento de reordenação de andamentos."""
from __future__ import annotations

import pytest

from services.andamento_reorder import (
    build_reorder_mapping,
    mapping_changed,
)


def test_build_mapping_identity_noop():
    slots = ["001002026-01", "001002026-02", "001002026-03"]
    mapping = build_reorder_mapping(slots, slots)
    assert mapping == {
        "001002026-01": "001002026-01",
        "001002026-02": "001002026-02",
        "001002026-03": "001002026-03",
    }
    assert mapping_changed(mapping) is False


def test_build_mapping_move_last_to_first():
    slots = ["A-01", "A-02", "A-03"]
    ordered = ["A-03", "A-01", "A-02"]
    mapping = build_reorder_mapping(slots, ordered)
    assert mapping == {
        "A-03": "A-01",
        "A-01": "A-02",
        "A-02": "A-03",
    }
    assert mapping_changed(mapping) is True


def test_build_mapping_move_middle_down():
    slots = ["01", "02", "03", "04"]
    # move "02" to after "03" → ["01", "03", "02", "04"]
    ordered = ["01", "03", "02", "04"]
    mapping = build_reorder_mapping(slots, ordered)
    assert mapping == {
        "01": "01",
        "03": "02",
        "02": "03",
        "04": "04",
    }


def test_build_mapping_rejects_length_mismatch():
    with pytest.raises(ValueError, match="mesma quantidade"):
        build_reorder_mapping(["a", "b"], ["a"])


def test_build_mapping_rejects_non_permutation():
    with pytest.raises(ValueError, match="permutação"):
        build_reorder_mapping(["a", "b"], ["a", "c"])

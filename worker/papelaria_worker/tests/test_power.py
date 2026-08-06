"""Testes de proteção contra suspensão."""
from __future__ import annotations

import ctypes
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import power  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_power_state():
    power._active = False
    yield
    power._active = False


def test_prevent_sleep_windows(monkeypatch):
    calls: list[int] = []

    class FakeKernel32:
        def SetThreadExecutionState(self, flags: int) -> int:
            calls.append(flags)
            return 1

    monkeypatch.setattr(power, "_is_windows", lambda: True)
    monkeypatch.setattr(
        ctypes,
        "windll",
        SimpleNamespace(kernel32=FakeKernel32()),
    )

    assert power.prevent_sleep() is True
    assert power.sleep_guard_active() is True
    assert calls == [power.ES_CONTINUOUS | power.ES_SYSTEM_REQUIRED]


def test_allow_sleep_windows(monkeypatch):
    calls: list[int] = []

    class FakeKernel32:
        def SetThreadExecutionState(self, flags: int) -> int:
            calls.append(flags)
            return 1

    monkeypatch.setattr(power, "_is_windows", lambda: True)
    monkeypatch.setattr(
        ctypes,
        "windll",
        SimpleNamespace(kernel32=FakeKernel32()),
    )
    power._active = True

    assert power.allow_sleep() is True
    assert power.sleep_guard_active() is False
    assert calls == [power.ES_CONTINUOUS]


def test_prevent_sleep_nao_windows(monkeypatch):
    monkeypatch.setattr(power, "_is_windows", lambda: False)
    assert power.prevent_sleep() is False
    assert power.sleep_guard_active() is False

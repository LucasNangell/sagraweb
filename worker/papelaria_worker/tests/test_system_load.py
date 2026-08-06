"""Testes de métricas de carga do worker."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from system_load import collect_system_load, is_local_load_acceptable  # noqa: E402


class _FakeCpu:
    def __init__(self, value: float):
        self._value = value

    def cpu_percent(self, interval=0):
        return self._value


class _FakeMem:
    def __init__(self, percent: float):
        self.percent = percent


def test_collect_system_load_score(monkeypatch):
    import psutil

    monkeypatch.setattr(psutil, "cpu_percent", lambda interval=0: 40.0)
    monkeypatch.setattr(psutil, "virtual_memory", lambda: _FakeMem(60.0))
    load = collect_system_load()
    assert load["cpu_percent"] == 40.0
    assert load["memory_percent"] == 60.0
    assert load["score"] == 50.0


def test_is_local_load_acceptable_ok():
    load = {"cpu_percent": 30.0, "memory_percent": 50.0}
    ok, reason = is_local_load_acceptable(
        load, max_cpu_percent=75, max_memory_percent=80
    )
    assert ok is True
    assert reason == ""


def test_is_local_load_acceptable_cpu_alto():
    load = {"cpu_percent": 90.0, "memory_percent": 50.0}
    ok, reason = is_local_load_acceptable(
        load, max_cpu_percent=75, max_memory_percent=80
    )
    assert ok is False
    assert "CPU" in reason


def test_is_local_load_acceptable_ram_alta():
    load = {"cpu_percent": 10.0, "memory_percent": 95.0}
    ok, reason = is_local_load_acceptable(
        load, max_cpu_percent=75, max_memory_percent=80
    )
    assert ok is False
    assert "RAM" in reason

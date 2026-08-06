"""Métricas locais de CPU/RAM para balanceamento de carga do worker."""
from __future__ import annotations

from typing import Any


def collect_system_load() -> dict[str, float]:
    import psutil

    cpu = float(psutil.cpu_percent(interval=0.1))
    mem = float(psutil.virtual_memory().percent)
    score = round(0.5 * cpu + 0.5 * mem, 1)
    return {
        "cpu_percent": round(cpu, 1),
        "memory_percent": round(mem, 1),
        "score": score,
    }


def is_local_load_acceptable(
    load: dict[str, Any],
    *,
    max_cpu_percent: float,
    max_memory_percent: float,
) -> tuple[bool, str]:
    try:
        cpu = float(load.get("cpu_percent", 0))
        mem = float(load.get("memory_percent", 0))
    except (TypeError, ValueError):
        return True, ""

    if cpu > max_cpu_percent:
        return False, f"CPU {cpu:.0f}% acima do limite {max_cpu_percent:.0f}%"
    if mem > max_memory_percent:
        return False, f"RAM {mem:.0f}% acima do limite {max_memory_percent:.0f}%"
    return True, ""

"""Impede dois workers Corel no mesmo PC."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from worker import acquire_single_instance_lock  # noqa: E402


def test_second_worker_lock_is_rejected(tmp_path):
    first = acquire_single_instance_lock(str(tmp_path / "temp"))
    assert first is not None
    second = acquire_single_instance_lock(str(tmp_path / "temp"))
    assert second is None
    first.close()

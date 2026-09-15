from resilience.heavy_jobs import inprocess_heavy_jobs
from services.runtime_metrics_service import (
    _fetch_all_snapshot,
    record_os_search_fetch_all,
)


def test_inprocess_heavy_jobs_default_true(monkeypatch):
    monkeypatch.delenv("SAGRA_INPROCESS_HEAVY_JOBS", raising=False)
    assert inprocess_heavy_jobs() is True


def test_inprocess_heavy_jobs_can_disable(monkeypatch):
    monkeypatch.setenv("SAGRA_INPROCESS_HEAVY_JOBS", "0")
    assert inprocess_heavy_jobs() is False


def test_fetch_all_metrics_record():
    record_os_search_fetch_all(rows=42, elapsed_ms=12.5, bytes_out=1000)
    snap = _fetch_all_snapshot()
    assert snap["last_rows"] == 42
    assert snap["last_bytes"] == 1000
    assert snap["last_minute"] >= 1

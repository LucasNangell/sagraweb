import pytest
from fastapi import HTTPException

from resilience.cpu_jobs import cpu_job_slot, snapshot


def test_cpu_job_slot_tracks_in_use(monkeypatch):
    monkeypatch.setenv("SAGRA_CPU_JOB_SLOTS", "2")
    with cpu_job_slot(label="t", timeout_sec=1):
        assert snapshot()["in_use"] == 1
    assert snapshot()["in_use"] == 0


def test_cpu_job_slot_timeout_http(monkeypatch):
    monkeypatch.setenv("SAGRA_CPU_JOB_SLOTS", "1")
    with cpu_job_slot(label="hold", timeout_sec=5):
        with pytest.raises(HTTPException) as exc:
            with cpu_job_slot(label="wait", wait=False, timeout_sec=0):
                pass
        assert exc.value.status_code == 503

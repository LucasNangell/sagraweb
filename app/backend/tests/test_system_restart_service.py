from __future__ import annotations

import json
from pathlib import Path

import pytest

from services import system_restart_service as svc


def test_cooldown_blocks_second_restart(tmp_path: Path):
    status_path = tmp_path / "system_restart_status.json"
    status_path.write_text(
        json.dumps(
            {
                "request_id": "abc",
                "phase": "done",
                "ok": True,
                "started_at": "2099-01-01T00:00:00+00:00",
                "finished_at": "2099-01-01T00:00:05+00:00",
            }
        ),
        encoding="utf-8",
    )
    status = svc.read_restart_status(path=status_path)
    with pytest.raises(svc.SystemRestartError) as exc:
        svc._assert_can_start(status, now=1.0)
    assert exc.value.status_code == 429


def test_in_progress_blocks_restart(tmp_path: Path, monkeypatch):
    status_path = tmp_path / "system_restart_status.json"
    now_iso = "2026-01-01T12:00:00+00:00"
    status_path.write_text(
        json.dumps(
            {
                "request_id": "abc",
                "phase": "running",
                "ok": None,
                "started_at": now_iso,
                "finished_at": None,
            }
        ),
        encoding="utf-8",
    )
    started = svc._parse_iso(now_iso)
    assert started is not None
    status = svc.read_restart_status(path=status_path)
    with pytest.raises(svc.SystemRestartError) as exc:
        svc._assert_can_start(status, now=started + 10)
    assert exc.value.status_code == 409


def test_request_system_restart_dry_run(tmp_path: Path, monkeypatch):
    script = tmp_path / "reiniciar-servicos-sagra.ps1"
    script.write_text("# noop\n", encoding="utf-8")
    status_path = tmp_path / "status.json"
    monkeypatch.setattr(svc.sys, "platform", "win32")

    result = svc.request_system_restart(
        reason="teste",
        requested_by="999",
        system_root=tmp_path,
        status_path=status_path,
        script_path=script,
        dry_run=True,
    )
    assert result["phase"] == "done"
    assert result["ok"] is True
    saved = json.loads(status_path.read_text(encoding="utf-8"))
    assert saved["request_id"] == result["request_id"]
    assert saved["requested_by"] == "999"


def test_request_system_restart_requires_script(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(svc.sys, "platform", "win32")
    with pytest.raises(svc.SystemRestartError) as exc:
        svc.request_system_restart(
            system_root=tmp_path,
            status_path=tmp_path / "status.json",
            script_path=tmp_path / "missing.ps1",
        )
    assert exc.value.status_code == 503

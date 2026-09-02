from __future__ import annotations

import json
from pathlib import Path

from services import prova_web_render_service as render_svc


def test_write_manifest_retries_transient_permission_error(
    tmp_path: Path,
    monkeypatch,
) -> None:
    manifest_path = tmp_path / "manifest.json"
    real_replace = render_svc._replace_file
    attempts = {"count": 0}

    def flaky_replace(src: str, dst: str) -> None:
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise PermissionError("[WinError 5] Acesso negado")
        real_replace(src, dst)

    monkeypatch.setattr(render_svc, "_replace_file", flaky_replace)
    monkeypatch.setattr(render_svc.time, "sleep", lambda _delay: None)

    assert render_svc._write_manifest_json(str(manifest_path), {"ok": True}) is True
    assert attempts["count"] == 3
    assert json.loads(manifest_path.read_text(encoding="utf-8")) == {"ok": True}


def test_write_optional_manifest_gives_up_and_removes_temp(
    tmp_path: Path,
    monkeypatch,
) -> None:
    manifest_path = tmp_path / "manifest.json"

    def locked_replace(_src: str, _dst: str) -> None:
        raise PermissionError("[WinError 5] Acesso negado")

    monkeypatch.setattr(render_svc, "_replace_file", locked_replace)
    monkeypatch.setattr(render_svc.time, "sleep", lambda _delay: None)

    assert (
        render_svc._write_manifest_json(
            str(manifest_path),
            {"partial": True},
            required=False,
        )
        is False
    )
    assert not manifest_path.exists()
    assert list(tmp_path.glob("manifest.json.*.tmp")) == []

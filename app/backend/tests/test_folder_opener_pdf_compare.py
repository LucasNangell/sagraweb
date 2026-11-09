"""Smoke do Folder Opener — validação de paths e health pdf_compare."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SERVICES = Path(__file__).resolve().parents[2] / "services"
_OPENER = _SERVICES / "folder_opener_service.py"


def _load_opener():
    spec = importlib.util.spec_from_file_location("folder_opener_service", _OPENER)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def opener():
    return _load_opener()


def test_validate_compare_pdf_rejects_non_pdf(opener, tmp_path):
    bad = tmp_path / "x.txt"
    bad.write_text("nope", encoding="utf-8")
    ok, msg = opener._validate_compare_pdf_path(str(bad))
    assert ok is False
    assert "PDF" in msg


def test_validate_compare_pdf_accepts_existing(opener, tmp_path):
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    ok, path = opener._validate_compare_pdf_path(str(pdf))
    assert ok is True
    assert Path(path).name == "a.pdf"


def test_health_exposes_pdf_compare_flag(opener):
    client = opener.app.test_client()
    res = client.get("/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["version"] == "1.3.0"
    assert "pdf_compare" in data
    assert isinstance(data["pdf_compare"], bool)


def test_pdf_compare_start_missing_file(opener):
    client = opener.app.test_client()
    res = client.post(
        "/pdf-compare/start",
        json={
            "previous_path": "C:\\no\\such\\a.pdf",
            "current_path": "C:\\no\\such\\b.pdf",
            "dpi": 150,
            "threshold": 16,
        },
    )
    # 400 (invalid path) or 503 (engine deps missing in ambiente mínimo)
    assert res.status_code in (400, 503)

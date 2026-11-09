"""Testes do motor de comparação visual de PDFs."""
from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from services import pdf_version_compare_service as svc


def _write_pdf(path: Path, *, text: str, color: tuple[float, float, float] = (0, 0, 0)) -> None:
    doc = fitz.open()
    page = doc.new_page(width=200, height=200)
    page.insert_text((40, 100), text, fontsize=28, color=color)
    doc.save(path)
    doc.close()


@pytest.fixture()
def compare_tmp(tmp_path, monkeypatch):
    root = tmp_path / "Compare"
    root.mkdir()
    # compare_pdfs resolve compare_root no módulo do motor, não no reexport.
    import pdf_compare_engine as engine

    monkeypatch.setattr(engine, "compare_root", lambda: root)
    monkeypatch.setattr(svc, "compare_root", lambda: root)
    return root


def test_identical_pdfs_have_no_changes(compare_tmp, tmp_path):
    a = tmp_path / "a.pdf"
    _write_pdf(a, text="SAGRA")

    result = svc.compare_pdfs(
        str(a),
        str(a),
        previous_relative="a.pdf",
        current_relative="a.pdf",
        options=svc.PdfCompareOptions(dpi=150, threshold=16),
    )
    assert result.changed_pages == 0
    assert result.compared_pages == 1
    assert result.pages[0].status == "compared"
    assert result.pages[0].changed_percent <= 0.01
    assert Path(result.pages[0].image_diff).is_file()


def test_different_pdfs_detect_changes(compare_tmp, tmp_path):
    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    _write_pdf(a, text="AAAA")
    _write_pdf(b, text="BBBB", color=(1, 0, 0))

    result = svc.compare_pdfs(
        str(a),
        str(b),
        options=svc.PdfCompareOptions(dpi=150, threshold=8),
    )
    assert result.changed_pages == 1
    assert result.pages[0].changed_percent > 0.01
    assert len(result.pages[0].boxes) >= 1


def test_only_previous_page(compare_tmp, tmp_path):
    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    doc = fitz.open()
    doc.new_page(width=120, height=120)
    doc.new_page(width=120, height=120)
    doc.save(a)
    doc.close()
    doc = fitz.open()
    doc.new_page(width=120, height=120)
    doc.save(b)
    doc.close()

    result = svc.compare_pdfs(
        str(a),
        str(b),
        options=svc.PdfCompareOptions(dpi=150, threshold=16),
    )
    assert result.compared_pages == 2
    assert result.pages[1].status == "only-previous"
    assert result.pages[1].changed_percent == 100.0


def test_path_traversal_asset_rejected(compare_tmp):
    job = svc.SessionJob(
        session_id="abc",
        ano=2026,
        os_id=1,
        session_dir=compare_tmp / "abc",
    )
    job.session_dir.mkdir(parents=True)
    (job.session_dir / "page-001-diff.jpg").write_bytes(b"jpeg")
    with pytest.raises(ValueError):
        svc.resolve_asset_path(job, "../secret.jpg")
    path = svc.resolve_asset_path(job, "page-001-diff.jpg")
    assert path.name == "page-001-diff.jpg"


def test_preserves_real_page_sizes(compare_tmp, tmp_path):
    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    doc = fitz.open()
    doc.new_page(width=200, height=100)
    doc.save(a)
    doc.close()
    doc = fitz.open()
    doc.new_page(width=120, height=180)
    doc.save(b)
    doc.close()

    result = svc.compare_pdfs(
        str(a),
        str(b),
        options=svc.PdfCompareOptions(dpi=150, threshold=16),
    )
    page = result.pages[0]
    # Em 150 DPI: px = mm_pt * (dpi/72); page size is in points.
    assert page.width_a > page.width_b
    assert page.height_a < page.height_b
    assert page.width == max(page.width_a, page.width_b)
    assert page.height == max(page.height_a, page.height_b)
    from PIL import Image

    with Image.open(page.image_a) as img_a:
        assert img_a.size == (page.width_a, page.height_a)
    with Image.open(page.image_b) as img_b:
        assert img_b.size == (page.width_b, page.height_b)


def test_report_pdf_builds(compare_tmp, tmp_path):
    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    _write_pdf(a, text="X")
    _write_pdf(b, text="Y")
    result = svc.compare_pdfs(
        str(a),
        str(b),
        options=svc.PdfCompareOptions(dpi=150, threshold=8),
    )
    dest = Path(result.session_dir) / "report.pdf"
    out = svc.build_report_pdf(result, dest, include_unchanged=True)
    assert out.is_file()
    assert out.stat().st_size > 100


def test_start_compare_rejects_when_busy(compare_tmp, tmp_path, monkeypatch):
    import threading
    import time

    import pdf_compare_engine as engine

    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    _write_pdf(a, text="A")
    _write_pdf(b, text="B")

    release = threading.Event()
    original_compare = engine.compare_pdfs

    def slow_compare(*args, **kwargs):
        release.wait(timeout=5)
        return original_compare(*args, **kwargs)

    monkeypatch.setattr(engine, "compare_pdfs", slow_compare)
    monkeypatch.setattr(svc, "compare_pdfs", slow_compare)

    options = svc.PdfCompareOptions(dpi=150, threshold=16)
    job1 = svc.start_compare_job(
        ano=2026,
        os_id=1,
        previous_pdf=str(a),
        current_pdf=str(b),
        previous_relative="a.pdf",
        current_relative="b.pdf",
        options=options,
        max_active_jobs=1,
    )
    with pytest.raises(svc.CompareBusyError):
        svc.start_compare_job(
            ano=2026,
            os_id=2,
            previous_pdf=str(a),
            current_pdf=str(b),
            previous_relative="a.pdf",
            current_relative="b.pdf",
            options=options,
            max_active_jobs=1,
        )
    release.set()
    deadline = time.time() + 10
    while not job1.done and time.time() < deadline:
        time.sleep(0.05)
    assert job1.done
    assert svc.count_active_jobs() == 0

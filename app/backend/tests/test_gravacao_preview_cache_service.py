"""Testes do cache de preview TIF."""

import os
import tempfile
import time
from unittest.mock import patch

import pytest
from PIL import Image

from services.gravacao_externa_service import get_or_build_preview_png
from services.gravacao_preview_cache_service import (
    build_source_fingerprint,
    cache_path_for_digest,
    collect_arquivos_for_active_gravacao_previews,
    enqueue_preview_warmup_for_active_sessions,
    get_or_build_cached_preview,
    is_cache_valid,
    read_preview_cache,
    warm_previews_for_arquivos,
    write_preview_cache,
)


@pytest.fixture
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SAGRA_GRAVACAO_PREVIEW_DIR", str(tmp_path))
    return tmp_path


def _write_tif(path: str, *, ink: int = 0) -> None:
    Image.new("1", (8, 8), ink).save(path, format="TIFF")


def test_write_and_read_preview_cache(cache_dir):
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        _write_tif(tmp.name)
        source = tmp.name
        nome = "placa (M).tif"

    try:
        cache_path = write_preview_cache(source, nome)
        assert cache_path is not None
        assert cache_path.is_file()

        cached = read_preview_cache(source, nome)
        assert cached is not None
        assert cached[:8] == b"\x89PNG\r\n\x1a\n"
    finally:
        os.unlink(source)


def test_cache_hit_skips_render(cache_dir):
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        _write_tif(tmp.name)
        source = tmp.name
        nome = "placa (C).tif"

    try:
        write_preview_cache(source, nome)
        with patch(
            "services.gravacao_externa_service.render_tif_preview_png",
        ) as render_mock:
            png = get_or_build_cached_preview(source, nome)
            render_mock.assert_not_called()
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
    finally:
        os.unlink(source)


def test_cache_invalidated_when_source_mtime_changes(cache_dir):
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        _write_tif(tmp.name)
        source = tmp.name
        nome = "placa.tif"

    try:
        write_preview_cache(source, nome)
        digest = build_source_fingerprint(source, nome)
        assert digest is not None
        cache_path = cache_path_for_digest(digest)
        assert is_cache_valid(cache_path, source)

        time.sleep(0.05)
        os.utime(source, None)
        assert not is_cache_valid(cache_path, source)
    finally:
        os.unlink(source)


def test_get_or_build_preview_png_uses_cache(cache_dir):
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        _write_tif(tmp.name)
        source = tmp.name
        nome = "test.tif"

    try:
        first = get_or_build_preview_png(source, filename=nome)
        with patch(
            "services.gravacao_externa_service.render_tif_preview_png",
        ) as render_mock:
            second = get_or_build_preview_png(source, filename=nome)
            render_mock.assert_not_called()
        assert first == second
    finally:
        os.unlink(source)


def test_warm_previews_skips_pdf(cache_dir):
    with patch(
        "services.gravacao_preview_cache_service.write_preview_cache",
    ) as write_mock:
        warm_previews_for_arquivos(
            [
                {"absolute_path": r"\\server\a.pdf", "nome": "prova.pdf"},
                {"absolute_path": r"\\server\b.tif", "nome": "placa.tif"},
            ]
        )
        write_mock.assert_called_once()
        assert write_mock.call_args[0][1] == "placa.tif"


def test_collect_arquivos_dedupes_and_skips_failed_os():
    pendente_session = {"id": 1}
    externa_session = {"id": 2}
    shared_path = r"\\server\shared.tif"

    with (
        patch(
            "services.gravacao_pendente_service.list_os_gravacao_pendente",
            return_value=(
                [
                    {"ano": 2026, "nr_os": 100},
                    {"ano": 2026, "nr_os": 101},
                ],
                2,
            ),
        ),
        patch(
            "services.gravacao_pendente_service.get_active_pendente_session",
            side_effect=lambda ano, os_id: pendente_session if os_id == 100 else (_ for _ in ()).throw(
                RuntimeError("sessao falhou")
            ),
        ),
        patch(
            "services.gravacao_pendente_service.build_pendente_detail",
            return_value={
                "arquivos": [
                    {"absolute_path": shared_path, "nome": "a.tif"},
                    {"absolute_path": r"\\server\other.pdf", "nome": "x.pdf"},
                ]
            },
        ),
        patch(
            "services.gravacao_externa_service.list_os_gravacao_externa",
            return_value=([{"ano": 2026, "nr_os": 200}], 1),
        ),
        patch(
            "services.gravacao_externa_service.get_active_session",
            return_value=externa_session,
        ),
        patch(
            "services.gravacao_externa_service.build_session_detail",
            return_value={
                "arquivos": [
                    {"absolute_path": shared_path, "nome": "dup.tif"},
                    {"absolute_path": r"\\server\b.tiff", "nome": "b.tiff"},
                ]
            },
        ),
    ):
        arquivos = collect_arquivos_for_active_gravacao_previews()

    paths = {a["absolute_path"] for a in arquivos}
    assert paths == {shared_path, r"\\server\b.tiff"}
    assert len(arquivos) == 2


def test_enqueue_preview_warmup_for_active_sessions_calls_enqueue():
    collected = [{"absolute_path": r"\\server\a.tif", "nome": "a.tif"}]
    thread_targets = []

    class FakeThread:
        def __init__(self, target=None, name=None, daemon=None):
            self.target = target
            thread_targets.append(target)

        def start(self):
            if self.target:
                self.target()

    with (
        patch(
            "services.gravacao_preview_cache_service.collect_arquivos_for_active_gravacao_previews",
            return_value=collected,
        ),
        patch(
            "services.gravacao_preview_cache_service.enqueue_preview_warmup",
        ) as enqueue_mock,
        patch(
            "services.gravacao_preview_cache_service.threading.Thread",
            FakeThread,
        ),
    ):
        enqueue_preview_warmup_for_active_sessions()

    enqueue_mock.assert_called_once_with(collected)
    assert len(thread_targets) == 1

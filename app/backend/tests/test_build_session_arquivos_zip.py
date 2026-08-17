"""Testes do empacotamento ZIP de Gravação Externa."""

from __future__ import annotations

import os
import tempfile
import zipfile
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services.gravacao_externa_service import build_session_arquivos_zip


def test_build_session_arquivos_zip_stored_on_disk():
    with tempfile.TemporaryDirectory() as tmpdir:
        file_a = os.path.join(tmpdir, "a.tif")
        file_b = os.path.join(tmpdir, "b.tif")
        with open(file_a, "wb") as fh:
            fh.write(b"TIFF-A")
        with open(file_b, "wb") as fh:
            fh.write(b"TIFF-B")

        arquivos = [
            {"id": 1, "nome": "a.tif", "relative": "a.tif"},
            {"id": 2, "nome": "b.tif", "relative": "b.tif"},
        ]
        session = {"id": 9, "os_ano": 2024, "os_nro": 77}

        with patch(
            "services.gravacao_externa_service._fetch_arquivos",
            return_value=arquivos,
        ), patch(
            "services.gravacao_externa_service.resolve_arquivo_absolute_path",
            side_effect=lambda _session, arquivo: (
                file_a if arquivo["nome"] == "a.tif" else file_b
            ),
        ):
            zip_path, filename = build_session_arquivos_zip(session)

        try:
            assert filename == "gravacao_externa_OS_00077_2024.zip"
            assert os.path.isfile(zip_path)
            with zipfile.ZipFile(zip_path, "r") as archive:
                assert archive.namelist() == ["a.tif", "b.tif"]
                assert archive.read("a.tif") == b"TIFF-A"
                info = archive.getinfo("a.tif")
                assert info.compress_type == zipfile.ZIP_STORED
        finally:
            os.unlink(zip_path)


def test_build_session_arquivos_zip_empty_raises():
    session = {"id": 1, "os_ano": 2024, "os_nro": 1}
    with patch(
        "services.gravacao_externa_service._fetch_arquivos",
        return_value=[],
    ):
        with pytest.raises(HTTPException) as exc:
            build_session_arquivos_zip(session)
    assert exc.value.status_code == 404


def test_write_session_arquivos_zip_abort_raises():
    from services.gravacao_externa_service import ZipBuildCancelled, write_session_arquivos_zip

    with tempfile.TemporaryDirectory() as tmpdir:
        file_a = os.path.join(tmpdir, "a.tif")
        with open(file_a, "wb") as fh:
            fh.write(b"TIFF-A")
        dest = os.path.join(tmpdir, "out.zip")
        session = {"id": 9, "os_ano": 2024, "os_nro": 77}
        arquivos = [
            {"id": 1, "nome": "a.tif", "relative": "a.tif"},
            {"id": 2, "nome": "b.tif", "relative": "b.tif"},
        ]
        with patch(
            "services.gravacao_externa_service._fetch_arquivos",
            return_value=arquivos,
        ), patch(
            "services.gravacao_externa_service.resolve_arquivo_absolute_path",
            return_value=file_a,
        ):
            with pytest.raises(ZipBuildCancelled):
                write_session_arquivos_zip(
                    session,
                    dest,
                    should_abort=lambda: True,
                )


def test_compute_arquivos_signature_stable():
    from services.gravacao_externa_service import compute_arquivos_signature

    arquivos = [
        {
            "id": 1,
            "relative": "a.tif",
            "absolute_path": None,
            "nome": "a.tif",
            "tamanho_bytes": 10,
            "ordem": 0,
        }
    ]
    assert compute_arquivos_signature(arquivos) == compute_arquivos_signature(arquivos)
    other = [{**arquivos[0], "tamanho_bytes": 11}]
    assert compute_arquivos_signature(arquivos) != compute_arquivos_signature(other)

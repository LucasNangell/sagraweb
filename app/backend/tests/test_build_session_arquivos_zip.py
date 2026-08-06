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

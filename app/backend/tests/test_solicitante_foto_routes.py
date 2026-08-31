"""Rotas de foto do solicitante."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from routers.auxiliar_routes import solicitante_foto, solicitante_foto_status
from schemas.auxiliar import SolicitanteFotoStatusResponse


def test_foto_status_false_when_missing():
    with patch(
        "services.solicitante_foto_service.foto_exists",
        return_value=False,
    ):
        result = solicitante_foto_status("Maria Silva")
    assert result == SolicitanteFotoStatusResponse(exists=False)


def test_foto_status_true_when_cadastrada():
    with patch(
        "services.solicitante_foto_service.foto_exists",
        return_value=True,
    ):
        result = solicitante_foto_status("Maria Silva")
    assert result.exists is True


def test_get_foto_404_when_missing():
    with patch(
        "services.solicitante_foto_service.resolve_foto_path",
        return_value=None,
    ):
        with pytest.raises(HTTPException) as exc:
            solicitante_foto("Maria Silva")
    assert exc.value.status_code == 404


def test_get_foto_file_response(tmp_path: Path):
    dest = tmp_path / "abc.jpg"
    dest.write_bytes(b"\xff\xd8\xff\x00")
    with patch(
        "services.solicitante_foto_service.resolve_foto_path",
        return_value=dest,
    ):
        response = solicitante_foto("Maria Silva")
    assert response.path == dest
    assert response.media_type == "image/jpeg"

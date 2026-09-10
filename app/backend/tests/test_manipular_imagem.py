"""Testes Manipular Imagem — remoção de máscara 0 e gate de permissão."""

from io import BytesIO
from unittest.mock import MagicMock

import numpy as np
import pytest
from fastapi import HTTPException
from PIL import Image

from routers import manipular_imagem_routes as routes
from services import manipular_imagem_service as svc


def _png_bytes_with_alpha_mask() -> bytes:
    """PNG 4x4: metade esquerda opaca, direita transparente (máscara alpha)."""
    arr = np.zeros((4, 4, 4), dtype=np.uint8)
    arr[:, :, :3] = 40
    arr[:, :2, 3] = 255
    arr[:, 2:, 3] = 0
    buf = BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, "PNG")
    return buf.getvalue()


def _png_bytes_no_mask() -> bytes:
    """PNG colorido sem alpha parcial, sem grayscale e sem cor dominante."""
    arr = np.zeros((8, 8, 4), dtype=np.uint8)
    arr[:, :, 3] = 255
    # Tabuleiro de cores distintas para evitar chroma_key / grayscale
    colors = [
        (255, 0, 0),
        (0, 255, 0),
        (0, 0, 255),
        (255, 255, 0),
        (255, 0, 255),
        (0, 255, 255),
        (128, 64, 0),
        (0, 128, 64),
    ]
    for y in range(8):
        for x in range(8):
            arr[y, x, :3] = colors[(y * 8 + x) % len(colors)]
    buf = BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, "PNG")
    return buf.getvalue()


def test_require_access_denied():
    request = MagicMock()
    request.state.sagra_permissions = {}
    with pytest.raises(HTTPException) as exc:
        routes._require_access(request)
    assert exc.value.status_code == 403


def test_require_access_ok():
    request = MagicMock()
    request.state.sagra_permissions = {"sb_manipular_imagem": True}
    routes._require_access(request)


def test_remover_mascara_0_png_alpha():
    content = _png_bytes_with_alpha_mask()
    png_out, name = svc.remover_mascara_0(content, "teste.png")
    assert name == "teste_sem_mascara_0.png"
    assert png_out[:8] == b"\x89PNG\r\n\x1a\n"

    result = np.array(Image.open(BytesIO(png_out)).convert("RGBA"))
    # Máscara 0 = alpha_binaria (pixels com alpha>127). Remoção zera alpha nesses pixels.
    assert np.all(result[:, :2, 3] == 0)


def test_remover_mascara_0_sem_mascara():
    content = _png_bytes_no_mask()
    with pytest.raises(ValueError, match="Nenhuma máscara"):
        svc.remover_mascara_0(content, "colorido.png")


def test_formato_nao_suportado():
    with pytest.raises(ValueError, match="Formato não suportado"):
        svc.remover_mascara_0(b"not-an-image", "arquivo.gif")

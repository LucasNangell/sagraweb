"""Testes Manipular Imagem — remoção parametrizada e gate de permissão."""

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


def test_analisar_mascaras():
    svc.clear_jobs_for_tests()
    content = _png_bytes_with_alpha_mask()
    info = svc.analisar_mascaras(content, "teste.png")
    assert info["filename"] == "teste.png"
    assert info["job_id"]
    assert len(info["mascaras"]) >= 1
    assert info["mascaras"][0]["indice"] == 0
    assert "cobertura" in info["mascaras"][0]


def test_aplicar_mascara_job_reusa_cache():
    svc.clear_jobs_for_tests()
    content = _png_bytes_with_alpha_mask()
    info = svc.analisar_mascaras(content, "teste.png")
    png_out, name = svc.aplicar_mascara_job(
        info["job_id"],
        mascara_idx=0,
        intensidade=100,
        limiar=50,
        preview=False,
    )
    assert name == "teste_sem_mascara_0.png"
    result = np.array(Image.open(BytesIO(png_out)).convert("RGBA"))
    assert np.all(result[:, :2, 3] == 0)


def test_preview_pode_reduzir_dimensao():
    svc.clear_jobs_for_tests()
    # Imagem grande o suficiente para forçar downscale no preview
    arr = np.zeros((1600, 1600, 4), dtype=np.uint8)
    arr[:, :, :3] = 40
    arr[:, :800, 3] = 255
    arr[:, 800:, 3] = 0
    buf = BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, "PNG")
    content = buf.getvalue()

    info = svc.analisar_mascaras(content, "grande.png")
    png_preview, _ = svc.aplicar_mascara_job(
        info["job_id"],
        mascara_idx=0,
        intensidade=100,
        limiar=50,
        preview=True,
    )
    png_full, _ = svc.aplicar_mascara_job(
        info["job_id"],
        mascara_idx=0,
        intensidade=100,
        limiar=50,
        preview=False,
    )
    prev = Image.open(BytesIO(png_preview))
    full = Image.open(BytesIO(png_full))
    assert max(prev.size) <= svc.PREVIEW_MAX_EDGE
    assert full.size == (1600, 1600)


def test_remover_mascara_0_png_alpha():
    content = _png_bytes_with_alpha_mask()
    png_out, name = svc.remover_mascara_0(content, "teste.png")
    assert name == "teste_sem_mascara_0.png"
    assert png_out[:8] == b"\x89PNG\r\n\x1a\n"

    result = np.array(Image.open(BytesIO(png_out)).convert("RGBA"))
    assert np.all(result[:, :2, 3] == 0)


def test_intensidade_parcial():
    content = _png_bytes_with_alpha_mask()
    png_out, _ = svc.aplicar_mascara(
        content,
        "teste.png",
        mascara_idx=0,
        intensidade=50,
        limiar=50,
    )
    result = np.array(Image.open(BytesIO(png_out)).convert("RGBA"))
    # Metade opaca (255) com 50% → ~127; transparente permanece 0
    assert np.all(result[:, :2, 3] == 128) or np.all(
        np.abs(result[:, :2, 3].astype(np.int16) - 127) <= 1
    )
    assert np.all(result[:, 2:, 3] == 0)


def test_limiar_conservador_remove_menos():
    content = _png_bytes_with_alpha_mask()
    # limiar 0 → threshold 255 → alpha > 255 nunca → sem remoção
    png_out, _ = svc.aplicar_mascara(
        content,
        "teste.png",
        mascara_idx=0,
        intensidade=100,
        limiar=0,
    )
    result = np.array(Image.open(BytesIO(png_out)).convert("RGBA"))
    assert np.all(result[:, :2, 3] == 255)


def test_remover_mascara_0_sem_mascara():
    content = _png_bytes_no_mask()
    with pytest.raises(ValueError, match="Nenhuma máscara"):
        svc.remover_mascara_0(content, "colorido.png")


def test_formato_nao_suportado():
    with pytest.raises(ValueError, match="Formato não suportado"):
        svc.remover_mascara_0(b"not-an-image", "arquivo.gif")

"""Cadastro de foto do solicitante — persistência e validação."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from services.os_filter_options_service import normalize_label
from services.solicitante_foto_service import (
    MAX_BYTES,
    foto_exists,
    resolve_foto_path,
    save_foto,
)


def _jpeg_bytes(size: tuple[int, int] = (4, 4), color: tuple[int, int, int] = (12, 34, 56)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _png_bytes() -> bytes:
    img = Image.new("RGBA", (3, 3), (255, 0, 0, 128))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _patch_store(monkeypatch, tmp_path: Path):
    store: dict[str, dict] = {}

    def fake_exec(sql, params=None):
        sql_l = " ".join(sql.split()).lower()
        if sql_l.strip().startswith("select"):
            norm = params[0] if params else ""
            row = store.get(norm)
            return [row] if row else []
        if "insert into tab_solicitante_foto" in sql_l:
            display, norm, path = params
            store[norm] = {
                "solicitante": display,
                "solicitante_normalizado": norm,
                "image_path": path,
                "content_type": "image/jpeg",
            }
            return []
        return []

    monkeypatch.setattr(
        "services.solicitante_foto_service.db.execute_query",
        fake_exec,
    )
    monkeypatch.setattr(
        "services.solicitante_foto_service.solicitante_fotos_dir",
        lambda: tmp_path,
    )
    return store


def test_save_and_get_foto(tmp_path, monkeypatch):
    _patch_store(monkeypatch, tmp_path)
    save_foto("Maria Silva", _jpeg_bytes())
    path = resolve_foto_path("Maria Silva")
    assert path is not None
    assert path.is_file()
    assert path.suffix == ".jpg"
    assert foto_exists("Maria Silva") is True


def test_equivalent_names_share_foto(tmp_path, monkeypatch):
    _patch_store(monkeypatch, tmp_path)
    save_foto("José Silva", _jpeg_bytes())
    assert normalize_label("José Silva") == normalize_label("JOSE SILVA")
    assert foto_exists("JOSE SILVA") is True
    assert resolve_foto_path("jose silva") is not None


def test_png_is_converted_to_jpeg(tmp_path, monkeypatch):
    _patch_store(monkeypatch, tmp_path)
    save_foto("Ana Souza", _png_bytes())
    path = resolve_foto_path("Ana Souza")
    assert path is not None
    with Image.open(path) as img:
        assert img.format == "JPEG"


def test_missing_foto_returns_false(tmp_path, monkeypatch):
    _patch_store(monkeypatch, tmp_path)
    assert foto_exists("Ninguém") is False
    assert resolve_foto_path("Ninguém") is None


def test_reject_empty_file(tmp_path, monkeypatch):
    _patch_store(monkeypatch, tmp_path)
    with pytest.raises(ValueError, match="vazio"):
        save_foto("Maria Silva", b"")


def test_reject_short_name(tmp_path, monkeypatch):
    _patch_store(monkeypatch, tmp_path)
    with pytest.raises(ValueError, match="mínimo 3"):
        save_foto("Ab", _jpeg_bytes())


def test_reject_non_image(tmp_path, monkeypatch):
    _patch_store(monkeypatch, tmp_path)
    with pytest.raises(ValueError, match="não é uma imagem"):
        save_foto("Maria Silva", b"not-an-image")


def test_reject_oversized(tmp_path, monkeypatch):
    _patch_store(monkeypatch, tmp_path)
    huge = b"\xff\xd8\xff" + b"\x00" * MAX_BYTES
    with pytest.raises(ValueError, match="muito grande"):
        save_foto("Maria Silva", huge)


def test_db_row_without_file_is_missing(tmp_path, monkeypatch):
    store = _patch_store(monkeypatch, tmp_path)
    store[normalize_label("Maria Silva")] = {
        "solicitante": "Maria Silva",
        "solicitante_normalizado": normalize_label("Maria Silva"),
        "image_path": str(tmp_path / "missing.jpg"),
        "content_type": "image/jpeg",
    }
    assert foto_exists("Maria Silva") is False

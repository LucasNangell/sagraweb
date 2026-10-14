"""Trecho do solicitante no nome da pasta da OS (SiglaOrgao para categoria Orgao)."""
from __future__ import annotations

import pytest

from services.os_arquivos_service import _fetch_os_meta, _folder_solicitante
from services.os_folder_structure import compute_os_folder_name


@pytest.mark.parametrize(
    ("categoria", "sigla", "solicitante", "esperado"),
    [
        ("Orgao", "SECOM", "Fulano", "SECOM"),
        (" orgao ", "SECOM", "Fulano", "SECOM"),
        ("ORGAO", " SECOM ", "Fulano", "SECOM"),
        ("Orgao", None, "Fulano", "Fulano"),
        ("Orgao", "", "Fulano", "Fulano"),
        ("Orgao", "   ", "Fulano", "Fulano"),
        ("Deputado", "SECOM", "Fulano", "Fulano"),
        ("Mesa", "SECOM", "Fulano", "Fulano"),
        (None, "SECOM", "Fulano", "Fulano"),
    ],
)
def test_folder_solicitante_rule(categoria, sigla, solicitante, esperado):
    assert _folder_solicitante(categoria, sigla, solicitante) == esperado


def _mock_row(monkeypatch, row):
    monkeypatch.setattr(
        "services.os_arquivos_service.db.execute_query",
        lambda *_a, **_k: [row],
    )


def test_fetch_os_meta_orgao_usa_sigla(monkeypatch):
    _mock_row(
        monkeypatch,
        {
            "solicitante": "Fulano de Tal",
            "categoria": "Orgao",
            "sigla_orgao": "SECOM",
            "titulo": "Titulo",
            "produto": "Cartaz",
        },
    )
    meta = _fetch_os_meta(2026, 123)
    assert meta["folder_solicitante"] == "SECOM"
    assert meta["solicitante"] == "Fulano de Tal"


def test_fetch_os_meta_orgao_sigla_null_mantem_nome(monkeypatch):
    _mock_row(
        monkeypatch,
        {
            "solicitante": "Fulano de Tal",
            "categoria": "Orgao",
            "sigla_orgao": None,
            "titulo": "Titulo",
            "produto": "Cartaz",
        },
    )
    meta = _fetch_os_meta(2026, 123)
    assert meta["folder_solicitante"] == "Fulano de Tal"


def test_fetch_os_meta_orgao_sigla_null_sem_nome_usa_cliente(monkeypatch):
    _mock_row(
        monkeypatch,
        {
            "solicitante": None,
            "categoria": "Orgao",
            "sigla_orgao": None,
            "titulo": None,
            "produto": None,
        },
    )
    meta = _fetch_os_meta(2026, 123)
    assert meta["folder_solicitante"] == "Cliente"
    assert meta["solicitante"] == "Cliente"


def test_fetch_os_meta_outra_categoria_ignora_sigla(monkeypatch):
    _mock_row(
        monkeypatch,
        {
            "solicitante": "Dep Fulano",
            "categoria": "Deputado",
            "sigla_orgao": "PT",
            "titulo": "Titulo",
            "produto": "Cartaz",
        },
    )
    meta = _fetch_os_meta(2026, 123)
    assert meta["folder_solicitante"] == "Dep Fulano"


def test_compute_os_folder_name_com_sigla():
    assert compute_os_folder_name(123, "SECOM", "Cartão de Visita") == "00123-Secom-Cartaodevisita"

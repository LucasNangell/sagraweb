"""Campos numéricos vazios/irregulares não podem quebrar a ficha da OS."""
from __future__ import annotations

import re
from decimal import Decimal
from unittest.mock import patch

import pytest

from routers.requisicao_routes import _format_milhar, generate_requisicao

DETALHES_FIELDS = (
    "ModelosArq",
    "Tiragem",
    "TipoPublicacaoLink",
    "MaquinaLink",
    "Pags",
    "FrenteVerso",
    "Titulo",
    "FormatoLink",
    "Cores",
    "CoresDescricao",
    "PapelLink",
    "PapelDescricao",
    "DescAcabamento",
    "Observ",
    "InsumosFornecidos",
    "MaterialFornecido",
)


def _os_row(**overrides):
    row = {
        "DataEntrada": None,
        "ReqEntregue": 0,
        "ReqLançada": 0,
        "ProcessoSolicit": "",
        "CSnro": "",
        "CotaRepro": 0,
        "CotaCartao": "",
        "DebitarCGRAF": 0,
        "NroProtocolo": 123,
        "AnoProtocolo": 2026,
        "GabSalaUsuario": "",
        "ModelosArq": 1,
        "Tiragem": 100,
        "CategoriaLink": "",
        "CodUsuarioLink": "",
        "NomeUsuario": "",
        "SiglaOrgao": "",
        "RamalUsuario": "",
        "OrgInteressado": "",
        "ContatoTrab": "",
        "TipoPublicacaoLink": "",
        "MaquinaLink": "",
        "Pags": 1,
        "FrenteVerso": 0,
        "Titulo": "Cartaz institucional",
        "FormatoLink": "",
        "Cores": "",
        "CoresDescricao": "",
        "PapelLink": "",
        "PapelDescricao": "",
        "DescAcabamento": "",
        "Observ": "",
        "InsumosFornecidos": "",
        "MaterialFornecido": "",
        "ResponsavelGrafLink": "",
        "EntregPrazoLink": "",
        "EntregaFormaLink": "",
        "EntregData": None,
        "EntregPeriodo": "",
    }
    row.update(overrides)
    return row


def _render(row, ano=2026, nro=123, mode=None):
    with patch("routers.requisicao_routes.db.execute_query", return_value=[row]):
        return generate_requisicao(
            ano, nro, mode=mode, prova_capa=None, prova_miolo=None
        )


def _box_after_label(html: str, label: str) -> str:
    pattern = (
        rf'<span class="label">{re.escape(label)}</span>\s*'
        r'<div class="value-box-menor"[^>]*>(.*?)</div>'
    )
    match = re.search(pattern, html, re.DOTALL)
    assert match, f"campo {label} não encontrado"
    return re.sub(r"\s+", "", match.group(1))


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, ""),
        ("", ""),
        ("   ", ""),
        (0, "0"),
        (1500, "1.500"),
        (1500.4, "1.500"),
        (Decimal("1500.4"), "1.500"),
        ("1500", "1.500"),
        (" 1500 ", "1.500"),
        ("1.000", "1.000"),
        ("1.234.567", "1.234.567"),
        ("1500,4", "1.500"),
        ("12.5", "12"),
        ("abc", "abc"),
        (float("nan"), "nan"),
    ],
)
def test_format_milhar(raw, expected):
    assert _format_milhar(raw) == expected


@pytest.mark.parametrize("field", ["Tiragem", "CotaRepro"])
@pytest.mark.parametrize("raw", [None, "", "  "])
def test_ficha_nao_quebra_com_numero_vazio(field, raw):
    response = _render(_os_row(**{field: raw}))

    assert response.status_code == 200
    assert "Erro Interno" not in response.body.decode("utf-8")


@pytest.mark.parametrize("field", ["Tiragem", "CotaRepro"])
@pytest.mark.parametrize("raw", ["1.500", "1500", Decimal("1500.4"), 1500])
def test_ficha_formata_milhar(field, raw):
    response = _render(_os_row(**{field: raw}))

    assert response.status_code == 200
    assert "1.500" in response.body.decode("utf-8")


def test_ficha_os_sem_detalhes_servico():
    row = _os_row(CotaRepro=None, **{f: None for f in DETALHES_FIELDS})
    response = _render(row)

    assert response.status_code == 200
    assert "Erro Interno" not in response.body.decode("utf-8")


def test_numero_pedido_os():
    html = _render(_os_row(NroProtocolo=123), nro=123).body.decode("utf-8")
    assert "OS 00123/26" in html


def test_numero_pedido_sp():
    html = _render(_os_row(NroProtocolo=5123), nro=5123).body.decode("utf-8")
    assert "SP 05123/26" in html


@pytest.mark.parametrize("mode", ["prova", "prova_ficha"])
def test_ficha_prova_forca_tiragem_e_cota_repro_1(mode):
    html = _render(
        _os_row(CotaRepro=1500, Tiragem=100),
        mode=mode,
    ).body.decode("utf-8")

    assert _box_after_label(html, "Cota Repro") == "1"
    assert _box_after_label(html, "Tiragem") == "1"


def test_ficha_normal_mantem_tiragem_e_cota_repro():
    html = _render(_os_row(CotaRepro=1500, Tiragem=100)).body.decode("utf-8")

    assert _box_after_label(html, "Cota Repro") == "1.500"
    assert _box_after_label(html, "Tiragem") == "100"

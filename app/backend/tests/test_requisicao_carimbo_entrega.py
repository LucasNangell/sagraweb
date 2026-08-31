"""Carimbo de entrega na ficha da OS (Câmara nas Redes)."""
from __future__ import annotations

import base64
import os
import tempfile
from unittest.mock import patch

import pytest
from jinja2 import Template

from routers.requisicao_routes import (
    _ficha_tem_prioridade,
    _resolve_carimbo_data_uri,
    _resolve_template_path,
    _titulo_indica_camara_nas_redes,
    generate_requisicao,
)


@pytest.mark.parametrize(
    "titulo",
    [
        "Camara nas Redes",
        "Câmara nas Redes",
        "Informativo Câmara nas Redes 2026",
        "CAMARA NAS REDES",
        "câmara nas redes",
    ],
)
def test_titulo_indica_camara_nas_redes(titulo):
    assert _titulo_indica_camara_nas_redes(titulo) is True


@pytest.mark.parametrize(
    "titulo",
    [
        "",
        None,
        "Cartaz institucional",
        "Camara",
        "nas Redes",
    ],
)
def test_titulo_nao_indica_camara_nas_redes(titulo):
    assert _titulo_indica_camara_nas_redes(titulo) is False


def test_resolve_carimbo_data_uri_presente():
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"fake"
    with tempfile.TemporaryDirectory() as tmp:
        with open(os.path.join(tmp, "entrega.png"), "wb") as handle:
            handle.write(png_bytes)
        uri = _resolve_carimbo_data_uri(os.path.join(tmp, "requisicao.html"), "entrega.png")
        expected = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
        assert uri == expected


def test_resolve_carimbo_data_uri_ausente():
    with tempfile.TemporaryDirectory() as tmp:
        assert _resolve_carimbo_data_uri(os.path.join(tmp, "requisicao.html"), "entrega.png") == ""


def test_template_overlay_entrega_oculta_conteudo_sem_remover_secoes():
    template_path = _resolve_template_path()
    with open(template_path, encoding="utf-8") as handle:
        html = Template(handle.read()).render(
            show_carimbo_entrega=True,
            carimbo_entrega_src="data:image/png;base64,abc",
            insumos="papel",
            material_entregue="kit",
        )

    assert 'class="overlay-carimbo-entrega"' in html
    assert 'class="value-box ficha-carimbo-entrega-box"' in html
    assert 'class="section-header ficha-carimbo-entrega-spacer"' in html
    assert "Insumos Fornecidos" in html
    assert "Material Entregue" in html


def test_template_sem_carimbo_entrega_mostra_insumos():
    template_path = _resolve_template_path()
    with open(template_path, encoding="utf-8") as handle:
        html = Template(handle.read()).render(
            show_carimbo_entrega=False,
            insumos="papel",
            material_entregue="kit",
        )

    assert 'class="overlay-carimbo-entrega"' not in html
    assert 'class="value-box ficha-carimbo-entrega-box"' not in html
    assert 'class="section-header ficha-carimbo-entrega-spacer"' not in html
    assert "Insumos Fornecidos" in html
    assert "Material Entregue" in html


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
        "InsumosFornecidos": "insumo",
        "MaterialFornecido": "material",
        "ResponsavelGrafLink": "",
        "EntregPrazoLink": "",
        "EntregaFormaLink": "",
        "EntregData": None,
        "EntregPeriodo": "",
    }
    row.update(overrides)
    return row


def test_rota_liga_carimbo_quando_titulo_camara_nas_redes():
    with patch(
        "routers.requisicao_routes.db.execute_query",
        return_value=[_os_row(Titulo="Câmara nas Redes")],
    ):
        response = generate_requisicao(2026, 123)

    html = response.body.decode("utf-8")
    assert response.status_code == 200
    assert 'class="overlay-carimbo-entrega"' in html
    assert 'class="value-box ficha-carimbo-entrega-box"' in html
    assert "data:image/png;base64," in html
    assert "Insumos Fornecidos" in html
    assert "Material Entregue" in html


def test_rota_nao_liga_carimbo_quando_titulo_comum():
    with patch(
        "routers.requisicao_routes.db.execute_query",
        return_value=[_os_row(Titulo="Cartaz institucional")],
    ):
        response = generate_requisicao(2026, 123)

    html = response.body.decode("utf-8")
    assert response.status_code == 200
    assert 'class="overlay-carimbo-entrega"' not in html
    assert 'class="value-box ficha-carimbo-entrega-box"' not in html
    assert 'class="section-header ficha-carimbo-entrega-spacer"' not in html


@pytest.mark.parametrize(
    "prazo,esperado",
    [
        ("Solicitado p/", True),
        ("Prometido p/", True),
        ("Normal", False),
        ("", False),
        (None, False),
    ],
)
def test_ficha_tem_prioridade(prazo, esperado):
    assert _ficha_tem_prioridade(prazo) is esperado


def test_template_mostra_turno_quando_show_turno():
    template_path = _resolve_template_path()
    with open(template_path, encoding="utf-8") as handle:
        html = Template(handle.read()).render(
            show_turno=True,
            turno="Noite",
            data_entrega="28/08/2026",
            forma_entrega="Avisar Contato",
        )

    assert "ficha-turno" in html
    assert ">Turno<" in html
    assert "Noite" in html


def test_template_omite_turno_quando_show_turno_falso():
    template_path = _resolve_template_path()
    with open(template_path, encoding="utf-8") as handle:
        html = Template(handle.read()).render(
            show_turno=False,
            turno="Noite",
            data_entrega="28/08/2026",
            forma_entrega="Avisar Contato",
        )

    assert "ficha-turno" not in html
    assert ">Turno<" not in html


def test_rota_mostra_turno_quando_prioridade_e_data():
    with patch(
        "routers.requisicao_routes.db.execute_query",
        return_value=[
            _os_row(
                EntregPrazoLink="Solicitado p/",
                EntregData="28/08/2026",
                EntregPeriodo="Noite",
            )
        ],
    ):
        response = generate_requisicao(2026, 123)

    html = response.body.decode("utf-8")
    assert response.status_code == 200
    assert "ficha-turno" in html
    assert ">Turno<" in html
    assert "Noite" in html


def test_rota_omite_turno_quando_prioridade_normal():
    with patch(
        "routers.requisicao_routes.db.execute_query",
        return_value=[
            _os_row(
                EntregPrazoLink="Normal",
                EntregData="28/08/2026",
                EntregPeriodo="Noite",
            )
        ],
    ):
        response = generate_requisicao(2026, 123)

    html = response.body.decode("utf-8")
    assert response.status_code == 200
    assert "ficha-turno" not in html
    assert ">Turno<" not in html


def test_rota_omite_turno_quando_prioridade_sem_data():
    with patch(
        "routers.requisicao_routes.db.execute_query",
        return_value=[
            _os_row(
                EntregPrazoLink="Prometido p/",
                EntregData=None,
                EntregPeriodo="Tarde",
            )
        ],
    ):
        response = generate_requisicao(2026, 123)

    html = response.body.decode("utf-8")
    assert response.status_code == 200
    assert "ficha-turno" not in html
    assert ">Turno<" not in html


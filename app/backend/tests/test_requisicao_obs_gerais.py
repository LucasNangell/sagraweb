"""Testes para o campo Observações Gerais e limites da folha A5 na ficha de OS."""
from __future__ import annotations

import os
import subprocess
import tempfile
from unittest.mock import patch

import pytest
from jinja2 import Template

from routers.requisicao_routes import (
    _normalize_obs_gerais,
    _resolve_template_path,
    generate_requisicao,
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


@pytest.mark.parametrize(
    "raw_input,expected",
    [
        (None, ""),
        ("", ""),
        ("   ", ""),
        ("Linha 1\nLinha 2", "Linha 1\nLinha 2"),
        ("Linha 1\r\nLinha 2", "Linha 1\nLinha 2"),
        ("Linha 1\rLinha 2", "Linha 1\nLinha 2"),
        ("Linha 1\n\nLinha 2", "Linha 1\nLinha 2"),
        ("Linha 1\r\n\r\nLinha 2", "Linha 1\nLinha 2"),
        ("Linha 1\n\n\nLinha 2", "Linha 1\nLinha 2"),
        ("Linha 1\n  \n\t\nLinha 2", "Linha 1\nLinha 2"),
        ("\n\nLinha 1\n\n\nLinha 2\n\n", "Linha 1\nLinha 2"),
        ("A\n\nB\n\nC\n\nD", "A\nB\nC\nD"),
        ("Linha 1\n \nLinha 2\n\n\nLinha 3", "Linha 1\nLinha 2\nLinha 3"),
    ],
)
def test_normalize_obs_gerais(raw_input, expected):
    assert _normalize_obs_gerais(raw_input) == expected


def test_template_contem_max_height_120px():
    template_path = _resolve_template_path()
    with open(template_path, encoding="utf-8") as handle:
        content = handle.read()

    assert "--ficha-obs-gerais-max: 120px;" in content
    assert "'ficha-obs-gerais': 120" in content
    assert "'ficha-obs-gerais': 70" in content


def test_generate_requisicao_normaliza_obs_gerais():
    obs_com_quebras = "Primeira linha\n\n\nSegunda linha\n \nTerceira linha"
    with patch(
        "routers.requisicao_routes.db.execute_query",
        return_value=[_os_row(Titulo="Cartaz institucional", Observ=obs_com_quebras)],
    ):
        response = generate_requisicao(2026, 123)

    assert response.status_code == 200
    html = response.body.decode("utf-8")
    assert "Primeira linha\nSegunda linha\nTerceira linha" in html
    assert "Primeira linha\n\n" not in html


def _find_edge_path() -> str | None:
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


@pytest.mark.parametrize(
    "titulo,obs_lines_count,with_entrega,with_turno",
    [
        ("Cartaz comum", 3, False, False),
        ("Cartaz institucional longo com muitas observacoes", 11, False, False),
        ("Informativo Câmara nas Redes 2026", 11, True, True),
    ],
)
def test_impressao_requisicao_permanece_uma_pagina_a5(
    titulo, obs_lines_count, with_entrega, with_turno
):
    edge_path = _find_edge_path()
    if not edge_path:
        pytest.skip("Microsoft Edge não encontrado para teste headless de PDF")

    try:
        import pypdf
    except ImportError:
        pytest.skip("pypdf não instalado no ambiente")

    obs_text = "\n".join(
        [f"Linha {i}: Detalhe de producao da ordem de servico" for i in range(1, obs_lines_count + 1)]
    )

    row_data = _os_row(
        Titulo=titulo,
        Observ=obs_text,
        DescAcabamento="- Dobrar ao meio\n- Grampear 2 grampos\n- Refilar nas marcas",
        InsumosFornecidos="Papel couche 150g fornecido",
        MaterialFornecido="Prova impressa e assinada",
        EntregPrazoLink="Solicitado p/ 10/09/2026" if with_turno else "Normal",
        EntregData="2026-09-10" if with_turno else None,
        EntregPeriodo="Tarde" if with_turno else "",
    )

    with patch("routers.requisicao_routes.db.execute_query", return_value=[row_data]):
        response = generate_requisicao(2026, 123)

    assert response.status_code == 200
    html_content = response.body.decode("utf-8")

    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(html_content)
        html_file = f.name
    pdf_file = html_file.replace(".html", ".pdf")

    try:
        subprocess.run(
            [edge_path, "--headless", "--disable-gpu", f"--print-to-pdf={pdf_file}", html_file],
            check=True,
            capture_output=True,
        )
        reader = pypdf.PdfReader(pdf_file)
        assert len(reader.pages) == 1, f"Esperado 1 página no A5, gerou {len(reader.pages)}"
    finally:
        for p in (html_file, pdf_file):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass

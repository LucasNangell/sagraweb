"""Testes do coeficiente A4 por produto de papelaria."""
from __future__ import annotations

from unittest.mock import patch

from services.coef_a4_produto_service import (
    calcular_coef_a4_por_produto_papelaria,
    obter_coef_a4_por_produto,
    seed_coef_a4_produto_from_protocolos,
)


def test_calcular_coef_a4_mediana_por_produto():
    rows = [
        {"produto": "Ct Visita", "pags": 1, "tiragem": 1000, "cota": 100},
        {"produto": "Ct Visita", "pags": 1, "tiragem": 1000, "cota": 100},
        {"produto": "Timbrado A4", "pags": 1, "tiragem": 500, "cota": 500},
    ]
    with patch(
        "services.coef_a4_produto_service._fetch_protocolo_coef_rows",
        return_value=rows,
    ):
        result = calcular_coef_a4_por_produto_papelaria()

    assert result["Ct Visita"]["coeficiente"] == 10.0
    assert result["Ct Visita"]["amostras"] == 2
    assert result["Timbrado A4"]["coeficiente"] == 1.0


def test_obter_coef_a4_por_produto():
    with patch("services.coef_a4_produto_service.db") as mock_db:
        mock_db.execute_query.return_value = [{"coeficiente": 2.5}]
        assert obter_coef_a4_por_produto("Timbrado A4") == 2.5
    assert obter_coef_a4_por_produto("") is None


def test_seed_coef_a4_somente_tabela_vazia():
    with patch(
        "services.coef_a4_produto_service.tabela_coef_a4_vazia",
        return_value=False,
    ), patch(
        "services.coef_a4_produto_service.calcular_coef_a4_por_produto_papelaria"
    ) as mock_calc:
        assert seed_coef_a4_produto_from_protocolos() == 0
        mock_calc.assert_not_called()


def test_seed_coef_a4_insere_quando_vazia():
    with patch(
        "services.coef_a4_produto_service.tabela_coef_a4_vazia",
        return_value=True,
    ), patch(
        "services.coef_a4_produto_service.calcular_coef_a4_por_produto_papelaria",
        return_value={
            "Bloco A5": {
                "produto": "Bloco A5",
                "coeficiente": 2.0,
                "amostras": 10,
            }
        },
    ), patch("services.coef_a4_produto_service.db") as mock_db:
        inseridos = seed_coef_a4_produto_from_protocolos()

    assert inseridos == 1
    sql = mock_db.execute_query.call_args[0][0]
    assert "INSERT INTO tabCoefA4Produto" in sql

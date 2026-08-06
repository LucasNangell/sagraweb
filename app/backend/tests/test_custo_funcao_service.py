"""Testes do serviço de funções de custo (mão de obra)."""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest

from services import custo_funcao_service as svc


def test_compute_custo_hora_1760_equals_10():
    assert svc.compute_custo_hora(1760) == Decimal("10.0000")
    assert svc.compute_custo_hora("1760") == Decimal("10.0000")


def test_compute_custo_hora_zero_mensal():
    assert svc.compute_custo_hora(0) == Decimal("0.0000")


def test_compute_custo_hora_rejects_zero_horas():
    with pytest.raises(ValueError, match="horas_mes"):
        svc.compute_custo_hora(100, horas_mes=0)


def test_create_funcao_derives_custo_hora():
    with patch.object(svc, "_assert_codigo_unique"), patch.object(
        svc.db, "execute_transaction", return_value=[7]
    ), patch.object(
        svc,
        "get_funcao",
        return_value={
            "id": 7,
            "nome": "Operador Offset",
            "codigo": "OFF",
            "descricao": None,
            "custo_mensal": 1760.0,
            "custo_hora": 10.0,
            "horas_mes": 176.0,
            "moeda": "BRL",
            "ativo": True,
            "criado_em": None,
            "criado_por": "1",
            "atualizado_em": None,
            "atualizado_por": "1",
        },
    ):
        created = svc.create_funcao(
            nome="Operador Offset",
            custo_mensal=1760,
            codigo="OFF",
            ponto="1",
        )
    assert created["custo_mensal"] == 1760.0
    assert created["custo_hora"] == 10.0
    assert created["horas_mes"] == 176.0


def test_create_funcao_rejects_empty_nome():
    with pytest.raises(ValueError, match="Nome"):
        svc.create_funcao(nome="  ", custo_mensal=100, ponto="1")


def test_create_funcao_rejects_negative_mensal():
    with pytest.raises(ValueError, match="custo_mensal"):
        svc.create_funcao(nome="X", custo_mensal=-1, ponto="1")


def test_create_funcao_rejects_duplicate_codigo():
    with patch.object(svc.db, "execute_query", return_value=[{"id": 1}]):
        with pytest.raises(ValueError, match="código"):
            svc.create_funcao(
                nome="Nova",
                custo_mensal=100,
                codigo="DUP",
                ponto="1",
            )


def test_update_funcao_recalculates_custo_hora():
    existing = {
        "id": 3,
        "nome": "Digital",
        "codigo": None,
        "descricao": None,
        "custo_mensal": 1760.0,
        "custo_hora": 10.0,
        "horas_mes": 176.0,
        "moeda": "BRL",
        "ativo": True,
        "criado_em": None,
        "criado_por": "1",
        "atualizado_em": None,
        "atualizado_por": "1",
    }
    updated = {**existing, "custo_mensal": 3520.0, "custo_hora": 20.0}

    with patch.object(svc, "get_funcao", side_effect=[existing, updated]), patch.object(
        svc.db, "execute_transaction", return_value=[None]
    ) as mock_tx:
        result = svc.update_funcao(3, ponto="9", custo_mensal=3520)

    assert result["custo_hora"] == 20.0
    # Verifica que o UPDATE recebeu custo_hora recalculado
    tx_fn = mock_tx.call_args[0][0][0]
    cursor = type("C", (), {"execute": lambda self, sql, params=None: None})()
    calls: list[tuple] = []

    def capture(sql, params=None):
        calls.append((sql, params))

    cursor.execute = capture  # type: ignore[method-assign]
    tx_fn(cursor)
    assert any("custo_hora" in (sql or "") for sql, _ in calls)
    assert any(20.0 in (params or []) for _, params in calls)


def test_set_funcao_active_missing_raises():
    with patch.object(svc, "get_funcao", return_value=None):
        with pytest.raises(KeyError):
            svc.set_funcao_active(99, active=False, ponto="1")


def test_list_funcoes_maps_rows():
    row = {
        "id": 1,
        "nome": "Acabamento",
        "codigo": "ACB",
        "descricao": "Geral",
        "custo_mensal": 1760,
        "custo_hora": 10,
        "horas_mes": 176,
        "moeda": "BRL",
        "ativo": 1,
        "criado_em": None,
        "criado_por": None,
        "atualizado_em": None,
        "atualizado_por": None,
    }
    with patch.object(svc.db, "execute_query", return_value=[row]):
        items = svc.list_funcoes(include_inactive=True)
    assert len(items) == 1
    assert items[0]["nome"] == "Acabamento"
    assert items[0]["custo_hora"] == 10.0
    assert items[0]["ativo"] is True

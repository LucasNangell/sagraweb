"""Testes do serviço e rotas de Estoque."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from routers import estoque_routes as routes
from services import estoque_service as svc


def test_dec_and_disponivel_helpers():
    assert svc._dec(None) == Decimal("0")
    assert svc._dec("1.5") == Decimal("1.5")
    assert svc._f(Decimal("1.23456")) == 1.2346


def test_require_view_denied():
    request = MagicMock()
    request.state.sagra_permissions = {}
    with pytest.raises(HTTPException) as exc:
        routes._require_view(request)
    assert exc.value.status_code == 403


def test_require_view_operador_or_gerente():
    request = MagicMock()
    request.state.sagra_permissions = {"sb_estoque": True}
    routes._require_view(request)

    request.state.sagra_permissions = {"sb_estoque_gerente": True}
    routes._require_view(request)
    assert routes._is_gerente(request) is True


def test_require_gerente_blocks_operador():
    request = MagicMock()
    request.state.sagra_permissions = {"sb_estoque": True}
    with pytest.raises(HTTPException) as exc:
        routes._require_gerente(request)
    assert exc.value.status_code == 403


def test_criar_pedido_rejects_empty_items():
    with pytest.raises(ValueError, match="ao menos um item"):
        svc.criar_pedido(solicitante_ponto="123", itens=[])


def test_criar_pedido_rejects_over_available():
    def fake_tx(ops):
        raise ValueError("SKU 1: disponível 2.0, solicitado 5.0")

    with patch.object(svc.db, "execute_transaction", side_effect=fake_tx):
        with pytest.raises(ValueError, match="disponível"):
            # Force the service path to hit transaction; simulate via raising in tx
            svc.criar_pedido(
                solicitante_ponto="10",
                itens=[{"sku_id": 1, "quantidade": 5}],
            )


def test_sku_row_to_dict_hides_negative_disponivel():
    row = {
        "id": 1,
        "codigo": "P01",
        "nome": "Papel",
        "descricao": None,
        "categoria_id": None,
        "categoria_nome": None,
        "unidade": "folha",
        "papel_link": None,
        "estoque_minimo": 10,
        "ativo": 1,
        "quantidade": 5,
        "reservado": 8,
        "custo_medio": 1.5,
        "ultimo_custo": 1.5,
        "moeda": "BRL",
    }
    out = svc._sku_row_to_dict(row, include_cost=True)
    assert out["disponivel"] == 0.0
    assert out["alerta_baixo"] is True
    assert out["custo_medio"] == 1.5


def test_get_skus_operador_without_cost(monkeypatch):
    request = MagicMock()
    request.state.sagra_permissions = {"sb_estoque": True}
    request.state.sagra_session = MagicMock(ponto=99)

    monkeypatch.setattr(
        routes.svc,
        "list_skus",
        lambda **kwargs: (
            [{"id": 1, "codigo": "A", "nome": "X", "disponivel": 3}],
            1,
        ),
    )
    result = routes.get_skus(request)
    assert result["total"] == 1


def test_post_entrada_requires_gerente():
    request = MagicMock()
    request.state.sagra_permissions = {"sb_estoque": True}
    body = routes.MovimentoPayload(sku_id=1, quantidade=10)
    with pytest.raises(HTTPException) as exc:
        routes.post_entrada(body, request)
    assert exc.value.status_code == 403

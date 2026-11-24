"""Agregação mensal do painel global — /api/os/volume-mensal."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture()
def volume_client(monkeypatch):
    from routers import os_routes
    import services.os_search_cache as cache

    cache.clear_for_tests()
    app = FastAPI()
    app.include_router(os_routes.router, prefix="/api")
    return TestClient(app), os_routes, cache


def test_volume_mensal_aggregates_by_month_and_category(monkeypatch):
    from services import os_volume_mensal_service as svc

    monkeypatch.setattr(
        svc,
        "_resolve_andamento_join",
        lambda: ("LEFT JOIN tabAndamento AS a_op ON 1=1", "a_op.SituacaoLink", "a_op.SetorLink", False),
    )
    fake_db = MagicMock()
    fake_db.execute_query.return_value = [
        {"mes": 1, "categoria": "em_andamento", "total": 5},
        {"mes": 1, "categoria": "entregue", "total": 2},
        {"mes": 3, "categoria": "cancelado", "total": 1},
    ]
    monkeypatch.setattr(svc, "db", fake_db)

    result = svc.execute_os_volume_mensal(ano=2026, include_os=True, include_sp=True)
    assert result["ano"] == 2026
    assert len(result["months"]) == 12
    jan = result["months"][0]
    assert jan == {"month": 1, "em_andamento": 5, "entregue": 2, "cancelado": 0}
    mar = result["months"][2]
    assert mar["cancelado"] == 1
    assert "NroProtocolo < 5000" not in fake_db.execute_query.call_args[0][0]


def test_volume_mensal_filters_os_only(monkeypatch):
    from services import os_volume_mensal_service as svc

    monkeypatch.setattr(
        svc,
        "_resolve_andamento_join",
        lambda: ("", "a_op.SituacaoLink", "a_op.SetorLink", False),
    )
    fake_db = MagicMock()
    fake_db.execute_query.return_value = []
    monkeypatch.setattr(svc, "db", fake_db)

    svc.execute_os_volume_mensal(ano=2026, include_os=True, include_sp=False)
    sql = fake_db.execute_query.call_args[0][0]
    assert "p.NroProtocolo < 5000" in sql


def test_volume_mensal_route_uses_service_and_cache(volume_client, monkeypatch):
    client, os_routes, cache = volume_client
    calls = []

    def fake_exec(**kwargs):
        calls.append(kwargs)
        return {
            "ano": kwargs["ano"],
            "months": [
                {"month": m, "em_andamento": 0, "entregue": 0, "cancelado": 0}
                for m in range(1, 13)
            ],
        }

    monkeypatch.setattr(
        "services.os_volume_mensal_service.execute_os_volume_mensal",
        fake_exec,
    )

    r1 = client.get(
        "/api/os/volume-mensal",
        params={"ano": 2026, "include_os": True, "include_sp": True},
    )
    r2 = client.get(
        "/api/os/volume-mensal",
        params={"ano": 2026, "include_os": True, "include_sp": True},
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["ano"] == 2026
    assert len(r1.json()["months"]) == 12
    assert len(calls) == 1
    assert r1.headers.get("X-Sagra-Cache") == "miss"
    assert r2.headers.get("X-Sagra-Cache") == "hit"


def test_volume_mensal_drill_route(volume_client, monkeypatch):
    client, _os_routes, _cache = volume_client

    monkeypatch.setattr(
        "services.os_volume_mensal_service.fetch_os_volume_mensal_drill_rows",
        lambda **kwargs: [
            {"setor": "SEFOC", "produto": "Livro", "situacao": "Em Execução"},
        ],
    )

    r = client.get(
        "/api/os/volume-mensal/drill",
        params={
            "ano": 2026,
            "month": 3,
            "category": "em_andamento",
            "include_os": True,
            "include_sp": True,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["month"] == 3
    assert body["category"] == "em_andamento"
    assert body["rows"][0]["setor"] == "SEFOC"


def test_painel_data_route_allows_volume_mensal():
    from security.painel_access import is_painel_data_api_route

    assert is_painel_data_api_route("/api/os/volume-mensal", "GET") is True
    assert is_painel_data_api_route("/api/os/volume-mensal/drill", "GET") is True
    assert is_painel_data_api_route("/sagra/api/os/volume-mensal", "GET") is True

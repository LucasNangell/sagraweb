"""Simulador de acesso efetivo (GET /api/admin/access/preview) e resumo (overview).

Regressão da regra de mesclagem IP × usuário: o simulador usa o mesmo núcleo
(`resolve_effective_permissions_core`) que o middleware.
"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi import HTTPException

from routers import acesso_admin_routes as routes
from routers import ip_admin_routes
from security import remote_master, user_permissions
from security.api_auth import require_master_ip
from security.user_permissions import _PERMISSION_BOOL_KEYS

PONTO = 123
TERMINAL_IP = "10.1.1.50"


def _perms(**granted: bool) -> dict[str, Any]:
    perms: dict[str, Any] = {key: False for key in _PERMISSION_BOOL_KEYS}
    perms.update(granted)
    perms["painel_setores"] = []
    perms["ip"] = TERMINAL_IP
    return perms


class FakeDb:
    def __init__(self) -> None:
        self.user: dict[str, Any] | None = {
            "Ponto": PONTO,
            "Nome": "Fulano",
            "AuthAtivo": 1,
            "EmailVerified": 1,
        }
        self.user_permissions: dict[str, Any] | None = None
        self.terminals: list[dict[str, Any]] = [
            {"id": 7, "ip": TERMINAL_IP, "descricao": "Recepção", "grupo": "Sala"},
            {"id": 8, "ip": "10.1.1.%", "descricao": "Rede", "grupo": "Sala"},
        ]

    def execute_query(self, sql: str, params: tuple | None = None):
        text = " ".join(sql.split())
        if "FROM user_permissions" in text:
            return [dict(self.user_permissions)] if self.user_permissions else []
        if "FROM tabUsuarios" in text and "WHERE Ponto" in text:
            return [dict(self.user)] if self.user else []
        if "FROM ip_permissions WHERE ativo" in text:
            return [dict(t) for t in self.terminals]
        raise AssertionError(f"SQL inesperado: {text}")


@pytest.fixture
def fake(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(user_permissions.db, "execute_query", db.execute_query)
    monkeypatch.setattr(routes.db, "execute_query", db.execute_query)
    monkeypatch.setattr(remote_master, "REMOTE_MASTER_PONTOS", frozenset())
    monkeypatch.setattr(routes, "is_privileged_ip", lambda ip: ip == "10.120.2.11")
    state: dict[str, Any] = {"ip_perms": _perms(sb_inicio=True, sb_gerencia=True)}

    def fake_get_client_permissions(ip: str):
        if ip == "10.120.2.11":
            return ip_admin_routes._full_access_permissions(ip)
        return state["ip_perms"]

    monkeypatch.setattr(ip_admin_routes, "get_client_permissions", fake_get_client_permissions)
    db.state = state  # type: ignore[attr-defined]
    return db


def _user_row(**granted: int) -> dict[str, Any]:
    row: dict[str, Any] = {"Ponto": PONTO}
    for key in _PERMISSION_BOOL_KEYS:
        row[key] = 0
    row.update(granted)
    row["painel_setores"] = None
    row["sb_dashboard_setor"] = 0
    return row


def _preview(**kwargs):
    return asyncio.run(routes.preview_access(**kwargs))


def test_local_sem_overlay_vale_o_terminal(fake):
    result = _preview(ponto=PONTO, ip=TERMINAL_IP, origem="local")
    assert result["acesso"] is True
    assert result["modo"] == "local_terminal"
    assert result["permissoes"]["sb_inicio"] is True
    assert result["permissoes"]["sb_pcp"] is False
    assert set(result["origem_por_chave"].values()) == {"ip"}
    assert result["terminal"]["cadastro"]["id"] == 7  # IP exato vence o curinga
    assert result["usuario"]["permissoes_proprias"] is False


def test_local_com_overlay_substitui_o_terminal(fake):
    fake.user_permissions = _user_row(sb_pcp=1)
    result = _preview(ponto=PONTO, ip=TERMINAL_IP, origem="local")
    assert result["modo"] == "local_usuario"
    # Overlay substitui todas as flags: sb_inicio do terminal não é herdado.
    assert result["permissoes"]["sb_pcp"] is True
    assert result["permissoes"]["sb_inicio"] is False
    assert set(result["origem_por_chave"].values()) == {"user"}
    assert result["permissoes_terminal"]["sb_inicio"] is True
    assert result["permissoes_usuario"]["sb_pcp"] is True


def test_local_terminal_nao_cadastrado_nega(fake):
    fake.state["ip_perms"] = None
    result = _preview(ponto=PONTO, ip="10.9.9.9", origem="local")
    assert result["acesso"] is False
    assert result["modo"] == "terminal_nao_autorizado"
    assert result["permissoes"] is None


def test_curinga_casa_quando_nao_ha_ip_exato(fake):
    result = _preview(ponto=PONTO, ip="10.1.1.77", origem="local")
    assert result["terminal"]["cadastro"]["id"] == 8
    assert result["terminal"]["cadastro"]["curinga"] is True


def test_internet_sem_permissoes_proprias_nada_liberado(fake):
    result = _preview(ponto=PONTO, ip="", origem="internet")
    assert result["acesso"] is True
    assert result["modo"] == "internet_sem_permissoes"
    assert not any(result["permissoes"].values())
    assert result["permissoes_terminal"] is None


def test_internet_com_permissoes_proprias(fake):
    fake.user_permissions = _user_row(sb_email=1)
    result = _preview(ponto=PONTO, ip="", origem="internet")
    assert result["modo"] == "internet_usuario"
    assert result["permissoes"]["sb_email"] is True
    assert result["permissoes"]["sb_inicio"] is False


def test_internet_conta_inativa_bloqueia(fake):
    fake.user["AuthAtivo"] = 0
    fake.user_permissions = _user_row(sb_email=1)
    result = _preview(ponto=PONTO, ip="", origem="internet")
    assert result["acesso"] is False
    assert result["modo"] == "conta_inativa"


def test_master_tem_acesso_total(fake):
    result = _preview(ponto=PONTO, ip="10.120.2.11", origem="local")
    assert result["acesso"] is True
    assert all(result["permissoes"].values())
    assert set(result["origem_por_chave"].values()) == {"master"}
    assert result["terminal"]["privilegiado"] is True


def test_master_remoto_via_internet(fake, monkeypatch):
    monkeypatch.setattr(remote_master, "REMOTE_MASTER_PONTOS", frozenset({PONTO}))
    result = _preview(ponto=PONTO, ip="", origem="internet")
    assert result["modo"] == "master_remoto"
    assert all(result["permissoes"].values())


def test_local_exige_ip_concreto(fake):
    for ip in ("", "10.1.1.%", "abc;drop"):
        with pytest.raises(HTTPException) as exc:
            _preview(ponto=PONTO, ip=ip, origem="local")
        assert exc.value.status_code == 422


def test_rotas_exigem_master():
    from routers.api import app

    paths = {"/api/admin/access/preview", "/api/admin/access/overview"}
    found = set()
    for route in app.routes:
        if getattr(route, "path", None) in paths:
            deps = [d.call for d in route.dependant.dependencies]
            assert require_master_ip in deps, route.path
            found.add(route.path)
    assert found == paths


def test_overview_conta_por_tabela(monkeypatch):
    counts = {
        "COUNT(*) AS n FROM tabUsuarios WHERE Email": 4,
        "COUNT(*) AS n FROM tabUsuarios WHERE (Email": 1,
        "COUNT(*) AS n FROM tabUsuarios": 10,
        "COUNT(*) AS n FROM ip_permissions WHERE ativo": 6,
        "COUNT(*) AS n FROM ip_permissions": 8,
        "COUNT(*) AS n FROM tabSolicitacoesAcesso": 2,
    }

    def fake_execute(sql, params=None):
        text = " ".join(sql.split())
        for needle, value in counts.items():
            if needle in text:
                return [{"n": value}]
        raise AssertionError(text)

    monkeypatch.setattr(routes.db, "execute_query", fake_execute)
    from routers import realtime

    monkeypatch.setattr(realtime.manager, "get_online_users", lambda: ["918713", 123, "x"])
    result = asyncio.run(routes.access_overview())
    assert result == {
        "usuarios": {"total": 10, "online": 2, "conta_internet": 4, "ativacao_pendente": 1},
        "terminais": {"total": 8, "ativos": 6},
        "solicitacoes_pendentes": 2,
    }

"""Testes do app Android da Manutenção: token do aparelho, eventos, visualizações e APK."""

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import manutencao_app_routes as app_routes
from routers import manutencao_routes as routes
from services import manutencao_app_service as app_svc

TOKEN = "t" * 43
APARELHO = {"id": 9, "ponto": "918", "aparelho_id": "dev-1", "modelo": "Pixel", "versao_app": "1.0.0"}


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(app_routes.router, prefix="/api")
    return TestClient(app)


def test_prefixo_do_app_liberado_no_middleware():
    from security.api_auth import _is_public_api
    from security.cloudflare_access import is_cloudflare_public_path

    assert _is_public_api("/api/manutencao/app/eventos", "GET")
    assert is_cloudflare_public_path("/api/manutencao/app/sessao", "POST")
    # Rotas da página continuam exigindo sessão.
    assert not _is_public_api("/api/manutencao/aparelhos", "POST")


def test_hash_token_estavel_e_nao_reversivel():
    assert app_svc.hash_token(TOKEN) == app_svc.hash_token(f"  {TOKEN} ")
    assert TOKEN not in app_svc.hash_token(TOKEN)
    assert len(app_svc.hash_token(TOKEN)) == 64


def test_autenticar_token_rejeita_curto_e_revogado():
    with pytest.raises(app_svc.AparelhoInvalido):
        app_svc.autenticar_token("curto")
    with (
        patch.object(app_svc, "ensure_manutencao_schema"),
        patch.object(app_svc.db, "execute_query", return_value=[{**APARELHO, "revogado_em": "2026-11-01"}]),
        pytest.raises(app_svc.AparelhoInvalido),
    ):
        app_svc.autenticar_token(TOKEN)


def test_sessao_sem_token_401(client):
    resp = client.post("/api/manutencao/app/sessao")
    assert resp.status_code == 401


def test_sessao_recria_cookie_e_registra_abertura(client):
    with (
        patch.object(app_svc, "autenticar_token", return_value=dict(APARELHO)),
        patch.object(app_routes, "_tem_permissao_manutencao", return_value=True),
        patch.object(app_routes, "_nome", return_value="Fulano"),
        patch.object(app_svc, "registrar_abertura") as abertura,
        patch("security.public_access.is_public_internet_request", return_value=False),
    ):
        resp = client.post(
            "/api/manutencao/app/sessao",
            headers={"X-Sagra-App-Token": TOKEN, "X-Sagra-App-Versao": "1.2.0"},
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["nome"] == "Fulano"
    assert "sagra_session" in resp.headers.get("set-cookie", "")
    abertura.assert_called_once()
    assert abertura.call_args.args[1] == "1.2.0"


def test_sessao_sem_permissao_403(client):
    with (
        patch.object(app_svc, "autenticar_token", return_value=dict(APARELHO)),
        patch.object(app_routes, "_tem_permissao_manutencao", return_value=False),
        patch("security.public_access.is_public_internet_request", return_value=False),
    ):
        resp = client.post("/api/manutencao/app/sessao", headers={"X-Sagra-App-Token": TOKEN})
    assert resp.status_code == 403


def test_eventos_sincroniza_sem_backlog(client):
    with (
        patch.object(app_svc, "autenticar_token", return_value=dict(APARELHO)),
        patch.object(app_svc, "ultimo_id_notificacao", return_value=77),
        patch.object(app_svc, "info_versao", return_value=None),
    ):
        resp = client.get("/api/manutencao/app/eventos?desde=-1", headers={"X-Sagra-App-Token": TOKEN})
    assert resp.json() == {"ultimo_id": 77, "itens": [], "versao": None}


def test_eventos_entrega_itens_com_rota_relativa(client):
    item = {
        "id": 80,
        "pedido_id": 42,
        "titulo": "Nova",
        "mensagem": "m",
        "url": "https://host/sagra/manutencao?aba=operador&pedido=42",
        "urgente": True,
        "criado_em": None,
    }
    with (
        patch.object(app_svc, "autenticar_token", return_value=dict(APARELHO)),
        patch.object(app_svc, "notificacoes_desde", return_value=[item]),
        patch.object(app_svc, "info_versao", return_value={"version_code": 3, "version_name": "1.2.0"}),
    ):
        resp = client.get("/api/manutencao/app/eventos?desde=79&espera=0", headers={"X-Sagra-App-Token": TOKEN})
    body = resp.json()
    assert body["ultimo_id"] == 80
    assert body["itens"][0]["rota"] == "manutencao?aba=operador&pedido=42"
    assert body["versao"]["version_code"] == 3


def test_eventos_sem_novidade_devolve_mesmo_id(client):
    with (
        patch.object(app_svc, "autenticar_token", return_value=dict(APARELHO)),
        patch.object(app_svc, "notificacoes_desde", return_value=[]),
        patch.object(app_svc, "info_versao", return_value=None),
    ):
        resp = client.get("/api/manutencao/app/eventos?desde=5&espera=0", headers={"X-Sagra-App-Token": TOKEN})
    assert resp.json()["ultimo_id"] == 5


def test_rota_relativa_fallback():
    assert app_routes.rota_relativa(None, 7) == "manutencao?aba=operador&pedido=7"
    assert app_routes.rota_relativa("/manutencao?aba=gerencia&pedido=7", 7) == "manutencao?aba=gerencia&pedido=7"


def test_versao_e_apk(tmp_path, monkeypatch, client):
    monkeypatch.setenv("MANUTENCAO_APP_DIR", str(tmp_path))
    assert client.get("/api/manutencao/app/versao").status_code == 404
    (tmp_path / "sagra-manutencao-1.0.0.apk").write_bytes(b"PK\x03\x04apk")
    (tmp_path / "versao.json").write_text(
        json.dumps({"version_code": 1, "version_name": "1.0.0", "arquivo": "sagra-manutencao-1.0.0.apk", "sha256": "x"}),
        encoding="utf-8",
    )
    info = client.get("/api/manutencao/app/versao").json()
    assert info["version_code"] == 1 and info["tamanho"] == 7 and "_path" not in info
    apk = client.get("/api/manutencao/app/apk")
    assert apk.status_code == 200
    assert apk.headers["content-type"] == "application/vnd.android.package-archive"
    assert apk.content == b"PK\x03\x04apk"


def test_versao_rejeita_caminho_fora_da_pasta(tmp_path, monkeypatch):
    monkeypatch.setenv("MANUTENCAO_APP_DIR", str(tmp_path))
    (tmp_path / "versao.json").write_text(json.dumps({"version_code": 1, "arquivo": "../x.apk"}), encoding="utf-8")
    assert app_svc.info_versao() is None


def test_registrar_visualizacoes_filtra_ids_e_origem():
    cursor = MagicMock()
    ctx = MagicMock()
    ctx.__enter__.return_value = cursor
    with (
        patch.object(app_svc, "ensure_manutencao_schema"),
        patch.object(app_svc.db, "execute_query", return_value=[{"id": 1}, {"id": 2}]) as q,
        patch.object(app_svc.db, "cursor", return_value=ctx),
    ):
        n = app_svc.registrar_visualizacoes("918", [1, "2", 2, "x", -5, 99], "hack")
    assert n == 2
    assert q.call_args.args[1] == (1, 2, 99)
    linhas = cursor.executemany.call_args.args[1]
    assert linhas == [(1, "918", "web"), (2, "918", "web")]


def test_registrar_visualizacoes_ignora_sem_ponto():
    assert app_svc.registrar_visualizacoes("0", [1], "app") == 0


def test_enfileirar_notificacao_sinaliza_long_poll():
    cursor = MagicMock()
    ctx = MagicMock()
    ctx.__enter__.return_value = cursor
    antes = app_svc.versao_sinal()
    with patch.object(app_svc, "ensure_manutencao_schema"), patch.object(app_svc.db, "cursor", return_value=ctx):
        n = app_svc.enfileirar_notificacao(
            ["111", "111", "222"], titulo="t", mensagem="m", url=None, urgente=True, pedido_id=4
        )
    assert n == 2
    assert app_svc.versao_sinal() == antes + 1


def _req(perms, ponto="918"):
    request = MagicMock()
    request.state.sagra_permissions = perms
    return request


def test_rotas_de_aparelho_exigem_permissoes():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        routes.get_aparelhos(_req({"sb_manutencao_operador": True}), aberturas=0)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException):
        routes.post_aparelho(routes.AparelhoPayload(aparelho_id="12345678"), _req({}))
    with (
        patch.object(routes, "_ponto", return_value="918"),
        patch.object(app_svc, "registrar_aparelho", return_value={"id": 1, "token": TOKEN, "ponto": "918"}) as reg,
    ):
        out = routes.post_aparelho(
            routes.AparelhoPayload(aparelho_id="12345678", modelo="Pixel", versao_app="1.0.0"),
            _req({"sb_manutencao_operador": True}),
        )
    assert out["token"] == TOKEN
    assert reg.call_args.kwargs["aparelho_id"] == "12345678"

"""
Rotas do app Android da Manutenção autenticadas pelo token do aparelho.

Prefixo /api/manutencao/app/ é liberado no middleware (security/api_auth.py e
cloudflare_access.py) porque aqui a autenticação é o header X-Sagra-App-Token —
cada rota valida o token. Versão/APK são públicos (o APK não contém segredos).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from database import db
from services import manutencao_app_service as app_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/manutencao/app", tags=["manutencao-app"])

TOKEN_HEADER = "x-sagra-app-token"
VERSAO_HEADER = "x-sagra-app-versao"
ESPERA_MAX_S = 25


def _token(request: Request) -> str:
    return (request.headers.get(TOKEN_HEADER) or "").strip()


def _versao_header(request: Request) -> Optional[str]:
    raw = (request.headers.get(VERSAO_HEADER) or "").strip()
    return raw[:20] or None


async def _aparelho(request: Request) -> dict:
    try:
        return await run_in_threadpool(app_svc.autenticar_token, _token(request))
    except app_svc.AparelhoInvalido as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _tem_permissao_manutencao(ponto: str) -> bool:
    rows = db.execute_query(
        """
        SELECT sb_manutencao_gerencia, sb_manutencao_operador
        FROM user_permissions WHERE Ponto = %s
        """,
        (ponto,),
    ) or []
    if not rows:
        return True  # sem linha própria: permissões vêm do IP/padrão — o middleware decide.
    r = rows[0]
    return bool(r.get("sb_manutencao_gerencia") or r.get("sb_manutencao_operador"))


def _nome(ponto: str) -> str:
    rows = db.execute_query("SELECT Nome FROM tabUsuarios WHERE Ponto = %s", (int(ponto),)) or []
    return str(rows[0].get("Nome") or "").strip() if rows else ""


def rota_relativa(url: Optional[str], pedido_id: Optional[int]) -> str:
    """Caminho relativo à base da SPA (o app resolve contra o próprio servidor)."""
    if url:
        idx = url.find("manutencao")
        if idx >= 0:
            return url[idx:]
    if pedido_id:
        return f"manutencao?aba=operador&pedido={int(pedido_id)}"
    return "manutencao?aba=operador"


@router.post("/sessao")
async def post_sessao(request: Request, response: Response):
    """Recria a sessão a partir do token do aparelho e registra a abertura do app."""
    aparelho = await _aparelho(request)
    ponto = aparelho["ponto"]

    from security.public_access import (
        AUTH_MODE_LOCAL,
        AUTH_MODE_PASSWORD,
        is_public_internet_request,
    )
    from security.session_auth import SessionData, set_session_cookie

    via_internet = is_public_internet_request(request)

    def _validar() -> str:
        if via_internet:
            from security.user_permissions import _user_account_allows_password_login

            if not _user_account_allows_password_login(int(ponto)):
                raise HTTPException(status_code=403, detail="Conta desativada ou não ativada")
        if not _tem_permissao_manutencao(ponto):
            raise HTTPException(status_code=403, detail="Sem permissão para Manutenção")
        app_svc.registrar_abertura(aparelho, _versao_header(request))
        return _nome(ponto)

    nome = await run_in_threadpool(_validar)
    session = SessionData(
        ponto=int(ponto),
        nome=nome,
        ip=_client_ip(request),
        iat=int(time.time()),
        auth_mode=AUTH_MODE_PASSWORD if via_internet else AUTH_MODE_LOCAL,
    )
    set_session_cookie(response, session)
    return {"ponto": ponto, "nome": nome, "aparelho_id": aparelho["id"]}


def _client_ip(request: Request) -> str:
    try:
        from security.api_auth import resolve_client_ip

        return resolve_client_ip(request) or ""
    except Exception:  # pragma: no cover
        return request.client.host if request.client else ""


@router.get("/eventos")
async def get_eventos(
    request: Request,
    desde: int = Query(-1, description="Último id recebido; -1 = só sincronizar"),
    espera: int = Query(ESPERA_MAX_S, ge=0, le=ESPERA_MAX_S),
):
    """Long-poll do serviço em segundo plano: devolve notificações novas do usuário."""
    aparelho = await _aparelho(request)
    ponto = aparelho["ponto"]
    info = app_svc.info_versao()
    versao = {"version_code": info["version_code"], "version_name": info["version_name"]} if info else None

    if desde < 0:
        ultimo = await run_in_threadpool(app_svc.ultimo_id_notificacao, ponto)
        return {"ultimo_id": ultimo, "itens": [], "versao": versao}

    limite = time.monotonic() + espera
    sinal = app_svc.versao_sinal()
    while True:
        itens = await run_in_threadpool(app_svc.notificacoes_desde, ponto, desde)
        if itens or time.monotonic() >= limite:
            break
        while time.monotonic() < limite and app_svc.versao_sinal() == sinal:
            if await request.is_disconnected():
                return Response(status_code=204)
            await asyncio.sleep(1.0)
        sinal = app_svc.versao_sinal()
    for item in itens:
        item["rota"] = rota_relativa(item.get("url"), item.get("pedido_id"))
    ultimo = itens[-1]["id"] if itens else desde
    return {"ultimo_id": ultimo, "itens": itens, "versao": versao}


@router.post("/sair")
async def post_sair(request: Request):
    """Desconecta este aparelho (o próximo uso pede login novamente)."""
    token = _token(request)
    if token:
        await run_in_threadpool(app_svc.revogar_por_token, token)
    return {"ok": True}


@router.get("/versao")
def get_versao():
    info = app_svc.info_versao()
    if not info:
        raise HTTPException(status_code=404, detail="Nenhuma versão do app publicada")
    return {k: v for k, v in info.items() if not k.startswith("_")}


_ARQ_RE = re.compile(r"^[A-Za-z0-9._-]+\.apk$")


@router.get("/apk")
def get_apk():
    info = app_svc.info_versao()
    if not info or not _ARQ_RE.match(info["arquivo"]):
        raise HTTPException(status_code=404, detail="Nenhuma versão do app publicada")
    return FileResponse(
        info["_path"],
        media_type="application/vnd.android.package-archive",
        filename=info["arquivo"],
        headers={"Cache-Control": "no-cache"},
    )

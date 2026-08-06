"""
API Credenciais DEPOL — pedidos pré-OS + execução via worker Papelaria.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from services import credenciais_depol_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/credenciais-depol", tags=["credenciais-depol"])


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


def _require_access(request: Request) -> None:
    if not _perms(request).get("sb_credenciais_depol"):
        raise HTTPException(status_code=403, detail="Sem permissão para Credenciais DEPOL")


def _require_admin(request: Request) -> None:
    p = _perms(request)
    if p.get("sb_configuracoes") or p.get("sb_admin_ips"):
        return
    raise HTTPException(
        status_code=403,
        detail="Sem permissão para configurar Credenciais DEPOL",
    )


def _require_modelos_media(request: Request) -> None:
    """Pedido ou admin podem carregar thumbs/SVGs."""
    p = _perms(request)
    if (
        p.get("sb_credenciais_depol")
        or p.get("sb_configuracoes")
        or p.get("sb_admin_ips")
    ):
        return
    raise HTTPException(status_code=403, detail="Sem permissão")


def _ponto(request: Request) -> str:
    from security.session_auth import SessionData, require_session

    session = getattr(request.state, "sagra_session", None)
    if isinstance(session, SessionData):
        return str(session.ponto)
    try:
        return str(require_session(request).ponto)
    except Exception:
        return "0"


class ItemPayload(BaseModel):
    modelo_arquivo: str
    linha1: str
    linha2: Optional[str] = None
    linha3: Optional[str] = None
    ordem: Optional[int] = None


class CreatePedidoPayload(BaseModel):
    titulo: Optional[str] = None
    observacao: Optional[str] = None
    itens: list[ItemPayload] = Field(min_length=1)


class PatchPedidoPayload(BaseModel):
    titulo: Optional[str] = None
    observacao: Optional[str] = None
    itens: Optional[list[ItemPayload]] = None


class VincularPayload(BaseModel):
    ano: int
    nro: int


class SvgBoxPayload(BaseModel):
    x_mm: float
    y_mm: float
    w_mm: float
    h_mm: float


class LayoutPayload(BaseModel):
    page_w_mm: float = 85
    page_h_mm: float = 120
    svgs: dict[str, SvgBoxPayload]


class UpdateModeloPayload(BaseModel):
    nome_exibicao: Optional[str] = None
    ativo: Optional[bool] = None
    ordem: Optional[int] = None
    layout: Optional[LayoutPayload] = None


class AutoOsSettingsPayload(BaseModel):
    auto_criar_os: Optional[bool] = None
    os_template_nro: Optional[int] = None
    os_template_ano: Optional[int] = None


def _http_err(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    logger.exception("Erro Credenciais DEPOL")
    return HTTPException(status_code=500, detail="Erro interno")


@router.get("/modelos")
def list_modelos(request: Request) -> dict[str, Any]:
    _require_access(request)
    return {"modelos": svc.list_modelos()}


@router.get("/modelos/{nome}/thumb")
def modelo_thumb(nome: str, request: Request):
    _require_modelos_media(request)
    try:
        path = svc.resolve_thumb_path(nome)
    except (ValueError, FileNotFoundError) as exc:
        raise _http_err(exc) from exc
    return FileResponse(path, media_type="image/jpeg")


@router.get("/svgs/{nome}")
def get_svg(nome: str, request: Request):
    _require_modelos_media(request)
    try:
        path = svc.resolve_svg_path(nome)
    except (ValueError, FileNotFoundError) as exc:
        raise _http_err(exc) from exc
    return FileResponse(path, media_type="image/svg+xml")


@router.get("/admin/modelos")
def admin_list_modelos(request: Request) -> dict[str, Any]:
    _require_admin(request)
    return {"modelos": svc.list_modelos_admin()}


@router.get("/admin/settings")
def admin_get_settings(request: Request) -> dict[str, Any]:
    _require_admin(request)
    return svc.get_auto_os_settings()


@router.put("/admin/settings")
def admin_put_settings(
    payload: AutoOsSettingsPayload, request: Request
) -> dict[str, Any]:
    _require_admin(request)
    try:
        return svc.update_auto_os_settings(
            auto_criar_os=payload.auto_criar_os,
            os_template_nro=payload.os_template_nro,
            os_template_ano=payload.os_template_ano,
        )
    except ValueError as exc:
        raise _http_err(exc) from exc


@router.post("/admin/modelos/sync")
def admin_sync_modelos(request: Request) -> dict[str, Any]:
    _require_admin(request)
    try:
        return svc.sync_modelos_from_folder()
    except FileNotFoundError as exc:
        raise _http_err(exc) from exc


@router.put("/admin/modelos/{modelo_id}")
def admin_update_modelo(
    modelo_id: int, payload: UpdateModeloPayload, request: Request
) -> dict[str, Any]:
    _require_admin(request)
    try:
        layout = None
        if payload.layout is not None:
            layout = {
                "page_w_mm": payload.layout.page_w_mm,
                "page_h_mm": payload.layout.page_h_mm,
                "svgs": {
                    k: v.model_dump() for k, v in payload.layout.svgs.items()
                },
            }
        return svc.update_modelo(
            modelo_id,
            nome_exibicao=payload.nome_exibicao,
            ativo=payload.ativo,
            ordem=payload.ordem,
            layout=layout,
        )
    except (ValueError, LookupError) as exc:
        raise _http_err(exc) from exc


@router.post("/pedidos")
def create_pedido(payload: CreatePedidoPayload, request: Request) -> dict[str, Any]:
    _require_access(request)
    try:
        return svc.create_pedido(
            criado_por=_ponto(request),
            titulo=payload.titulo,
            observacao=payload.observacao,
            itens=[i.model_dump() for i in payload.itens],
        )
    except (ValueError, FileNotFoundError, LookupError) as exc:
        raise _http_err(exc) from exc


@router.get("/pedidos")
def list_pedidos(
    request: Request,
    status: Optional[str] = None,
    abertos: bool = Query(False),
    ano: Optional[int] = None,
    nro: Optional[int] = None,
) -> dict[str, Any]:
    _require_access(request)
    return {
        "pedidos": svc.list_pedidos(status=status, abertos=abertos, ano=ano, nro=nro)
    }


@router.get("/pedidos/{pedido_id}")
def get_pedido(pedido_id: int, request: Request) -> dict[str, Any]:
    _require_access(request)
    pedido = svc.get_pedido(pedido_id)
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")
    return pedido


@router.patch("/pedidos/{pedido_id}")
def patch_pedido(
    pedido_id: int, payload: PatchPedidoPayload, request: Request
) -> dict[str, Any]:
    _require_access(request)
    try:
        return svc.update_pedido(
            pedido_id,
            titulo=payload.titulo,
            observacao=payload.observacao,
            itens=[i.model_dump() for i in payload.itens] if payload.itens is not None else None,
        )
    except (ValueError, FileNotFoundError, LookupError) as exc:
        raise _http_err(exc) from exc


@router.post("/pedidos/{pedido_id}/cancelar")
def cancelar_pedido(pedido_id: int, request: Request) -> dict[str, Any]:
    _require_access(request)
    try:
        return svc.cancelar_pedido(pedido_id)
    except (ValueError, LookupError) as exc:
        raise _http_err(exc) from exc


@router.post("/pedidos/{pedido_id}/vincular")
def vincular_pedido(
    pedido_id: int, payload: VincularPayload, request: Request
) -> dict[str, Any]:
    _require_access(request)
    try:
        return svc.vincular_pedido(
            pedido_id, payload.ano, payload.nro, _ponto(request)
        )
    except (ValueError, LookupError) as exc:
        raise _http_err(exc) from exc


@router.post("/pedidos/{pedido_id}/desvincular")
def desvincular_pedido(pedido_id: int, request: Request) -> dict[str, Any]:
    _require_access(request)
    try:
        return svc.desvincular_pedido(pedido_id)
    except (ValueError, LookupError) as exc:
        raise _http_err(exc) from exc


@router.post("/pedidos/{pedido_id}/executar")
def executar_pedido(pedido_id: int, request: Request) -> dict[str, Any]:
    """Enfileira um job com todos os pedidos elegíveis da mesma OS."""
    _require_access(request)
    try:
        return svc.executar_pedido(pedido_id, _ponto(request))
    except (ValueError, LookupError, FileNotFoundError) as exc:
        raise _http_err(exc) from exc


@router.post("/os/{ano}/{nro}/executar")
def executar_os(ano: int, nro: int, request: Request) -> dict[str, Any]:
    """Enfileira um job Corel/prova com todos os pedidos vinculados da OS."""
    _require_access(request)
    try:
        return svc.executar_os(ano, nro, _ponto(request))
    except (ValueError, LookupError, FileNotFoundError) as exc:
        raise _http_err(exc) from exc


@router.get("/pedidos/{pedido_id}/job")
def get_pedido_job(pedido_id: int, request: Request) -> dict[str, Any]:
    _require_access(request)
    try:
        return svc.get_pedido_job(pedido_id)
    except LookupError as exc:
        raise _http_err(exc) from exc


@router.post("/pedidos/{pedido_id}/aprovar-prova")
def aprovar_prova(pedido_id: int, request: Request) -> dict[str, Any]:
    _require_access(request)
    try:
        return svc.aprovar_prova_pedido(pedido_id, _ponto(request))
    except (ValueError, LookupError) as exc:
        raise _http_err(exc) from exc


@router.post("/pedidos/{pedido_id}/descartar-prova")
def descartar_prova(pedido_id: int, request: Request) -> dict[str, Any]:
    _require_access(request)
    try:
        return svc.descartar_prova_pedido(pedido_id, _ponto(request))
    except (ValueError, LookupError) as exc:
        raise _http_err(exc) from exc

"""
API do módulo Estoque — isolado; não altera OS/PCP/andamento.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from services import estoque_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(tags=["estoque"])


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


def _can_view(request: Request) -> bool:
    p = _perms(request)
    return bool(p.get("sb_estoque") or p.get("sb_estoque_gerente"))


def _is_gerente(request: Request) -> bool:
    return bool(_perms(request).get("sb_estoque_gerente"))


def _require_view(request: Request) -> None:
    if not _can_view(request):
        raise HTTPException(status_code=403, detail="Sem permissão para Estoque")


def _require_gerente(request: Request) -> None:
    _require_view(request)
    if not _is_gerente(request):
        raise HTTPException(status_code=403, detail="Requer perfil gerente de estoque")


def _ponto(request: Request) -> str:
    from security.session_auth import SessionData, require_session

    session = getattr(request.state, "sagra_session", None)
    if isinstance(session, SessionData):
        return str(session.ponto)
    try:
        return str(require_session(request).ponto)
    except Exception:
        return "0"


# ----- payloads -----


class SkuCreate(BaseModel):
    codigo: str
    nome: str
    descricao: Optional[str] = None
    categoria_id: Optional[int] = None
    unidade: str = "un"
    papel_link: Optional[str] = None
    estoque_minimo: float = 0


class SkuUpdate(BaseModel):
    codigo: Optional[str] = None
    nome: Optional[str] = None
    descricao: Optional[str] = None
    categoria_id: Optional[int] = None
    clear_categoria: bool = False
    unidade: Optional[str] = None
    papel_link: Optional[str] = None
    estoque_minimo: Optional[float] = None
    ativo: Optional[bool] = None


class MovimentoPayload(BaseModel):
    sku_id: int
    quantidade: float
    custo_unitario: Optional[float] = None
    motivo: Optional[str] = None
    os_nro: Optional[int] = None
    os_ano: Optional[int] = None


class AjustePayload(BaseModel):
    sku_id: int
    quantidade_nova: float
    motivo: str


class PedidoItemIn(BaseModel):
    sku_id: int
    quantidade: float = Field(gt=0)


class PedidoCreate(BaseModel):
    itens: list[PedidoItemIn]
    observacao: Optional[str] = None
    os_nro: Optional[int] = None
    os_ano: Optional[int] = None


class RecusaPayload(BaseModel):
    motivo: Optional[str] = None


# ----- routes -----


@router.get("/estoque/categorias")
def get_categorias(request: Request):
    _require_view(request)
    return {"items": svc.list_categorias()}


@router.get("/estoque/skus")
def get_skus(
    request: Request,
    q: Optional[str] = None,
    categoria_id: Optional[int] = None,
    include_inactive: bool = False,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_view(request)
    gerente = _is_gerente(request)
    items, total = svc.list_skus(
        q=q,
        categoria_id=categoria_id,
        only_active=True,
        include_inactive=include_inactive if gerente else False,
        include_cost=gerente,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/estoque/skus/{sku_id}")
def get_sku(sku_id: int, request: Request):
    _require_view(request)
    sku = svc.get_sku(sku_id, include_cost=_is_gerente(request))
    if not sku:
        raise HTTPException(status_code=404, detail="SKU não encontrado")
    if not sku["ativo"] and not _is_gerente(request):
        raise HTTPException(status_code=404, detail="SKU não encontrado")
    return sku


@router.post("/estoque/skus")
def post_sku(body: SkuCreate, request: Request):
    _require_gerente(request)
    try:
        return svc.create_sku(
            codigo=body.codigo,
            nome=body.nome,
            descricao=body.descricao,
            categoria_id=body.categoria_id,
            unidade=body.unidade,
            papel_link=body.papel_link,
            estoque_minimo=body.estoque_minimo,
            ponto=_ponto(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if "Duplicate" in str(exc) or "uk_estoque_sku_codigo" in str(exc):
            raise HTTPException(status_code=409, detail="Código SKU já existe") from exc
        raise


@router.patch("/estoque/skus/{sku_id}")
def patch_sku(sku_id: int, body: SkuUpdate, request: Request):
    _require_gerente(request)
    try:
        return svc.update_sku(
            sku_id,
            ponto=_ponto(request),
            codigo=body.codigo,
            nome=body.nome,
            descricao=body.descricao,
            categoria_id=body.categoria_id,
            clear_categoria=body.clear_categoria,
            unidade=body.unidade,
            papel_link=body.papel_link,
            estoque_minimo=body.estoque_minimo,
            ativo=body.ativo,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/estoque/entradas")
def post_entrada(body: MovimentoPayload, request: Request):
    _require_gerente(request)
    try:
        return svc.registrar_entrada(
            sku_id=body.sku_id,
            quantidade=body.quantidade,
            custo_unitario=body.custo_unitario,
            motivo=body.motivo,
            ponto=_ponto(request),
            os_nro=body.os_nro,
            os_ano=body.os_ano,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/estoque/saidas")
def post_saida(body: MovimentoPayload, request: Request):
    _require_gerente(request)
    try:
        return svc.registrar_saida(
            sku_id=body.sku_id,
            quantidade=body.quantidade,
            motivo=body.motivo,
            ponto=_ponto(request),
            os_nro=body.os_nro,
            os_ano=body.os_ano,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/estoque/ajustes")
def post_ajuste(body: AjustePayload, request: Request):
    _require_gerente(request)
    try:
        return svc.registrar_ajuste(
            sku_id=body.sku_id,
            quantidade_nova=body.quantidade_nova,
            motivo=body.motivo,
            ponto=_ponto(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/estoque/movimentos")
def get_movimentos(
    request: Request,
    sku_id: Optional[int] = None,
    tipo: Optional[str] = None,
    pedido_id: Optional[int] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_view(request)
    solicitante = None if _is_gerente(request) else _ponto(request)
    if not _is_gerente(request) and sku_id is None and pedido_id is None:
        # operador: only movements linked to own pedidos
        pass
    items, total = svc.list_movimentos(
        sku_id=sku_id,
        tipo=tipo,
        pedido_id=pedido_id,
        solicitante_ponto=solicitante,
        limit=limit,
        offset=offset,
    )
    if not _is_gerente(request):
        for it in items:
            it.pop("custo_unitario", None)
            it.pop("custo_total", None)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/estoque/pedidos")
def get_pedidos(
    request: Request,
    status: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_view(request)
    solicitante = None if _is_gerente(request) else _ponto(request)
    items, total = svc.list_pedidos(
        status=status,
        solicitante_ponto=solicitante,
        limit=limit,
        offset=offset,
    )
    if not _is_gerente(request):
        for ped in items:
            for item in ped.get("itens") or []:
                item.pop("custo_unitario_snapshot", None)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/estoque/pedidos/{pedido_id}")
def get_pedido(pedido_id: int, request: Request):
    _require_view(request)
    pedido = svc.get_pedido(pedido_id)
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if not _is_gerente(request) and pedido["solicitante_ponto"] != _ponto(request):
        raise HTTPException(status_code=403, detail="Pedido de outro solicitante")
    if not _is_gerente(request):
        for item in pedido.get("itens") or []:
            item.pop("custo_unitario_snapshot", None)
    return pedido


@router.post("/estoque/pedidos")
def post_pedido(body: PedidoCreate, request: Request):
    _require_view(request)
    try:
        return svc.criar_pedido(
            solicitante_ponto=_ponto(request),
            itens=[i.model_dump() for i in body.itens],
            observacao=body.observacao,
            os_nro=body.os_nro,
            os_ano=body.os_ano,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/estoque/pedidos/{pedido_id}/atender")
def post_atender(pedido_id: int, request: Request):
    _require_gerente(request)
    try:
        return svc.atender_pedido(pedido_id=pedido_id, ponto=_ponto(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/estoque/pedidos/{pedido_id}/recusar")
def post_recusar(pedido_id: int, body: RecusaPayload, request: Request):
    _require_gerente(request)
    try:
        return svc.recusar_pedido(
            pedido_id=pedido_id, ponto=_ponto(request), motivo=body.motivo
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/estoque/pedidos/{pedido_id}/cancelar")
def post_cancelar(pedido_id: int, request: Request):
    _require_view(request)
    try:
        return svc.cancelar_pedido(
            pedido_id=pedido_id,
            ponto=_ponto(request),
            is_gerente=_is_gerente(request),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/estoque/alertas")
def get_alertas(request: Request):
    _require_gerente(request)
    return {"items": svc.list_alertas()}


@router.get("/estoque/resumo")
def get_resumo(request: Request):
    _require_gerente(request)
    return svc.get_resumo()

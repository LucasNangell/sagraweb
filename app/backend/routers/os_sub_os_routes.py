"""
Endpoints MySQL-only para componentes e Sub OS por componente.
Reutiliza autenticação global; permissão ctx_detalhes_os aplicada no frontend.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from schemas.common import StatusResponse
from services.os_componentes_service import (
    add_sub_os_history,
    delete_sub_os_history,
    get_componente,
    get_or_create_sub_os,
    get_sub_os,
    is_os_frozen,
    list_sub_os,
    list_sub_os_history,
    load_componentes_for_os,
    count_sub_os,
)

router = APIRouter(tags=["os-sub-os"])
logger = logging.getLogger(__name__)


class ComponenteRow(BaseModel):
    id: int
    nome: str
    nome_normalizado: str
    tipo: Optional[str] = None
    ordem: int = 0
    ativo: bool = True
    lotes: list = Field(default_factory=list)


class SubOsRow(BaseModel):
    id: int
    display_name: str
    componente_id: int
    componente_nome: str
    componente_tipo: Optional[str] = None
    situacao: Optional[str] = None
    setor: Optional[str] = None
    data: Optional[str] = None
    situacao_atual: Optional[str] = None
    setor_atual: Optional[str] = None
    observacao_atual: Optional[str] = None
    data_atual: Optional[str] = None
    ultimo_status_id: Optional[int] = None
    has_history: bool = False
    row_kind: str = "sub_os"
    congelada: bool = False
    ativo: bool = True


class SubOsCreateRequest(BaseModel):
    componente_id: int


class SubOsCreateResponse(BaseModel):
    id: int
    display_name: str
    created: bool
    congelada: bool = False


class SubOsHistoryItem(BaseModel):
    situacao: str
    setor: str
    obs: str = ""
    usuario: str


class SubOsHistoryRow(BaseModel):
    id: int
    situacao: str
    setor: str
    observacao: Optional[str] = None
    data: Optional[str] = None
    ultimo_status: bool = False
    ponto: Optional[str] = None
    usuario_nome: Optional[str] = None
    cod_status_espelho: Optional[str] = None
    source_type: Optional[str] = None
    source_cod_status: Optional[str] = None
    herdado_da_os_principal: bool = False
    criado_em: Optional[str] = None
    criado_por: Optional[str] = None


class SubOsHistoryDeleteResponse(BaseModel):
    status: str = "success"
    inherited: bool = False
    ultimo_status_id: Optional[int] = None
    still_listable: bool = True


class SubOsHistoryAddResponse(BaseModel):
    sub_history_id: int
    mirror_cod_status: str
    componente_nome: str
    display_name: str


class SubOsSummaryResponse(BaseModel):
    count: int
    has_sub_os: bool


@router.get("/os/{ano}/{id}/componentes", response_model=List[ComponenteRow])
def get_os_componentes(ano: int, id: int, include_inactive: bool = False):
    try:
        rows = load_componentes_for_os(id, ano, ativos_only=not include_inactive)
        return [ComponenteRow.model_validate(r) for r in rows]
    except Exception as exc:
        logger.error("Erro ao listar componentes OS %s/%s: %s", id, ano, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/os/{ano}/{id}/sub-os/summary", response_model=SubOsSummaryResponse)
def get_sub_os_summary(ano: int, id: int):
    try:
        cnt = count_sub_os(id, ano)
        return SubOsSummaryResponse(count=cnt, has_sub_os=cnt > 0)
    except Exception as exc:
        logger.error("Erro no summary Sub OS %s/%s: %s", id, ano, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/os/{ano}/{id}/sub-os", response_model=List[SubOsRow])
def get_os_sub_os_list(ano: int, id: int, include_inherited_only: bool = False):
    try:
        rows = list_sub_os(id, ano, listable_only=not include_inherited_only)
        return [SubOsRow.model_validate(r) for r in rows]
    except Exception as exc:
        logger.error("Erro ao listar Sub OS %s/%s: %s", id, ano, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/os/{ano}/{id}/sub-os", response_model=SubOsCreateResponse)
def create_or_get_sub_os(ano: int, id: int, body: SubOsCreateRequest):
    comp = get_componente(id, ano, body.componente_id)
    if not comp:
        raise HTTPException(status_code=404, detail="Componente não encontrado para esta OS")
    if not comp.get("ativo", True):
        raise HTTPException(status_code=400, detail="Componente inativo")

    frozen, situacao = is_os_frozen(id, ano)
    if frozen:
        raise HTTPException(
            status_code=403,
            detail=f"OS {id}/{ano} congelada ({situacao}) — Sub OS não pode ser criada",
        )

    def tx(cursor):
        return get_or_create_sub_os(
            cursor,
            nro=id,
            ano=ano,
            componente_id=body.componente_id,
        )

    try:
        from database import db

        result = db.execute_transaction([tx])[0]
        return SubOsCreateResponse.model_validate(result)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        logger.error("Erro ao criar Sub OS %s/%s: %s", id, ano, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/os/{ano}/{id}/sub-os/{sub_os_id}/history", response_model=List[SubOsHistoryRow])
def get_sub_os_history(ano: int, id: int, sub_os_id: int):
    sub = get_sub_os(id, ano, sub_os_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Sub OS não encontrada para esta OS")
    try:
        rows = list_sub_os_history(sub_os_id)
        return [SubOsHistoryRow.model_validate(r) for r in rows]
    except Exception as exc:
        logger.error("Erro histórico Sub OS %s: %s", sub_os_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/os/{ano}/{id}/sub-os/{sub_os_id}/history", response_model=SubOsHistoryAddResponse)
def add_sub_os_history_endpoint(
    ano: int, id: int, sub_os_id: int, item: SubOsHistoryItem, request: Request
):
    from services.os_edit_lock_service import (
        enforce_interactive_lock,
        release_lock_for_request,
    )

    sub = get_sub_os(id, ano, sub_os_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Sub OS não encontrada para esta OS")

    frozen, situacao = is_os_frozen(id, ano)
    if frozen or sub.get("congelada"):
        raise HTTPException(
            status_code=403,
            detail=f"OS {id}/{ano} congelada ({situacao}) — andamento de Sub OS bloqueado",
        )

    enforce_interactive_lock(request, id, ano, "andamento")

    try:
        result = add_sub_os_history(
            nro=id,
            ano=ano,
            sub_os_id=sub_os_id,
            situacao=item.situacao,
            setor=item.setor,
            obs=item.obs,
            usuario=item.usuario,
        )
        release_lock_for_request(request, id, ano)
        return SubOsHistoryAddResponse.model_validate(result)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        logger.error("Erro ao adicionar andamento Sub OS %s/%s: %s", id, ano, exc)
        if "Duplicate entry" in str(exc):
            raise HTTPException(status_code=409, detail="Erro de concorrência. Tente novamente.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/os/{ano}/{id}/sub-os/{sub_os_id}/history/{history_id}", response_model=StatusResponse)
def update_sub_os_history_blocked(ano: int, id: int, sub_os_id: int, history_id: int):
    """Edição de andamento Sub OS não implementada na fase 1 (espelho MDB)."""
    raise HTTPException(
        status_code=405,
        detail="Edição de andamento de Sub OS não disponível nesta versão",
    )


@router.delete(
    "/os/{ano}/{id}/sub-os/{sub_os_id}/history/{history_id}",
    response_model=SubOsHistoryDeleteResponse,
)
@router.post(
    "/os/{ano}/{id}/sub-os/{sub_os_id}/history/{history_id}/delete",
    response_model=SubOsHistoryDeleteResponse,
)
def delete_sub_os_history_endpoint(ano: int, id: int, sub_os_id: int, history_id: int):
    sub = get_sub_os(id, ano, sub_os_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Sub OS não encontrada para esta OS")

    try:
        result = delete_sub_os_history(
            nro=id,
            ano=ano,
            sub_os_id=sub_os_id,
            history_id=history_id,
        )
        return SubOsHistoryDeleteResponse(
            status="success",
            inherited=bool(result.get("inherited")),
            ultimo_status_id=result.get("ultimo_status_id"),
            still_listable=bool(result.get("still_listable", True)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        logger.error("Erro ao excluir andamento Sub OS %s/%s: %s", id, ano, exc)
        raise HTTPException(status_code=500, detail=str(exc))

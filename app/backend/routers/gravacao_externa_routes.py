"""Rotas da funcionalidade Gravação Externa."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from security.session_auth import SessionData, require_session

from routers.andamento_helpers import format_ponto
from routers.setor_painel_routes import fetch_user_fornecedor
from services.gravacao_externa_service import (
    ALLOWED_EXTENSIONS,
    add_mensagem,
    build_session_detail,
    concluir_gravacao,
    get_active_session,
    get_arquivo_for_session,
    iniciar_gravacao,
    lancar_entrega_chapas,
    list_mensagens,
    list_os_gravacao_aguardando_entrega,
    list_os_gravacao_externa,
    render_session_composite_preview,
    remove_externa_from_queue,
    get_or_build_preview_png,
    require_session_access,
    resolve_active_session,
    resolve_arquivo_absolute_path,
    session_allows_operacao_fornecedor,
    update_session_arquivos,
    user_can_access_session,
    user_can_send_mensagem,
    _fetch_arquivos,
)
from services.gravacao_externa_zip_job_service import (
    ZIP_READY,
    enqueue_zip_job,
    get_zip_job_status,
    mark_zip_downloaded,
    resolve_ready_zip,
    zip_etag,
)
from services.os_vinculo_grupo_service import _clean_ponto

router = APIRouter()
logger = logging.getLogger(__name__)


class GravacaoExternaOsMembro(BaseModel):
    nr_os: int
    ano: int


class GravacaoExternaOsItem(BaseModel):
    nr_os: int
    ano: int
    solicitante: Optional[str] = None
    produto: Optional[str] = None
    titulo: Optional[str] = None
    situacao: Optional[str] = None
    setor: Optional[str] = None
    last_update: Optional[datetime] = None
    gravacao_externa_id: Optional[int] = None
    gravacao_status: str = "sem_sessao"
    componente: Literal["todos", "capa", "miolo"] = "todos"
    lancado_por_ponto: Optional[str] = None
    lancado_por_nome: Optional[str] = None
    fornecedor_ponto: Optional[str] = None
    fornecedor_nome: Optional[str] = None
    concluida_em: Optional[datetime] = None
    concluida_por_ponto: Optional[str] = None
    gravacao_criado_em: Optional[datetime] = None
    chapas_por_maquina: Optional[List[dict]] = None
    total_chapas: Optional[int] = None
    juntada_grupo_id: Optional[str] = None
    membros: List[GravacaoExternaOsMembro] = []


class GravacaoExternaOsListResponse(BaseModel):
    items: List[GravacaoExternaOsItem]
    total: int
    limit: int
    offset: int


class GravacaoExternaEntregaBody(BaseModel):
    recebido_por_ponto: str = Field(..., min_length=1)
    recebido_por_nome: str = Field(..., min_length=1, max_length=128)


class GravacaoExternaArquivoItem(BaseModel):
    id: int
    relative: str
    absolute_path: Optional[str] = None
    nome: str
    tamanho_bytes: Optional[int] = None
    ordem: int = 0
    maquina: Optional[str] = None


class GravacaoExternaMensagemItem(BaseModel):
    id: int
    autor_ponto: str
    autor_nome: Optional[str] = None
    autor_papel: str
    mensagem: str
    criado_em: Optional[datetime] = None


class GravacaoExternaDetailResponse(BaseModel):
    id: int
    os_ano: int
    os_nro: int
    cod_status: str
    componente: Literal["todos", "capa", "miolo"] = "todos"
    lancado_por_ponto: str
    lancado_por_nome: Optional[str] = None
    status: str
    iniciado_por_ponto: Optional[str] = None
    iniciado_em: Optional[datetime] = None
    criado_em: Optional[datetime] = None
    origem_pendente_id: Optional[int] = None
    fornecedor_ponto: Optional[str] = None
    concluida_em: Optional[datetime] = None
    concluida_por_ponto: Optional[str] = None
    entrega_lancada_em: Optional[datetime] = None
    recebido_por_ponto: Optional[str] = None
    recebido_por_nome: Optional[str] = None
    pagamento_nf_em: Optional[datetime] = None
    observacao: Optional[str] = None
    arquivos: List[GravacaoExternaArquivoItem]
    mensagens: List[GravacaoExternaMensagemItem]


class GravacaoExternaMensagemCreate(BaseModel):
    mensagem: str = Field(..., min_length=1, max_length=8000)


class GravacaoExternaArquivoInput(BaseModel):
    absolute_path: str
    nome: str
    maquina: Optional[str] = None


class GravacaoExternaArquivosUpdate(BaseModel):
    arquivos: List[GravacaoExternaArquivoInput] = Field(..., min_length=1)


class GravacaoExternaZipStatusResponse(BaseModel):
    status: str
    assinatura: str
    nome_arquivo: Optional[str] = None
    tamanho_bytes: Optional[int] = None
    total_arquivos: int = 0
    arquivos_prontos: int = 0
    bytes_prontos: int = 0
    erro: Optional[str] = None
    etag: Optional[str] = None


class GravacaoExternaQueueRemovalResponse(BaseModel):
    removed: bool
    gravacao_externa_id: int
    removed_ids: List[int] = Field(default_factory=list)
    juntada_grupo_id: Optional[str] = None


def _get_request_session(request: Request) -> SessionData:
    session = getattr(request.state, "sagra_session", None)
    if isinstance(session, SessionData):
        return session
    return require_session(request)


def _session_ponto(request: Request) -> str:
    return str(_get_request_session(request).ponto)


def _has_view_permission(request: Request) -> bool:
    perms = getattr(request.state, "sagra_permissions", None) or {}
    return bool(perms.get("sb_gravacao_externa"))


def _has_operator_permission(request: Request) -> bool:
    perms = getattr(request.state, "sagra_permissions", None) or {}
    return bool(perms.get("sb_gravacao_externa_operador"))


def _has_entrega_permission(request: Request) -> bool:
    perms = getattr(request.state, "sagra_permissions", None) or {}
    return bool(perms.get("sb_gravacao_externa_entrega"))


def _require_view_permission(request: Request) -> None:
    if not _has_view_permission(request):
        raise HTTPException(status_code=403, detail="Permissão Gravação Externa necessária.")


def _require_entrega_permission(request: Request) -> None:
    if not _has_entrega_permission(request):
        raise HTTPException(
            status_code=403,
            detail="Permissão para lançar recebimento das chapas necessária.",
        )


def _require_operator_permission(request: Request) -> None:
    if not _has_operator_permission(request):
        raise HTTPException(
            status_code=403,
            detail="Permissão de operador de Gravação Externa necessária.",
        )


def _require_pending_queue_management_permission(request: Request) -> None:
    perms = getattr(request.state, "sagra_permissions", None) or {}
    if not perms.get("sb_gravacao_pendente"):
        raise HTTPException(
            status_code=403,
            detail="Permissão Gravações Pendentes necessária.",
        )
    if fetch_user_fornecedor(_session_ponto(request)):
        raise HTTPException(
            status_code=403,
            detail="Fornecedor não pode remover OS da fila do Birô.",
        )


def _maybe_iniciar_on_download(request: Request, ano: int, os_id: int, session: dict) -> None:
    """Marca gravação como iniciada ao baixar arquivos (idempotente se já iniciada)."""
    if str(session.get("status") or "") != "pendente":
        return
    try:
        iniciar_gravacao(
            ano=ano,
            os_id=os_id,
            operador_ponto=_session_ponto(request),
            gravacao_externa_id=int(session["id"]),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "Falha ao auto-iniciar gravação no download OS %s/%s: %s",
            os_id,
            ano,
            exc,
        )


def _require_operator_or_assigned_fornecedor(request: Request, session: dict) -> None:
    if _has_operator_permission(request):
        return
    if session_allows_operacao_fornecedor(session, _session_ponto(request)):
        return
    raise HTTPException(
        status_code=403,
        detail="Permissão de operador ou fornecedor atribuído necessária.",
    )


def _require_view_or_fornecedor_access(request: Request, session: dict) -> None:
    """Visualização: Gravação Externa ou fornecedor atribuído à sessão."""
    if _has_view_permission(request):
        return
    if session_allows_operacao_fornecedor(session, _session_ponto(request)):
        return
    raise HTTPException(
        status_code=403,
        detail="Acesso negado à sessão de Gravação Externa.",
    )


def _caller_fornecedor_ponto(request: Request) -> Optional[str]:
    ponto = _session_ponto(request)
    if fetch_user_fornecedor(ponto):
        return format_ponto(_clean_ponto(ponto)) or str(ponto).strip()
    return None


def _resolve_route_active_session(
    ano: int,
    os_id: int,
    gravacao_externa_id: int | None,
) -> dict | None:
    """Preserva clientes legados por OS e usa identidade exata nos clientes novos."""
    if gravacao_externa_id is None:
        return get_active_session(ano, os_id)
    return resolve_active_session(ano, os_id, gravacao_externa_id)


@router.get("/gravacao-externa/os", response_model=GravacaoExternaOsListResponse)
def list_gravacao_externa_os(
    request: Request,
    ano: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_view_permission(request)
    items, total = list_os_gravacao_externa(
        ano=ano,
        search=search,
        limit=limit,
        offset=offset,
        fornecedor_ponto=_caller_fornecedor_ponto(request),
    )
    return GravacaoExternaOsListResponse(
        items=[GravacaoExternaOsItem.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/gravacao-externa/aguardando-entrega",
    response_model=GravacaoExternaOsListResponse,
)
def list_gravacao_externa_aguardando_entrega(
    request: Request,
    ano: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_view_permission(request)
    # Quem tem permissão de recebimento vê todas; fornecedor sem ela vê só as suas.
    fornecedor_filter = (
        None
        if _has_entrega_permission(request)
        else _caller_fornecedor_ponto(request)
    )
    items, total = list_os_gravacao_aguardando_entrega(
        ano=ano,
        search=search,
        limit=limit,
        offset=offset,
        fornecedor_ponto=fornecedor_filter,
    )
    return GravacaoExternaOsListResponse(
        items=[GravacaoExternaOsItem.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/gravacao-externa/fila/{gravacao_externa_id}/remover",
    response_model=GravacaoExternaQueueRemovalResponse,
)
def post_remover_gravacao_externa_fila(
    request: Request,
    gravacao_externa_id: int,
):
    _require_pending_queue_management_permission(request)
    try:
        result = remove_externa_from_queue(gravacao_externa_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.info(
        "Fila do Birô removida por %s: sessão=%s, sessões_afetadas=%s",
        _session_ponto(request),
        gravacao_externa_id,
        result.get("removed_ids"),
    )
    return GravacaoExternaQueueRemovalResponse.model_validate(result)


@router.get("/gravacao-externa/{ano}/{id}", response_model=GravacaoExternaDetailResponse)
def get_gravacao_externa_detail(
    request: Request,
    ano: int,
    id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _resolve_route_active_session(ano, id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Externa não encontrada.")
    _require_view_or_fornecedor_access(request, session)
    detail = build_session_detail(session)
    return GravacaoExternaDetailResponse.model_validate(detail)


@router.post("/gravacao-externa/{ano}/{id}/iniciar", response_model=GravacaoExternaDetailResponse)
def post_iniciar_gravacao(
    request: Request,
    ano: int,
    id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _resolve_route_active_session(ano, id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Externa não encontrada.")
    _require_operator_or_assigned_fornecedor(request, session)
    ponto = _session_ponto(request)
    detail = iniciar_gravacao(
        ano=ano,
        os_id=id,
        operador_ponto=ponto,
        gravacao_externa_id=gravacao_externa_id,
    )
    return GravacaoExternaDetailResponse.model_validate(detail)


@router.put("/gravacao-externa/{ano}/{id}/arquivos", response_model=GravacaoExternaDetailResponse)
def put_gravacao_externa_arquivos(
    request: Request,
    ano: int,
    id: int,
    body: GravacaoExternaArquivosUpdate,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    ponto = _session_ponto(request)
    is_operator = _has_operator_permission(request)
    session = _resolve_route_active_session(ano, id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Externa não encontrada.")
    require_session_access(
        session,
        ponto=ponto,
        has_operator_permission=is_operator,
    )
    detail = update_session_arquivos(
        ano=ano,
        os_id=id,
        arquivos=[
            {
                "absolute_path": a.absolute_path,
                "nome": a.nome,
                "maquina": a.maquina,
            }
            for a in body.arquivos
        ],
        gravacao_externa_id=gravacao_externa_id,
    )
    return GravacaoExternaDetailResponse.model_validate(detail)


@router.post("/gravacao-externa/{ano}/{id}/concluir", response_model=GravacaoExternaDetailResponse)
def post_concluir_gravacao(
    request: Request,
    ano: int,
    id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _resolve_route_active_session(ano, id, gravacao_externa_id)
    if gravacao_externa_id is not None and not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Externa não encontrada.")
    if session:
        _require_operator_or_assigned_fornecedor(request, session)
    else:
        # Sem sessão/arquivos: só operador (não fornecedor).
        _require_operator_permission(request)
    ponto = _session_ponto(request)
    detail = concluir_gravacao(
        ano=ano,
        os_id=id,
        operador_ponto=ponto,
        gravacao_externa_id=gravacao_externa_id,
    )
    return GravacaoExternaDetailResponse.model_validate(detail)


@router.post(
    "/gravacao-externa/{ano}/{id}/entrega-chapas",
    response_model=GravacaoExternaDetailResponse,
)
def post_entrega_chapas(
    request: Request,
    ano: int,
    id: int,
    body: GravacaoExternaEntregaBody,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    _require_view_permission(request)
    _require_entrega_permission(request)
    detail = lancar_entrega_chapas(
        ano=ano,
        os_id=id,
        recebido_por_ponto=body.recebido_por_ponto,
        recebido_por_nome=body.recebido_por_nome,
        gravacao_externa_id=gravacao_externa_id,
    )
    return GravacaoExternaDetailResponse.model_validate(detail)


@router.get("/gravacao-externa/{ano}/{id}/mensagens", response_model=List[GravacaoExternaMensagemItem])
def get_gravacao_externa_mensagens(
    request: Request,
    ano: int,
    id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    ponto = _session_ponto(request)
    is_operator = _has_operator_permission(request)
    msgs = list_mensagens(
        ano=ano,
        os_id=id,
        ponto=ponto,
        is_operator=is_operator,
        has_view_permission=_has_view_permission(request),
        gravacao_externa_id=gravacao_externa_id,
    )
    return [GravacaoExternaMensagemItem.model_validate(m) for m in msgs]


@router.post("/gravacao-externa/{ano}/{id}/mensagens", response_model=GravacaoExternaMensagemItem)
def post_gravacao_externa_mensagem(
    request: Request,
    ano: int,
    id: int,
    body: GravacaoExternaMensagemCreate,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    ponto = _session_ponto(request)
    has_view = _has_view_permission(request)
    session = _resolve_route_active_session(ano, id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Externa não encontrada.")
    is_fornecedor = fetch_user_fornecedor(ponto)
    if not user_can_send_mensagem(
        session,
        ponto=ponto,
        has_view_permission=has_view,
        is_fornecedor=is_fornecedor,
    ):
        raise HTTPException(status_code=403, detail="Acesso negado.")
    msg = add_mensagem(
        ano=ano,
        os_id=id,
        ponto=ponto,
        mensagem=body.mensagem,
        has_view_permission=has_view,
        is_fornecedor=is_fornecedor,
        gravacao_externa_id=gravacao_externa_id,
    )
    return GravacaoExternaMensagemItem.model_validate(msg)


def _require_zip_session(
    request: Request,
    ano: int,
    os_id: int,
    gravacao_externa_id: int | None = None,
) -> dict:
    session = _resolve_route_active_session(ano, os_id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    _require_operator_or_assigned_fornecedor(request, session)
    return session


def _zip_file_response(row: dict) -> FileResponse:
    mark_zip_downloaded(int(row["gravacao_externa_id"]))
    return FileResponse(
        str(row["arquivo_path"]),
        media_type="application/zip",
        filename=str(row.get("nome_arquivo") or "arquivos.zip"),
        content_disposition_type="attachment",
        headers={
            "etag": zip_etag(str(row["assinatura"])),
            "Cache-Control": "private, max-age=0, must-revalidate",
        },
    )


@router.post(
    "/gravacao-externa/{ano}/{id}/arquivos/zip",
    response_model=GravacaoExternaZipStatusResponse,
)
def post_gravacao_externa_zip(
    request: Request,
    ano: int,
    id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _require_zip_session(request, ano, id, gravacao_externa_id)
    _maybe_iniciar_on_download(request, ano, id, session)
    job = enqueue_zip_job(session)
    payload = GravacaoExternaZipStatusResponse.model_validate(job)
    status_code = 200 if job.get("status") == ZIP_READY else 202
    return JSONResponse(status_code=status_code, content=payload.model_dump())


@router.get(
    "/gravacao-externa/{ano}/{id}/arquivos/zip",
    response_model=GravacaoExternaZipStatusResponse,
)
def get_gravacao_externa_zip(
    request: Request,
    ano: int,
    id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _require_zip_session(request, ano, id, gravacao_externa_id)
    job = get_zip_job_status(session)
    return GravacaoExternaZipStatusResponse.model_validate(job)


@router.get("/gravacao-externa/{ano}/{id}/arquivos/zip/download")
def download_gravacao_externa_zip(
    request: Request,
    ano: int,
    id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _require_zip_session(request, ano, id, gravacao_externa_id)
    row = resolve_ready_zip(session)
    if not row:
        raise HTTPException(
            status_code=409,
            detail="O ZIP ainda está sendo preparado. Aguarde e tente novamente.",
        )
    return _zip_file_response(row)


@router.get("/gravacao-externa/{ano}/{id}/arquivos/download-all")
def download_all_gravacao_externa_arquivos(
    request: Request,
    ano: int,
    id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _require_zip_session(request, ano, id, gravacao_externa_id)
    _maybe_iniciar_on_download(request, ano, id, session)
    row = resolve_ready_zip(session)
    if row:
        return _zip_file_response(row)
    enqueue_zip_job(session)
    raise HTTPException(
        status_code=409,
        detail="O ZIP ainda está sendo preparado. Aguarde e tente novamente.",
    )


@router.get("/gravacao-externa/{ano}/{id}/arquivos/{arq_id}/download")
def download_gravacao_externa_arquivo(
    request: Request,
    ano: int,
    id: int,
    arq_id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _resolve_route_active_session(ano, id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    _require_operator_or_assigned_fornecedor(request, session)
    _maybe_iniciar_on_download(request, ano, id, session)
    arquivo = get_arquivo_for_session(session, arq_id)
    path = resolve_arquivo_absolute_path(session, arquivo)
    ext = path.rsplit(".", 1)[-1].lower()
    media = "application/pdf" if ext == "pdf" else "image/tiff"
    return FileResponse(
        path,
        media_type=media,
        filename=arquivo["nome"],
        content_disposition_type="attachment",
    )


@router.get("/gravacao-externa/{ano}/{id}/arquivos/{arq_id}/preview")
def preview_gravacao_externa_arquivo(
    request: Request,
    ano: int,
    id: int,
    arq_id: int,
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _resolve_route_active_session(ano, id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    _require_view_or_fornecedor_access(request, session)
    arquivo = get_arquivo_for_session(session, arq_id)
    path = resolve_arquivo_absolute_path(session, arquivo)
    ext = "." + path.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=403, detail="Tipo não permitido.")
    if ext == ".pdf":
        return FileResponse(
            path,
            media_type="application/pdf",
            filename=arquivo["nome"],
            content_disposition_type="inline",
        )
    png_bytes = get_or_build_preview_png(path, filename=arquivo["nome"])
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/gravacao-externa/{ano}/{id}/preview-composite")
def preview_gravacao_externa_composite(
    request: Request,
    ano: int,
    id: int,
    group_key: str = Query(..., min_length=1),
    gravacao_externa_id: Optional[int] = Query(None, ge=1),
):
    session = _resolve_route_active_session(ano, id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    _require_view_or_fornecedor_access(request, session)
    arquivos = _fetch_arquivos(int(session["id"]))
    png_bytes = render_session_composite_preview(session, group_key, arquivos)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )

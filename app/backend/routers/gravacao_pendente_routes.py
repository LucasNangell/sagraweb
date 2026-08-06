"""Rotas da funcionalidade Gravação Pendente."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from security.session_auth import SessionData, require_session
from services.gravacao_externa_service import (
    ALLOWED_EXTENSIONS,
    get_or_build_preview_png,
    render_session_composite_preview,
)
from services.gravacao_pendente_service import (
    _fetch_pendente_arquivos,
    build_historico_cota_summary,
    build_pendente_detail,
    delete_controle_lancamento,
    enviar_para_gravacao_externa,
    estimate_chapas_from_validated_arquivos,
    get_active_pendente_session,
    get_detalhes_config,
    list_fornecedores,
    list_historico_concluidas,
    list_os_gravacao_pendente,
    recalc_cotas_from_fornecedores,
    require_pendente_session_access,
    update_controle_lancamento,
    update_cota_inicial_chapas,
    update_pagamento_nf,
    update_pendente_session_arquivos,
    upsert_fornecedor_cota,
    upsert_maquina_config,
    user_can_access_pendente_session,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class GravacaoPendenteOsMembro(BaseModel):
    nr_os: int
    ano: int


class GravacaoPendenteOsItem(BaseModel):
    nr_os: int
    ano: int
    solicitante: Optional[str] = None
    produto: Optional[str] = None
    situacao: Optional[str] = None
    setor: Optional[str] = None
    last_update: Optional[datetime] = None
    gravacao_pendente_id: Optional[int] = None
    gravacao_pendente_status: str = "sem_sessao"
    lancado_por_ponto: Optional[str] = None
    lancado_por_nome: Optional[str] = None
    gravacao_criado_em: Optional[datetime] = None
    juntada_grupo_id: Optional[str] = None
    membros: List[GravacaoPendenteOsMembro] = []


class GravacaoPendenteOsListResponse(BaseModel):
    items: List[GravacaoPendenteOsItem]
    total: int
    limit: int
    offset: int


class GravacaoPendenteArquivoItem(BaseModel):
    id: int
    absolute_path: str
    nome: str
    tamanho_bytes: Optional[int] = None
    ordem: int = 0
    maquina: Optional[str] = None


class GravacaoPendenteChapaItem(BaseModel):
    id: int
    maquina: str
    quantidade: int


class GravacaoPendenteDetailResponse(BaseModel):
    id: int
    os_ano: int
    os_nro: int
    cod_status: str
    lancado_por_ponto: str
    lancado_por_nome: Optional[str] = None
    status: str
    enviada_em: Optional[datetime] = None
    enviada_por_ponto: Optional[str] = None
    criado_em: Optional[datetime] = None
    arquivos: List[GravacaoPendenteArquivoItem]
    chapas: List[GravacaoPendenteChapaItem]


class GravacaoPendenteHistoricoItem(BaseModel):
    gravacao_pendente_id: Optional[int] = None
    gravacao_externa_id: Optional[int] = None
    ano: int
    nr_os: int
    juntada_grupo_id: Optional[str] = None
    membros: List[GravacaoPendenteOsMembro] = Field(default_factory=list)
    solicitante: Optional[str] = None
    titulo: Optional[str] = None
    lancado_por_ponto: Optional[str] = None
    lancado_por_nome: Optional[str] = None
    iniciado_por_ponto: Optional[str] = None
    iniciado_em: Optional[datetime] = None
    criado_em: Optional[datetime] = None
    enviada_em: Optional[datetime] = None
    fornecedor_ponto: Optional[str] = None
    fornecedor_nome: Optional[str] = None
    concluida_em: Optional[datetime] = None
    entrega_lancada_em: Optional[datetime] = None
    recebido_por_ponto: Optional[str] = None
    recebido_por_nome: Optional[str] = None
    pagamento_nf_em: Optional[datetime] = None
    total_chapas: int = 0
    chapas_por_maquina: List[dict] = Field(default_factory=list)


class GravacaoPendenteFornecedorItem(BaseModel):
    ponto: str
    nome: Optional[str] = None


class GravacaoPendenteFornecedoresResponse(BaseModel):
    items: List[GravacaoPendenteFornecedorItem]


class GravacaoPendenteMaquinaCotaItem(BaseModel):
    maquina: str
    cota_chapas: int = 0
    chapas_restantes: int = 0


class GravacaoPendenteHistoricoResponse(BaseModel):
    items: List[GravacaoPendenteHistoricoItem]
    total: int
    total_chapas_geral: int
    cota_inicial_chapas: int = 0
    chapas_restantes: int = 0
    maquinas: List[GravacaoPendenteMaquinaCotaItem] = Field(default_factory=list)
    limit: int
    offset: int


class GravacaoPendenteCotaAdjustBody(BaseModel):
    mode: Literal["set", "inc", "dec"] = "inc"
    valor: int = Field(..., ge=0)
    observacao: str = Field(..., min_length=1)


class GravacaoPendenteCotaSummaryResponse(BaseModel):
    cota_inicial_chapas: int
    total_chapas_geral: int
    chapas_restantes: int
    maquinas: List[GravacaoPendenteMaquinaCotaItem] = Field(default_factory=list)


class GravacaoPendenteMaquinaConfigItem(BaseModel):
    maquina: str
    cota_chapas: int = 0
    preco_chapa: float = Field(0, ge=0)


class GravacaoPendenteMaquinaPrecoItem(BaseModel):
    maquina: str
    preco_chapa: float = Field(..., ge=0)


class GravacaoPendenteMaquinasConfigBody(BaseModel):
    items: List[GravacaoPendenteMaquinaPrecoItem] = Field(..., min_length=1)


class GravacaoPendenteFornecedorCotaItem(BaseModel):
    ponto: str = Field(..., min_length=1)
    maquina: str = Field(..., min_length=1)
    cota_chapas: int = Field(..., ge=0)
    preco_chapa: float = Field(0, ge=0)


class GravacaoPendenteFornecedorCotasMap(BaseModel):
    Komori: int = 0
    SM74: int = 0
    PM52: int = 0


class GravacaoPendenteFornecedorPrecosMap(BaseModel):
    Komori: float = 0
    SM74: float = 0
    PM52: float = 0


class GravacaoPendenteFornecedorCotaDetalhe(BaseModel):
    ponto: str
    nome: Optional[str] = None
    cotas: GravacaoPendenteFornecedorCotasMap = Field(
        default_factory=GravacaoPendenteFornecedorCotasMap
    )
    precos: GravacaoPendenteFornecedorPrecosMap = Field(
        default_factory=GravacaoPendenteFornecedorPrecosMap
    )


class GravacaoPendenteFornecedorCotasBody(BaseModel):
    items: List[GravacaoPendenteFornecedorCotaItem] = Field(..., min_length=1)


class GravacaoPendenteConfigDetalhesResponse(BaseModel):
    cota_inicial_chapas: int
    total_chapas_geral: int
    chapas_restantes: int
    maquinas: List[GravacaoPendenteMaquinaConfigItem] = Field(default_factory=list)
    fornecedor_cotas: List[GravacaoPendenteFornecedorCotaDetalhe] = Field(default_factory=list)


class GravacaoPendentePagamentoNfBody(BaseModel):
    pagamento_nf_em: Optional[datetime] = None


class GravacaoPendentePagamentoNfResponse(BaseModel):
    gravacao_externa_id: int
    pagamento_nf_em: Optional[datetime] = None


class GravacaoPendenteControleChapaBody(BaseModel):
    maquina: str
    quantidade: int = Field(..., ge=1)


class GravacaoPendenteControleUpdateBody(BaseModel):
    chapas: List[GravacaoPendenteControleChapaBody] = Field(default_factory=list)
    criado_em: Optional[datetime] = None
    enviada_em: Optional[datetime] = None
    fornecedor_ponto: Optional[str] = None
    concluida_em: Optional[datetime] = None
    entrega_lancada_em: Optional[datetime] = None
    recebido_por_ponto: Optional[str] = None
    recebido_por_nome: Optional[str] = None
    pagamento_nf_em: Optional[datetime] = None


class GravacaoPendenteControleUpdateResponse(BaseModel):
    gravacao_pendente_id: int
    updated_pendente_ids: List[int] = Field(default_factory=list)
    updated_externa_ids: List[int] = Field(default_factory=list)
    juntada_grupo_id: Optional[str] = None
    chapas: List[dict] = Field(default_factory=list)
    total_chapas: int = 0
    criado_em: Optional[datetime] = None
    enviada_em: Optional[datetime] = None
    fornecedor_ponto: Optional[str] = None
    concluida_em: Optional[datetime] = None
    entrega_lancada_em: Optional[datetime] = None
    recebido_por_ponto: Optional[str] = None
    recebido_por_nome: Optional[str] = None
    pagamento_nf_em: Optional[datetime] = None


class EnviarGravacaoExternaBody(BaseModel):
    setor: str = Field(default="Grav. Externa", min_length=1)
    fornecedor_ponto: Optional[str] = None


class GravacaoPendenteChapaInput(BaseModel):
    maquina: str
    quantidade: int


class GravacaoPendenteArquivoInput(BaseModel):
    absolute_path: str
    nome: str
    maquina: Optional[str] = None


class GravacaoPendenteArquivosUpdate(BaseModel):
    arquivos: List[GravacaoPendenteArquivoInput] = Field(..., min_length=1)
    chapas: Optional[List[GravacaoPendenteChapaInput]] = None


class GravacaoPendenteChapasEstimateResponse(BaseModel):
    total_chapas: int = 0
    fonte: str = "none"
    # Quando fonte=pdf: soma de páginas (= conjuntos de separação esperados).
    # Null quando a estimate não veio só de PDF.
    pdf_page_count: Optional[int] = None
    # Soma de tintas detectadas por página (chapas/TIFs esperados). Null se indisponível.
    expected_plate_count: Optional[int] = None
    ink_analysis_status: Optional[str] = None


def _has_pendente_permission(request: Request) -> bool:
    perms = getattr(request.state, "sagra_permissions", None) or {}
    return bool(perms.get("sb_gravacao_pendente"))


def _get_request_session(request: Request) -> SessionData:
    session = getattr(request.state, "sagra_session", None)
    if isinstance(session, SessionData):
        return session
    return require_session(request)


def _require_pendente_permission(request: Request) -> None:
    perms = getattr(request.state, "sagra_permissions", None) or {}
    if not perms.get("sb_gravacao_pendente"):
        raise HTTPException(status_code=403, detail="Permissão Gravações Pendentes necessária.")


def _require_controle_delete_permission(request: Request) -> None:
    _require_pendente_permission(request)
    perms = getattr(request.state, "sagra_permissions", None) or {}
    if not perms.get("sb_gravacao_pendente_excluir"):
        raise HTTPException(
            status_code=403,
            detail="Permissão para excluir o controle de chapas necessária.",
        )


def _require_lancar_externa_permission(request: Request) -> None:
    _require_pendente_permission(request)
    perms = getattr(request.state, "sagra_permissions", None) or {}
    if not perms.get("sb_gravacao_externa_lancar"):
        raise HTTPException(
            status_code=403,
            detail="Permissão para lançar gravação externa necessária.",
        )


@router.get("/gravacao-pendente/os", response_model=GravacaoPendenteOsListResponse)
def list_gravacao_pendente_os(
    request: Request,
    ano: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_pendente_permission(request)
    items, total = list_os_gravacao_pendente(
        ano=ano, search=search, limit=limit, offset=offset,
    )
    return GravacaoPendenteOsListResponse(
        items=[GravacaoPendenteOsItem.model_validate(i) for i in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/gravacao-pendente/historico", response_model=GravacaoPendenteHistoricoResponse)
def get_gravacao_pendente_historico(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_pendente_permission(request)
    items, total, total_chapas = list_historico_concluidas(limit=limit, offset=offset)
    cota_summary = build_historico_cota_summary()
    return GravacaoPendenteHistoricoResponse(
        items=[GravacaoPendenteHistoricoItem.model_validate(i) for i in items],
        total=total,
        total_chapas_geral=total_chapas,
        cota_inicial_chapas=cota_summary["cota_inicial_chapas"],
        chapas_restantes=cota_summary["chapas_restantes"],
        maquinas=cota_summary.get("maquinas") or [],
        limit=limit,
        offset=offset,
    )


@router.get(
    "/gravacao-pendente/fornecedores",
    response_model=GravacaoPendenteFornecedoresResponse,
)
def get_gravacao_pendente_fornecedores(request: Request):
    _require_pendente_permission(request)
    items = list_fornecedores()
    return GravacaoPendenteFornecedoresResponse(
        items=[GravacaoPendenteFornecedorItem.model_validate(i) for i in items],
    )


@router.post(
    "/gravacao-pendente/historico/cota-inicial/adjust",
    response_model=GravacaoPendenteCotaSummaryResponse,
)
def post_gravacao_pendente_cota_adjust(
    request: Request,
    body: GravacaoPendenteCotaAdjustBody,
):
    _require_pendente_permission(request)
    try:
        update_cota_inicial_chapas(
            ponto=str(_get_request_session(request).ponto),
            observacao=body.observacao,
            mode=body.mode,
            valor=body.valor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    summary = build_historico_cota_summary()
    return GravacaoPendenteCotaSummaryResponse.model_validate(summary)


@router.get(
    "/gravacao-pendente/config/detalhes",
    response_model=GravacaoPendenteConfigDetalhesResponse,
)
def get_gravacao_pendente_config_detalhes(request: Request):
    _require_pendente_permission(request)
    return GravacaoPendenteConfigDetalhesResponse.model_validate(get_detalhes_config())


@router.put(
    "/gravacao-pendente/config/maquinas",
    response_model=GravacaoPendenteConfigDetalhesResponse,
)
def put_gravacao_pendente_config_maquinas(
    request: Request,
    body: GravacaoPendenteMaquinasConfigBody,
):
    _require_pendente_permission(request)
    ponto = str(_get_request_session(request).ponto)
    try:
        for item in body.items:
            upsert_maquina_config(item.maquina, item.preco_chapa, ponto)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GravacaoPendenteConfigDetalhesResponse.model_validate(get_detalhes_config())


@router.put(
    "/gravacao-pendente/config/fornecedor-cotas",
    response_model=GravacaoPendenteConfigDetalhesResponse,
)
def put_gravacao_pendente_config_fornecedor_cotas(
    request: Request,
    body: GravacaoPendenteFornecedorCotasBody,
):
    _require_pendente_permission(request)
    ponto = str(_get_request_session(request).ponto)
    try:
        for item in body.items:
            upsert_fornecedor_cota(
                item.ponto,
                item.maquina,
                item.cota_chapas,
                ponto,
                preco_chapa=item.preco_chapa,
                recalc=False,
            )
        recalc_cotas_from_fornecedores(ponto_atualizador=ponto)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GravacaoPendenteConfigDetalhesResponse.model_validate(get_detalhes_config())


@router.patch(
    "/gravacao-pendente/controle/{gravacao_externa_id}/pagamento-nf",
    response_model=GravacaoPendentePagamentoNfResponse,
)
def patch_gravacao_pendente_pagamento_nf(
    request: Request,
    gravacao_externa_id: int,
    body: GravacaoPendentePagamentoNfBody,
):
    _require_pendente_permission(request)
    try:
        result = update_pagamento_nf(
            gravacao_externa_id=gravacao_externa_id,
            pagamento_nf_em=body.pagamento_nf_em,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GravacaoPendentePagamentoNfResponse.model_validate(result)


@router.patch(
    "/gravacao-pendente/controle/{gravacao_pendente_id}",
    response_model=GravacaoPendenteControleUpdateResponse,
)
def patch_gravacao_pendente_controle(
    request: Request,
    gravacao_pendente_id: int,
    body: GravacaoPendenteControleUpdateBody,
):
    _require_pendente_permission(request)
    try:
        result = update_controle_lancamento(
            gravacao_pendente_id=gravacao_pendente_id,
            chapas=[c.model_dump() for c in body.chapas],
            criado_em=body.criado_em,
            enviada_em=body.enviada_em,
            fornecedor_ponto=body.fornecedor_ponto,
            concluida_em=body.concluida_em,
            entrega_lancada_em=body.entrega_lancada_em,
            recebido_por_ponto=body.recebido_por_ponto,
            recebido_por_nome=body.recebido_por_nome,
            pagamento_nf_em=body.pagamento_nf_em,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GravacaoPendenteControleUpdateResponse.model_validate(result)


@router.delete("/gravacao-pendente/controle/{gravacao_pendente_id}")
@router.post("/gravacao-pendente/controle/{gravacao_pendente_id}/delete")
def delete_gravacao_pendente_controle(request: Request, gravacao_pendente_id: int):
    _require_controle_delete_permission(request)
    try:
        deleted_id = delete_controle_lancamento(gravacao_pendente_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": True, "gravacao_pendente_id": deleted_id}


@router.get("/gravacao-pendente/{ano}/{id}", response_model=GravacaoPendenteDetailResponse)
def get_gravacao_pendente_detail(request: Request, ano: int, id: int):
    session = get_active_pendente_session(ano, id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Pendente não encontrada.")
    require_pendente_session_access(
        session,
        ponto=str(_get_request_session(request).ponto),
        has_pendente_permission=_has_pendente_permission(request),
    )
    detail = build_pendente_detail(session)
    return GravacaoPendenteDetailResponse.model_validate(detail)


@router.put("/gravacao-pendente/{ano}/{id}/arquivos", response_model=GravacaoPendenteDetailResponse)
def put_gravacao_pendente_arquivos(
    request: Request,
    ano: int,
    id: int,
    body: GravacaoPendenteArquivosUpdate,
):
    session = get_active_pendente_session(ano, id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Pendente não encontrada.")
    require_pendente_session_access(
        session,
        ponto=str(_get_request_session(request).ponto),
        has_pendente_permission=_has_pendente_permission(request),
    )
    detail = update_pendente_session_arquivos(
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
        chapas=(
            [
                {"maquina": c.maquina, "quantidade": c.quantidade}
                for c in body.chapas
            ]
            if body.chapas is not None
            else None
        ),
    )
    return GravacaoPendenteDetailResponse.model_validate(detail)


@router.post(
    "/gravacao-pendente/chapas/estimate",
    response_model=GravacaoPendenteChapasEstimateResponse,
)
def post_gravacao_pendente_chapas_estimate(
    request: Request,
    body: GravacaoPendenteArquivosUpdate,
):
    """
    Estima a quantidade total de chapas a partir de arquivos da rede.

    Regra:
    - Se houver TIF/TIFF: total_chapas = quantidade de arquivos TIF/TIFF.
    - Caso contrário (apenas PDFs): total_chapas = soma de páginas dos PDFs
      (= nº de conjuntos de separação esperados; pdf_page_count preenchido).
    """
    _require_pendente_permission(request)
    from services.network_files_service import validate_network_arquivos_input

    validated = validate_network_arquivos_input(
        [
            {
                "absolute_path": a.absolute_path,
                "nome": a.nome,
                "maquina": a.maquina,
            }
            for a in body.arquivos
        ]
    )
    estimate = estimate_chapas_from_validated_arquivos(validated)
    total = int(estimate.get("total_chapas") or 0)
    fonte = str(estimate.get("fonte") or "none")
    raw_pages = estimate.get("pdf_page_count")
    pdf_page_count = int(raw_pages) if raw_pages is not None else None
    raw_plates = estimate.get("expected_plate_count")
    expected_plate_count = int(raw_plates) if raw_plates is not None else None
    ink_status = estimate.get("ink_analysis_status")
    ink_analysis_status = str(ink_status) if ink_status else None
    return GravacaoPendenteChapasEstimateResponse(
        total_chapas=total,
        fonte=fonte,
        pdf_page_count=pdf_page_count,
        expected_plate_count=expected_plate_count,
        ink_analysis_status=ink_analysis_status,
    )


@router.post("/gravacao-pendente/{ano}/{id}/enviar")
def post_enviar_gravacao_externa(
    request: Request,
    ano: int,
    id: int,
    body: EnviarGravacaoExternaBody = EnviarGravacaoExternaBody(),
):
    _require_lancar_externa_permission(request)
    session = _get_request_session(request)
    from routers.gravacao_externa_routes import GravacaoExternaDetailResponse

    detail = enviar_para_gravacao_externa(
        ano=ano,
        os_id=id,
        operador_ponto=str(session.ponto),
        setor=body.setor.strip(),
        fornecedor_ponto=body.fornecedor_ponto,
    )
    return GravacaoExternaDetailResponse.model_validate(detail)


def _get_pendente_arquivo(session_id: int, arquivo_id: int) -> dict:
    from database import db

    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_pendente_arquivo
        WHERE Id = %s AND GravacaoPendenteId = %s LIMIT 1
        """,
        (arquivo_id, session_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    row = rows[0]
    return {
        "id": int(row["Id"]),
        "absolute_path": str(row.get("AbsolutePath") or ""),
        "nome": str(row.get("NomeArquivo") or ""),
    }


@router.get("/gravacao-pendente/{ano}/{id}/arquivos/{arq_id}/download")
def download_gravacao_pendente_arquivo(request: Request, ano: int, id: int, arq_id: int):
    _require_pendente_permission(request)
    session = get_active_pendente_session(ano, id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    arquivo = _get_pendente_arquivo(int(session["id"]), arq_id)
    from services.network_files_service import validate_network_arquivos_input

    path = validate_network_arquivos_input(
        [{"absolute_path": arquivo["absolute_path"], "nome": arquivo["nome"]}]
    )[0]["absolute_path"]
    ext = path.rsplit(".", 1)[-1].lower()
    media = "application/pdf" if ext == "pdf" else "image/tiff"
    return FileResponse(path, media_type=media, filename=arquivo["nome"], content_disposition_type="attachment")


@router.get("/gravacao-pendente/{ano}/{id}/arquivos/{arq_id}/preview")
def preview_gravacao_pendente_arquivo(request: Request, ano: int, id: int, arq_id: int):
    _require_pendente_permission(request)
    session = get_active_pendente_session(ano, id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    arquivo = _get_pendente_arquivo(int(session["id"]), arq_id)
    from services.network_files_service import validate_network_arquivos_input

    path = validate_network_arquivos_input(
        [{"absolute_path": arquivo["absolute_path"], "nome": arquivo["nome"]}]
    )[0]["absolute_path"]
    ext = "." + path.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=403, detail="Tipo não permitido.")
    if ext == ".pdf":
        return FileResponse(path, media_type="application/pdf", filename=arquivo["nome"], content_disposition_type="inline")
    png_bytes = get_or_build_preview_png(path, filename=arquivo["nome"])
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/gravacao-pendente/{ano}/{id}/preview-composite")
def preview_gravacao_pendente_composite(
    request: Request,
    ano: int,
    id: int,
    group_key: str = Query(..., min_length=1),
):
    _require_pendente_permission(request)
    session = get_active_pendente_session(ano, id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    arquivos = _fetch_pendente_arquivos(int(session["id"]))
    png_bytes = render_session_composite_preview(session, group_key, arquivos)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )
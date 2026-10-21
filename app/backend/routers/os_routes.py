from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from typing import Callable, List, Literal, Optional, Tuple
import logging
import os
import time
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from os_calc_fields import (
    WEB_PROTECTED_FROM_CLEAR,
    cota_protocolo_column,
    cota_repro_from_calculos,
    compute_detalhes_calc_fields,
)
from database import db
from .andamento_helpers import format_andamento_obs, format_ponto
import hashlib
from pcp_queue_service import ensure_pcp_table

from schemas.common import StatusResponse
from schemas.os import (
    DuplicateOsResponse,
    HistoryAddResponse,
    HistoryDeleteResponse,
    HistoryReplicateResponse,
    HistoryRow,
    HistoryUpdateResponse,
    NextOsIdResponse,
    OsAuditLogRow,
    OsDetailsResponse,
    OsFolderBrowseEntry,
    OsFolderBrowseResponse,
    OsFolderCreateResponse,
    OsFolderMoveExecuteRequest,
    OsFolderMoveExecuteResponse,
    OsFolderMovePreviewRequest,
    OsFolderMovePreviewResponse,
    OsFolderPlanResponse,
    OsPathResponse,
    OsSearchResponse,
    OsVersionItem,
    OsVersionsResponse,
    PanelRow,
    SaveOsResponse,
    VinculoExcecaoRequest,
    VinculoGrupoAndamento,
    VinculoGrupoAndamentosRequest,
    VinculoGrupoConfigResponse,
    VinculoItem,
    VinculoReplicacaoCheckResponse,
)
from .os_audit_service import (
    diff_changed_fields,
    fetch_audit_log,
    log_andamento_added,
    log_andamento_deleted,
    log_andamento_updated,
    log_os_duplicated,
    log_os_save,
    log_vinculo_added,
    log_vinculo_deleted,
)
from services.os_folder_structure import (
    OS_FOLDER_SUBFOLDERS,
    ensure_os_folder_on_network,
    plan_os_folder,
)
from services.os_folder_move_service import execute_folder_move, preview_folder_move

from services.os_search_export_service import (
    build_os_list_xlsx,
    fetch_all_os_search_rows,
)
from services.os_search_service import (
    OS_SEARCH_DEFAULT_LIMIT,
    OS_SEARCH_FETCH_ALL_MAX_LIMIT,
    OS_SEARCH_MAX_LIMIT,
    OS_SEARCH_MIN_LIKE_CHARS,
    _clamp_os_search_pagination,
    _dedupe_os_search_rows,
    _os_search_andamento_join_sql,
    _os_search_like_term,
    build_os_search_etag,
    execute_os_search,
)

router = APIRouter(tags=["os"])
logger = logging.getLogger(__name__)


def _dispatch_mdb_sync(
    task_name: str,
    callback: Callable[[], None],
    *,
    cod_status: str | None = None,
    nro: int | None = None,
    ano: int | None = None,
) -> None:
    from .mdb_writer import dispatch_mdb_sync

    dispatch_mdb_sync(
        task_name,
        callback,
        cod_status=cod_status,
        nro=nro,
        ano=ano,
    )


def _broadcast_os_system_update(
    nro: int,
    ano: int,
    action: str,
    *,
    setor: str | None = None,
    situacao: str | None = None,
    sub_os_id: int | None = None,
    scope: str | None = None,
) -> None:
    """
    Dispara materialização + WebSocket para clientes atualizarem lista/histórico.

    Qualquer alteração em tabAndamento deve acabar em after_andamento_changed.
    """
    from routers.realtime import broadcast_os_system_update

    broadcast_os_system_update(
        nro,
        ano,
        action,
        setor=setor,
        situacao=situacao,
        sub_os_id=sub_os_id,
        scope=scope,
        origem="api",
    )


def _parse_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on", "sim")


# --- New Endpoint for ID Prediction ---
@router.get("/os/next_id", response_model=NextOsIdResponse)
def get_next_os_id(year: int = Query(..., description="Ano da OS"), type: str = Query("normal", enum=["normal", "papelaria"])):
    """
    Retorna o próximo ID disponível para o ano e tipo especificado.
    Normal: < 5000
    Papelaria: >= 5000
    """
    try:
        current_year = datetime.now().year
        # Se o ano solicitado for diferente do atual, apenas usamos o ano solicitado para busca,
        # mas a regra de negócio geralmente cria OS no ano corrente. 
        # Vamos assumir que criamos no ano passado via parametro se necessário, mas o default é current.
        
        query = ""
        params = (year,)
        
        if type == "papelaria":
            query = "SELECT MAX(NroProtocolo) as max_id FROM tabProtocolos WHERE AnoProtocolo = %s AND NroProtocolo >= 5000"
            start_id = 5000
        else:
            query = "SELECT MAX(NroProtocolo) as max_id FROM tabProtocolos WHERE AnoProtocolo = %s AND NroProtocolo < 5000"
            start_id = 1

        res = db.execute_query(query, params)
        max_id = res[0]['max_id'] if res and res[0]['max_id'] else 0
        
        if max_id == 0:
            next_id = start_id
        else:
            next_id = max_id + 1
            
        return NextOsIdResponse(next_id=next_id, year=year)
    except Exception as e:
        logger.error(f"Error getting next ID: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Modelo para receber o usuário na duplicação
class DuplicateRequest(BaseModel):
    usuario: str


class CalculosPayload(BaseModel):
    model_config = ConfigDict(extra="allow")


class TechSpecAcabamentoPayload(BaseModel):
    catalog_id: Optional[int] = None
    label: str = ""
    variacao_id: Optional[int] = None
    variacao_label: Optional[str] = None
    obs: Optional[str] = None


class TechSpecLotePayload(BaseModel):
    id: Optional[str] = None
    paginas: int = 0
    maquina_link: Optional[str] = None
    papel_link: Optional[str] = None
    cores_link: Optional[str] = None
    papel_desc: Optional[str] = None
    cores_desc: Optional[str] = None
    impressao: Optional[str] = None
    frente_verso: Optional[bool] = False
    formato: Optional[str] = None
    acabamentos: List[TechSpecAcabamentoPayload] = Field(default_factory=list)


class TechSpecComponentePayload(BaseModel):
    componente_id: Optional[int] = None
    nome: Optional[str] = None
    tipo: Optional[str] = None
    lotes: List[TechSpecLotePayload] = Field(default_factory=list)
    acabamentos: List[TechSpecAcabamentoPayload] = Field(default_factory=list)
    verso_em_branco: Optional[bool] = False


class TechSpecPayload(BaseModel):
    version: int = 1
    componentes: List[TechSpecComponentePayload] = Field(default_factory=list)
    acabamentosGerais: List[TechSpecAcabamentoPayload] = Field(default_factory=list)


class ProtocoloEntregaPayload(BaseModel):
    data: Optional[str] = None
    armazenado_em: Optional[str] = None
    recado_com: Optional[str] = None
    entregue_para: Optional[str] = None
    nr_ponto: Optional[str] = None
    data_entrega: Optional[str] = None
    entregue_por: Optional[str] = None
    setor: Optional[str] = None


class GravacaoPendenteArquivoInput(BaseModel):
    absolute_path: str
    nome: str
    maquina: Optional[str] = None


class GravacaoPendenteChapaInput(BaseModel):
    maquina: str
    quantidade: int = Field(..., ge=1)


class GravacaoPendenteJuntadaInput(BaseModel):
    numero: int
    ano: int


class HistoryItem(BaseModel):
    situacao: str
    setor: str
    obs: str
    usuario: str
    confirm_main_os_target: Optional[bool] = False
    unir_sub_os: Optional[bool] = False
    protocolo_entrega: Optional[ProtocoloEntregaPayload] = None
    gravacao_pendente_arquivos: Optional[List[GravacaoPendenteArquivoInput]] = None
    gravacao_pendente_chapas: Optional[List[GravacaoPendenteChapaInput]] = None
    gravacao_pendente_juntadas: Optional[List[GravacaoPendenteJuntadaInput]] = None
    gravacao_pendente_observacao_biro: Optional[str] = None
    gravacao_pendente_componente: Literal["todos", "capa", "miolo"] = "todos"
    face_token: Optional[str] = None
    from_tablet: Optional[bool] = False
    replicar_alvo: Optional[str] = None  # "juntada" | "vinculo" (default)


class OsEditLockBody(BaseModel):
    token: str = Field(..., min_length=8, max_length=64)
    origem: Optional[str] = "os_edit"


def _apply_protocolo_tab_on_andamento(cursor, nro: int, ano: int, item: HistoryItem, *, ponto: str) -> None:
    from services.os_protocolo_andamento_service import (
        ProtocoloEntregaInput,
        apply_protocolo_on_andamento,
        requires_protocolo_entrega_payload,
    )

    if requires_protocolo_entrega_payload(item.situacao) and not item.protocolo_entrega:
        raise HTTPException(
            status_code=400,
            detail="Informe os dados de entrega (protocolo_entrega) para andamento Entregue.",
        )

    entrega = None
    if item.protocolo_entrega is not None:
        entrega = ProtocoloEntregaInput.model_validate(item.protocolo_entrega.model_dump())

    try:
        apply_protocolo_on_andamento(
            cursor,
            nro,
            ano,
            item.situacao,
            obs=item.obs or "",
            ponto=ponto,
            setor=item.setor or "",
            entrega=entrega,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _sync_protocolo_andamento_fields_mdb(nro: int, ano: int, situacao: str) -> None:
    from services.os_protocolo_andamento_service import is_protocolo_andamento_situacao

    if not is_protocolo_andamento_situacao(situacao):
        return
    from .mdb_writer import sync_protocolo_andamento_fields_to_mdb

    if not sync_protocolo_andamento_fields_to_mdb(nro, ano):
        raise ValueError(
            f"Falha ao replicar campos de entrega/cancelamento no MDB para OS {nro}/{ano}"
        )


class SaveOSRequest(BaseModel):
    # Identificação para Update (opcionais para Insert)
    NroProtocolo: Optional[int] = None
    AnoProtocolo: Optional[int] = None
    
    # Dados Principais
    CodigoRequisicao: Optional[str] = None
    CategoriaLink: Optional[str] = None
    NomeUsuario: Optional[str] = None
    Titular: Optional[str] = None
    OrgInteressado: Optional[str] = None
    SiglaOrgao: Optional[str] = None
    GabSalaUsuario: Optional[str] = None
    Andar: Optional[str] = None
    Localizacao: Optional[str] = None
    RamalUsuario: Optional[str] = None
    
    DataEntrada: Optional[str] = None
    ProcessoSolicit: Optional[str] = None
    CSnro: Optional[str] = None
    TiragemSolicitada: Optional[str] = None
    TiragemFinal: Optional[str] = None
    DebitarCGRAF: Optional[bool] = False
    
    # Detalhes
    Titulo: Optional[str] = None
    TipoPublicacaoLink: Optional[str] = None
    FormatoLink: Optional[str] = None
    MaquinaLink: Optional[str] = None
    Tiragem: Optional[str] = None
    Pags: Optional[str] = None
    FrenteVerso: Optional[bool] = False
    ModelosArq: Optional[str] = None
    FormatoLink: Optional[str] = None
    
    EntregPrazoLink: Optional[str] = None
    EntregData: Optional[str] = None
    EntregPeriodo: Optional[str] = None
    ResponsavelGrafLink: Optional[str] = None
    EntregaFormaLink: Optional[str] = None
    
    PapelLink: Optional[str] = None
    PapelDescricao: Optional[str] = None
    Cores: Optional[str] = None
    CoresDescricao: Optional[str] = None
    
    DescAcabamento: Optional[str] = None
    Observ: Optional[str] = None
    ContatoTrab: Optional[str] = None
    
    # Material / Elementos
    MaterialFornecido: Optional[bool] = False
    Fotolito: Optional[bool] = False
    ModeloDobra: Optional[bool] = False
    ProvaImpressa: Optional[bool] = False
    InsumosFornecidos: Optional[str] = None
    
    ElemGrafBrasao: Optional[bool] = False
    ElemGrafTimbre: Optional[bool] = False
    ElemGrafArteGab: Optional[bool] = False
    ElemGrafAssinatura: Optional[bool] = False
    
    # Usuário que está salvando (pela sessão)
    PontoUsuario: Optional[str] = None

    # Setor do andamento "Entrada Inicial" (somente INSERT)
    SetorAndamento: Optional[str] = None

    Calculos: Optional[CalculosPayload] = None
    TechSpec: Optional[TechSpecPayload] = None


def resolve_entrada_inicial_setor(
    setor_andamento: Optional[str] = None,
    ponto: Optional[str] = None,
) -> str:
    """Setor da Entrada Inicial: payload, senão setor do usuário, senão SEFOC."""
    text = (setor_andamento or "").strip()
    if text:
        return text
    ponto_limpo = "".join(filter(str.isdigit, str(ponto or "")))
    if ponto_limpo:
        from routers.setor_painel_routes import fetch_user_setor

        user_setor = fetch_user_setor(ponto_limpo)
        if user_setor:
            return user_setor
    return "SEFOC"


_CALC_DETALHES_SQL_COLS = (
    "CalcPgs1", "CalcQtdCores1", "CalcCor1",
    "CalcPgs2", "CalcQtdCores2", "CalcCor2",
    "CalcPgs3", "CalcQtdCores3", "CalcCor3",
)


@router.get("/os/{ano}/{id}/path", response_model=OsPathResponse)
def get_os_path(ano: int, id: int):
    logger.info(f"DEBUG ENDPOINT: Request path for OS {id}/{ano}")
    try:
        path = _get_os_folder_path(ano, id)
        
        if path:
            return OsPathResponse(path=path)

        # Fallback Local
        local_path = os.path.abspath(f"storage_test/{ano}/{id}")
        if os.path.exists(local_path):
            return OsPathResponse(path=local_path)

        return OsPathResponse(path="Pasta não encontrada na rede.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting path: {e}")
        return OsPathResponse(path=f"Erro: {str(e)}")


def _normalize_os_relative_path(relative: Optional[str]) -> str:
    cleaned = (relative or "").replace("\\", "/").strip().strip("/")
    if not cleaned:
        return ""
    parts = [part for part in cleaned.split("/") if part and part != "."]
    for part in parts:
        if part == "..":
            raise HTTPException(status_code=400, detail="Caminho inválido.")
    return "/".join(parts)


def _resolve_os_relative_path(os_root: str, relative: Optional[str]) -> str:
    rel = _normalize_os_relative_path(relative)
    full = os.path.normpath(os.path.join(os_root, rel.replace("/", os.sep)))
    root_norm = os.path.normpath(os_root)
    try:
        common = os.path.commonpath([root_norm, full])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Caminho inválido.") from exc
    if common != root_norm:
        raise HTTPException(status_code=400, detail="Caminho fora da pasta da OS.")
    return full


def _resolve_os_root_path(ano: int, os_id: int) -> Optional[str]:
    from resilience.fs_timeout import FsTimeoutError, isdir_with_timeout

    path = _get_os_folder_path(ano, os_id)
    if path:
        try:
            if isdir_with_timeout(path):
                return path
        except FsTimeoutError as exc:
            raise HTTPException(
                status_code=503,
                detail="Pasta da OS indisponível na rede (timeout). Tente novamente.",
                headers={"Retry-After": "10"},
            ) from exc
    local_path = os.path.abspath(f"storage_test/{ano}/{os_id}")
    if os.path.isdir(local_path):
        return local_path
    return None


@router.get("/os/{ano}/{id}/folder-browse", response_model=OsFolderBrowseResponse)
def browse_os_folder(
    ano: int,
    id: int,
    relative: Optional[str] = Query(None, description="Subpasta relativa à raiz da OS"),
):
    os_root = _resolve_os_root_path(ano, id)
    if not os_root:
        return OsFolderBrowseResponse(
            root_path="",
            relative=_normalize_os_relative_path(relative),
            entries=[],
            error="Pasta da OS não encontrada na rede.",
        )

    rel = _normalize_os_relative_path(relative)
    try:
        target = _resolve_os_relative_path(os_root, rel)
    except HTTPException as exc:
        return OsFolderBrowseResponse(
            root_path=os_root,
            relative=rel,
            entries=[],
            error=str(exc.detail),
        )

    if not os.path.isdir(target):
        return OsFolderBrowseResponse(
            root_path=os_root,
            relative=rel,
            entries=[],
            error="Pasta não encontrada.",
        )

    try:
        names = _listdir_with_timeout(target)
    except TimeoutError:
        return OsFolderBrowseResponse(
            root_path=os_root,
            relative=rel,
            entries=[],
            error="Tempo esgotado ao listar a pasta na rede.",
        )
    except OSError as exc:
        logger.warning("Erro ao listar pasta da OS %s/%s (%s): %s", id, ano, target, exc)
        return OsFolderBrowseResponse(
            root_path=os_root,
            relative=rel,
            entries=[],
            error="Não foi possível ler o conteúdo desta pasta.",
        )

    entries: List[OsFolderBrowseEntry] = []
    for name in sorted(names, key=lambda value: value.lower()):
        if not name or name.startswith("."):
            continue
        full_path = os.path.join(target, name)
        child_rel = f"{rel}/{name}" if rel else name
        if os.path.isdir(full_path):
            entries.append(
                OsFolderBrowseEntry(name=name, type="folder", relative=child_rel)
            )
            continue
        if os.path.isfile(full_path):
            size = None
            try:
                size = os.path.getsize(full_path)
            except OSError:
                size = None
            entries.append(
                OsFolderBrowseEntry(
                    name=name,
                    type="file",
                    relative=child_rel,
                    size=size,
                )
            )

    entries.sort(key=lambda item: (0 if item.type == "folder" else 1, item.name.lower()))
    return OsFolderBrowseResponse(root_path=os_root, relative=rel, entries=entries)


def is_original_os_relative(relative: str) -> bool:
    """True se o relativo está sob uma pasta Original (ou o typo Orignal)."""
    first = (relative or "").replace("\\", "/").split("/")[0].strip()
    lowered = first.lower()
    return lowered.startswith(("original", "orignal"))


@router.get("/os/{ano}/{id}/folder-file")
def serve_os_folder_file(
    ano: int,
    id: int,
    relative: str = Query(..., description="Caminho relativo à raiz da OS, sob Original"),
):
    from security.file_access import resolve_allowed_file_path

    rel = _normalize_os_relative_path(relative)
    if not rel:
        raise HTTPException(status_code=400, detail="Caminho inválido.")
    if not is_original_os_relative(rel):
        raise HTTPException(
            status_code=403,
            detail="Somente arquivos das pastas Original podem ser abertos nesta aba.",
        )

    os_root = _resolve_os_root_path(ano, id)
    if not os_root:
        raise HTTPException(status_code=404, detail="Pasta da OS não encontrada na rede.")

    target = _resolve_os_relative_path(os_root, rel)
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")

    safe_path = resolve_allowed_file_path(target)
    return FileResponse(str(safe_path), content_disposition_type="inline")


def _fetch_os_folder_meta(ano: int, os_id: int) -> dict:
    from services.os_arquivos_service import _fetch_os_meta

    return _fetch_os_meta(ano, os_id)


@router.get("/os/{ano}/{id}/folder-plan", response_model=OsFolderPlanResponse)
def get_os_folder_plan(ano: int, id: int):
    try:
        meta = _fetch_os_folder_meta(ano, id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    plan = plan_os_folder(
        nr_os=id,
        ano=ano,
        solicitante=meta["folder_solicitante"],
        produto=meta["produto"],
        titulo=meta["titulo"],
    )
    return OsFolderPlanResponse(**plan)


@router.post("/os/{ano}/{id}/folder-create", response_model=OsFolderCreateResponse)
def create_os_folder(ano: int, id: int):
    try:
        meta = _fetch_os_folder_meta(ano, id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    existing = _resolve_os_root_path(ano, id)
    if existing:
        folder_name = os.path.basename(existing.rstrip("\\/"))
        return OsFolderCreateResponse(
            path=existing,
            folder_name=folder_name,
            created=False,
            subfolders=list(OS_FOLDER_SUBFOLDERS),
            message="A pasta da OS já existe na rede.",
        )

    try:
        path, folder_name = ensure_os_folder_on_network(
            nr_os=id,
            ano=ano,
            solicitante=meta["folder_solicitante"],
            produto=meta["produto"],
            titulo=meta["titulo"],
        )
    except Exception as exc:
        logger.error("Falha ao criar pasta da OS %s/%s: %s", id, ano, exc)
        raise HTTPException(
            status_code=500,
            detail=str(exc) or "Não foi possível criar a pasta na rede.",
        ) from exc

    return OsFolderCreateResponse(
        path=path,
        folder_name=folder_name,
        created=True,
        subfolders=list(OS_FOLDER_SUBFOLDERS),
        message="Estrutura de pastas criada com sucesso.",
    )


@router.post("/os/{ano}/{id}/folder-move/preview", response_model=OsFolderMovePreviewResponse)
def preview_os_folder_move(ano: int, id: int, body: OsFolderMovePreviewRequest):
    try:
        result = preview_folder_move(
            dest_ano=ano,
            dest_id=id,
            origem_ano=body.origem_ano,
            origem_id=body.origem_id,
            get_os_folder_path=_get_os_folder_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Erro ao pré-visualizar mover pastas %s/%s: %s", id, ano, exc)
        raise HTTPException(status_code=500, detail="Não foi possível conferir as pastas.") from exc
    return OsFolderMovePreviewResponse(**result)


@router.post("/os/{ano}/{id}/folder-move", response_model=OsFolderMoveExecuteResponse)
def move_os_folders(ano: int, id: int, body: OsFolderMoveExecuteRequest):
    try:
        result = execute_folder_move(
            dest_ano=ano,
            dest_id=id,
            origem_ano=body.origem_ano,
            origem_id=body.origem_id,
            confirm_meta_mismatch=body.confirm_meta_mismatch,
            append_repeticao_observ=body.append_repeticao_observ,
            confirm_origem_nao_concluida=body.confirm_origem_nao_concluida,
            get_os_folder_path=_get_os_folder_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        logger.error("Erro de rede ao mover pastas %s/%s: %s", id, ano, exc)
        raise HTTPException(
            status_code=500,
            detail=str(exc) or "Falha ao mover pastas na rede.",
        ) from exc
    except Exception as exc:
        logger.error("Erro ao mover pastas %s/%s: %s", id, ano, exc)
        raise HTTPException(status_code=500, detail="Não foi possível mover as pastas.") from exc

    if body.append_repeticao_observ:
        def _sync_observ_to_mdb() -> None:
            from .mdb_writer import sync_os_from_mysql_to_mdb

            sync_os_from_mysql_to_mdb(id, ano, det_fields={"Observ"})

        _dispatch_mdb_sync("os_repeticao_observ", _sync_observ_to_mdb, nro=id, ano=ano)

    return OsFolderMoveExecuteResponse(**result)


def _get_os_folder_path(ano: int, id: int) -> Optional[str]:
    """Helper para localizar a pasta da OS na rede."""
    if id >= 5000:
        base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_Papelaria_{ano}"
    else:
        base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_{ano}"
        
    os_pattern = os.path.join(base_path, f"{id:05d}*")
    
    logger.info(f"DEBUG PATH: Searching for OS {id}/{ano} in {base_path}")
    logger.info(f"DEBUG PATH: Pattern used: {os_pattern}")

    from resilience.fs_timeout import FsTimeoutError, glob_with_timeout

    try:
        found = glob_with_timeout(os_pattern)
    except FsTimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail="Pasta da OS indisponível na rede (timeout). Tente novamente.",
            headers={"Retry-After": "10"},
        ) from exc
    if found:
        logger.info(f"DEBUG PATH: Found: {found[0]}")
        return found[0]
        
    logger.info("DEBUG PATH: Not found in network.")
    return None


def require_entreg_data_for_priority(
    prazo: Optional[str],
    data_entrega: Optional[str],
) -> None:
    prazo_norm = (prazo or "").strip()
    if not prazo_norm or prazo_norm.casefold() == "normal":
        return
    if not str(data_entrega or "").strip():
        raise HTTPException(status_code=400, detail="Informe a Data Entrega.")


@router.post("/os/save", response_model=SaveOsResponse)
def save_os(data: SaveOSRequest, request: Request):
    """
    Salva uma OS (Insert ou Update).
    Se NroProtocolo e AnoProtocolo forem fornecidos e existirem -> UPDATE.
    Caso contrário -> INSERT (Gera novo ID).
    """
    # Sanitize empty strings to None to avoid DB errors or bad data
    if data.EntregData == "": data.EntregData = None
    if data.DataEntrada == "": data.DataEntrada = None
    if data.EntregPeriodo == "": data.EntregPeriodo = None
    if data.ResponsavelGrafLink == "": data.ResponsavelGrafLink = None
    if data.EntregaFormaLink == "": data.EntregaFormaLink = None
    if data.NroProtocolo == 0: data.NroProtocolo = None
    if data.AnoProtocolo == 0: data.AnoProtocolo = None

    updating_existing = False
    if data.NroProtocolo and data.AnoProtocolo:
        existing = db.execute_query(
            "SELECT 1 FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
            (data.NroProtocolo, data.AnoProtocolo),
        )
        updating_existing = bool(existing)
    if updating_existing:
        from services.os_edit_lock_service import enforce_interactive_lock

        enforce_interactive_lock(
            request, int(data.NroProtocolo), int(data.AnoProtocolo), "os_edit"
        )

    require_entreg_data_for_priority(data.EntregPrazoLink, data.EntregData)

    save_meta = {"was_insert": False}
    mdb_sync_plan = {
        "proto_fields": None,
        "det_fields": None,
        "explicit_clears": set(),
    }

    def transaction_logic(cursor):
        is_update = False
        message = "OS salva com sucesso"
        
        if data.NroProtocolo and data.AnoProtocolo:
            cursor.execute("SELECT 1 FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s", (data.NroProtocolo, data.AnoProtocolo))
            if cursor.fetchone():
                is_update = True
        
        old_proto = None
        old_det = None
        if is_update and data.NroProtocolo and data.AnoProtocolo:
            cursor.execute(
                "SELECT * FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                (data.NroProtocolo, data.AnoProtocolo),
            )
            old_proto = cursor.fetchone()
            cursor.execute(
                "SELECT * FROM tabDetalhesServico WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
                (data.NroProtocolo, data.AnoProtocolo),
            )
            old_det = cursor.fetchone()
        
        current_year = data.AnoProtocolo if data.AnoProtocolo else datetime.now().year
        
        # --- Lógica de ID para INSERT ---
        final_id = data.NroProtocolo
        
        if not is_update:
            # 1. Determinar intervalo (Papelaria vs Normal) baseado na sugestão ou default
            suggested_id = data.NroProtocolo
            is_papelaria_range = (suggested_id and suggested_id >= 5000)
            
            # 2. Buscar próximo ID real
            if is_papelaria_range:
                cursor.execute("SELECT MAX(NroProtocolo) as max_id FROM tabProtocolos WHERE AnoProtocolo = %s AND NroProtocolo >= 5000", (current_year,))
                start_id = 5000
            else:
                cursor.execute("SELECT MAX(NroProtocolo) as max_id FROM tabProtocolos WHERE AnoProtocolo = %s AND NroProtocolo < 5000", (current_year,))
                start_id = 1
                
            res = cursor.fetchone()
            max_id = res['max_id'] if res and res['max_id'] else 0
            
            if max_id == 0:
                real_next_id = start_id
            else:
                real_next_id = max_id + 1
            
            # 3. Resolver colisão ou usar real_next_id se sem sugestão
            if not suggested_id:
                final_id = real_next_id
            else:
                cursor.execute("SELECT 1 FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s", (suggested_id, current_year))
                if cursor.fetchone():
                    # Ocupado!
                    final_id = real_next_id
                    message = f"OS salva com sucesso! O número foi alterado para {final_id}/{current_year} pois {suggested_id} já estava em uso."
                else:
                    # Livre - Aceita sugestão (mesmo que seja buraco ou futuro)
                    final_id = suggested_id

        cota_estimada = cota_repro_from_calculos(data.Calculos)
        proto_nro = data.NroProtocolo if is_update else final_id
        cota_col = cota_protocolo_column(proto_nro)

        # --- CAMPOS TAB PROTOCOLOS ---
        if is_update:
            query_proto = f"""
                UPDATE tabProtocolos SET
                    CodigoRequisic=%s, CategoriaLink=%s, NomeUsuario=%s, Titular=%s, OrgInteressado=%s, SiglaOrgao=%s,
                    GabSalaUsuario=%s, Andar=%s, Localizacao=%s, RamalUsuario=%s,
                    DataEntrada=%s, ProcessoSolicit=%s, CSnro=%s,
                    EntregPrazoLink=%s, EntregData=%s, ContatoTrab=%s,
                    ResponsavelGrafLink=%s, EntregaFormaLink=%s, EntregPeriodo=%s,
                    {cota_col}=%s, DebitarCGRAF=%s
                WHERE NroProtocolo=%s AND AnoProtocolo=%s
            """
            cursor.execute(query_proto, (
                data.CodigoRequisicao, data.CategoriaLink, data.NomeUsuario, data.Titular, data.OrgInteressado, data.SiglaOrgao,
                data.GabSalaUsuario, data.Andar, data.Localizacao, data.RamalUsuario,
                data.DataEntrada, data.ProcessoSolicit, data.CSnro,
                data.EntregPrazoLink, data.EntregData, data.ContatoTrab,
                data.ResponsavelGrafLink, data.EntregaFormaLink, data.EntregPeriodo,
                cota_estimada,
                bool(data.DebitarCGRAF),
                data.NroProtocolo, data.AnoProtocolo
            ))
        else:
            query_proto = f"""
                INSERT INTO tabProtocolos (
                    NroProtocolo, AnoProtocolo,
                    CodigoRequisic, CategoriaLink, NomeUsuario, Titular, SiglaOrgao,
                    GabSalaUsuario, Andar, Localizacao, RamalUsuario,
                    DataEntrada, ProcessoSolicit, CSnro,
                    EntregPrazoLink, EntregData, ContatoTrab,
                    ResponsavelGrafLink, EntregaFormaLink, EntregPeriodo,
                    {cota_col},
                    DebitarCGRAF,
                    ReqLançada,
                    OrgInteressado
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, 'Câmara dos Deputados'))
            """
            cursor.execute(query_proto, (
                final_id, current_year,
                data.CodigoRequisicao, data.CategoriaLink, data.NomeUsuario, data.Titular, data.SiglaOrgao,
                data.GabSalaUsuario, data.Andar, data.Localizacao, data.RamalUsuario,
                data.DataEntrada, data.ProcessoSolicit, data.CSnro,
                data.EntregPrazoLink, data.EntregData, data.ContatoTrab,
                data.ResponsavelGrafLink, data.EntregaFormaLink, data.EntregPeriodo,
                cota_estimada,
                bool(data.DebitarCGRAF),
                True,
                data.OrgInteressado 
            ))

        # --- CAMPOS TAB DETALHES ---
        calc_fields = compute_detalhes_calc_fields(
            calculos=data.Calculos,
            techspec=data.TechSpec,
            cores=data.Cores,
            cores_descricao=data.CoresDescricao,
            tiragem_solicitada=data.TiragemSolicitada,
        )
        cota_total = data.TiragemFinal
        if data.Calculos is not None:
            cal_dump = (
                data.Calculos.model_dump()
                if hasattr(data.Calculos, "model_dump")
                else dict(data.Calculos)
            )
            if cal_dump.get("cota_total") not in (None, "", 0):
                cota_total = cal_dump.get("cota_total")

        cursor.execute("SELECT 1 FROM tabDetalhesServico WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s", (final_id, current_year))
        details_exist = cursor.fetchone()
        
        if details_exist:
            query_det = f"""
                UPDATE tabDetalhesServico SET
                    Titulo=%s, TipoPublicacaoLink=%s, FormatoLink=%s, MaquinaLink=%s, Tiragem=%s, Pags=%s, FrenteVerso=%s, ModelosArq=%s,
                    PapelLink=%s, PapelDescricao=%s, Cores=%s, CoresDescricao=%s,
                    DescAcabamento=%s, Observ=%s,
                    TiragemSolicitada=%s, CotaTotal=%s,
                    MaterialFornecido=%s, Fotolito=%s, ModeloDobra=%s, ProvaImpressa=%s, InsumosFornecidos=%s,
                    ElemGrafBrasao=%s, ElemGrafTimbre=%s, ElemGrafArteGab=%s, ElemGrafAssinatura=%s,
                    {", ".join(f"{c}=COALESCE(%s, {c})" for c in _CALC_DETALHES_SQL_COLS)}
                WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s
            """
            cursor.execute(query_det, (
                data.Titulo, data.TipoPublicacaoLink, data.FormatoLink, data.MaquinaLink, data.Tiragem, data.Pags, data.FrenteVerso, data.ModelosArq,
                data.PapelLink, data.PapelDescricao, data.Cores, data.CoresDescricao,
                data.DescAcabamento, data.Observ,
                calc_fields.get("TiragemSolicitada", data.TiragemSolicitada),
                cota_total,
                data.MaterialFornecido, data.Fotolito, data.ModeloDobra, data.ProvaImpressa, data.InsumosFornecidos,
                data.ElemGrafBrasao, data.ElemGrafTimbre, data.ElemGrafArteGab, data.ElemGrafAssinatura,
                *[calc_fields.get(c) for c in _CALC_DETALHES_SQL_COLS],
                final_id, current_year
            ))
        else:
            calc_cols_sql = ", ".join(_CALC_DETALHES_SQL_COLS)
            calc_placeholders = ", ".join(["%s"] * len(_CALC_DETALHES_SQL_COLS))
            query_det = f"""
                INSERT INTO tabDetalhesServico (
                    NroProtocoloLinkDet, AnoProtocoloLinkDet,
                    Titulo, TipoPublicacaoLink, FormatoLink, MaquinaLink, Tiragem, Pags, FrenteVerso, ModelosArq,
                    PapelLink, PapelDescricao, Cores, CoresDescricao,
                    DescAcabamento, Observ,
                    TiragemSolicitada, CotaTotal,
                    MaterialFornecido, Fotolito, ModeloDobra, ProvaImpressa, InsumosFornecidos,
                    ElemGrafBrasao, ElemGrafTimbre, ElemGrafArteGab, ElemGrafAssinatura,
                    {calc_cols_sql}
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, {calc_placeholders})
            """
            cursor.execute(query_det, (
                final_id, current_year,
                data.Titulo, data.TipoPublicacaoLink, data.FormatoLink, data.MaquinaLink, data.Tiragem, data.Pags, data.FrenteVerso, data.ModelosArq,
                data.PapelLink, data.PapelDescricao, data.Cores, data.CoresDescricao,
                data.DescAcabamento, data.Observ,
                calc_fields.get("TiragemSolicitada", data.TiragemSolicitada),
                cota_total,
                data.MaterialFornecido, data.Fotolito, data.ModeloDobra, data.ProvaImpressa, data.InsumosFornecidos,
                data.ElemGrafBrasao, data.ElemGrafTimbre, data.ElemGrafArteGab, data.ElemGrafAssinatura,
                *[calc_fields.get(c) for c in _CALC_DETALHES_SQL_COLS],
            ))
            
        # --- HISTÓRICO INICIAL (SE NOVO) ---
        if not is_update:
            new_cod_status = f"{final_id:05d}{current_year}-01"
            
            # Hora da criação no formato "HHhmm"
            now = datetime.now()
            hora_fmt = f"{now.hour:02d}h{now.minute:02d}"
            
            # Observação inicial
            obs_texto = f"{hora_fmt}" 

            ponto_limpo = ''.join(filter(str.isdigit, data.PontoUsuario or ''))
            ponto_fmt = format_ponto(ponto_limpo)
            setor_entrada = resolve_entrada_inicial_setor(
                data.SetorAndamento, data.PontoUsuario
            )
            
            query_hist = """
                INSERT INTO tabAndamento 
                (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto)
                VALUES (%s, %s, %s, 'Entrada Inicial', %s, NOW(), 1, %s, %s)
            """
            cursor.execute(
                query_hist,
                (new_cod_status, final_id, current_year, setor_entrada, obs_texto, ponto_fmt),
            )
            
            log_os_save(
                cursor,
                is_update=False,
                nro=final_id,
                ano=current_year,
                ponto=data.PontoUsuario,
                data=data,
            )
            log_andamento_added(
                cursor,
                nro=final_id,
                ano=current_year,
                cod_status=new_cod_status,
                situacao="Entrada Inicial",
                setor=setor_entrada,
                obs=obs_texto,
                ponto=ponto_fmt,
            )
        else:
            log_os_save(
                cursor,
                is_update=True,
                nro=data.NroProtocolo,
                ano=data.AnoProtocolo,
                ponto=data.PontoUsuario,
                data=data,
                old_proto=old_proto,
                old_det=old_det,
            )

        if data.TechSpec is not None:
            from services.os_componentes_service import sync_componentes_from_techspec

            sync_componentes_from_techspec(
                cursor,
                nro=final_id,
                ano=current_year,
                techspec=data.TechSpec,
                ponto=data.PontoUsuario,
            )

        save_meta["was_insert"] = not is_update

        if is_update:
            proto_written = {
                "CodigoRequisic": data.CodigoRequisicao,
                "CategoriaLink": data.CategoriaLink,
                "NomeUsuario": data.NomeUsuario,
                "Titular": data.Titular,
                "OrgInteressado": data.OrgInteressado,
                "SiglaOrgao": data.SiglaOrgao,
                "GabSalaUsuario": data.GabSalaUsuario,
                "Andar": data.Andar,
                "Localizacao": data.Localizacao,
                "RamalUsuario": data.RamalUsuario,
                "DataEntrada": data.DataEntrada,
                "ProcessoSolicit": data.ProcessoSolicit,
                "CSnro": data.CSnro,
                "EntregPrazoLink": data.EntregPrazoLink,
                "EntregData": data.EntregData,
                "ContatoTrab": data.ContatoTrab,
                "ResponsavelGrafLink": data.ResponsavelGrafLink,
                "EntregaFormaLink": data.EntregaFormaLink,
                "EntregPeriodo": data.EntregPeriodo,
                cota_col: cota_estimada,
            }
            det_written = {
                "Titulo": data.Titulo,
                "TipoPublicacaoLink": data.TipoPublicacaoLink,
                "FormatoLink": data.FormatoLink,
                "MaquinaLink": data.MaquinaLink,
                "Tiragem": data.Tiragem,
                "Pags": data.Pags,
                "FrenteVerso": data.FrenteVerso,
                "ModelosArq": data.ModelosArq,
                "PapelLink": data.PapelLink,
                "PapelDescricao": data.PapelDescricao,
                "Cores": data.Cores,
                "CoresDescricao": data.CoresDescricao,
                "DescAcabamento": data.DescAcabamento,
                "Observ": data.Observ,
                "TiragemSolicitada": calc_fields.get("TiragemSolicitada", data.TiragemSolicitada),
                "CotaTotal": cota_total,
                "MaterialFornecido": data.MaterialFornecido,
                "Fotolito": data.Fotolito,
                "ModeloDobra": data.ModeloDobra,
                "ProvaImpressa": data.ProvaImpressa,
                "InsumosFornecidos": data.InsumosFornecidos,
                "ElemGrafBrasao": data.ElemGrafBrasao,
                "ElemGrafTimbre": data.ElemGrafTimbre,
                "ElemGrafArteGab": data.ElemGrafArteGab,
                "ElemGrafAssinatura": data.ElemGrafAssinatura,
            }
            for calc_col in _CALC_DETALHES_SQL_COLS:
                calc_val = calc_fields.get(calc_col)
                if calc_val is None:
                    continue
                det_written[calc_col] = calc_val
            proto_changed, proto_clears = diff_changed_fields(old_proto, proto_written)
            det_changed, det_clears = diff_changed_fields(old_det, det_written)
            protected = set(WEB_PROTECTED_FROM_CLEAR)
            mdb_sync_plan["proto_fields"] = proto_changed
            mdb_sync_plan["det_fields"] = det_changed
            mdb_sync_plan["explicit_clears"] = (proto_clears | det_clears) - protected

        return SaveOsResponse(
            status="ok",
            id=final_id,
            ano=current_year,
            message=message,
        )

    try:
        result_tx = db.execute_transaction([transaction_logic])
        result = result_tx[0]

        if isinstance(result, SaveOsResponse):
            _broadcast_os_system_update(
                result.id,
                result.ano,
                "os_created" if save_meta["was_insert"] else "os_updated",
            )
            res_id, res_ano = result.id, result.ano
        else:
            validated = SaveOsResponse.model_validate(result)
            _broadcast_os_system_update(
                validated.id,
                validated.ano,
                "os_created" if save_meta["was_insert"] else "os_updated",
            )
            res_id, res_ano = validated.id, validated.ano
            result = validated

        if res_id and res_ano:
            initial_cod = f"{res_id:05d}{res_ano}-01"

            def _sync_os_to_mdb() -> None:
                from .mdb_writer import sync_os_from_mysql_to_mdb

                sync_os_from_mysql_to_mdb(
                    res_id,
                    res_ano,
                    sync_andamentos=save_meta["was_insert"],
                    cod_statuses=[initial_cod] if save_meta["was_insert"] else None,
                    proto_fields=mdb_sync_plan["proto_fields"],
                    det_fields=mdb_sync_plan["det_fields"],
                    explicit_clears=mdb_sync_plan["explicit_clears"],
                )

            _dispatch_mdb_sync("os_save", _sync_os_to_mdb, nro=res_id, ano=res_ano)

        if updating_existing:
            from services.os_edit_lock_service import release_lock_for_request

            release_lock_for_request(
                request, int(data.NroProtocolo), int(data.AnoProtocolo)
            )

        return result
    except HTTPException:
        raise
    except Exception as e:
        from resilience.http_errors import internal_server_error

        internal_server_error("save_os", e)


# --- ADICIONE ESTE NOVO ENDPOINT ---
@router.post("/os/{ano}/{id}/duplicate", response_model=DuplicateOsResponse)
def duplicate_os(ano: int, id: int, req: DuplicateRequest):
    """
    Duplica uma OS existente gerando um novo número sequencial
    baseado no tipo (Normal < 5000 ou Papelaria >= 5000).
    """
    from services.os_duplicate_service import duplicate_os as duplicate_os_svc

    try:
        dup = duplicate_os_svc(
            source_nro=id,
            source_ano=ano,
            usuario=req.usuario,
        )
        result = DuplicateOsResponse(new_id=dup.new_id, new_year=dup.new_year)

        _broadcast_os_system_update(dup.new_id, dup.new_year, "os_created")

        initial_cod = dup.cod_status

        def _sync_duplicate_to_mdb() -> None:
            from .mdb_writer import sync_os_from_mysql_to_mdb

            sync_os_from_mysql_to_mdb(
                dup.new_id,
                dup.new_year,
                sync_andamentos=True,
                cod_statuses=[initial_cod],
            )

        _dispatch_mdb_sync(
            "os_duplicate",
            _sync_duplicate_to_mdb,
            cod_status=initial_cod,
            nro=dup.new_id,
            ano=dup.new_year,
        )
        return result
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Duplicate error: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/os/search", response_model=OsSearchResponse)
def search_os(
    request: Request,
    response: Response,
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    ano_mode: Optional[str] = Query(None, pattern="^(specific|from)$"),
    anos: Optional[List[int]] = Query(None),
    produto: Optional[str] = None,
    produtos: Optional[List[str]] = Query(None),
    titulo: Optional[str] = None,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = Query(None),
    situacao: Optional[List[str]] = Query(None),
    setor: Optional[List[str]] = Query(None),
    prioridade: Optional[List[str]] = Query(None),
    processo: Optional[str] = None,
    categorias: Optional[List[str]] = Query(None),
    maquinas: Optional[List[str]] = Query(None),
    formatos: Optional[List[str]] = Query(None),
    papel: Optional[str] = None,
    cores: Optional[str] = None,
    acabamento: Optional[str] = None,
    observacao: Optional[str] = None,
    data_entrada_de: Optional[str] = None,
    data_entrada_ate: Optional[str] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
    page: int = 1,
    limit: int = OS_SEARCH_DEFAULT_LIMIT,
    pcp_order: bool = False,
    simple_pagination: bool = True,
    include_total: bool = False,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
    sorts: Optional[List[str]] = Query(None),
    exact_os_lookup: bool = False,
    painel: bool = Query(False, description="Painel TV: omite enrich live/sub-OS extra"),
    fetch_all: bool = Query(
        False,
        description=f"Home: retorna todos os registros filtrados (teto {OS_SEARCH_FETCH_ALL_MAX_LIMIT})",
    ),
):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"

    try:
        # Nr OS na home: lookup exato indexável (ignora filtros de escolha lentos).
        if nr_os is not None:
            exact_os_lookup = True

        started = time.perf_counter()
        result = execute_os_search(
            nr_os=nr_os,
            ano=ano,
            ano_mode=ano_mode,
            anos=anos,
            produto=produto,
            produtos=produtos,
            titulo=titulo,
            solicitante=solicitante,
            solicitantes=solicitantes,
            situacao=situacao,
            setor=setor,
            prioridade=prioridade,
            processo=processo,
            categorias=categorias,
            maquinas=maquinas,
            formatos=formatos,
            papel=papel,
            cores=cores,
            acabamento=acabamento,
            observacao=observacao,
            data_entrada_de=data_entrada_de,
            data_entrada_ate=data_entrada_ate,
            include_finished=include_finished,
            include_os=include_os,
            include_sp=include_sp,
            page=page,
            limit=limit,
            pcp_order=pcp_order,
            simple_pagination=simple_pagination,
            sort_by=sort_by,
            sort_dir=sort_dir,
            sorts=sorts,
            include_total=include_total or not simple_pagination,
            exact_os_lookup=exact_os_lookup,
            painel=painel,
            fetch_all=fetch_all,
        )
        etag = build_os_search_etag(result)
        response.headers["ETag"] = etag
        if fetch_all:
            try:
                from services.runtime_metrics_service import record_os_search_fetch_all

                record_os_search_fetch_all(
                    rows=len(result.get("data") or []),
                    elapsed_ms=(time.perf_counter() - started) * 1000.0,
                )
            except Exception:
                pass
        inm = (request.headers.get("if-none-match") or "").strip()
        if fetch_all and inm and inm == etag:
            return Response(status_code=304, headers={"ETag": etag})
        return OsSearchResponse.model_validate(result)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        from resilience.http_errors import internal_server_error

        internal_server_error("search_os", e)


@router.get("/os/search/export/xlsx")
def export_os_search_xlsx(
    response: Response,
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    ano_mode: Optional[str] = Query(None, pattern="^(specific|from)$"),
    anos: Optional[List[int]] = Query(None),
    produto: Optional[str] = None,
    produtos: Optional[List[str]] = Query(None),
    titulo: Optional[str] = None,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = Query(None),
    situacao: Optional[List[str]] = Query(None),
    setor: Optional[List[str]] = Query(None),
    prioridade: Optional[List[str]] = Query(None),
    processo: Optional[str] = None,
    categorias: Optional[List[str]] = Query(None),
    maquinas: Optional[List[str]] = Query(None),
    formatos: Optional[List[str]] = Query(None),
    papel: Optional[str] = None,
    cores: Optional[str] = None,
    acabamento: Optional[str] = None,
    observacao: Optional[str] = None,
    data_entrada_de: Optional[str] = None,
    data_entrada_ate: Optional[str] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
    sorts: Optional[List[str]] = Query(None),
    exact_os_lookup: bool = False,
):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"

    try:
        if nr_os is not None:
            exact_os_lookup = True

        rows = fetch_all_os_search_rows(
            nr_os=nr_os,
            ano=ano,
            ano_mode=ano_mode,
            anos=anos,
            produto=produto,
            produtos=produtos,
            titulo=titulo,
            solicitante=solicitante,
            solicitantes=solicitantes,
            situacao=situacao,
            setor=setor,
            prioridade=prioridade,
            processo=processo,
            categorias=categorias,
            maquinas=maquinas,
            formatos=formatos,
            papel=papel,
            cores=cores,
            acabamento=acabamento,
            observacao=observacao,
            data_entrada_de=data_entrada_de,
            data_entrada_ate=data_entrada_ate,
            include_finished=include_finished,
            include_os=include_os,
            include_sp=include_sp,
            sort_by=sort_by,
            sort_dir=sort_dir,
            sorts=sorts,
            exact_os_lookup=exact_os_lookup,
        )
        output = build_os_list_xlsx(rows)
        filename = f"Lista_OS_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
        return StreamingResponse(
            output,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        from resilience.http_errors import internal_server_error

        internal_server_error("export_os_search_xlsx", e)


@router.get("/os/{ano}/{id}/details", response_model=OsDetailsResponse)
def get_os_details(ano: int, id: int):
    query = """
    SELECT 
        p.CodigoRequisic AS CodigoRequisicao, p.CategoriaLink, p.NomeUsuario, p.Titular, p.OrgInteressado, p.SiglaOrgao, 
        p.GabSalaUsuario, p.Andar, p.Localizacao, p.RamalUsuario, p.CodUsuarioLink,
        p.NroProtocolo, p.AnoProtocolo, p.DataEntrada, p.ProcessoSolicit, p.CSnro,
        d.TiragemSolicitada, d.Tiragem AS TiragemFinal, p.CotaRepro, p.CotaCartao, p.DebitarCGRAF, d.CotaTotal,
        d.Titulo, d.TipoPublicacaoLink, d.FormatoLink, d.MaquinaLink, d.Tiragem, d.Pags, d.FrenteVerso, d.ModelosArq, d.FormatoLink,
        p.EntregPrazoLink, p.EntregData, p.EntregPeriodo, p.EntregaFormaLink, p.ResponsavelGrafLink,
        d.PapelLink, d.PapelDescricao, d.Cores, d.CoresDescricao, d.FormatoLink,
        d.DescAcabamento, d.Observ, p.ContatoTrab, d.MaterialFornecido, d.Fotolito, d.ModeloDobra,
        d.ProvaImpressa, d.InsumosFornecidos, md.MidiaDigitalLink, md.MidiaDigitDescricao,
        d.ElemGrafBrasao, d.ElemGrafTimbre, d.ElemGrafArteGab, d.ElemGrafAssinatura
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d ON (p.NroProtocolo = d.NroProtocoloLinkDet) AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabMidiaDigital AS md ON (p.NroProtocolo = md.NroProtocoloLinkMidia) AND (p.AnoProtocolo = md.AnoProtocoloLinkMidia)
    WHERE p.NroProtocolo = %(id)s AND p.AnoProtocolo = %(ano)s
    """
    try:
        results = db.execute_query(query, {'id': id, 'ano': ano})
        if not results:
            raise HTTPException(status_code=404, detail="OS not found")
        row = dict(results[0])
        try:
            from services.cliente_cota_service import obter_saldo_cota_atual

            saldo = obter_saldo_cota_atual(
                cod_usuario=row.get("CodUsuarioLink"),
                categoria=row.get("CategoriaLink"),
                nome_usuario=row.get("NomeUsuario"),
                nro_protocolo=id,
            )
            if saldo is not None:
                row["CotaAtualSaldo"] = saldo
        except Exception as exc:
            logger.warning("Falha ao obter cota atual do cliente: %s", exc)
        return OsDetailsResponse.model_validate(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching details: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/gerencia/cota-atual")
def get_gerencia_cota_atual(
    categoria: str = Query(""),
    nome_usuario: str = Query(""),
    cod_usuario: str = Query(""),
    nro_os: int = Query(0, ge=0),
):
    """Saldo de cota do semestre aberto para o solicitante (gerência)."""
    try:
        from services.cliente_cota_service import obter_saldo_cota_atual

        saldo = obter_saldo_cota_atual(
            cod_usuario=cod_usuario or None,
            categoria=categoria or None,
            nome_usuario=nome_usuario or None,
            nro_protocolo=nro_os or None,
        )
        return {"saldo": saldo}
    except Exception as exc:
        logger.error("Erro ao consultar cota atual: %s", exc)
        raise HTTPException(status_code=500, detail="Erro ao consultar cota atual.") from exc


@router.get("/gerencia/coef-a4-produtos")
def get_gerencia_coef_a4_produtos():
    """Coeficientes A4 por produto de papelaria (tabCoefA4Produto)."""
    try:
        from services.coef_a4_produto_service import listar_coef_a4_produtos

        items = listar_coef_a4_produtos()
        return {"items": items}
    except Exception as exc:
        logger.error("Erro ao consultar coef A4 por produto: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Erro ao consultar coeficientes A4 por produto.",
        ) from exc


@router.get("/os/{ano}/{id}/audit-log", response_model=List[OsAuditLogRow])
def get_os_audit_log(ano: int, id: int):
    def transaction_logic(cursor):
        rows = fetch_audit_log(cursor, id, ano)
        return [OsAuditLogRow.model_validate(r) for r in rows]

    try:
        return db.execute_transaction([transaction_logic])[0]
    except Exception as e:
        logger.error(f"Error fetching audit log: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Ordem do histórico: CodStatus A→Z (Data não entra na ordenação).
_OS_HISTORY_ORDER_SQL = "ORDER BY CodStatus"


def _dedupe_history_rows(rows: list) -> list:
    """Um registro por CodStatus (fiel ao banco, sem linhas repetidas na API)."""
    seen: set[str] = set()
    unique = []
    for row in rows or []:
        cod = row.get("CodStatus") if isinstance(row, dict) else getattr(row, "CodStatus", None)
        cod_key = str(cod).strip() if cod is not None else ""
        if not cod_key or cod_key in seen:
            continue
        seen.add(cod_key)
        unique.append(row)
    return unique


@router.post("/os/{ano}/{id}/edit-lock")
def acquire_os_edit_lock(ano: int, id: int, body: OsEditLockBody, request: Request):
    from services.os_edit_lock_service import (
        OsEditLockedError,
        acquire_lock,
        raise_locked_http,
        session_from_request,
    )

    session = session_from_request(request)
    if session is None:
        raise HTTPException(status_code=403, detail="Sessão ausente ou inválida.")
    try:
        return acquire_lock(
            nro=id,
            ano=ano,
            ponto=int(session.ponto),
            nome=str(session.nome or ""),
            origem=body.origem or "os_edit",
            token=body.token,
        )
    except OsEditLockedError as exc:
        raise_locked_http(exc)


@router.post("/os/{ano}/{id}/edit-lock/heartbeat")
def heartbeat_os_edit_lock(ano: int, id: int, body: OsEditLockBody, request: Request):
    from services.os_edit_lock_service import (
        OsEditLockGoneError,
        heartbeat_lock,
        session_from_request,
    )

    session = session_from_request(request)
    if session is None:
        raise HTTPException(status_code=403, detail="Sessão ausente ou inválida.")
    try:
        return heartbeat_lock(
            nro=id,
            ano=ano,
            ponto=int(session.ponto),
            token=body.token,
        )
    except (OsEditLockGoneError, ValueError):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "os_edit_lock_gone",
                "message": "O bloqueio de edição expirou.",
            },
        )


@router.post("/os/{ano}/{id}/edit-lock/release")
def release_os_edit_lock(ano: int, id: int, body: OsEditLockBody, request: Request):
    from services.os_edit_lock_service import release_lock, session_from_request

    session = session_from_request(request)
    if session is None:
        raise HTTPException(status_code=403, detail="Sessão ausente ou inválida.")
    return release_lock(
        nro=id,
        ano=ano,
        ponto=int(session.ponto),
        token=body.token,
    )


@router.get("/os/{ano}/{id}/edit-lock")
def get_os_edit_lock(ano: int, id: int, request: Request):
    from services.os_edit_lock_service import get_lock_status, session_from_request

    session = session_from_request(request)
    ponto = int(session.ponto) if session is not None else None
    return get_lock_status(id, ano, ponto)


@router.get("/os/{ano}/{id}/history", response_model=List[HistoryRow])
def get_os_history(ano: int, id: int):
    query = (
        "SELECT a.CodStatus, a.SituacaoLink, a.SetorLink, a.Data, a.Ponto, "
        "a.Observaçao, u.Nome AS usuario_nome "
        "FROM tabAndamento a "
        "LEFT JOIN tabUsuarios u ON u.Ponto = CAST(REPLACE(REPLACE(COALESCE(a.Ponto, ''), '.', ''), '-', '') AS UNSIGNED) "
        "WHERE a.NroProtocoloLink = %(id)s AND a.AnoProtocoloLink = %(ano)s "
        f"{_OS_HISTORY_ORDER_SQL}"
    )
    try:
        rows = db.execute_query(query, {"id": id, "ano": ano})
        return [HistoryRow.model_validate(r) for r in _dedupe_history_rows(rows)]
    except Exception as e:
        logger.error(f"Error fetching history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/os/{ano}/{id}/history", response_model=HistoryAddResponse)
def add_os_history(ano: int, id: int, item: HistoryItem, request: Request):
    logger.info(f"DEBUG: POST History Payload: {item}")
    from services.os_componentes_service import (
        count_sub_os,
        deactivate_all_sub_os,
        os_has_active_componentes,
        propagate_main_os_andamento_to_sub_os,
    )
    from services.os_protocolo_guard import OsProtocoloGuardError, require_protocolo_mysql

    try:
        ano = require_protocolo_mysql(id, ano)
    except OsProtocoloGuardError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    needs_main_confirm = os_has_active_componentes(id, ano) or count_sub_os(id, ano) > 0
    if needs_main_confirm and not item.confirm_main_os_target and not item.unir_sub_os:
        raise HTTPException(
            status_code=403,
            detail=(
                "Esta OS possui componentes com andamento independente. "
                "Confirme que o andamento é da OS principal (confirm_main_os_target=true)."
            ),
        )

    from services.os_edit_lock_service import (
        enforce_interactive_lock,
        release_lock_for_request,
    )

    enforce_interactive_lock(request, id, ano, "andamento")

    if item.from_tablet or item.face_token:
        from security.session_auth import get_session_from_request
        from services.face_identity_service import verify_face_token

        if not item.face_token:
            raise HTTPException(
                status_code=401,
                detail="face_token obrigatório para andamento pelo painel tablet.",
            )
        session = get_session_from_request(request)
        tablet_ponto = session.ponto if session is not None else None
        face_payload = verify_face_token(
            item.face_token,
            os_ano=ano,
            os_id=id,
            tablet_ponto=tablet_ponto,
            consume=True,
        )
        item.usuario = str(face_payload["ponto"])

    clean_user = ''.join(filter(str.isdigit, item.usuario)) if item.usuario else ''
    ponto_formatado = format_ponto(clean_user)

    from services.gravacao_pendente_service import (
        arquivos_are_pdf_only,
        build_pendente_obs_text,
        insert_pendente_session_cursor,
        is_gravacao_pendente_situacao,
        SETOR_GRAVACAO_PENDENTE,
        validate_chapas_input,
        validate_gravacao_pendente_juntadas,
    )
    from services.network_files_service import validate_network_arquivos_input
    from services.gravacao_componente import (
        normalize_gravacao_componente,
        with_gravacao_componente_obs_prefix,
    )
    from services.os_vinculo_grupo_service import _lookup_usuario_nome

    validated_gp_arquivos = None
    validated_gp_chapas = None
    gp_juntadas: list[tuple[int, int]] = []
    gp_juntada_grupo_id: str | None = None
    gp_lancador_nome: str | None = None
    obs_formatada = format_andamento_obs(item.obs)
    gp_observacao_biro = None
    gp_componente = normalize_gravacao_componente(item.gravacao_pendente_componente)

    if is_gravacao_pendente_situacao(item.situacao):
        item.setor = SETOR_GRAVACAO_PENDENTE
        if not item.gravacao_pendente_arquivos:
            raise HTTPException(
                status_code=400,
                detail="Selecione ao menos um arquivo para o andamento Gravação Pendente.",
            )
        try:
            validated_gp_arquivos = validate_network_arquivos_input(
                [
                    {
                        "absolute_path": a.absolute_path,
                        "nome": a.nome,
                        "maquina": a.maquina,
                    }
                    for a in (item.gravacao_pendente_arquivos or [])
                ]
            )
            validated_gp_chapas = validate_chapas_input(
                [
                    {"maquina": c.maquina, "quantidade": c.quantidade}
                    for c in (item.gravacao_pendente_chapas or [])
                ],
                allow_empty=arquivos_are_pdf_only(validated_gp_arquivos),
            )
            gp_juntadas = validate_gravacao_pendente_juntadas(
                principal_ano=ano,
                principal_nr=id,
                juntadas=[
                    {"numero": j.numero, "ano": j.ano}
                    for j in (item.gravacao_pendente_juntadas or [])
                ],
                componente=gp_componente,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        gp_observacao_biro = item.gravacao_pendente_observacao_biro
        if gp_observacao_biro is None:
            gp_observacao_biro = item.obs
        if gp_juntadas:
            import uuid

            gp_juntada_grupo_id = str(uuid.uuid4())
        gp_lancador_nome = _lookup_usuario_nome(clean_user or item.usuario) or None
        obs_body = build_pendente_obs_text(
            validated_gp_chapas,
            item.obs,
        )
        if gp_juntadas:
            from routers.andamento_helpers import with_juntada_obs_prefix
            from services.gravacao_pendente_service import format_juntada_membros_label

            membros = [{"nr_os": id, "ano": ano}] + [
                {"nr_os": nr, "ano": a} for a, nr in gp_juntadas
            ]
            obs_body = with_juntada_obs_prefix(
                obs_body,
                format_juntada_membros_label(membros),
            )
        obs_formatada = format_andamento_obs(
            with_gravacao_componente_obs_prefix(obs_body, gp_componente)
        )

    def transaction_logic(cursor):
        from services.gravacao_pendente_service import lookup_os_solicitante

        def _next_cod_status(nro: int, ano_os: int) -> str:
            from services.andamento_operacional import next_cod_status_for_os

            return next_cod_status_for_os(cursor, nro, ano_os)

        def _insert_andamento_for(nro: int, ano_os: int) -> str:
            cursor.execute(
                "UPDATE tabAndamento SET UltimoStatus = 0 "
                "WHERE NroProtocoloLink = %(id)s AND AnoProtocoloLink = %(ano)s AND UltimoStatus = 1",
                {"id": nro, "ano": ano_os},
            )
            new_cod = _next_cod_status(nro, ano_os)
            cursor.execute(
                "INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto) VALUES (%(cod)s, %(id)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(usuario)s)",
                {
                    "cod": new_cod,
                    "id": nro,
                    "ano": ano_os,
                    "situacao": item.situacao,
                    "setor": item.setor,
                    "obs": obs_formatada,
                    "usuario": ponto_formatado,
                },
            )
            log_andamento_added(
                cursor,
                nro=nro,
                ano=ano_os,
                cod_status=new_cod,
                situacao=item.situacao,
                setor=item.setor,
                obs=obs_formatada,
                ponto=ponto_formatado,
            )
            return new_cod

        # Principal
        new_cod = _insert_andamento_for(id, ano)

        cursor.execute(
            """
            SELECT COUNT(*) AS cnt FROM tab_os_componentes
            WHERE nro_protocolo = %s AND ano_protocolo = %s AND ativo = 1
            """,
            (id, ano),
        )
        has_active = int((cursor.fetchone() or {}).get("cnt") or 0) > 0
        if has_active:
            propagate_main_os_andamento_to_sub_os(
                cursor,
                nro=id,
                ano=ano,
                source_cod_status=new_cod,
                situacao=item.situacao,
                setor=item.setor,
                obs=obs_formatada,
                ponto=ponto_formatado,
                ponto_usuario=clean_user or item.usuario,
            )
        if item.unir_sub_os:
            deactivate_all_sub_os(cursor, id, ano)

        _apply_protocolo_tab_on_andamento(
            cursor,
            id,
            ano,
            item,
            ponto=ponto_formatado,
        )

        if validated_gp_arquivos is not None and validated_gp_chapas is not None:
            insert_pendente_session_cursor(
                cursor,
                ano=ano,
                os_id=id,
                cod_status=new_cod,
                ponto_fmt=ponto_formatado,
                lancado_por_nome=gp_lancador_nome,
                validated_arquivos=validated_gp_arquivos,
                validated_chapas=validated_gp_chapas,
                cliente=lookup_os_solicitante(ano, id),
                juntada_grupo_id=gp_juntada_grupo_id,
                observacao=gp_observacao_biro,
                componente=gp_componente,
            )
            for j_ano, j_nr in gp_juntadas:
                j_cod = _insert_andamento_for(j_nr, j_ano)
                insert_pendente_session_cursor(
                    cursor,
                    ano=j_ano,
                    os_id=j_nr,
                    cod_status=j_cod,
                    ponto_fmt=ponto_formatado,
                    lancado_por_nome=gp_lancador_nome,
                    validated_arquivos=validated_gp_arquivos,
                    validated_chapas=validated_gp_chapas,
                    cliente=lookup_os_solicitante(j_ano, j_nr),
                    juntada_grupo_id=gp_juntada_grupo_id,
                    observacao=gp_observacao_biro,
                    componente=gp_componente,
                )

        return HistoryAddResponse(new_id=new_cod)

    try:
        raw = db.execute_transaction([transaction_logic])[0]
        response = HistoryAddResponse.model_validate(raw)

        try:
            from services.os_componentes_service import sync_sub_os_congelada_flags

            sync_sub_os_congelada_flags(id, ano)
        except Exception as exc:
            logger.warning("Falha ao sincronizar congelamento Sub OS: %s", exc)

        _broadcast_os_system_update(
            id,
            ano,
            "history_added",
            setor=item.setor,
            situacao=item.situacao,
        )
        for j_ano, j_nr in gp_juntadas:
            _broadcast_os_system_update(
                j_nr,
                j_ano,
                "history_added",
                setor=item.setor,
                situacao=item.situacao,
            )

        if validated_gp_arquivos:
            from services.gravacao_preview_cache_service import enqueue_preview_warmup

            enqueue_preview_warmup(validated_gp_arquivos)

        def _sync_add_to_mdb() -> None:
            from services.os_protocolo_andamento_service import (
                is_protocolo_andamento_situacao,
            )
            from .mdb_writer import sync_andamento_from_mysql_to_mdb

            sync_andamento_from_mysql_to_mdb(
                response.new_id,
                id,
                ano,
                operation="insert",
                sync_protocolo_extra=is_protocolo_andamento_situacao(item.situacao),
            )

        _dispatch_mdb_sync(
            "history_add",
            _sync_add_to_mdb,
            cod_status=response.new_id,
            nro=id,
            ano=ano,
        )

        release_lock_for_request(request, id, ano)
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Add history error: {e}")
        if "Duplicate entry" in str(e):
             raise HTTPException(status_code=409, detail="Erro de concorrência. Tente novamente.")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/os/{ano}/{id}/vinculos", response_model=List[VinculoItem])
def list_os_vinculos(ano: int, id: int):
    """Retorna lista de OSs vinculadas à OS fornecida (bidirecional)."""
    try:
        query = """
            SELECT os_principal_numero as principal_num, os_principal_ano as principal_ano,
                   os_vinculada_numero as vinc_num, os_vinculada_ano as vinc_ano, data_vinculo
            FROM tabOSVinculadas
            WHERE (os_principal_numero = %s AND os_principal_ano = %s)
               OR (os_vinculada_numero = %s AND os_vinculada_ano = %s)
        """
        rows = db.execute_query(query, (id, ano, id, ano))

        # Normalize to return the other OS in each relation
        result = []
        for r in rows:
            if r['principal_num'] == id and r['principal_ano'] == ano:
                result.append({ 'numero': r['vinc_num'], 'ano': r['vinc_ano'], 'data_vinculo': r['data_vinculo'] })
            else:
                result.append({ 'numero': r['principal_num'], 'ano': r['principal_ano'], 'data_vinculo': r['data_vinculo'] })

        return result
    except Exception as e:
        logger.error(f"Error listing vinculos: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class VinculoRequest(BaseModel):
    numero: int
    ano: int
    situacao: Optional[str] = None
    setor: Optional[str] = None
    criado_por: Optional[str] = None
    andamentos: Optional[List[VinculoGrupoAndamento]] = None


@router.get("/os/{ano}/{id}/vinculo/grupo-config", response_model=VinculoGrupoConfigResponse)
def get_vinculo_grupo_config(ano: int, id: int):
    """Retorna comportamento do grupo de OSs vinculadas (andamento/setor sincronizado)."""
    try:
        from services.os_vinculo_grupo_service import (
            get_connected_os_members,
            get_grupo_config_for_os,
        )

        config = get_grupo_config_for_os(id, ano)
        if not config:
            return VinculoGrupoConfigResponse(membros=get_connected_os_members(id, ano))
        return VinculoGrupoConfigResponse(
            grupo_id=config.get("id"),
            situacao=config.get("situacao"),
            setor=config.get("setor"),
            criado_por_ponto=config.get("criado_por_ponto"),
            membros=config.get("membros") or [],
            andamentos=config.get("andamentos") or [],
        )
    except Exception as e:
        logger.error("Error fetching vinculo grupo config: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/os/{ano}/{id}/vinculo/replicacao-check", response_model=VinculoReplicacaoCheckResponse)
def check_vinculo_replicacao(
    ano: int,
    id: int,
    situacao: str = Query(...),
    setor: str = Query(...),
):
    """Verifica se andamento exige confirmação de replicação (juntada ou vínculo).

    Entregue em juntada de gravação não pede confirmação de grupo — entrega
    é por OS. Se houver vínculo, o check de vinculação segue normalmente.
    """
    try:
        from services.gravacao_pendente_service import resolve_juntada_grupo_for_os
        from services.os_vinculo_grupo_service import check_replicacao_andamento

        situacao_norm = (situacao or "").strip()
        juntada = resolve_juntada_grupo_for_os(id, ano)
        if juntada and situacao_norm != "Entregue":
            return VinculoReplicacaoCheckResponse.model_validate(
                {
                    "requires_confirmation": True,
                    "legacy": False,
                    "origem": "juntada",
                    "juntada_grupo_id": juntada["juntada_grupo_id"],
                    "membros": juntada["membros_vinculo"],
                }
            )

        result = check_replicacao_andamento(id, ano, situacao, setor)
        if result.get("requires_confirmation"):
            result = {**result, "origem": "vinculo"}
        return VinculoReplicacaoCheckResponse.model_validate(result)
    except Exception as e:
        logger.error("Error checking vinculo replicacao: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/os/{ano}/{id}/vincular", response_model=StatusResponse)
def create_vinculo(ano: int, id: int, req: VinculoRequest):
    """Cria vínculo entre a OS (id, ano) e (req.numero, req.ano)."""
    try:
        from services.os_vinculo_grupo_service import (
            assign_grupo_to_component,
            get_grupo_id_for_os,
            normalize_andamentos_input,
            resolve_grupo_for_new_vinculo,
        )

        from services.os_protocolo_guard import OsProtocoloGuardError, normalize_ano

        try:
            ano = normalize_ano(ano)
            req.ano = normalize_ano(req.ano)
        except OsProtocoloGuardError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        # Validations
        if req.numero == id and req.ano == ano:
            raise HTTPException(status_code=400, detail="Não é possível vincular uma OS a ela mesma.")

        # Check existence of both OSs
        p = db.execute_query("SELECT 1 FROM tabProtocolos WHERE NroProtocolo=%s AND AnoProtocolo=%s", (id, ano))
        q = db.execute_query("SELECT 1 FROM tabProtocolos WHERE NroProtocolo=%s AND AnoProtocolo=%s", (req.numero, req.ano))
        if not p or not q:
            raise HTTPException(status_code=404, detail="Uma das OSs não existe.")

        # Check duplicate in either direction
        dup = db.execute_query("SELECT 1 FROM tabOSVinculadas WHERE (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s) OR (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s)",
                               (id, ano, req.numero, req.ano, req.numero, req.ano, id, ano))
        if dup:
            raise HTTPException(status_code=409, detail="Vínculo já existe.")

        andamentos_payload = [item.model_dump() for item in (req.andamentos or [])]
        pares = normalize_andamentos_input(
            andamentos_payload, req.situacao, req.setor
        )
        grupo_a = get_grupo_id_for_os(id, ano)
        grupo_b = get_grupo_id_for_os(req.numero, req.ano)
        if grupo_a is None and grupo_b is None:
            if not pares:
                raise HTTPException(
                    status_code=400,
                    detail="Informe ao menos um andamento e setor para definir o comportamento do grupo.",
                )

        # Insert canonical direction as provided
        def transaction_logic(cursor):
            grupo_id = resolve_grupo_for_new_vinculo(
                id,
                ano,
                req.numero,
                req.ano,
                req.situacao,
                req.setor,
                req.criado_por,
                andamentos=pares,
                cursor=cursor,
            )
            cursor.execute(
                """
                INSERT INTO tabOSVinculadas
                    (os_principal_numero, os_principal_ano, os_vinculada_numero, os_vinculada_ano, grupo_id)
                VALUES (%s,%s,%s,%s,%s)
                """,
                (id, ano, req.numero, req.ano, grupo_id),
            )
            assign_grupo_to_component(id, ano, grupo_id, cursor=cursor)
            log_vinculo_added(
                cursor,
                nro=id,
                ano=ano,
                vinculo_nro=req.numero,
                vinculo_ano=req.ano,
                ponto=format_ponto(''.join(filter(str.isdigit, req.criado_por or ''))) or None,
            )
            return {"status": "ok"}

        db.execute_transaction([transaction_logic])
        return StatusResponse(status="ok")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating vinculo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/os/{ano}/{id}/vinculo/{v_num}/{v_ano}", response_model=StatusResponse)
@router.post("/os/{ano}/{id}/vinculo/{v_num}/{v_ano}/delete", response_model=StatusResponse)
def delete_vinculo(ano: int, id: int, v_num: int, v_ano: int):
    def transaction_logic(cursor):
        cursor.execute(
            "DELETE FROM tabOSVinculadas WHERE (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s) OR (os_principal_numero=%s AND os_principal_ano=%s AND os_vinculada_numero=%s AND os_vinculada_ano=%s)",
            (id, ano, v_num, v_ano, v_num, v_ano, id, ano),
        )
        log_vinculo_deleted(
            cursor,
            nro=id,
            ano=ano,
            vinculo_nro=v_num,
            vinculo_ano=v_ano,
        )
        return {"status": "ok"}

    try:
        db.execute_transaction([transaction_logic])
        return StatusResponse(status="ok")
    except Exception as e:
        logger.error(f"Error deleting vinculo: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put(
    "/os/{ano}/{id}/vinculo/grupo-andamentos",
    response_model=VinculoGrupoConfigResponse,
)
def update_vinculo_grupo_andamentos(
    ano: int, id: int, body: VinculoGrupoAndamentosRequest
):
    """Substitui os pares andamento+setor que disparam replicação no grupo."""
    try:
        from services.os_vinculo_grupo_service import (
            get_connected_os_members,
            get_grupo_config_for_os,
            get_grupo_id_for_os,
            replace_grupo_andamentos,
        )

        grupo_id = get_grupo_id_for_os(id, ano)
        if grupo_id is None:
            raise HTTPException(
                status_code=400,
                detail="OS não possui grupo de vínculo.",
            )
        replace_grupo_andamentos(
            grupo_id,
            [item.model_dump() for item in body.andamentos],
        )
        config = get_grupo_config_for_os(id, ano)
        if not config:
            return VinculoGrupoConfigResponse(
                grupo_id=grupo_id,
                membros=get_connected_os_members(id, ano),
                andamentos=body.andamentos,
            )
        return VinculoGrupoConfigResponse(
            grupo_id=config.get("id"),
            situacao=config.get("situacao"),
            setor=config.get("setor"),
            criado_por_ponto=config.get("criado_por_ponto"),
            membros=config.get("membros") or [],
            andamentos=config.get("andamentos") or [],
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.error("Error updating vinculo grupo andamentos: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/os/{ano}/{id}/history/replicate", response_model=HistoryReplicateResponse)
def replicate_history(ano: int, id: int, item: HistoryItem, request: Request):
    """Replicar andamento para OSs do vínculo ou da juntada (incluindo a atual)."""
    from services.os_edit_lock_service import (
        enforce_interactive_lock,
        release_lock_for_request,
    )

    enforce_interactive_lock(request, id, ano, "andamento")
    alvo = (item.replicar_alvo or "vinculo").strip().lower()
    pre_targets: set[tuple[int, int]] | None = None
    if alvo == "juntada":
        from services.gravacao_pendente_service import resolve_juntada_grupo_for_os

        juntada = resolve_juntada_grupo_for_os(id, ano)
        if not juntada:
            raise HTTPException(
                status_code=400,
                detail="OS não possui juntada de gravação ativa com outras OSs.",
            )
        pre_targets = {(id, ano)}
        for m in juntada["membros"]:
            pre_targets.add((int(m["nr_os"]), int(m["ano"])))
    else:
        from services.os_vinculo_grupo_service import get_connected_os_members

        pre_targets = {
            (int(m["numero"]), int(m["ano"]))
            for m in get_connected_os_members(id, ano)
        }
        pre_targets.add((id, ano))

    def transaction_logic(cursor):
        targets: set[tuple[int, int]]
        if pre_targets is not None:
            targets = set(pre_targets)
        else:
            targets = {(id, ano)}

        clean_user = "".join(filter(str.isdigit, item.usuario)) if item.usuario else ""
        obs_formatada = format_andamento_obs(item.obs)
        ponto_formatado = format_ponto(clean_user)

        inserted = []
        for t_num, t_ano in targets:
            cursor.execute(
                "UPDATE tabAndamento SET UltimoStatus = 0 "
                "WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s AND UltimoStatus = 1",
                (t_num, t_ano),
            )

            base_prefix = f"{t_num:05d}{t_ano}-"
            cursor.execute(
                f"SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE '{base_prefix}%'"
            )
            res = cursor.fetchone()
            next_seq = 1
            if res and res.get("max_cod"):
                try:
                    existing_suffix = res["max_cod"].split("-")[-1]
                    next_seq = int(existing_suffix) + 1
                except Exception:
                    next_seq = 1

            new_cod = f"{base_prefix}{next_seq:02d}"

            cursor.execute(
                "INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto) VALUES (%s, %s, %s, %s, %s, NOW(), 1, %s, %s)",
                (
                    new_cod,
                    t_num,
                    t_ano,
                    item.situacao,
                    item.setor,
                    obs_formatada,
                    ponto_formatado,
                ),
            )
            inserted.append(
                {
                    "cod_status": new_cod,
                    "nro": t_num,
                    "ano": t_ano,
                    "situacao": item.situacao,
                    "setor": item.setor,
                    "obs": obs_formatada,
                    "ponto": ponto_formatado,
                }
            )
            log_andamento_added(
                cursor,
                nro=t_num,
                ano=t_ano,
                cod_status=new_cod,
                situacao=item.situacao,
                setor=item.setor,
                obs=obs_formatada,
                ponto=ponto_formatado,
                origem="API_REPLICATE_JUNTADA" if alvo == "juntada" else "API_REPLICATE",
            )
            _apply_protocolo_tab_on_andamento(
                cursor,
                t_num,
                t_ano,
                item,
                ponto=ponto_formatado,
            )

        return {"status": "ok", "replicated_to": len(targets), "_inserted": inserted}

    try:
        raw = db.execute_transaction([transaction_logic])[0]
        inserted = raw.pop("_inserted", [])
        response = HistoryReplicateResponse.model_validate(raw)

        try:
            from services.os_componentes_service import sync_sub_os_congelada_flags

            notified_sync: set[tuple[int, int]] = set()
            for row in inserted:
                key = (row.get("nro"), row.get("ano"))
                if not key[0] or not key[1] or key in notified_sync:
                    continue
                notified_sync.add(key)
                sync_sub_os_congelada_flags(key[0], key[1])
        except Exception as exc:
            logger.warning("Falha ao sincronizar congelamento Sub OS (replicate): %s", exc)

        notified = set()
        for row in inserted:
            key = (row.get("nro"), row.get("ano"))
            if key in notified or not key[0] or not key[1]:
                continue
            notified.add(key)
            _broadcast_os_system_update(
                key[0],
                key[1],
                "history_replicated",
                setor=item.setor,
                situacao=item.situacao,
            )

        def _sync_replicated_to_mdb() -> None:
            from services.os_protocolo_andamento_service import (
                is_protocolo_andamento_situacao,
            )
            from .mdb_writer import sync_andamento_from_mysql_to_mdb

            for row in inserted:
                situ = row.get("situacao") or item.situacao
                sync_andamento_from_mysql_to_mdb(
                    row["cod_status"],
                    row["nro"],
                    row["ano"],
                    operation="insert",
                    sync_protocolo_extra=is_protocolo_andamento_situacao(situ),
                )

        _dispatch_mdb_sync(
            "history_replicate",
            _sync_replicated_to_mdb,
            cod_status=inserted[0]["cod_status"] if inserted else None,
            nro=inserted[0]["nro"] if inserted else id,
            ano=inserted[0]["ano"] if inserted else ano,
        )

        release_lock_for_request(request, id, ano)
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error replicating history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/os/{ano}/{id}/vinculo/excecao", response_model=StatusResponse)
def create_vinculo_excecao(ano: int, id: int, body: VinculoExcecaoRequest):
    """Marca exceção/divergência para uma OS vinculada (quando andamento só aplicado nela)."""
    try:
        from services.os_vinculo_grupo_service import (
            get_grupo_id_for_os,
            notify_grupo_creator_divergencia,
        )

        db.execute_query(
            "INSERT INTO tabOSVinculoExcecoes (NroProtocolo, AnoProtocolo, Observacao) VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE Observacao = VALUES(Observacao)",
            (id, ano, body.observacao),
        )
        grupo_id = get_grupo_id_for_os(id, ano)
        if body.situacao and body.setor:
            notify_grupo_creator_divergencia(
                grupo_id=grupo_id,
                os_nro=id,
                os_ano=ano,
                usuario_ponto=body.usuario_ponto,
                situacao=body.situacao,
                setor=body.setor,
            )
        return StatusResponse(status="ok")
    except Exception as e:
        logger.error(f"Error creating vinculo excecao: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class HistoryUpdateItem(HistoryItem):
    cod_status: str

@router.put("/os/{ano}/{id}/history", response_model=StatusResponse)
def update_os_history(ano: int, id: int, item: HistoryUpdateItem, request: Request):
    logger.info(f"DEBUG: PUT History Payload: {item}")
    from services.os_edit_lock_service import (
        enforce_interactive_lock,
        release_lock_for_request,
    )

    enforce_interactive_lock(request, id, ano, "andamento")
    ponto_formatado = format_ponto(''.join(filter(str.isdigit, item.usuario or '')))

    def transaction_logic(cursor):
        cursor.execute(
            """
            SELECT SituacaoLink, SetorLink, Observaçao, Ponto
            FROM tabAndamento
            WHERE CodStatus=%(cod)s AND NroProtocoloLink=%(id)s AND AnoProtocoloLink=%(ano)s
            """,
            {'cod': item.cod_status, 'id': id, 'ano': ano},
        )
        old_row = cursor.fetchone() or {}

        cursor.execute(
            """
            UPDATE tabAndamento 
            SET SituacaoLink=%(situacao)s, SetorLink=%(setor)s, `Observaçao`=%(obs)s, Ponto=%(usuario)s
            WHERE CodStatus=%(cod)s AND NroProtocoloLink=%(id)s AND AnoProtocoloLink=%(ano)s
            """,
            {
                'situacao': item.situacao,
                'setor': item.setor,
                'obs': item.obs,
                'usuario': ponto_formatado,
                'cod': item.cod_status,
                'id': id,
                'ano': ano,
            },
        )
        log_andamento_updated(
            cursor,
            nro=id,
            ano=ano,
            cod_status=item.cod_status,
            old_row=old_row,
            situacao=item.situacao,
            setor=item.setor,
            obs=item.obs,
            ponto=ponto_formatado,
        )
        return {"status": "updated"}

    try:
        db.execute_transaction([transaction_logic])

        try:
            from services.os_componentes_service import sync_sub_os_congelada_flags

            sync_sub_os_congelada_flags(id, ano)
        except Exception as exc:
            logger.warning("Falha ao sincronizar congelamento Sub OS (update): %s", exc)

        _broadcast_os_system_update(
            id,
            ano,
            "history_updated",
            setor=item.setor,
            situacao=item.situacao,
        )

        def _sync_update_to_mdb() -> None:
            from .mdb_writer import sync_andamento_from_mysql_to_mdb

            sync_andamento_from_mysql_to_mdb(
                item.cod_status, id, ano, operation="update"
            )

        _dispatch_mdb_sync(
            "history_update",
            _sync_update_to_mdb,
            cod_status=item.cod_status,
            nro=id,
            ano=ano,
        )

        release_lock_for_request(request, id, ano)
        return StatusResponse(status="ok")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/os/{ano}/{id}/history/{cod_status}", response_model=StatusResponse)
@router.post("/os/{ano}/{id}/history/{cod_status}/delete", response_model=StatusResponse)
def delete_os_history(ano: int, id: int, cod_status: str):
    # Executar TUDO dentro de uma única transação
    def transaction_logic(cursor):
        # 1. Buscar andamento ANTES de excluir (somente desta OS)
        cursor.execute(
            """
            SELECT SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto
            FROM tabAndamento
            WHERE CodStatus = %s
              AND NroProtocoloLink = %s
              AND AnoProtocoloLink = %s
            """,
            (cod_status, id, ano),
        )

        andamento = cursor.fetchone()
        if not andamento:
            raise ValueError(
                f"Andamento {cod_status} não encontrado para OS {id}/{ano}"
            )
        
        # 2. Registrar hash em deleted_andamentos (mesma normalização do sync)
        from services.andamento_tombstone import calculate_andamento_content_hash

        content_hash = calculate_andamento_content_hash(andamento)

        cursor.execute(
            """
            INSERT INTO deleted_andamentos (codstatus, nro, ano, content_hash, deleted_at, motivo, origem)
            VALUES (%s, %s, %s, %s, NOW(), 'Exclusão via Frontend', 'API')
            ON DUPLICATE KEY UPDATE deleted_at = NOW(), content_hash = VALUES(content_hash)
            """,
            (cod_status, id, ano, content_hash),
        )

        logger.info(
            "[DELETE] %s registrado em deleted_andamentos (hash: %s)",
            cod_status,
            content_hash[:8],
        )

        log_andamento_deleted(
            cursor,
            nro=id,
            ano=ano,
            cod_status=cod_status,
            old_row=andamento,
        )

        from services.os_componentes_service import delete_inherited_andamento_for_main_cod

        affected_sub_os_ids = delete_inherited_andamento_for_main_cod(
            cursor, cod_status, nro=id, ano=ano
        )
        
        # 3. Excluir do tabAndamento (somente desta OS)
        cursor.execute(
            """
            DELETE FROM tabAndamento
            WHERE CodStatus = %s
              AND NroProtocoloLink = %s
              AND AnoProtocoloLink = %s
            """,
            (cod_status, id, ano),
        )
        
        # 4. Recalcula UltimoStatus (ignora espelhos de Sub OS)
        from services.andamento_operacional import recalc_ultimo_status_operacional

        recalc_ultimo_status_operacional(cursor, id, ano)

        return {
            "status": "deleted",
            "situacao": str(andamento.get("SituacaoLink") or ""),
            "setor": str(andamento.get("SetorLink") or ""),
            "affected_sub_os_ids": affected_sub_os_ids,
        }

    try:
        raw = db.execute_transaction([transaction_logic])[0]
        affected_sub_os_ids = list(raw.get("affected_sub_os_ids") or [])

        try:
            from services.os_componentes_service import sync_sub_os_congelada_flags

            sync_sub_os_congelada_flags(id, ano)
        except Exception as exc:
            logger.warning("Falha ao sincronizar congelamento Sub OS (delete): %s", exc)

        _broadcast_os_system_update(id, ano, "history_deleted")

        if affected_sub_os_ids:
            try:
                from routers.realtime import broadcast_os_system_update

                for sub_id in affected_sub_os_ids:
                    broadcast_os_system_update(
                        id,
                        ano,
                        "sub_os_history_deleted",
                        sub_os_id=sub_id,
                        scope="sub_os",
                    )
            except Exception as exc:
                logger.warning(
                    "Falha ao emitir WS cascade Sub OS após exclusão principal: %s",
                    exc,
                )

        def _sync_delete_to_mdb() -> None:
            from .mdb_writer import sync_andamento_delete_to_mdb

            sync_andamento_delete_to_mdb(cod_status, id, ano)

        _dispatch_mdb_sync(
            "history_delete",
            _sync_delete_to_mdb,
            cod_status=cod_status,
            nro=id,
            ano=ano,
        )

        return StatusResponse(status="success")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Erro ao excluir {cod_status}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def _listdir_with_timeout(folder: str) -> List[str]:
    """Evita travar a API quando a pasta de rede (DFS) não responde."""
    from resilience.fs_timeout import FsTimeoutError, listdir_with_timeout

    try:
        return listdir_with_timeout(folder)
    except FsTimeoutError as exc:
        raise TimeoutError(str(exc)) from exc


@router.get("/os/{ano}/{id}/versions", response_model=OsVersionsResponse)
def get_os_versions(ano: int, id: int):
    try:
        os_folder = _get_os_folder_path(ano, id)
        versions = []
        from resilience.fs_timeout import FsTimeoutError, path_exists_with_timeout

        folder_exists = False
        if os_folder:
            try:
                folder_exists = path_exists_with_timeout(os_folder)
            except FsTimeoutError:
                folder_exists = False
        if os_folder and folder_exists:
            try:
                subitems = _listdir_with_timeout(os_folder)
            except TimeoutError:
                subitems = []
            # Log all subitems for debugging
            logger.info(f"DEBUG VERSIONS: Procura em {os_folder}, items encontrados: {subitems}")
            
            # Filter logic updated: must start with "original" OR "orignal" (common typo)
            # Using startswith tuple for cleaner code
            original_folders = sorted([i for i in subitems if os.path.isdir(os.path.join(os_folder, i)) and i.lower().startswith(("original", "orignal"))])
            
            logger.info(f"DEBUG VERSIONS: Pastas consideradas versoes: {original_folders}")
            
            for idx, folder_name in enumerate(original_folders):
                versions.append(
                    OsVersionItem(
                        version=idx + 1,
                        label=f"v{idx + 1} ({folder_name})",
                        path=os.path.join(os_folder, folder_name),
                    )
                )

        if not versions:
            local_test_path = os.path.abspath("storage_test")
            os.makedirs(local_test_path, exist_ok=True)
            versions.append(
                OsVersionItem(
                    version=1,
                    label="v1 (Simulação Local)",
                    path=local_test_path,
                )
            )

        return OsVersionsResponse(versions=versions)
    except Exception as e:
        logger.error(f"Erro buscando versoes: {e}")
        return OsVersionsResponse(versions=[])

@router.get("/os/panel", response_model=List[PanelRow])
def get_panel_data(setor: Optional[str] = Query(None)):
    query = """
    SELECT p.NroProtocolo AS nr_os, p.AnoProtocolo AS ano, d.Titulo AS titulo, p.NomeUsuario AS solicitante,
    a.SituacaoLink AS situacao, p.EntregPrazoLink AS prioridade, d.TipoPublicacaoLink AS produto, d.FormatoLink AS formato,
    a.SetorLink AS setor, p.EntregData AS data_entrega, d.Tiragem
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d ON (p.NroProtocolo = d.NroProtocoloLinkDet) AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabAndamento AS a ON (p.NroProtocolo = a.NroProtocoloLink) AND (p.AnoProtocolo = a.AnoProtocoloLink)
    WHERE a.UltimoStatus = 1 AND (a.SituacaoLink LIKE 'Saída p/%%' OR a.SituacaoLink = 'Em Execução' OR a.SituacaoLink = 'Recebido' OR a.SituacaoLink LIKE 'Tramit. de Prova p/%%')
    """
    params = {}
    if setor:
        query += " AND a.SetorLink = %(setor)s"
        params['setor'] = setor
    query += " ORDER BY p.EntregData ASC"
    try:
        rows = db.execute_query(query, params)
        return [PanelRow.model_validate(r) for r in rows]
    except Exception as e:
        logger.error(f"Error fetching panel data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

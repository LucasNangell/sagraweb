from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, Field

from schemas.common import DictRow, MessageResponse, StatusResponse


class NextOsIdResponse(BaseModel):
    next_id: int
    year: int


class OsPathResponse(BaseModel):
    path: str


class OsFolderBrowseEntry(BaseModel):
    name: str
    type: str
    relative: str
    size: Optional[int] = None


class OsFolderBrowseResponse(BaseModel):
    root_path: str
    relative: str
    entries: List[OsFolderBrowseEntry] = Field(default_factory=list)
    error: Optional[str] = None


class OsFolderPlanResponse(BaseModel):
    exists: bool
    folder_name: str
    base_path: str
    full_path: str
    subfolders: List[str]
    solicitante: str
    produto: str
    titulo: str = ""


class OsFolderCreateResponse(BaseModel):
    path: str
    folder_name: str
    created: bool
    subfolders: List[str]
    message: str


class OsFolderMovePreviewRequest(BaseModel):
    origem_ano: int
    origem_id: int


class OsFolderMoveFolderItem(BaseModel):
    from_name: str
    to_name: str
    dest_path: Optional[str] = None


class OsFolderMoveAndamentoItem(BaseModel):
    situacao: Optional[str] = None
    setor: Optional[str] = None
    data: Optional[str] = None
    ponto: Optional[str] = None
    observacao: Optional[str] = None


class OsFolderMovePreviewResponse(BaseModel):
    dest_solicitante: str
    dest_produto: str
    origem_solicitante: str
    origem_produto: str
    same_solicitante: bool
    same_produto: bool
    meta_mismatch: bool
    origem_folder_exists: bool
    origem_folder_path: str
    dest_folder_exists: bool
    dest_folder_path: str
    folders_to_move: List[OsFolderMoveFolderItem]
    dest_conflicts: List[str]
    can_execute: bool
    origem_situacao: Optional[str] = None
    origem_concluida: bool = True
    origem_andamentos: List[OsFolderMoveAndamentoItem] = Field(default_factory=list)


class OsFolderMoveExecuteRequest(BaseModel):
    origem_ano: int
    origem_id: int
    confirm_meta_mismatch: bool = False
    append_repeticao_observ: bool = False
    confirm_origem_nao_concluida: bool = False


class OsFolderMoveExecuteResponse(BaseModel):
    status: str
    dest_folder_path: str
    origem_folder_path: str
    moved_folders: List[OsFolderMoveFolderItem]
    transfer_suffix: str
    dest_folder_created: bool
    meta_mismatch: bool


class SaveOsResponse(BaseModel):
    status: str = "ok"
    id: Optional[int] = None
    ano: Optional[int] = None
    message: str = "OS salva com sucesso"


class DuplicateOsResponse(BaseModel):
    new_id: int
    new_year: int


class SearchMetaSimple(BaseModel):
    page: int
    limit: int
    has_next: bool
    simple_pagination: bool = True
    total_records: int
    total_pages: int


class SearchMetaLegacy(BaseModel):
    page: int
    limit: int
    total_records: int
    total_pages: int


class OsSearchRow(BaseModel):
    model_config = {"extra": "allow"}


class OsSearchResponse(BaseModel):
    data: List[OsSearchRow]
    meta: dict[str, Any]


class OsDetailsResponse(BaseModel):
    model_config = {"extra": "allow"}


class HistoryRow(BaseModel):
    model_config = {"extra": "allow"}


class HistoryAddResponse(BaseModel):
    new_id: str


class HistoryUpdateResponse(BaseModel):
    status: str = "updated"


class HistoryDeleteResponse(BaseModel):
    status: str = "deleted"


class HistoryReplicateResponse(BaseModel):
    status: str = "ok"
    replicated_to: int


class VinculoItem(BaseModel):
    numero: int
    ano: int
    data_vinculo: Optional[Any] = None


class VinculoGrupoMembro(BaseModel):
    numero: int
    ano: int


class VinculoGrupoAndamento(BaseModel):
    situacao: str
    setor: str


class VinculoGrupoConfigResponse(BaseModel):
    grupo_id: Optional[int] = None
    situacao: Optional[str] = None
    setor: Optional[str] = None
    criado_por_ponto: Optional[str] = None
    membros: List[VinculoGrupoMembro] = Field(default_factory=list)
    andamentos: List[VinculoGrupoAndamento] = Field(default_factory=list)


class VinculoGrupoAndamentosRequest(BaseModel):
    andamentos: List[VinculoGrupoAndamento] = Field(default_factory=list)


class VinculoReplicacaoCheckResponse(BaseModel):
    requires_confirmation: bool = False
    legacy: bool = False
    origem: Optional[str] = None  # "juntada" | "vinculo" | None
    grupo_id: Optional[int] = None
    juntada_grupo_id: Optional[str] = None
    situacao_grupo: Optional[str] = None
    setor_grupo: Optional[str] = None
    criado_por_ponto: Optional[str] = None
    membros: List[VinculoGrupoMembro] = Field(default_factory=list)
    andamentos: List[VinculoGrupoAndamento] = Field(default_factory=list)


class OsVersionItem(BaseModel):
    version: int
    label: str
    path: str


class OsVersionsResponse(BaseModel):
    versions: List[OsVersionItem]


class PanelRow(BaseModel):
    model_config = {"extra": "allow"}


class VinculoExcecaoRequest(BaseModel):
    observacao: Optional[str] = None
    usuario_ponto: Optional[str] = None
    situacao: Optional[str] = None
    setor: Optional[str] = None


class OsAuditLogRow(BaseModel):
    id: int
    evento_em: Optional[Any] = None
    acao: str
    entidade: str
    campo: Optional[str] = None
    valor_anterior: Optional[str] = None
    valor_novo: Optional[str] = None
    ponto: Optional[str] = None
    client_ip: Optional[str] = None
    origem: Optional[str] = None
    descricao: Optional[str] = None
    usuario_nome: Optional[str] = None

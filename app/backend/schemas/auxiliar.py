from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from schemas.common import DictRow


class LabelRow(BaseModel):
    """Linha {Campo: valor} usada em listas auxiliares."""

    model_config = {"extra": "allow"}


class CategoriaRow(BaseModel):
    Categoria: Optional[str] = None


class SituacaoRow(BaseModel):
    Situacao: Optional[str] = None


class SetorRow(BaseModel):
    Setor: Optional[str] = None


class MaquinaRow(BaseModel):
    MaquinaLink: Optional[str] = None


class ProdutoRow(BaseModel):
    Produto: Optional[str] = None


class FormaEntregaRow(BaseModel):
    FormaEntrega: Optional[str] = None


class ResponsavelGrafRow(BaseModel):
    ResponsavelGraf: Optional[str] = None


class AcabamentoVariacaoRow(BaseModel):
    id: int
    label: str


class AcabamentoCatalogRow(BaseModel):
    id: int
    label: str
    variacoes: List[AcabamentoVariacaoRow] = Field(default_factory=list)


class PapelRow(BaseModel):
    Papel: Optional[str] = None


class PapelLombadaRow(BaseModel):
    CodPapel: Optional[int] = None
    Papel: Optional[str] = None
    Espessura: Optional[float] = None


class CorRow(BaseModel):
    Cor: Optional[str] = None


class FormatoRow(BaseModel):
    Formato: Optional[str] = None
    altura_mm: Optional[float] = None
    largura_mm: Optional[float] = None


class ProtocoloLookupResponse(BaseModel):
    NroProtocolo: Optional[int] = None
    AnoProtocolo: Optional[int] = None
    NomeUsuario: Optional[str] = None
    CategoriaLink: Optional[str] = None
    ContatoTrab: Optional[str] = None


class DeputadoLookupResponse(BaseModel):
    id: Optional[int] = None
    nome: str = ""
    nome_eleitoral: str = ""
    gabinete: str = ""
    andar: str = ""
    local: str = ""
    ramal: str = ""
    foto: str = ""
    email: str = ""
    partido: str = ""
    uf: str = ""
    partido_uf: str = ""
    situacao: str = ""


class DeputadoEmailsResponse(BaseModel):
    email_dep: str = ""
    email_gab: str = ""
    email_contato: str = ""
    ramal: str = ""
    gabinete: str = ""


class SolicitanteFotoStatusResponse(BaseModel):
    exists: bool = False


class AuxListResponse(BaseModel):
    """Resposta genérica para listas auxiliares."""

    items: List[DictRow] = Field(default_factory=list)

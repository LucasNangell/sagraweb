from __future__ import annotations

import logging
import unicodedata
from typing import List
from unicodedata import normalize

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile

from database import db
from lookup_sync import sync_lookup_tables_from_mdb_if_empty
from formato_dimensions import resolve_formato_dimensions
from schemas.auxiliar import (
    CategoriaRow,
    CorRow,
    DeputadoEmailsResponse,
    DeputadoLookupResponse,
    FormatoRow,
    MaquinaRow,
    PapelLombadaRow,
    PapelRow,
    ProdutoRow,
    ProtocoloLookupResponse,
    FormaEntregaRow,
    ResponsavelGrafRow,
    AcabamentoCatalogRow,
    SetorRow,
    SituacaoRow,
    SolicitanteFotoStatusResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/aux", tags=["auxiliar"])

_AUX_LOOKUP_CACHE = "private, max-age=60"


def _set_aux_lookup_cache(response: Response) -> None:
    response.headers["Cache-Control"] = _AUX_LOOKUP_CACHE


@router.get("/categorias", response_model=List[CategoriaRow])
def get_categorias(response: Response) -> List[CategoriaRow]:
    from services.system_catalog_service import merge_catalog_labels

    _set_aux_lookup_cache(response)
    sync_lookup_tables_from_mdb_if_empty()
    rows = db.execute_query(
        "SELECT DISTINCT Categoria FROM tabcategorias ORDER BY Categoria"
    )
    dynamic = [str(r.get("Categoria") or "").strip() for r in rows if r.get("Categoria")]
    merged = merge_catalog_labels("categoria", dynamic)
    return [CategoriaRow(Categoria=label) for label in merged]


@router.get("/situacoes", response_model=List[SituacaoRow])
def get_situacoes(response: Response) -> List[SituacaoRow]:
    from services.system_catalog_service import merge_catalog_labels

    _set_aux_lookup_cache(response)
    rows = db.execute_query(
        """
        SELECT DISTINCT SituacaoLink as Situacao
        FROM tabAndamento
        WHERE SituacaoLink IS NOT NULL
        ORDER BY SituacaoLink
        """
    )
    dynamic = [str(r.get("Situacao") or "").strip() for r in rows if r.get("Situacao")]
    merged = merge_catalog_labels("situacao", dynamic)
    return [SituacaoRow(Situacao=label) for label in merged]


@router.get("/setores", response_model=List[SetorRow])
def get_setores(response: Response) -> List[SetorRow]:
    from services.system_catalog_service import merge_catalog_labels

    _set_aux_lookup_cache(response)
    rows = db.execute_query(
        """
        SELECT DISTINCT SetorLink as Setor
        FROM tabAndamento
        WHERE SetorLink IS NOT NULL
        ORDER BY SetorLink
        """
    )
    dynamic = [str(r.get("Setor") or "").strip() for r in rows if r.get("Setor")]
    merged = merge_catalog_labels("setor", dynamic)
    return [SetorRow(Setor=label) for label in merged]


@router.get("/maquinas", response_model=List[MaquinaRow])
def get_maquinas() -> List[MaquinaRow]:
    from services.system_catalog_service import merge_catalog_labels

    rows = db.execute_query(
        "SELECT DISTINCT MaquinaLink FROM tabDetalhesServico ORDER BY MaquinaLink"
    )
    dynamic = [str(r.get("MaquinaLink") or "").strip() for r in rows if r.get("MaquinaLink")]
    merged = merge_catalog_labels("maquina", dynamic)
    return [MaquinaRow(MaquinaLink=label) for label in merged]


@router.get("/produtos", response_model=List[ProdutoRow])
def get_produtos() -> List[ProdutoRow]:
    from services.system_catalog_service import merge_catalog_labels

    rows = db.execute_query(
        """
        SELECT DISTINCT TipoPublicacaoLink as Produto
        FROM tabDetalhesServico
        ORDER BY TipoPublicacaoLink
        """
    )
    dynamic = [str(r.get("Produto") or "").strip() for r in rows if r.get("Produto")]
    merged = merge_catalog_labels("produto", dynamic)
    return [ProdutoRow(Produto=label) for label in merged]


@router.get("/papeis", response_model=List[PapelRow])
def get_papeis() -> List[PapelRow]:
    from services.system_catalog_service import merge_catalog_labels

    sync_lookup_tables_from_mdb_if_empty()
    rows = db.execute_query(
        "SELECT DISTINCT Papel FROM tabPapel WHERE Papel IS NOT NULL AND Papel <> '' ORDER BY Papel"
    )
    dynamic = [str(r.get("Papel") or "").strip() for r in rows if r.get("Papel")]
    merged = merge_catalog_labels("papel", dynamic)
    return [PapelRow(Papel=label) for label in merged]


@router.get("/papeis-lombada", response_model=List[PapelLombadaRow])
def get_papeis_lombada(response: Response) -> List[PapelLombadaRow]:
    """Papéis com espessura medida (µm) para a calculadora de lombada."""
    from lookup_sync import sync_papel_espessura_from_lombada_mdb

    _set_aux_lookup_cache(response)
    sync_lookup_tables_from_mdb_if_empty()
    # Fonte canônica das espessuras: CalcularLombada2010.mdb
    try:
        sync_papel_espessura_from_lombada_mdb()
    except Exception as exc:
        logger.warning("Sync Espessura lombada falhou (seguindo com MySQL): %s", exc)
    rows = db.execute_query(
        """
        SELECT CodPapel, Papel, Espessura
        FROM tabPapel
        WHERE Espessura IS NOT NULL
        ORDER BY Papel
        """
    )
    result: List[PapelLombadaRow] = []
    for row in rows:
        papel = str(row.get("Papel") or "").strip()
        esp = row.get("Espessura")
        if not papel or esp is None:
            continue
        try:
            espessura = float(esp)
        except (TypeError, ValueError):
            continue
        cod = row.get("CodPapel")
        try:
            cod_papel = int(cod) if cod is not None else None
        except (TypeError, ValueError):
            cod_papel = None
        result.append(
            PapelLombadaRow(CodPapel=cod_papel, Papel=papel, Espessura=espessura)
        )
    return result


@router.get("/formatos", response_model=List[FormatoRow])
def get_formatos() -> List[FormatoRow]:
    from services.system_catalog_service import merge_catalog_labels

    sync_lookup_tables_from_mdb_if_empty()
    rows = db.execute_query(
        """
        SELECT DISTINCT Formato
        FROM tabFormatos
        WHERE Formato IS NOT NULL AND Formato <> ''
        ORDER BY Formato
        """
    )
    dynamic = [str(r.get("Formato") or "").strip() for r in rows if r.get("Formato")]
    merged = merge_catalog_labels("formato", dynamic)
    result: List[FormatoRow] = []
    for nome in merged:
        dims = resolve_formato_dimensions(str(nome))
        result.append(
            FormatoRow(
                Formato=str(nome).strip(),
                altura_mm=dims[0] if dims else None,
                largura_mm=dims[1] if dims else None,
            )
        )
    return result


@router.get("/cores", response_model=List[CorRow])
def get_cores() -> List[CorRow]:
    from services.system_catalog_service import merge_catalog_labels

    sync_lookup_tables_from_mdb_if_empty()
    rows = db.execute_query(
        """
        SELECT DISTINCT Cor
        FROM tabCores
        WHERE Cor IS NOT NULL AND Cor <> ''
        ORDER BY Cor
        """
    )
    if not rows:
        rows = db.execute_query(
            """
            SELECT DISTINCT Cores AS Cor
            FROM tabDetalhesServico
            WHERE Cores IS NOT NULL AND Cores <> ''
            ORDER BY Cores
            """
        )
    dynamic = [str(r.get("Cor") or "").strip() for r in rows if r.get("Cor")]
    merged = merge_catalog_labels("cor", dynamic)
    return [CorRow(Cor=label) for label in merged]


@router.get("/formas-entrega", response_model=List[FormaEntregaRow])
def get_formas_entrega(response: Response) -> List[FormaEntregaRow]:
    _set_aux_lookup_cache(response)
    rows = db.execute_query(
        """
        SELECT DISTINCT EntregaFormaLink AS FormaEntrega
        FROM tabProtocolos
        WHERE EntregaFormaLink IS NOT NULL AND TRIM(EntregaFormaLink) <> ''
        ORDER BY EntregaFormaLink
        """
    )
    values = [
        str(r.get("FormaEntrega") or "").strip()
        for r in rows
        if r.get("FormaEntrega")
    ]
    return [FormaEntregaRow(FormaEntrega=label) for label in values if label]


@router.get("/responsaveis-grafica", response_model=List[ResponsavelGrafRow])
def get_responsaveis_grafica(response: Response) -> List[ResponsavelGrafRow]:
    _set_aux_lookup_cache(response)
    rows = db.execute_query(
        """
        SELECT DISTINCT ResponsavelGrafLink AS ResponsavelGraf
        FROM tabProtocolos
        WHERE ResponsavelGrafLink IS NOT NULL AND TRIM(ResponsavelGrafLink) <> ''
        ORDER BY ResponsavelGrafLink
        """
    )
    values = [
        str(r.get("ResponsavelGraf") or "").strip()
        for r in rows
        if r.get("ResponsavelGraf")
    ]
    return [ResponsavelGrafRow(ResponsavelGraf=label) for label in values if label]


@router.get("/acabamentos", response_model=List[AcabamentoCatalogRow])
def get_acabamentos(response: Response) -> List[AcabamentoCatalogRow]:
    from services.system_catalog_service import list_acabamentos_operacionais

    _set_aux_lookup_cache(response)
    items = list_acabamentos_operacionais()
    return [AcabamentoCatalogRow.model_validate(item) for item in items]


@router.get("/protocolo/buscar", response_model=ProtocoloLookupResponse)
def buscar_protocolo(
    os: int = Query(..., alias="os"),
    ano: int = Query(..., alias="ano"),
) -> ProtocoloLookupResponse:
    sql = """
        SELECT NroProtocolo, AnoProtocolo, NomeUsuario, CategoriaLink, ContatoTrab
        FROM tabProtocolos
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
    """
    res = db.execute_query(sql, (os, ano))
    if not res:
        return ProtocoloLookupResponse()
    return ProtocoloLookupResponse.model_validate(res[0])


def remover_acentos(txt: str) -> str:
    return normalize("NFKD", txt).encode("ASCII", "ignore").decode("ASCII")


@router.get("/deputado/buscar", response_model=DeputadoLookupResponse)
def buscar_deputado(
    nome: str = Query("", min_length=0),
    id: int | None = Query(None, ge=1, description="ID na API dadosabertos.camara.leg.br"),
) -> DeputadoLookupResponse:
    from services.deputados_camara_service import (
        buscar_deputado_por_nome,
        obter_deputado_por_id,
    )

    try:
        if id is not None:
            dep = obter_deputado_por_id(id)
        else:
            if not nome or len(nome.strip()) < 3:
                return DeputadoLookupResponse()
            dep = buscar_deputado_por_nome(nome.strip())

        if not dep:
            return DeputadoLookupResponse()

        return DeputadoLookupResponse.model_validate(dep.as_lookup_dict())
    except Exception as exc:
        logger.error("Erro ao buscar deputado (nome=%s id=%s): %s", nome, id, exc)
        return DeputadoLookupResponse()


@router.get("/solicitante/foto-status", response_model=SolicitanteFotoStatusResponse)
def solicitante_foto_status(nome: str = Query("")) -> SolicitanteFotoStatusResponse:
    from services.solicitante_foto_service import foto_exists

    return SolicitanteFotoStatusResponse(exists=foto_exists(nome))


@router.get("/solicitante/foto")
def solicitante_foto(nome: str = Query("", min_length=0)):
    from fastapi.responses import FileResponse

    from services.solicitante_foto_service import resolve_foto_path

    path = resolve_foto_path(nome)
    if path is None:
        raise HTTPException(status_code=404, detail="Foto não cadastrada.")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.post("/solicitante/foto", response_model=SolicitanteFotoStatusResponse)
async def upload_solicitante_foto(
    nome: str = Form(...),
    file: UploadFile = File(...),
) -> SolicitanteFotoStatusResponse:
    from services.solicitante_foto_service import MAX_BYTES, save_foto

    data = await file.read(MAX_BYTES + 1)
    try:
        save_foto(nome, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SolicitanteFotoStatusResponse(exists=True)


def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.lower().strip()


def extract_emails_simple(text: str) -> str:
    if not text:
        return ""
    text = text.replace("\r", " ").replace("\n", " ")
    emails: set[str] = set()
    pos = 0
    while pos < len(text):
        at = text.find("@", pos)
        if at == -1:
            break
        start = text.rfind(" ", 0, at)
        start = start + 1 if start != -1 else 0
        end = text.find(" ", at)
        end = end if end != -1 else len(text)
        email = text[start:end].strip()
        if "@" in email:
            emails.add(email)
        pos = end
    return ";".join(sorted(emails))


@router.get("/deputado/emails", response_model=DeputadoEmailsResponse)
def deputado_emails(
    nome_usuario: str,
    NrOS: int,
    Ano: int,
) -> DeputadoEmailsResponse:
    if not nome_usuario or len(nome_usuario.strip()) < 3:
        return DeputadoEmailsResponse()

    from services.deputados_camara_service import obter_emails_deputado

    emails = obter_emails_deputado(nome_usuario.strip())
    email_dep = emails["email_dep"]
    email_gab = emails["email_gab"]
    ramal = emails["ramal"]
    gabinete = emails["gabinete"]

    protocolo = db.execute_query(
        """
        SELECT ContatoTrab
        FROM tabprotocolos
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
        LIMIT 1
        """,
        (NrOS, Ano),
    )

    email_contato = ""
    if protocolo:
        contato = protocolo[0].get("ContatoTrab", "")
        email_contato = extract_emails_simple(contato)

    return DeputadoEmailsResponse(
        email_dep=email_dep,
        email_gab=email_gab,
        email_contato=email_contato,
        ramal=ramal,
        gabinete=gabinete,
    )

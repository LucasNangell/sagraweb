"""Rotas do perfil de imposição v2 (Configurações → Papelaria → Imposição).

O produto vai sempre em query string (nomes como "c/ Bolso" têm barra).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from routers.papelaria_routes import _require_import_access, _require_papelaria_access
from security.session_auth import SessionData

router = APIRouter(prefix="/papelaria")
logger = logging.getLogger(__name__)


class PerfilPayload(BaseModel):
    perfil: dict[str, Any]


class AtivarPayload(BaseModel):
    ativo: bool


class CompararPayload(BaseModel):
    perfil: dict[str, Any]
    pagina_largura_mm: Optional[float] = Field(None, gt=0)
    pagina_altura_mm: Optional[float] = Field(None, gt=0)


class PdfInfoPayload(BaseModel):
    path: str = Field(..., min_length=1, max_length=1024)


class ModeloPerfilPayload(BaseModel):
    nome: str = Field(..., min_length=1, max_length=120)
    perfil: dict[str, Any]


class JuntadaOsRef(BaseModel):
    ano: int
    nro: int


class PreviaJuntadaPayload(BaseModel):
    modelo_id: int
    variante: str = Field(..., min_length=1, max_length=16)
    juntada_os: list[JuntadaOsRef] = Field(default_factory=list)


def _ponto(session: SessionData) -> str:
    return str(getattr(session, "ponto", "") or "")


def _registro_com_validacao(reg: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    from services import papelaria_imposicao_perfil_service as perfil_svc

    if not reg:
        return None
    val = perfil_svc.validar_perfil(reg.get("perfil"), verificar_arquivos=False)
    return {
        **reg,
        "resumo": perfil_svc.resumo_perfil(reg.get("perfil")),
        "validacao": {k: val[k] for k in ("erros", "avisos", "completo")},
    }


def _handle(exc: Exception, what: str) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, LookupError):
        return HTTPException(404, str(exc))
    if isinstance(exc, FileNotFoundError):
        return HTTPException(404, str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(400, str(exc))
    logger.exception("Erro em %s: %s", what, exc)
    return HTTPException(500, f"Erro ao {what}.")


# --- Admin -------------------------------------------------------------------


@router.get("/admin/imposicao/status")
def status_perfis(_session: SessionData = Depends(_require_import_access)):
    try:
        from services import papelaria_imposicao_perfil_store as store

        return {"produtos": store.list_status_todos()}
    except Exception as exc:
        raise _handle(exc, "listar o estado das imposições")


@router.get("/admin/imposicao/perfis")
def obter_perfis(
    produto: str = Query(..., min_length=1, max_length=120),
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_store as store
        from services import papelaria_imposicao_v2_service as v2_svc

        perfis = store.get_perfis_produto(produto)
        antigos: dict[str, Any] = {}
        for var in ("digital", "offset"):
            try:
                antigos[var] = v2_svc.rascunho_da_configuracao_salva(produto=produto, variante=var)
            except Exception as exc:
                logger.warning("Rascunho do fluxo antigo %s/%s: %s", produto, var, exc)
                antigos[var] = {"existe": False, "perfil": None, "completo_no_banco": False}
        return {
            "produto": produto.strip(),
            "digital": _registro_com_validacao(perfis.get("digital")),
            "offset": _registro_com_validacao(perfis.get("offset")),
            "configuracao_antiga": antigos,
        }
    except Exception as exc:
        raise _handle(exc, "carregar os perfis de imposição")


@router.put("/admin/imposicao/perfis/{variante}")
def salvar_perfil(
    variante: str,
    payload: PerfilPayload,
    produto: str = Query(..., min_length=1, max_length=120),
    session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_store as store

        reg = store.save_perfil(
            produto=produto, variante=variante, perfil=payload.perfil, ponto=_ponto(session)
        )
        return _registro_com_validacao(reg)
    except Exception as exc:
        raise _handle(exc, "salvar o perfil de imposição")


@router.delete("/admin/imposicao/perfis/{variante}")
def remover_perfil(
    variante: str,
    produto: str = Query(..., min_length=1, max_length=120),
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_store as store

        return store.delete_perfil(produto=produto, variante=variante)
    except Exception as exc:
        raise _handle(exc, "remover o perfil de imposição")


@router.post("/admin/imposicao/perfis/{variante}/ativar")
def ativar_perfil(
    variante: str,
    payload: AtivarPayload,
    produto: str = Query(..., min_length=1, max_length=120),
    session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_store as store

        reg = store.set_ativo(
            produto=produto, variante=variante, ativo=payload.ativo, ponto=_ponto(session)
        )
        return _registro_com_validacao(reg)
    except Exception as exc:
        raise _handle(exc, "ativar o perfil de imposição")


@router.post("/admin/imposicao/perfis/{variante}/comparar")
def comparar_perfil(
    variante: str,
    payload: CompararPayload,
    produto: str = Query(..., min_length=1, max_length=120),
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_store as store
        from services import papelaria_imposicao_v2_service as v2_svc

        var = store.normalize_variante(variante)
        page = None
        if payload.pagina_largura_mm and payload.pagina_altura_mm:
            page = (float(payload.pagina_largura_mm), float(payload.pagina_altura_mm))
        return v2_svc.comparar_com_fluxo_antigo(
            produto=produto.strip(), variante=var, perfil=payload.perfil, pagina_mm=page
        )
    except Exception as exc:
        raise _handle(exc, "comparar com o fluxo atual")


@router.post("/admin/imposicao/validar")
def validar_perfil(
    payload: PerfilPayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_service as perfil_svc

        val = perfil_svc.validar_perfil(payload.perfil)
        return {**val, "resumo": perfil_svc.resumo_perfil(val["perfil"])}
    except Exception as exc:
        raise _handle(exc, "validar o perfil de imposição")


@router.post("/admin/imposicao/pdf-info")
def pdf_info(
    payload: PdfInfoPayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_service as perfil_svc

        info = perfil_svc.read_pdf_info(payload.path.strip())
        info["miniatura"] = bool(info.get("existe")) and _caminho_liberado(payload.path)
        return info
    except Exception as exc:
        raise _handle(exc, "ler o PDF")


def _caminho_liberado(path: str) -> bool:
    try:
        from security.file_access import resolve_network_file_path

        resolve_network_file_path(path.strip())
        return True
    except Exception:
        return False


@router.get("/admin/imposicao/pdf-thumb")
def pdf_thumb(
    path: str = Query(..., min_length=1, max_length=1024),
    _session: SessionData = Depends(_require_import_access),
):
    """PNG da 1ª página (fundo do preview). Só para pastas de rede liberadas."""
    if not path.strip().lower().endswith(".pdf"):
        raise HTTPException(400, "Apenas arquivos .pdf.")
    try:
        from security.file_access import resolve_network_file_path

        resolved = resolve_network_file_path(path.strip())
    except HTTPException as exc:
        if exc.status_code == 404:
            raise HTTPException(404, "PDF não encontrado.")
        raise HTTPException(403, "Caminho fora das pastas liberadas para pré-visualização.")
    if not os.path.isfile(resolved):
        raise HTTPException(404, "PDF não encontrado.")
    try:
        import fitz  # pymupdf

        with fitz.open(resolved) as doc:
            if doc.page_count < 1:
                raise HTTPException(400, "PDF sem páginas.")
            page = doc[0]
            longest = max(page.rect.width, page.rect.height) or 1.0
            zoom = min(4.0, 1400.0 / longest)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            png = pix.tobytes("png")
        return Response(
            content=png,
            media_type="image/png",
            headers={"Cache-Control": "private, max-age=300"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle(exc, "gerar a miniatura do PDF")


@router.get("/admin/imposicao/modelos-perfil")
def listar_modelos_perfil(_session: SessionData = Depends(_require_import_access)):
    try:
        from services import papelaria_imposicao_perfil_store as store

        return {"modelos": store.list_modelos()}
    except Exception as exc:
        raise _handle(exc, "listar os modelos de perfil")


@router.put("/admin/imposicao/modelos-perfil")
def salvar_modelo_perfil(
    payload: ModeloPerfilPayload,
    session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_store as store

        return store.save_modelo(nome=payload.nome, perfil=payload.perfil, ponto=_ponto(session))
    except Exception as exc:
        raise _handle(exc, "salvar o modelo de perfil")


@router.delete("/admin/imposicao/modelos-perfil/{modelo_id}")
def remover_modelo_perfil(
    modelo_id: int,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_imposicao_perfil_store as store

        return store.delete_modelo(modelo_id)
    except Exception as exc:
        raise _handle(exc, "remover o modelo de perfil")


# --- Página Papelaria (operador) ---------------------------------------------


@router.get("/os/{ano}/{nro}/imposicao-variantes")
def variantes_imposicao_os(
    ano: int,
    nro: int,
    modelo_id: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """Offset/Digital disponíveis para o diálogo (perfil aprovado ou fluxo antigo)."""
    try:
        from services import papelaria_imposicao_v2_service as v2_svc
        from services import papelaria_models_service as models_svc

        modelo = models_svc.get_modelo_by_id(int(modelo_id))
        if not modelo:
            raise LookupError("Modelo não encontrado ou inativo.")
        return v2_svc.opcoes_os(ano=ano, nro=nro, modelo=modelo)
    except Exception as exc:
        raise _handle(exc, "obter as opções de imposição")


@router.post("/os/{ano}/{nro}/imposicao/previa-juntada")
def previa_juntada_os(
    ano: int,
    nro: int,
    payload: PreviaJuntadaPayload,
    _session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_imposicao_perfil_store as store
        from services import papelaria_imposicao_v2_service as v2_svc
        from services import papelaria_jobs_service as jobs_svc
        from services import papelaria_models_service as models_svc

        modelo = models_svc.get_modelo_by_id(int(payload.modelo_id))
        if not modelo:
            raise LookupError("Modelo não encontrado ou inativo.")
        var = store.normalize_variante(payload.variante)
        lote = [(ano, nro)] + [(j.ano, j.nro) for j in payload.juntada_os if (j.ano, j.nro) != (ano, nro)]
        tiragens = [jobs_svc._load_os_tiragem(a, n) for a, n in lote]
        try:
            alloc = v2_svc.previa_juntada(
                produto=(modelo.get("produto") or "").strip(),
                variante=var,
                tiragens=tiragens,
                modelo=modelo,
            )
            return {"ok": True, **alloc}
        except ValueError as exc:
            return {"ok": False, "mensagem": str(exc)}
    except Exception as exc:
        raise _handle(exc, "calcular a juntada")

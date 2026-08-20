"""
Análise Lab — laboratório técnico de inspeção com marcas em mm.

Isolado da Prova WEB e da página /analise. Requer sb_analise.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from services import analise_lab_service as lab
from services import analise_lab_items_service as lab_items
from services import analise_lab_providencias_service as lab_prov
from services import analise_lab_report_service as lab_report
from services import analise_lab_sources_service as lab_src
from services.analise_lab_job_service import (
    cancel_analise_lab_render,
    enqueue_analise_lab_render,
    write_dirty_pages,
)
from services.prova_web_crop_service import build_pdf_crop_meta
from services.prova_web_render_service import (
    LAB_PASTA_RENDER,
    delete_web_render_dir,
    resolve_os_relative_pdf,
    resolve_rendered_page_path,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["analise-lab"])

_MAX_LISTED_FILES = 500


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


def _require_analise(request: Request) -> None:
    if not _perms(request).get("sb_analise"):
        raise HTTPException(status_code=403, detail="Permissão Análise necessária.")


def _session_ponto(request: Request) -> Optional[int]:
    session = getattr(request.state, "sagra_session", None)
    ponto = getattr(session, "ponto", None)
    try:
        return int(ponto) if ponto is not None else None
    except (TypeError, ValueError):
        return None


def _os_folder(ano: int, os_id: int) -> Optional[str]:
    from routers.os_routes import _get_os_folder_path

    return _get_os_folder_path(ano, os_id)


def _require_os_folder(ano: int, os_id: int) -> str:
    folder = _os_folder(ano, os_id)
    if not folder or not os.path.isdir(folder):
        raise HTTPException(
            status_code=404, detail="Pasta da OS não encontrada na rede."
        )
    return folder


def _os_info(ano: int, os_id: int) -> dict[str, Any]:
    from database import db
    from formato_dimensions import resolve_formato_dimensions

    rows = db.execute_query(
        """
        SELECT d.Titulo AS titulo, d.TipoPublicacaoLink AS produto,
               d.FormatoLink AS formato, p.NomeUsuario AS solicitante
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s
        LIMIT 1
        """,
        {"nro": os_id, "ano": ano},
    )
    empty = {
        "titulo": "",
        "produto": "",
        "solicitante": "",
        "formato": None,
        "formatoAlturaMm": None,
        "formatoLarguraMm": None,
    }
    if not rows:
        return empty
    row = rows[0]
    formato = (row.get("formato") or "").strip() or None
    dims = resolve_formato_dimensions(formato) if formato else None
    return {
        "titulo": (row.get("titulo") or "").strip(),
        "produto": (row.get("produto") or "").strip(),
        "solicitante": (row.get("solicitante") or "").strip(),
        "formato": formato,
        "formatoAlturaMm": float(dims[0]) if dims else None,
        "formatoLarguraMm": float(dims[1]) if dims else None,
    }


def _resolve_original_folder(ano: int, os_id: int, versao_label: str) -> str:
    from routers.analise_routes import (
        _get_os_folder_path,
        _resolve_original_folder_path,
    )

    target = _get_os_folder_path(ano, os_id)
    if not target or not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Pasta da OS não encontrada.")
    try:
        return _resolve_original_folder_path(target, versao_label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _rel_path_under_os(os_folder: str, full_path: str) -> str:
    real_os = os.path.realpath(os_folder)
    real_full = os.path.realpath(full_path)
    if not real_os.endswith(os.sep):
        real_os = real_os + os.sep
    if not real_full.startswith(real_os):
        raise ValueError("Arquivo fora da pasta da OS.")
    rel = os.path.relpath(real_full, real_os).replace("\\", "/")
    return rel


class AnaliseLabFonteIn(BaseModel):
    path: str = Field(..., min_length=1, max_length=512)
    componente: Literal["Capa", "Miolo", "Arq. Único"]
    ordem: int = Field(0, ge=0, le=500)


class AnaliseLabSave(BaseModel):
    versao_label: str = Field(..., min_length=1, max_length=128)
    modo: Literal["unico", "capa_miolo"] = "unico"
    arquivo_unico: Optional[str] = Field(None, max_length=512)
    arquivo_capa: Optional[str] = Field(None, max_length=512)
    arquivo_miolo: Optional[str] = Field(None, max_length=512)
    fontes: Optional[list[AnaliseLabFonteIn]] = None
    crop_json: Optional[dict[str, Any]] = None
    folhear_modo: Optional[Literal["flipbook", "folhas"]] = None


class AnaliseLabCropPatch(BaseModel):
    crop: Optional[dict[str, Any]] = None
    scope: Optional[Literal["page", "file", "component", "all", "miolo_central"]] = None
    path: Optional[str] = Field(None, max_length=512)
    source_page: Optional[int] = Field(None, ge=1)
    source_sequence: Optional[int] = Field(None, ge=1)
    componente: Optional[str] = Field(None, max_length=24)
    capa: Optional[dict[str, Any]] = None


class AnaliseLabMarkCreate(BaseModel):
    pagina: int = 0
    tipo: str = Field(..., min_length=1, max_length=32)
    geometria: dict[str, Any]
    rotulo: Optional[str] = Field(None, max_length=120)
    cor: str = Field("red", max_length=32)
    espelhar: bool = False
    pagina_origem: int = 0
    paginas: Optional[str] = Field(None, max_length=255)
    item_id: Optional[int] = None


class AnaliseLabMarkUpdate(BaseModel):
    pagina: Optional[int] = None
    geometria: Optional[dict[str, Any]] = None
    rotulo: Optional[str] = Field(None, max_length=120)
    cor: Optional[str] = Field(None, max_length=32)
    espelhar: Optional[bool] = None
    pagina_origem: Optional[int] = None
    paginas: Optional[str] = Field(None, max_length=255)
    item_id: Optional[int] = None


class AnaliseLabItemCreate(BaseModel):
    id_problema: Optional[int] = None
    titulo: Optional[str] = Field(None, max_length=255)
    html_snapshot: Optional[str] = None
    escopo: Literal["pagina", "paginas", "arquivo"] = "pagina"
    pagina: int = 0
    paginas: Optional[str] = Field(None, max_length=255)
    componente: Optional[str] = Field(None, max_length=24)
    versao_label: Optional[str] = Field(None, max_length=128)
    obs: Optional[str] = None
    confirm_split: bool = False


class AnaliseLabItemUpdate(BaseModel):
    titulo: Optional[str] = Field(None, max_length=255)
    html_snapshot: Optional[str] = None
    obs: Optional[str] = None
    componente: Optional[str] = Field(None, max_length=24)
    escopo: Optional[Literal["pagina", "paginas", "arquivo"]] = None
    pagina: Optional[int] = None
    paginas: Optional[str] = Field(None, max_length=255)
    resolucao_obrigatoria: Optional[bool] = None
    ordem: Optional[int] = None
    corrigido_sefoc: Optional[bool] = None
    obs_correcao_sefoc: Optional[str] = None


class AnaliseLabProvidenciaIn(BaseModel):
    id: Optional[int] = None
    texto: str = ""
    tipo: str = "livre"
    ordem: int = 0
    selecionada: bool = True
    origem: Optional[str] = None


class AnaliseLabProvidenciasReplace(BaseModel):
    providencias: list[AnaliseLabProvidenciaIn] = Field(default_factory=list)


class AnaliseLabItemReplicar(BaseModel):
    item_ids: list[int] = Field(min_length=1)
    copiar_marcas: bool = False


class AnaliseLabItemReordenar(BaseModel):
    ordem: list[int] = Field(min_length=1)


class AnaliseLabConcluir(BaseModel):
    versao: Optional[str] = None
    usuario: Optional[str] = None


@router.get("/os/{ano}/{os_id}/analise-lab")
def get_analise_lab(ano: int, os_id: int, request: Request):
    _require_analise(request)
    folder = _os_folder(ano, os_id)
    session = lab.get_session(ano, os_id)
    if session:
        try:
            lab_items.import_classic_items(session["id"], ano, os_id)
        except Exception as exc:
            logger.warning(
                "Análise Lab: falha ao importar itens clássicos (%s/%s): %s",
                os_id,
                ano,
                exc,
            )
    marks = lab.list_marks(session["id"]) if session else []
    itens = lab_items.list_items(session["id"]) if session else []
    return {
        "ano": ano,
        "os": os_id,
        "session": session,
        "marks": marks,
        "itens": itens,
        "osFolderFound": bool(folder and os.path.isdir(folder)),
        **_os_info(ano, os_id),
    }


@router.get("/os/{ano}/{os_id}/analise-lab/files")
def list_analise_lab_files(
    ano: int,
    os_id: int,
    request: Request,
    versao: str = Query(..., min_length=1, max_length=128),
):
    _require_analise(request)
    os_folder = _require_os_folder(ano, os_id)
    original = _resolve_original_folder(ano, os_id, versao)
    files: list[dict[str, Any]] = []
    truncated = False
    for root, _dirs, names in os.walk(original):
        for name in sorted(names):
            if not name.lower().endswith(".pdf"):
                continue
            full = os.path.join(root, name)
            try:
                rel = _rel_path_under_os(os_folder, full)
                stat = os.stat(full)
                files.append(
                    {
                        "path": rel,
                        "name": name,
                        "dir": os.path.dirname(rel).replace("\\", "/"),
                        "size": stat.st_size,
                        "modifiedAt": datetime.fromtimestamp(
                            stat.st_mtime, tz=timezone.utc
                        ).isoformat(),
                    }
                )
            except (OSError, ValueError):
                continue
            if len(files) >= _MAX_LISTED_FILES:
                truncated = True
                break
        if truncated:
            break
    return {
        "ano": ano,
        "os": os_id,
        "versao": versao,
        "files": files,
        "truncated": truncated,
    }


@router.get("/os/{ano}/{os_id}/analise-lab/pdf")
def get_analise_lab_source_pdf(
    ano: int,
    os_id: int,
    request: Request,
    path: str = Query(..., min_length=1, max_length=512),
):
    """Serve um PDF da pasta da OS para preview (pdf.js) no assistente de crop."""
    _require_analise(request)
    folder = _require_os_folder(ano, os_id)
    try:
        full = resolve_os_relative_pdf(folder, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(
        full,
        media_type="application/pdf",
        filename=os.path.basename(full),
        content_disposition_type="inline",
    )


@router.get("/os/{ano}/{os_id}/analise-lab/crop-meta")
def get_analise_lab_crop_meta(
    ano: int,
    os_id: int,
    request: Request,
    path: str = Query(..., min_length=1, max_length=512),
    detect_marks: bool = Query(False),
):
    """Metadados de página + sugestão de crop (TrimBox → BleedBox → 0)."""
    _require_analise(request)
    folder = _require_os_folder(ano, os_id)
    try:
        full = resolve_os_relative_pdf(folder, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        meta = build_pdf_crop_meta(full, detect_marks=detect_marks)
    except Exception as exc:
        logger.error("Análise Lab crop-meta falhou (%s/%s): %s", os_id, ano, exc)
        raise HTTPException(
            status_code=500, detail="Falha ao ler metadados do PDF."
        ) from exc
    return {"ano": ano, "os": os_id, "path": path.replace("\\", "/"), **meta}


@router.put("/os/{ano}/{os_id}/analise-lab")
def save_analise_lab(ano: int, os_id: int, body: AnaliseLabSave, request: Request):
    _require_analise(request)
    folder = _require_os_folder(ano, os_id)

    def _validated(relative: Optional[str], label: str) -> str:
        raw = (relative or "").strip()
        if not raw:
            raise HTTPException(
                status_code=400, detail=f"Selecione o arquivo de {label}."
            )
        try:
            resolve_os_relative_pdf(folder, raw)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return raw.replace("\\", "/")

    try:
        if body.fontes:
            fontes = lab_src.normalize_fontes(
                [item.model_dump() for item in body.fontes],
                modo=body.modo,
            )
        else:
            fontes = lab_src.fontes_from_legacy(
                modo=body.modo,
                arquivo_unico=body.arquivo_unico,
                arquivo_capa=body.arquivo_capa,
                arquivo_miolo=body.arquivo_miolo,
            )
        lab_src.validate_fontes_for_modo(fontes, body.modo)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    for fonte in fontes:
        _validated(fonte["path"], fonte["componente"].lower())

    arquivo_unico, arquivo_capa, arquivo_miolo = lab_src.derive_legacy_paths(
        fontes, body.modo
    )

    crop_json = body.crop_json if isinstance(body.crop_json, dict) else None
    if crop_json is not None:
        try:
            crop_json = json.loads(json.dumps(crop_json, ensure_ascii=False))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="crop_json inválido.") from exc
    else:
        crop_json = lab_src.identity_lab_crop_json(body.modo)

    existing = lab.get_session(ano, os_id)
    if existing:
        cancel_analise_lab_render(ano, os_id)
        try:
            delete_web_render_dir(folder, LAB_PASTA_RENDER)
        except Exception as exc:
            logger.warning(
                "Análise Lab: falha ao limpar pasta (%s/%s): %s", os_id, ano, exc
            )

    session = lab.upsert_session(
        ano,
        os_id,
        versao_label=body.versao_label.strip(),
        modo=body.modo,
        arquivo_unico=arquivo_unico,
        arquivo_capa=arquivo_capa,
        arquivo_miolo=arquivo_miolo,
        crop_json=crop_json,
        ponto=_session_ponto(request),
        folhear_modo=body.folhear_modo,
        fontes=fontes,
    )
    try:
        enqueue_analise_lab_render(ano, os_id)
    except Exception as exc:
        logger.error("Análise Lab: falha ao enfileirar (%s/%s): %s", os_id, ano, exc)
        raise HTTPException(
            status_code=500, detail="Falha ao iniciar a geração do laboratório."
        ) from exc

    session = lab.get_session(ano, os_id)
    if session:
        try:
            lab_items.import_classic_items(session["id"], ano, os_id)
        except Exception as exc:
            logger.warning(
                "Análise Lab: falha ao importar itens clássicos no save (%s/%s): %s",
                os_id,
                ano,
                exc,
            )
    return {
        "ok": True,
        "session": session,
        "renderStatus": (session or {}).get("renderStatus"),
    }


@router.patch("/os/{ano}/{os_id}/analise-lab/crop")
def patch_analise_lab_crop(
    ano: int, os_id: int, body: AnaliseLabCropPatch, request: Request
):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    if lab.is_render_in_flight(session):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A geração já está em andamento.",
                "renderStatus": session.get("renderStatus"),
            },
        )
    if body.crop is None and body.capa is None:
        raise HTTPException(status_code=400, detail="Informe crop ou configuração de capa.")
    if (body.crop is None) != (body.scope is None):
        raise HTTPException(
            status_code=400, detail="Informe crop e escopo juntos."
        )

    crop_json = session.get("cropJson")
    if not isinstance(crop_json, dict):
        crop_json = lab_src.identity_lab_crop_json(session.get("modo") or "unico")
    fontes = lab_src.fontes_from_session(session)
    capa_before = (
        dict(crop_json["capa"]) if isinstance(crop_json.get("capa"), dict) else {}
    )

    try:
        if body.crop is not None and body.scope is not None:
            crop_json = lab_src.apply_crop_scope(
                crop_json,
                scope=body.scope,
                crop=body.crop,
                path=body.path,
                source_page=body.source_page,
                sequence_page=body.source_sequence,
                componente=body.componente,
                fontes=fontes,
            )
        if body.capa is not None:
            crop_json = lab_src.merge_capa_config(crop_json, body.capa)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    capa_after = (
        dict(crop_json["capa"]) if isinstance(crop_json.get("capa"), dict) else {}
    )
    # Só avalia estrutura da capa quando o cliente enviou capa de propósito.
    structural = bool(body.capa is not None) and lab_src.capa_structural_changed(
        capa_before, capa_after
    )

    folder = _require_os_folder(ano, os_id)
    pasta = session.get("pastaRender") or LAB_PASTA_RENDER
    cancel_analise_lab_render(ano, os_id)

    dirty_pages: Optional[list[int]] = None
    partial = False
    scope = body.scope
    componente = body.componente
    do_full = bool(structural) or scope == "all"
    if scope is None and body.capa is not None and not structural:
        # Só crop/mm da capa (sem mudança estrutural).
        scope = "component"
        if not componente:
            componente = "Capa"
        do_full = False

    if not do_full and scope in ("page", "file", "component", "miolo_central"):
        cached = lab_src.load_ready_lab_manifest(folder, pasta)
        page_map = lab_src.load_page_map(folder, pasta)
        if not page_map and cached:
            try:
                page_map = lab_src.build_source_page_map(fontes, folder)
            except Exception as exc:
                logger.warning(
                    "Análise Lab: falha ao montar pageMap no crop (%s/%s): %s",
                    os_id,
                    ano,
                    exc,
                )
                page_map = None
        if cached and isinstance(cached.get("pages"), list) and page_map:
            dirty_set = lab_src.resolve_dirty_lab_pages(
                scope=scope,
                path=body.path,
                source_page=body.source_page,
                componente=componente,
                fontes=fontes,
                page_map=page_map,
                crop_json=crop_json,
                modo=session.get("modo") or "unico",
                manifest_pages=list(cached.get("pages") or []),
                sequence_page=body.source_sequence,
            )
            # Incluir capas só se o crop da capa mudou de fato.
            capa_crop_changed = False
            if body.capa is not None and isinstance(body.capa.get("crop"), dict):
                from services.prova_web_crop_service import normalize_crop_sides

                before_c = normalize_crop_sides(capa_before.get("crop"))
                after_c = normalize_crop_sides(body.capa.get("crop"))
                capa_crop_changed = before_c != after_c
            if (
                capa_crop_changed
                and not structural
                and scope != "component"
            ):
                capa_dirty = lab_src.resolve_dirty_lab_pages(
                    scope="component",
                    path=None,
                    source_page=None,
                    componente="Capa",
                    fontes=fontes,
                    page_map=page_map,
                    crop_json=crop_json,
                    modo=session.get("modo") or "unico",
                    manifest_pages=list(cached.get("pages") or []),
                )
                if capa_dirty:
                    dirty_set = (dirty_set or set()) | capa_dirty
            if dirty_set:
                dirty_pages = sorted(dirty_set)
                partial = True
                for n in dirty_pages:
                    try:
                        png = resolve_rendered_page_path(folder, pasta, n)
                        if os.path.isfile(png):
                            os.remove(png)
                    except (FileNotFoundError, ValueError, OSError):
                        pass
                try:
                    write_dirty_pages(folder, pasta, dirty_pages)
                except Exception as exc:
                    logger.warning(
                        "Análise Lab: falha ao gravar dirty pages (%s/%s): %s",
                        os_id,
                        ano,
                        exc,
                    )
                    partial = False
                    dirty_pages = None
            else:
                logger.info(
                    "Análise Lab: dirty set vazio no crop seletivo (%s/%s scope=%s); "
                    "caindo para regen completa",
                    os_id,
                    ano,
                    scope,
                )

    if not partial:
        try:
            delete_web_render_dir(folder, LAB_PASTA_RENDER)
        except Exception as exc:
            logger.warning(
                "Análise Lab: falha ao limpar pasta no crop (%s/%s): %s", os_id, ano, exc
            )

    session = lab.update_session_crop(
        ano,
        os_id,
        crop_json=crop_json,
        ponto=_session_ponto(request),
    )
    try:
        enqueue_analise_lab_render(ano, os_id)
    except Exception as exc:
        logger.error(
            "Análise Lab: falha ao enfileirar crop (%s/%s): %s", os_id, ano, exc
        )
        raise HTTPException(
            status_code=500, detail="Falha ao iniciar a geração do laboratório."
        ) from exc
    session = lab.get_session(ano, os_id)
    return {
        "ok": True,
        "session": session,
        "renderStatus": (session or {}).get("renderStatus"),
        "partial": partial,
        "dirtyPages": dirty_pages or [],
    }


@router.post("/os/{ano}/{os_id}/analise-lab/reprocessar")
def reprocess_analise_lab(ano: int, os_id: int, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    if lab.is_render_in_flight(session):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A geração já está em andamento.",
                "renderStatus": session.get("renderStatus"),
            },
        )
    folder = _os_folder(ano, os_id)
    if folder and os.path.isdir(folder):
        try:
            delete_web_render_dir(folder, LAB_PASTA_RENDER)
        except Exception as exc:
            logger.warning(
                "Análise Lab: falha ao limpar no reprocessar (%s/%s): %s",
                os_id,
                ano,
                exc,
            )
    lab.mark_render_pending(ano, os_id)
    enqueue_analise_lab_render(ano, os_id)
    session = lab.get_session(ano, os_id)
    return {
        "ok": True,
        "session": session,
        "renderStatus": (session or {}).get("renderStatus"),
    }


@router.delete("/os/{ano}/{os_id}/analise-lab")
def delete_analise_lab(ano: int, os_id: int, request: Request):
    _require_analise(request)
    cancel_analise_lab_render(ano, os_id)
    folder = _os_folder(ano, os_id)
    if folder and os.path.isdir(folder):
        try:
            delete_web_render_dir(folder, LAB_PASTA_RENDER)
        except Exception as exc:
            logger.warning(
                "Análise Lab: falha ao apagar pasta (%s/%s): %s", os_id, ano, exc
            )
    deleted = lab.delete_session(ano, os_id)
    return {"ok": True, "deleted": deleted}


def _enrich_lab_manifest(
    ano: int, os_id: int, session: dict[str, Any], cached: dict[str, Any]
) -> dict[str, Any]:
    folder = _require_os_folder(ano, os_id)
    pasta = session.get("pastaRender") or LAB_PASTA_RENDER
    page_map = lab_src.load_page_map(folder, pasta)
    pages = lab_src.enrich_manifest_pages(
        list(cached.get("pages") or []),
        page_map,
        modo=session.get("modo") or "unico",
        crop_json=session.get("cropJson")
        if isinstance(session.get("cropJson"), dict)
        else None,
    )
    warnings = list((page_map or {}).get("warnings") or [])
    return {**cached, "pages": pages, "labWarnings": warnings}


def _require_ready_manifest(ano: int, os_id: int, session: dict[str, Any]) -> dict[str, Any]:
    if lab.is_render_in_flight(session):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "O laboratório ainda está gerando as páginas.",
                "renderStatus": session.get("renderStatus"),
                "renderProgress": session.get("renderProgress"),
            },
        )
    if session.get("renderStatus") == lab.RENDER_ERROR:
        raise HTTPException(
            status_code=409,
            detail={
                "message": session.get("renderError")
                or "Falha ao gerar as páginas do laboratório.",
                "renderStatus": lab.RENDER_ERROR,
            },
        )
    if not lab.is_render_ready(session):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "O laboratório ainda não está pronto.",
                "renderStatus": session.get("renderStatus"),
            },
        )

    folder = _require_os_folder(ano, os_id)
    pasta = session.get("pastaRender") or LAB_PASTA_RENDER
    cached = lab_src.load_ready_lab_manifest(folder, pasta)
    if cached and not cached.get("partial"):
        return _enrich_lab_manifest(ano, os_id, session, cached)
    lab.mark_render_pending(ano, os_id)
    enqueue_analise_lab_render(ano, os_id)
    raise HTTPException(
        status_code=409,
        detail={
            "message": "Arquivos indisponíveis; regeneração iniciada.",
            "renderStatus": lab.RENDER_PENDING,
        },
    )


def _load_manifest_allow_partial(
    ano: int, os_id: int, session: dict[str, Any]
) -> dict[str, Any]:
    """Manifesto ready ou parcial durante geração."""
    folder = _require_os_folder(ano, os_id)
    pasta = session.get("pastaRender") or LAB_PASTA_RENDER
    cached = lab_src.load_ready_lab_manifest(folder, pasta)
    if cached and (lab.is_render_ready(session) or cached.get("pages")):
        enriched = _enrich_lab_manifest(ano, os_id, session, cached)
        return {
            **enriched,
            "partial": bool(cached.get("partial")) or lab.is_render_in_flight(session),
            "renderStatus": session.get("renderStatus"),
            "renderProgress": session.get("renderProgress"),
        }
    if lab.is_render_in_flight(session):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "O laboratório ainda está gerando as páginas.",
                "renderStatus": session.get("renderStatus"),
                "renderProgress": session.get("renderProgress"),
            },
        )
    return _require_ready_manifest(ano, os_id, session)


@router.get("/os/{ano}/{os_id}/analise-lab/manifest")
def get_analise_lab_manifest(ano: int, os_id: int, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    manifest = _load_manifest_allow_partial(ano, os_id, session)
    base = f"/api/os/{ano}/{os_id}/analise-lab/pages"
    pages = [
        {**page, "url": f"{base}/{page['page']}.png"}
        for page in manifest.get("pages", [])
    ]
    return {**manifest, "pages": pages, "session": session}


@router.get("/os/{ano}/{os_id}/analise-lab/pages/{page}.png")
def get_analise_lab_page(ano: int, os_id: int, page: int, request: Request):
    _require_analise(request)
    if page < 1:
        raise HTTPException(status_code=400, detail="Página inválida.")
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    folder = _require_os_folder(ano, os_id)
    pasta = session.get("pastaRender") or LAB_PASTA_RENDER
    try:
        path = resolve_rendered_page_path(folder, pasta, page)
    except FileNotFoundError as exc:
        if lab.is_render_in_flight(session):
            raise HTTPException(
                status_code=404,
                detail="Página ainda não gerada.",
            ) from exc
        _require_ready_manifest(ano, os_id, session)
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(
        path=path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


@router.get("/os/{ano}/{os_id}/analise-lab/marcas")
def list_marcas(ano: int, os_id: int, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    return {"marks": lab.list_marks(session["id"])}


@router.post("/os/{ano}/{os_id}/analise-lab/marcas")
def create_marca(
    ano: int, os_id: int, body: AnaliseLabMarkCreate, request: Request
):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    try:
        mark = lab.add_mark(
            session["id"],
            pagina=body.pagina,
            tipo=body.tipo,
            geometria=body.geometria,
            rotulo=body.rotulo,
            cor=body.cor,
            ponto=_session_ponto(request),
            espelhar=body.espelhar,
            pagina_origem=body.pagina_origem,
            paginas=body.paginas,
            item_id=body.item_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "mark": mark}


@router.patch("/os/{ano}/{os_id}/analise-lab/marcas/{mark_id}")
def patch_marca(
    ano: int,
    os_id: int,
    mark_id: int,
    body: AnaliseLabMarkUpdate,
    request: Request,
):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    current = lab.get_mark(mark_id)
    if not current or int(current["sessaoId"]) != int(session["id"]):
        raise HTTPException(status_code=404, detail="Marca não encontrada.")
    try:
        clear_item = "item_id" in body.model_fields_set and body.item_id is None
        mark = lab.update_mark(
            mark_id,
            pagina=body.pagina,
            geometria=body.geometria,
            rotulo=body.rotulo,
            cor=body.cor,
            espelhar=body.espelhar,
            pagina_origem=body.pagina_origem,
            paginas=body.paginas,
            item_id=body.item_id,
            clear_item=clear_item,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "mark": mark}


@router.delete("/os/{ano}/{os_id}/analise-lab/marcas/{mark_id}")
def remove_marca(ano: int, os_id: int, mark_id: int, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    current = lab.get_mark(mark_id)
    if not current or int(current["sessaoId"]) != int(session["id"]):
        raise HTTPException(status_code=404, detail="Marca não encontrada.")
    lab.delete_mark(mark_id)
    return {"ok": True}


@router.get("/os/{ano}/{os_id}/analise-lab/itens")
def list_itens(ano: int, os_id: int, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    return {"itens": lab_items.list_items(session["id"])}


@router.post("/os/{ano}/{os_id}/analise-lab/itens")
def create_item(ano: int, os_id: int, body: AnaliseLabItemCreate, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    try:
        if body.id_problema and body.html_snapshot is None:
            try:
                manifest = _require_ready_manifest(ano, os_id, session)
            except HTTPException:
                manifest = {"pages": []}
            result = lab_items.register_from_library(
                session["id"],
                id_problema=int(body.id_problema),
                escopo=body.escopo,
                pagina=body.pagina,
                paginas=body.paginas,
                versao_label=body.versao_label or session.get("versaoLabel") or "",
                ponto=_session_ponto(request),
                manifest=manifest,
                confirm_split=body.confirm_split,
            )
            return {"ok": True, **result}

        componente = (body.componente or "").strip()
        if not componente:
            try:
                manifest = _require_ready_manifest(ano, os_id, session)
            except HTTPException:
                manifest = {"pages": []}
            page_list = (
                lab.parse_page_spec(body.paginas)
                if body.paginas
                else ([body.pagina] if body.pagina else [])
            )
            grouped = lab_items.componente_for_pages(session, manifest, page_list)
            componente = next(iter(grouped.keys()), "Arq. Único")
        item = lab_items.add_item(
            session["id"],
            titulo=body.titulo or "Problema técnico",
            html_snapshot=body.html_snapshot or "",
            componente=componente,
            escopo=body.escopo,
            pagina=body.pagina,
            paginas=body.paginas,
            versao_label=body.versao_label or session.get("versaoLabel") or "",
            id_problema_padrao=int(body.id_problema) if body.id_problema else None,
            obs=body.obs,
            ponto=_session_ponto(request),
            resolucao_obrigatoria=False,
        )
        return {"ok": True, "items": [item], "needsConfirm": False}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/os/{ano}/{os_id}/analise-lab/itens/{item_id}")
def patch_item(
    ano: int,
    os_id: int,
    item_id: int,
    body: AnaliseLabItemUpdate,
    request: Request,
):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    current = lab_items.get_item(item_id)
    if not current or int(current["sessaoId"]) != int(session["id"]):
        raise HTTPException(status_code=404, detail="Item não encontrado.")
    try:
        item = lab_items.update_item(
            item_id,
            titulo=body.titulo,
            html_snapshot=body.html_snapshot,
            obs=body.obs,
            componente=body.componente,
            escopo=body.escopo,
            pagina=body.pagina,
            paginas=body.paginas,
            resolucao_obrigatoria=body.resolucao_obrigatoria,
            ordem=body.ordem,
            corrigido_sefoc=body.corrigido_sefoc,
            obs_correcao_sefoc=body.obs_correcao_sefoc,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Reanexa providências após update
    refreshed = lab_items.get_item(item_id)
    return {"ok": True, "item": refreshed or item}


@router.put("/os/{ano}/{os_id}/analise-lab/itens/{item_id}/providencias")
def put_item_providencias(
    ano: int,
    os_id: int,
    item_id: int,
    body: AnaliseLabProvidenciasReplace,
    request: Request,
):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    current = lab_items.get_item(item_id)
    if not current or int(current["sessaoId"]) != int(session["id"]):
        raise HTTPException(status_code=404, detail="Item não encontrado.")
    try:
        rows = lab_prov.replace_for_item(
            item_id,
            [p.model_dump() for p in body.providencias],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    item = lab_items.get_item(item_id)
    return {"ok": True, "providencias": rows, "item": item}


@router.post("/os/{ano}/{os_id}/analise-lab/itens/replicar")
def replicar_itens(
    ano: int,
    os_id: int,
    body: AnaliseLabItemReplicar,
    request: Request,
):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    try:
        items = lab_items.replicate_items(
            session["id"],
            body.item_ids,
            versao_label=session.get("versaoLabel") or "",
            copiar_marcas=body.copiar_marcas,
            ponto=_session_ponto(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "items": items}


@router.post("/os/{ano}/{os_id}/analise-lab/itens/reordenar")
def reordenar_itens(
    ano: int,
    os_id: int,
    body: AnaliseLabItemReordenar,
    request: Request,
):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    items = lab_items.reorder_items(session["id"], body.ordem)
    return {"ok": True, "itens": items}


@router.delete("/os/{ano}/{os_id}/analise-lab/itens/{item_id}")
def remove_item(ano: int, os_id: int, item_id: int, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    current = lab_items.get_item(item_id)
    if not current or int(current["sessaoId"]) != int(session["id"]):
        raise HTTPException(status_code=404, detail="Item não encontrado.")
    lab_items.delete_item(item_id)
    return {"ok": True}


@router.get("/os/{ano}/{os_id}/analise-lab/relatorio")
def get_relatorio(ano: int, os_id: int, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    html = lab_report.build_lab_consolidated_html(ano, os_id, session)
    return {"html": html}


@router.post("/os/{ano}/{os_id}/analise-lab/concluir")
def concluir_lab(
    ano: int, os_id: int, body: AnaliseLabConcluir, request: Request
):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    usuario = body.usuario or ""
    if not usuario:
        sess = getattr(request.state, "sagra_session", None)
        usuario = str(getattr(sess, "ponto", "") or "")
    try:
        result = lab_report.conclude(
            ano,
            os_id,
            session,
            versao=body.versao,
            usuario=usuario,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result

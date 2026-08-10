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
from services import analise_lab_report_service as lab_report
from services.analise_lab_job_service import (
    cancel_analise_lab_render,
    enqueue_analise_lab_render,
)
from services.prova_web_crop_service import build_pdf_crop_meta
from services.prova_web_render_service import (
    LAB_PASTA_RENDER,
    MODE_CAPA_MIOLO,
    delete_web_render_dir,
    resolve_os_relative_pdf,
    resolve_rendered_page_path,
    try_load_cached_manifest,
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


class AnaliseLabSave(BaseModel):
    versao_label: str = Field(..., min_length=1, max_length=128)
    modo: Literal["unico", "capa_miolo"] = "unico"
    arquivo_unico: Optional[str] = Field(None, max_length=512)
    arquivo_capa: Optional[str] = Field(None, max_length=512)
    arquivo_miolo: Optional[str] = Field(None, max_length=512)
    crop_json: Optional[dict[str, Any]] = None


class AnaliseLabMarkCreate(BaseModel):
    pagina: int = 0
    tipo: str = Field(..., min_length=1, max_length=32)
    geometria: dict[str, Any]
    rotulo: Optional[str] = Field(None, max_length=120)
    cor: str = Field("red", max_length=32)
    espelhar: bool = False
    pagina_origem: int = 0
    paginas: Optional[str] = Field(None, max_length=255)


class AnaliseLabMarkUpdate(BaseModel):
    pagina: Optional[int] = None
    geometria: Optional[dict[str, Any]] = None
    rotulo: Optional[str] = Field(None, max_length=120)
    cor: Optional[str] = Field(None, max_length=32)
    espelhar: Optional[bool] = None
    pagina_origem: Optional[int] = None
    paginas: Optional[str] = Field(None, max_length=255)


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


class AnaliseLabConcluir(BaseModel):
    versao: Optional[str] = None
    usuario: Optional[str] = None


@router.get("/os/{ano}/{os_id}/analise-lab")
def get_analise_lab(ano: int, os_id: int, request: Request):
    _require_analise(request)
    folder = _os_folder(ano, os_id)
    session = lab.get_session(ano, os_id)
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

    if body.modo == MODE_CAPA_MIOLO:
        arquivo_capa = _validated(body.arquivo_capa, "capa")
        arquivo_miolo = _validated(body.arquivo_miolo, "miolo")
        arquivo_unico = None
    else:
        arquivo_unico = _validated(body.arquivo_unico, "prova")
        arquivo_capa = None
        arquivo_miolo = None

    crop_json = body.crop_json if isinstance(body.crop_json, dict) else None
    if crop_json is not None:
        try:
            crop_json = json.loads(json.dumps(crop_json, ensure_ascii=False))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="crop_json inválido.") from exc

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
    )
    try:
        enqueue_analise_lab_render(ano, os_id)
    except Exception as exc:
        logger.error("Análise Lab: falha ao enfileirar (%s/%s): %s", os_id, ano, exc)
        raise HTTPException(
            status_code=500, detail="Falha ao iniciar a geração do laboratório."
        ) from exc

    session = lab.get_session(ano, os_id)
    return {
        "ok": True,
        "session": session,
        "renderStatus": (session or {}).get("renderStatus"),
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
    try:
        mode, sources = lab.resolve_session_sources(ano, os_id, session)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    pasta = session.get("pastaRender") or LAB_PASTA_RENDER
    cached = try_load_cached_manifest(
        mode=mode,
        source_paths=sources,
        os_folder=folder,
        pasta_render=pasta,
        crop_json=session.get("cropJson"),
    )
    if cached:
        return cached
    lab.mark_render_pending(ano, os_id)
    enqueue_analise_lab_render(ano, os_id)
    raise HTTPException(
        status_code=409,
        detail={
            "message": "Arquivos indisponíveis; regeneração iniciada.",
            "renderStatus": lab.RENDER_PENDING,
        },
    )


@router.get("/os/{ano}/{os_id}/analise-lab/manifest")
def get_analise_lab_manifest(ano: int, os_id: int, request: Request):
    _require_analise(request)
    session = lab.get_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão do laboratório não encontrada.")
    manifest = _require_ready_manifest(ano, os_id, session)
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
    _require_ready_manifest(ano, os_id, session)
    folder = _require_os_folder(ano, os_id)
    pasta = session.get("pastaRender") or LAB_PASTA_RENDER
    try:
        path = resolve_rendered_page_path(folder, pasta, page)
    except FileNotFoundError as exc:
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
        mark = lab.update_mark(
            mark_id,
            pagina=body.pagina,
            geometria=body.geometria,
            rotulo=body.rotulo,
            cor=body.cor,
            espelhar=body.espelhar,
            pagina_origem=body.pagina_origem,
            paginas=body.paginas,
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
        if body.id_problema:
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
            id_problema_padrao=None,
            obs=body.obs,
            ponto=_session_ponto(request),
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
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "item": item}


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

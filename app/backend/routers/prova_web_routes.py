"""
Prova WEB — visualizador interno de prova com folheamento (staff).

Endpoints autenticados (sessão + flag ctx_prova_web):
- registro do arquivo de prova por OS (tabProvaWeb)
- listagem de PDFs da pasta da OS
- PDF cru + crop-meta para o assistente de crop
- manifest + páginas PNG renderizadas (crop mm / TrimBox legado, cache)
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

from database import db
from services.prova_web_crop_service import build_pdf_crop_meta
from services.prova_web_dieline_service import parse_dieline_pdf
from services.prova_web_record_service import (
    RENDER_ERROR,
    RENDER_PENDING,
    RENDER_READY,
    STATUS_PUBLICADO,
    STATUS_RASCUNHO,
    count_prova_web_versions,
    delete_prova_web_version,
    get_prova_web_record,
    get_prova_web_record_by_versao,
    is_render_in_flight,
    is_render_ready,
    mark_prova_web_render_pending,
    next_prova_web_versao,
    resolve_record_sources,
    set_prova_web_status,
)
from services.prova_web_job_service import (
    cancel_prova_web_render,
    enqueue_prova_web_render,
)
from services.prova_web_render_service import (
    MODE_CAIXA,
    MODE_CAPA_MIOLO,
    MODE_ESPIRAL,
    delete_web_render_dir,
    pasta_render_for_versao,
    resolve_os_relative_pdf,
    resolve_rendered_asset_path,
    resolve_rendered_page_path,
    try_load_cached_manifest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["prova-web"])

_MAX_LISTED_FILES = 500
_MAX_WALK_DEPTH = 5


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


def _require_prova_web(request: Request) -> None:
    if not _perms(request).get("ctx_prova_web"):
        raise HTTPException(status_code=403, detail="Permissão Prova WEB necessária.")


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
            status_code=404,
            detail="Pasta da OS não encontrada na rede.",
        )
    return folder


def _is_papelaria_os(ano: int, os_id: int) -> bool:
    if os_id >= 5000:
        return True
    try:
        from services.papelaria_models_service import is_papelaria_os_by_product

        return is_papelaria_os_by_product(ano, os_id)
    except Exception:
        return False


def _os_info(ano: int, os_id: int) -> dict[str, Any]:
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


def _get_record(ano: int, os_id: int) -> Optional[dict[str, Any]]:
    return get_prova_web_record(ano, os_id)


def _resolve_record_sources(
    ano: int, os_id: int, record: dict[str, Any]
) -> tuple[str, list[str]]:
    """Retorna (mode, caminhos físicos) do registro, validando contra a pasta da OS."""
    try:
        return resolve_record_sources(ano, os_id, record)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _papelaria_mockup_meta(ano: int, os_id: int) -> dict[str, Any]:
    """Metadados do mockup 3D (modelo do job concluído mais recente), se houver."""
    meta: dict[str, Any] = {
        "mockupConfigJson": None,
        "produto": "",
        "arquivoModelo": "",
        "frenteVerso": "",
    }
    try:
        from services.papelaria_jobs_service import (
            STATUS_COMPLETED,
            list_jobs_for_os,
        )

        job = None
        for candidate in list_jobs_for_os(ano, os_id, limit=20):
            if candidate.get("status") == STATUS_COMPLETED:
                job = candidate
                break
        if not job:
            return meta

        meta["produto"] = (job.get("produto") or "").strip()
        meta["arquivoModelo"] = (job.get("arquivo_modelo") or "").strip()
        dados = job.get("dados") or {}
        if isinstance(dados, dict):
            meta["frenteVerso"] = str(
                dados.get("frente_verso") or dados.get("fv") or ""
            ).strip()

        modelo_id = job.get("modelo_id")
        if modelo_id:
            from services.papelaria_models_service import get_modelo_by_id

            modelo = get_modelo_by_id(int(modelo_id))
            if modelo:
                meta["mockupConfigJson"] = modelo.get("mockup_config_json")
                if not meta["produto"]:
                    meta["produto"] = (modelo.get("produto") or "").strip()
                if not meta["arquivoModelo"]:
                    meta["arquivoModelo"] = (modelo.get("arquivo_modelo") or "").strip()
    except Exception as exc:
        logger.warning("Prova WEB: mockup meta indisponível (%s/%s): %s", os_id, ano, exc)
    return meta


class ProvaWebUpdate(BaseModel):
    modo: Literal["unico", "capa_miolo", "folha_dobrada", "espiral", "caixa"]
    arquivo_unico: Optional[str] = Field(None, max_length=512)
    arquivo_capa: Optional[str] = Field(None, max_length=512)
    arquivo_miolo: Optional[str] = Field(None, max_length=512)
    # Se true e já existir versão, cria Versao N+1 (ProvaN).
    nova: bool = False
    crop_json: Optional[dict[str, Any]] = None


def _normalize_crop_json(
    raw: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="crop_json inválido.")
    try:
        # Serializa para garantir JSON válido e estável no MySQL.
        return json.loads(json.dumps(raw, ensure_ascii=False))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="crop_json inválido.") from exc


def _render_for_record(
    ano: int, os_id: int, record: dict[str, Any]
) -> dict[str, Any]:
    """Carrega manifest em cache se ready; nunca rasteriza no request HTTP."""
    if is_render_in_flight(record):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A prova ainda está sendo gerada.",
                "renderStatus": record.get("renderStatus"),
                "renderProgress": record.get("renderProgress"),
            },
        )
    if record.get("renderStatus") == RENDER_ERROR:
        raise HTTPException(
            status_code=409,
            detail={
                "message": record.get("renderError")
                or "Falha ao gerar as páginas da prova.",
                "renderStatus": RENDER_ERROR,
                "renderError": record.get("renderError"),
            },
        )
    if not is_render_ready(record):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A prova ainda não está pronta para visualização.",
                "renderStatus": record.get("renderStatus"),
            },
        )

    folder = _require_os_folder(ano, os_id)
    mode, sources = _resolve_record_sources(ano, os_id, record)
    pasta = record.get("pastaRender") or pasta_render_for_versao(
        int(record.get("versao") or 1)
    )
    cached = try_load_cached_manifest(
        mode=mode,
        source_paths=sources,
        os_folder=folder,
        pasta_render=pasta,
        crop_json=record.get("cropJson"),
    )
    if cached:
        return cached

    # ready sem cache: reenfileira e não bloqueia o request.
    versao = int(record.get("versao") or 1)
    try:
        mark_prova_web_render_pending(ano, os_id, versao)
        enqueue_prova_web_render(ano, os_id, versao)
    except Exception as exc:
        logger.error(
            "Prova WEB: falha ao reenfileirar cache miss (%s/%s v%s): %s",
            os_id,
            ano,
            versao,
            exc,
        )
    raise HTTPException(
        status_code=409,
        detail={
            "message": "Arquivos da prova indisponíveis; regeneração iniciada.",
            "renderStatus": RENDER_PENDING,
        },
    )


def _schedule_render(ano: int, os_id: int, versao: int) -> None:
    mark_prova_web_render_pending(ano, os_id, versao)
    enqueue_prova_web_render(ano, os_id, versao)


def _ensure_portal_link(
    ano: int, os_id: int, ponto: Optional[int], *, log_audit: bool = True
) -> str:
    """Gera (ou reusa) o token público e registra o link no histórico da OS."""
    from routers.os_audit_service import log_link_generated_db
    from routers.proof_portal_routes import (
        build_proof_portal_url,
        ensure_prova_web_token,
    )

    ponto_str = str(ponto) if ponto is not None else None
    record = _get_record(ano, os_id)
    versao_token = str((record or {}).get("versao") or 1)
    token = ensure_prova_web_token(
        os_id, ano, versao=versao_token, ponto_envio=ponto_str
    )
    portal_url = build_proof_portal_url(os_id, ano, token)
    if log_audit:
        try:
            log_link_generated_db(
                db,
                nro=os_id,
                ano=ano,
                url=portal_url,
                link_type="prova_web",
                ponto=ponto_str,
                origem="PROVA_WEB",
            )
        except Exception as exc:
            logger.warning(
                "Prova WEB: falha ao registrar link no histórico (%s/%s): %s",
                os_id,
                ano,
                exc,
            )
    return portal_url


@router.get("/os/{ano}/{os_id}/prova-web")
def get_prova_web(ano: int, os_id: int, request: Request):
    _require_prova_web(request)
    folder = _os_folder(ano, os_id)
    info = _os_info(ano, os_id)
    record = _get_record(ano, os_id)
    portal_url = None
    if record and not record.get("isDraft"):
        try:
            portal_url = _ensure_portal_link(
                ano, os_id, _session_ponto(request), log_audit=False
            )
        except Exception as exc:
            logger.warning(
                "Prova WEB: portalUrl indisponível (%s/%s): %s", os_id, ano, exc
            )
    return {
        "ano": ano,
        "os": os_id,
        "record": record,
        "versionCount": count_prova_web_versions(ano, os_id),
        "portalUrl": portal_url,
        "isPapelaria": _is_papelaria_os(ano, os_id),
        "osFolderFound": bool(folder and os.path.isdir(folder)),
        **info,
    }


@router.get("/os/{ano}/{os_id}/prova-web/files")
def list_prova_web_files(ano: int, os_id: int, request: Request):
    """Lista PDFs da pasta da OS (recursivo, sem expor caminho UNC)."""
    _require_prova_web(request)
    folder = _require_os_folder(ano, os_id)

    files: list[dict[str, Any]] = []
    truncated = False
    base_depth = folder.rstrip(os.sep).count(os.sep)

    for root, dirs, names in os.walk(folder):
        dirs[:] = sorted(
            d for d in dirs if not d.startswith(".") and d.lower() != "__pycache__"
        )
        depth = root.rstrip(os.sep).count(os.sep) - base_depth
        if depth >= _MAX_WALK_DEPTH:
            dirs[:] = []
        rel_dir = os.path.relpath(root, folder).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        for name in sorted(names):
            if not name.lower().endswith(".pdf"):
                continue
            full = os.path.join(root, name)
            try:
                stat = os.stat(full)
                size = stat.st_size
                modified_at = datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat()
            except OSError:
                size = 0
                modified_at = None
            files.append(
                {
                    "path": f"{rel_dir}/{name}" if rel_dir else name,
                    "name": name,
                    "dir": rel_dir,
                    "size": size,
                    "modifiedAt": modified_at,
                }
            )
            if len(files) >= _MAX_LISTED_FILES:
                truncated = True
                break
        if truncated:
            break

    return {"ano": ano, "os": os_id, "files": files, "truncated": truncated}


@router.get("/os/{ano}/{os_id}/prova-web/pdf")
def get_prova_web_source_pdf(
    ano: int,
    os_id: int,
    request: Request,
    path: str = Query(..., min_length=1, max_length=512),
):
    """Serve um PDF da pasta da OS para preview (pdf.js) no assistente de crop."""
    _require_prova_web(request)
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


@router.get("/os/{ano}/{os_id}/prova-web/crop-meta")
def get_prova_web_crop_meta(
    ano: int,
    os_id: int,
    request: Request,
    path: str = Query(..., min_length=1, max_length=512),
    detect_marks: bool = Query(False),
):
    """Metadados de página + sugestão de crop (TrimBox → BleedBox → 0)."""
    _require_prova_web(request)
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
        logger.error("Prova WEB crop-meta falhou (%s/%s): %s", os_id, ano, exc)
        raise HTTPException(
            status_code=500, detail="Falha ao ler metadados do PDF."
        ) from exc
    return {"ano": ano, "os": os_id, "path": path.replace("\\", "/"), **meta}


@router.get("/os/{ano}/{os_id}/prova-web/dieline-meta")
def get_prova_web_dieline_meta(
    ano: int,
    os_id: int,
    request: Request,
    path: str = Query(..., min_length=1, max_length=512),
    page: Optional[int] = Query(None, ge=0),
):
    """Extrai corte/dobra e dims tuck-end sugeridas de um PDF de faca."""
    _require_prova_web(request)
    folder = _require_os_folder(ano, os_id)
    try:
        full = resolve_os_relative_pdf(folder, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        parsed = parse_dieline_pdf(full, page_index=page)
        from services.prova_web_caixa_service import suggest_from_dieline

        suggestion = suggest_from_dieline(parsed)
    except Exception as exc:
        logger.error("Prova WEB dieline-meta falhou (%s/%s): %s", os_id, ano, exc)
        raise HTTPException(
            status_code=500, detail="Falha ao ler a faca do PDF."
        ) from exc
    return {
        "ano": ano,
        "os": os_id,
        "path": path.replace("\\", "/"),
        "parsed": parsed,
        "suggestion": suggestion,
    }


@router.put("/os/{ano}/{os_id}/prova-web")
def save_prova_web(ano: int, os_id: int, body: ProvaWebUpdate, request: Request):
    _require_prova_web(request)
    folder = _require_os_folder(ano, os_id)

    def _validated(relative: Optional[str], label: str) -> str:
        raw = (relative or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail=f"Selecione o arquivo de {label}.")
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
    elif body.modo == MODE_ESPIRAL:
        crop_json_pre = body.crop_json if isinstance(body.crop_json, dict) else {}
        espiral = crop_json_pre.get("espiral") if isinstance(crop_json_pre, dict) else None
        kind = "unico"
        if isinstance(espiral, dict):
            kind = str(espiral.get("sourceKind") or "unico").strip().lower()
        if kind == "capa_miolo":
            arquivo_capa = _validated(body.arquivo_capa, "capa")
            arquivo_miolo = _validated(body.arquivo_miolo, "miolo")
            arquivo_unico = None
        else:
            arquivo_unico = _validated(body.arquivo_unico, "prova")
            arquivo_capa = None
            arquivo_miolo = None
    elif body.modo == MODE_CAIXA:
        crop_json_pre = body.crop_json if isinstance(body.crop_json, dict) else {}
        caixa = crop_json_pre.get("caixa") if isinstance(crop_json_pre, dict) else None
        kind = "combined"
        if isinstance(caixa, dict):
            kind = str(caixa.get("sourceKind") or "combined").strip().lower()
        if kind == "separate":
            arquivo_capa = _validated(body.arquivo_capa, "faca")
            arquivo_miolo = _validated(body.arquivo_miolo, "arte")
            arquivo_unico = None
        else:
            arquivo_unico = _validated(body.arquivo_unico, "caixa")
            arquivo_capa = None
            arquivo_miolo = None
    else:
        arquivo_unico = _validated(body.arquivo_unico, "prova")
        arquivo_capa = None
        arquivo_miolo = None

    existing = _get_record(ano, os_id)
    replace_draft = bool(
        existing
        and existing.get("isDraft")
        and not body.nova
    )
    if existing and not body.nova and not replace_draft:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Já existe Prova WEB (Prova {existing.get('versao')}). "
                "Confirme se deseja visualizar a existente ou criar uma nova."
            ),
        )

    ponto = _session_ponto(request)
    crop_json = _normalize_crop_json(body.crop_json)
    crop_payload = json.dumps(crop_json, ensure_ascii=False) if crop_json is not None else None

    if replace_draft and existing:
        versao = int(existing["versao"])
        pasta = existing.get("pastaRender") or pasta_render_for_versao(versao)
        cancel_prova_web_render(ano, os_id, versao)
        try:
            delete_web_render_dir(folder, pasta)
        except Exception as exc:
            logger.warning(
                "Prova WEB: falha ao limpar pasta de rascunho (%s/%s v%s): %s",
                os_id,
                ano,
                versao,
                exc,
            )
        db.execute_query(
            """
            UPDATE tabProvaWeb
            SET PastaRender = %s, Modo = %s,
                ArquivoUnico = %s, ArquivoCapa = %s, ArquivoMiolo = %s,
                CropJson = %s, Status = %s, PontoRegistro = %s,
                RenderStatus = %s, RenderError = NULL, RenderProgress = NULL,
                RenderStartedAt = NULL, RenderFinishedAt = NULL
            WHERE NroProtocolo = %s AND AnoProtocolo = %s AND Versao = %s
            """,
            (
                pasta,
                body.modo,
                arquivo_unico,
                arquivo_capa,
                arquivo_miolo,
                crop_payload,
                STATUS_RASCUNHO,
                ponto,
                RENDER_PENDING,
                os_id,
                ano,
                versao,
            ),
        )
    else:
        if existing and body.nova:
            versao = next_prova_web_versao(ano, os_id)
        else:
            versao = 1
        pasta = pasta_render_for_versao(versao)
        db.execute_query(
            """
            INSERT INTO tabProvaWeb
                (NroProtocolo, AnoProtocolo, Versao, PastaRender, Modo,
                 ArquivoUnico, ArquivoCapa, ArquivoMiolo, CropJson, Status,
                 RenderStatus, PontoRegistro)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                os_id,
                ano,
                versao,
                pasta,
                body.modo,
                arquivo_unico,
                arquivo_capa,
                arquivo_miolo,
                crop_payload,
                STATUS_RASCUNHO,
                RENDER_PENDING,
                ponto,
            ),
        )

    try:
        enqueue_prova_web_render(ano, os_id, versao)
    except Exception as exc:
        logger.error(
            "Prova WEB: falha ao enfileirar render (%s/%s v%s): %s",
            os_id,
            ano,
            versao,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Falha ao iniciar a geração da prova.",
        ) from exc

    record = _get_record(ano, os_id)
    return {
        "ok": True,
        "record": record,
        "versionCount": count_prova_web_versions(ano, os_id),
        "portalUrl": None,
        "renderStatus": (record or {}).get("renderStatus"),
    }


def _expire_prova_web_tokens(ano: int, os_id: int, versao: int) -> None:
    db.execute_query(
        """
        UPDATE tabProofTokens
        SET DataExpiracao = NOW()
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
          AND TipoProva = 'prova_web'
          AND Versao = %s
          AND (Aprovado IS NULL)
          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
        """,
        (os_id, ano, str(int(versao))),
    )


@router.post("/os/{ano}/{os_id}/prova-web/{versao}/aprovar")
def aprovar_prova_web(ano: int, os_id: int, versao: int, request: Request):
    _require_prova_web(request)
    record = get_prova_web_record_by_versao(ano, os_id, versao)
    if not record:
        raise HTTPException(status_code=404, detail="Prova WEB não encontrada.")
    if not record.get("isDraft"):
        raise HTTPException(
            status_code=409,
            detail="Esta prova já está publicada.",
        )
    if not is_render_ready(record):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Aguarde a geração das páginas antes de aprovar.",
                "renderStatus": record.get("renderStatus"),
                "renderError": record.get("renderError"),
            },
        )
    set_prova_web_status(ano, os_id, versao, STATUS_PUBLICADO)
    ponto = _session_ponto(request)
    # Garante que o token use a versão aprovada (última publicada esperada).
    portal_url = _ensure_portal_link(ano, os_id, ponto, log_audit=True)
    record = get_prova_web_record_by_versao(ano, os_id, versao)
    return {
        "ok": True,
        "record": record,
        "portalUrl": portal_url,
        "versao": versao,
    }


@router.post("/os/{ano}/{os_id}/prova-web/{versao}/reprocessar")
def reprocessar_prova_web(ano: int, os_id: int, versao: int, request: Request):
    """Reenfileira render (erro, cancelado ou cache miss)."""
    _require_prova_web(request)
    record = get_prova_web_record_by_versao(ano, os_id, versao)
    if not record:
        raise HTTPException(status_code=404, detail="Prova WEB não encontrada.")
    if is_render_in_flight(record):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A geração desta prova já está em andamento.",
                "renderStatus": record.get("renderStatus"),
            },
        )
    folder = _os_folder(ano, os_id)
    pasta = record.get("pastaRender") or pasta_render_for_versao(versao)
    if folder and os.path.isdir(folder):
        try:
            delete_web_render_dir(folder, pasta)
        except Exception as exc:
            logger.warning(
                "Prova WEB: falha ao limpar pasta no reprocessar (%s/%s v%s): %s",
                os_id,
                ano,
                versao,
                exc,
            )
    try:
        _schedule_render(ano, os_id, versao)
    except Exception as exc:
        logger.error(
            "Prova WEB: falha ao reprocessar (%s/%s v%s): %s",
            os_id,
            ano,
            versao,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Falha ao reiniciar a geração da prova.",
        ) from exc
    record = get_prova_web_record_by_versao(ano, os_id, versao)
    return {
        "ok": True,
        "record": record,
        "renderStatus": (record or {}).get("renderStatus"),
    }


@router.delete("/os/{ano}/{os_id}/prova-web/{versao}")
def descartar_prova_web(ano: int, os_id: int, versao: int, request: Request):
    _require_prova_web(request)
    record = get_prova_web_record_by_versao(ano, os_id, versao)
    if not record:
        raise HTTPException(status_code=404, detail="Prova WEB não encontrada.")
    if not record.get("isDraft"):
        raise HTTPException(
            status_code=409,
            detail="Só é possível descartar provas em rascunho.",
        )
    cancel_prova_web_render(ano, os_id, versao)
    folder = _os_folder(ano, os_id)
    pasta = record.get("pastaRender") or pasta_render_for_versao(versao)
    if folder and os.path.isdir(folder):
        try:
            delete_web_render_dir(folder, pasta)
        except Exception as exc:
            logger.warning(
                "Prova WEB: falha ao apagar pasta ao descartar (%s/%s v%s): %s",
                os_id,
                ano,
                versao,
                exc,
            )
    _expire_prova_web_tokens(ano, os_id, versao)
    delete_prova_web_version(ano, os_id, versao)
    latest = _get_record(ano, os_id)
    return {
        "ok": True,
        "record": latest,
        "versionCount": count_prova_web_versions(ano, os_id),
    }


@router.get("/os/{ano}/{os_id}/prova-web/manifest")
def get_prova_web_manifest(ano: int, os_id: int, request: Request):
    _require_prova_web(request)
    record = _get_record(ano, os_id)
    if not record:
        raise HTTPException(
            status_code=404,
            detail="Nenhum arquivo de prova registrado para esta OS.",
        )
    manifest = _render_for_record(ano, os_id, record)

    base = f"/api/os/{ano}/{os_id}/prova-web/pages"
    pages = [
        {**page, "url": f"{base}/{page['page']}.png"}
        for page in manifest.get("pages", [])
    ]

    book_mockup = manifest.get("bookMockup")
    if isinstance(book_mockup, dict) and book_mockup.get("spineFile"):
        book_mockup = {
            **book_mockup,
            "spineUrl": f"/api/os/{ano}/{os_id}/prova-web/assets/{book_mockup['spineFile']}",
        }

    payload: dict[str, Any] = {
        **manifest,
        "pages": pages,
        "record": record,
        "isPapelaria": _is_papelaria_os(ano, os_id),
    }
    if book_mockup:
        payload["bookMockup"] = book_mockup
    if payload["isPapelaria"]:
        payload.update(_papelaria_mockup_meta(ano, os_id))
    return payload


@router.get("/os/{ano}/{os_id}/prova-web/pages/{page}.png")
def get_prova_web_page(ano: int, os_id: int, page: int, request: Request):
    _require_prova_web(request)
    record = _get_record(ano, os_id)
    if not record:
        raise HTTPException(status_code=404, detail="Prova não registrada.")
    _render_for_record(ano, os_id, record)
    folder = _require_os_folder(ano, os_id)
    pasta = record.get("pastaRender") or pasta_render_for_versao(
        int(record.get("versao") or 1)
    )
    try:
        path = resolve_rendered_page_path(folder, pasta, page)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


@router.get("/os/{ano}/{os_id}/prova-web/assets/{name}")
def get_prova_web_asset(ano: int, os_id: int, name: str, request: Request):
    """Assets auxiliares do render (ex.: spine.png) — fora da sequência do flipbook."""
    _require_prova_web(request)
    record = _get_record(ano, os_id)
    if not record:
        raise HTTPException(status_code=404, detail="Prova não registrada.")
    _render_for_record(ano, os_id, record)
    folder = _require_os_folder(ano, os_id)
    pasta = record.get("pastaRender") or pasta_render_for_versao(
        int(record.get("versao") or 1)
    )
    try:
        path = resolve_rendered_asset_path(folder, pasta, name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


# --- Modelos de dobra compartilhados (todos os usuários Prova WEB) ---


class FoldModelCreateBody(BaseModel):
    nome: str = Field(..., min_length=1, max_length=120)
    hint: str = Field("", max_length=240)
    config: dict[str, Any]
    ordem: int = 0


class FoldModelUpdateBody(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=120)
    hint: Optional[str] = Field(None, max_length=240)
    config: Optional[dict[str, Any]] = None
    ativo: Optional[bool] = None
    ordem: Optional[int] = None


@router.get("/prova-web/fold-models")
def list_prova_web_fold_models(
    request: Request,
    ativo: Optional[bool] = Query(None),
):
    _require_prova_web(request)
    from services import prova_web_fold_model_service as fold_models

    ativo_only = bool(ativo) if ativo is not None else False
    return {"models": fold_models.list_fold_models(ativo_only=ativo_only)}


@router.post("/prova-web/fold-models")
def create_prova_web_fold_model(body: FoldModelCreateBody, request: Request):
    _require_prova_web(request)
    from services import prova_web_fold_model_service as fold_models

    ponto = _session_ponto(request)
    try:
        model = fold_models.create_fold_model(
            nome=body.nome,
            hint=body.hint,
            config=body.config,
            ordem=body.ordem,
            updated_by_ponto=str(ponto) if ponto is not None else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"model": model}


@router.put("/prova-web/fold-models/{model_id}")
def update_prova_web_fold_model(
    model_id: int, body: FoldModelUpdateBody, request: Request
):
    _require_prova_web(request)
    from services import prova_web_fold_model_service as fold_models

    ponto = _session_ponto(request)
    try:
        model = fold_models.update_fold_model(
            model_id,
            nome=body.nome,
            hint=body.hint,
            config=body.config,
            ativo=body.ativo,
            ordem=body.ordem,
            updated_by_ponto=str(ponto) if ponto is not None else None,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"model": model}


@router.delete("/prova-web/fold-models/{model_id}")
def delete_prova_web_fold_model(model_id: int, request: Request):
    _require_prova_web(request)
    from services import prova_web_fold_model_service as fold_models

    if not fold_models.delete_fold_model(model_id):
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    return {"success": True}

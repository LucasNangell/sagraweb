"""
Rotas de pré-análise — isoladas do fluxo principal de análise técnica.

Somente leitura de PDFs na pasta Original; persiste snapshot por versão no MySQL;
não altera itens da análise nem andamento.
"""
from __future__ import annotations

import json
import logging
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pre-analise"])


class PreAnaliseRunRequest(BaseModel):
    versao_label: str = Field(..., min_length=1, description="Rótulo da versão (ex.: v2 (Original))")
    force: bool = Field(
        default=False,
        description="Ignora snapshot em cache e reexecuta todas as verificações.",
    )


def _executed_by_from_request(request: Request) -> str | None:
    try:
        from security.session_auth import get_session_from_request

        session = get_session_from_request(request)
        if session and session.ponto is not None:
            return str(session.ponto)
    except Exception:
        pass
    return None


def _resolve_snapshot_versao_label(ano: int, os_id: int, versao_label: str) -> str:
    """Rótulo canônico para persistência (ex.: v2 → v2 (Original))."""
    from routers.analise_routes import _resolve_version_display_label

    label = (versao_label or "").strip()
    if not label:
        return label
    resolved = _resolve_version_display_label(ano, os_id, label)
    if resolved and resolved != "—":
        return resolved
    return label


def _get_snapshot_for_version(
    ano: int,
    os_id: int,
    versao_label: str,
) -> tuple[dict | None, str]:
    """Busca snapshot pelo rótulo canônico, com fallback ao rótulo bruto."""
    from services.pre_analise.snapshot_store import get_snapshot

    canonical = _resolve_snapshot_versao_label(ano, os_id, versao_label)
    row = get_snapshot(ano, os_id, canonical)
    if row:
        return row, canonical
    raw = (versao_label or "").strip()
    if raw and raw != canonical:
        row = get_snapshot(ano, os_id, raw)
        if row:
            return row, raw
    return None, canonical


def _snapshot_cache_valid(cached: dict, current_fp: str) -> bool:
    """Snapshot reutilizável quando a pasta não mudou (compatível com registros antigos)."""
    if not cached.get("results"):
        return False
    cached_fp = cached.get("folder_fingerprint")
    if cached_fp is None:
        return True
    return cached_fp == current_fp


def _persist_snapshot(
    request: Request,
    ano: int,
    os_id: int,
    versao_label: str,
    results: list,
    *,
    folder_fingerprint: str | None = None,
) -> None:
    if not results:
        return
    from services.pre_analise.snapshot_store import save_snapshot

    save_snapshot(
        ano,
        os_id,
        _resolve_snapshot_versao_label(ano, os_id, versao_label),
        results,
        executed_by=_executed_by_from_request(request),
        folder_fingerprint=folder_fingerprint,
    )


def _resolve_version_folder(ano: int, os_id: int, versao_label: str) -> str:
    from routers.analise_routes import _get_os_folder_path, _resolve_original_folder_path

    target_os_dir = _get_os_folder_path(ano, os_id)
    if not target_os_dir:
        raise HTTPException(status_code=404, detail="Pasta da OS não encontrada na rede.")
    try:
        return _resolve_original_folder_path(target_os_dir, versao_label)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _prepare_pre_analise_folder(ano: int, os_id: int, versao_label: str) -> str:
    """Resolve pasta da versão, valida carga e reserva slot de execução."""
    from resilience.pre_analise_guard import pre_analise_job_slot, validate_pre_analise_folder

    folder = _resolve_version_folder(ano, os_id, versao_label)
    if not os.path.isdir(folder):
        raise HTTPException(status_code=404, detail="Pasta da versão não encontrada.")
    validate_pre_analise_folder(folder)
    return folder


@router.get("/analise/pre-analise/checks")
def get_pre_analise_checks():
    """Lista verificações disponíveis (para barra de progresso no cliente)."""
    from services.pre_analise.registry import list_checks

    return {"checks": list_checks()}


@router.get("/analise/{ano}/{os_id}/pre-analise/snapshots")
def list_pre_analise_snapshots(ano: int, os_id: int):
    """Índice de pré-análises salvas por versão (badges na árvore)."""
    from services.pre_analise.snapshot_store import list_snapshots_index

    return {
        "status": "success",
        "snapshots": list_snapshots_index(ano, os_id),
    }


@router.post("/analise/{ano}/{os_id}/pre-analise/snapshot")
def get_pre_analise_snapshot(ano: int, os_id: int, body: PreAnaliseRunRequest):
    """Carrega a pré-análise salva da versão indicada."""
    from services.pre_analise.folder_session import folder_fingerprint

    canonical_label = _resolve_snapshot_versao_label(ano, os_id, body.versao_label)
    row, _stored_label = _get_snapshot_for_version(ano, os_id, body.versao_label)
    if not row:
        return {
            "status": "success",
            "found": False,
            "versao_label": canonical_label,
        }

    stale = False
    try:
        folder = _resolve_version_folder(ano, os_id, body.versao_label)
        current_fp = folder_fingerprint(folder)
        stale = not _snapshot_cache_valid(row, current_fp)
    except HTTPException:
        pass

    return {
        "status": "success",
        "found": True,
        "stale": stale,
        "versao_label": canonical_label,
        "results": row["results"],
        "check_count": row["check_count"],
        "alert_count": row["alert_count"],
        "executed_at": row["executed_at"],
        "executed_by": row.get("executed_by"),
    }


@router.post("/analise/{ano}/{os_id}/pre-analise/estimate")
def estimate_pre_analise(ano: int, os_id: int, body: PreAnaliseRunRequest):
    """Estima duração total com base no histórico (páginas, PDFs e formato)."""
    from resilience.pre_analise_guard import validate_pre_analise_folder

    folder = _resolve_version_folder(ano, os_id, body.versao_label)
    if not os.path.isdir(folder):
        raise HTTPException(status_code=404, detail="Pasta da versão não encontrada.")
    validate_pre_analise_folder(folder)

    try:
        from services.pre_analise.context import PreAnaliseContext
        from services.pre_analise.folder_session import acquire_session, release_session
        from services.pre_analise.registry import _enabled_check_ids
        from services.pre_analise.timing_store import (
            build_estimate_payload,
            workload_from_pdf_infos,
        )

        check_ids = _enabled_check_ids()
        ctx = PreAnaliseContext(folder_path=folder, ano=ano, os_id=os_id)
        sess = acquire_session(folder)
        try:
            open_err, _ = sess.open_docs()
            if open_err:
                raise HTTPException(status_code=500, detail=open_err)
            pdf_infos = sess.load_pdf_infos()
            workload = workload_from_pdf_infos(pdf_infos)
            estimate = build_estimate_payload(check_ids, workload)
        finally:
            release_session(folder)

        return {"status": "success", "folder_path": folder, **estimate}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erro ao estimar pré-análise OS %s/%s", ano, os_id)
        raise HTTPException(status_code=500, detail="Erro ao estimar pré-análise.") from exc


@router.post("/analise/{ano}/{os_id}/pre-analise/run-all/stream")
def run_pre_analise_all_stream(
    request: Request,
    ano: int,
    os_id: int,
    body: PreAnaliseRunRequest,
):
    """
    Executa todas as verificações emitindo progresso em NDJSON (uma linha JSON por evento).
    """
    from resilience.pre_analise_guard import pre_analise_job_slot

    folder = _prepare_pre_analise_folder(ano, os_id, body.versao_label)

    from services.pre_analise.context import PreAnaliseContext
    from services.pre_analise.folder_session import folder_fingerprint
    from services.pre_analise.os_loader import load_os_details
    from services.pre_analise.registry import iter_all_checks
    current_fp = folder_fingerprint(folder)
    if not body.force:
        cached, _ = _get_snapshot_for_version(ano, os_id, body.versao_label)
        if cached and _snapshot_cache_valid(cached, current_fp):
            def cached_stream():
                for result in cached["results"]:
                    yield json.dumps(
                        {"type": "progress", "result": result, "cached": True},
                        ensure_ascii=False,
                    ) + "\n"
                yield json.dumps(
                    {
                        "type": "done",
                        "cached": True,
                        "check_count": cached.get("check_count"),
                        "alert_count": cached.get("alert_count"),
                    },
                    ensure_ascii=False,
                ) + "\n"

            return StreamingResponse(
                cached_stream(),
                media_type="application/x-ndjson",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )

    os_details = load_os_details(ano, os_id)
    ctx = PreAnaliseContext(
        folder_path=folder,
        ano=ano,
        os_id=os_id,
        os_details=os_details,
    )

    def event_stream():
        collected: list = []
        finished_ok = False
        try:
            with pre_analise_job_slot():
                for event in iter_all_checks(folder, ctx):
                    ev_type = event.get("type")
                    if ev_type == "progress" and event.get("result"):
                        collected.append(event["result"])
                    if ev_type == "done":
                        finished_ok = True
                    yield json.dumps(event, ensure_ascii=False) + "\n"
                if finished_ok and collected:
                    _persist_snapshot(
                        request,
                        ano,
                        os_id,
                        body.versao_label,
                        collected,
                        folder_fingerprint=current_fp,
                    )
        except HTTPException as http_exc:
            yield json.dumps(
                {"type": "error", "message": http_exc.detail},
                ensure_ascii=False,
            ) + "\n"
        except Exception:
            logger.exception("Erro no stream de pré-análise OS %s/%s", ano, os_id)
            yield json.dumps(
                {"type": "error", "message": "Erro ao executar pré-análise."},
                ensure_ascii=False,
            ) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/analise/{ano}/{os_id}/pre-analise/run-all")
def run_pre_analise_all(
    request: Request,
    ano: int,
    os_id: int,
    body: PreAnaliseRunRequest,
):
    """
    Executa todas as verificações em uma única requisição.

    Abre os PDFs da pasta uma vez e reutiliza o cache — muito mais rápido em rede.
    """
    from resilience.pre_analise_guard import pre_analise_job_slot

    folder = _prepare_pre_analise_folder(ano, os_id, body.versao_label)

    try:
        from services.pre_analise.context import PreAnaliseContext
        from services.pre_analise.folder_session import folder_fingerprint
        from services.pre_analise.os_loader import load_os_details
        from services.pre_analise.registry import run_all_checks
        current_fp = folder_fingerprint(folder)
        if not body.force:
            cached, _ = _get_snapshot_for_version(ano, os_id, body.versao_label)
            if cached and _snapshot_cache_valid(cached, current_fp):
                return {
                    "status": "success",
                    "folder_path": folder,
                    "versao_label": body.versao_label,
                    "results": cached["results"],
                    "total": len(cached["results"]),
                    "cached": True,
                }

        os_details = load_os_details(ano, os_id)
        ctx = PreAnaliseContext(
            folder_path=folder,
            ano=ano,
            os_id=os_id,
            os_details=os_details,
        )
        with pre_analise_job_slot():
            results = run_all_checks(folder, ctx)
            if results:
                _persist_snapshot(
                    request,
                    ano,
                    os_id,
                    body.versao_label,
                    results,
                    folder_fingerprint=current_fp,
                )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erro na pré-análise em lote OS %s/%s", ano, os_id)
        raise HTTPException(status_code=500, detail="Erro ao executar pré-análise.") from exc

    return {
        "status": "success",
        "folder_path": folder,
        "versao_label": body.versao_label,
        "results": results,
        "total": len(results),
    }


@router.post("/analise/{ano}/{os_id}/pre-analise/{check_id}")
def run_pre_analise_check(ano: int, os_id: int, check_id: str, body: PreAnaliseRunRequest):
    """Executa uma verificação de pré-análise na pasta Original da versão indicada."""
    from resilience.pre_analise_guard import pre_analise_job_slot, validate_pre_analise_folder

    folder = _resolve_version_folder(ano, os_id, body.versao_label)
    if not os.path.isdir(folder):
        raise HTTPException(status_code=404, detail="Pasta da versão não encontrada.")
    validate_pre_analise_folder(folder)

    try:
        from services.pre_analise.context import PreAnaliseContext
        from services.pre_analise.folder_session import attach_session
        from services.pre_analise.os_loader import load_os_details
        from services.pre_analise.registry import run_check

        os_details = load_os_details(ano, os_id)
        ctx = PreAnaliseContext(
            folder_path=folder,
            ano=ano,
            os_id=os_id,
            os_details=os_details,
        )
        with pre_analise_job_slot():
            attach_session(ctx)
            result = run_check(check_id, folder, ctx)
    except ValueError as exc:
        status = 403 if "desabilitada" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erro na pré-análise %s OS %s/%s", check_id, ano, os_id)
        raise HTTPException(status_code=500, detail="Erro ao executar pré-análise.") from exc

    return {
        "status": "success",
        "folder_path": folder,
        "versao_label": body.versao_label,
        "result": result,
    }

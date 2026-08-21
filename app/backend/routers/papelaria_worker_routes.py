"""Endpoints do worker Windows CorelDRAW — autenticação por secret."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/papelaria")


class WorkerHeartbeatPayload(BaseModel):
    worker_id: str = Field(..., min_length=1, max_length=64)
    meta: Dict[str, Any] = Field(default_factory=dict)


class WorkerClaimPayload(BaseModel):
    worker_id: str = Field(..., min_length=1, max_length=64)


class WorkerCompletePayload(BaseModel):
    worker_id: str = Field(..., min_length=1, max_length=64)
    arquivo_cdr: str = Field(default="", max_length=255)
    arquivo_pdf: str = Field(default="", max_length=255)
    artefatos: list[str] = Field(default_factory=list)
    log_resumo: Optional[str] = Field(None, max_length=4000)


class WorkerFailPayload(BaseModel):
    worker_id: str = Field(..., min_length=1, max_length=64)
    erro: str = Field(..., min_length=1, max_length=4000)
    log_resumo: Optional[str] = Field(None, max_length=4000)
    retryable: bool = False


class WorkerLogPayload(BaseModel):
    worker_id: str = Field(..., min_length=1, max_length=64)
    mensagem: str = Field(..., min_length=1, max_length=4000)
    nivel: str = Field(default="info", max_length=16)
    detalhe: Optional[Dict[str, Any]] = None


class WorkerInspectClaimPayload(BaseModel):
    worker_id: str = Field(..., min_length=1, max_length=64)


class WorkerInspectCompletePayload(BaseModel):
    worker_id: str = Field(..., min_length=1, max_length=64)
    campos: Dict[str, str] = Field(default_factory=dict)
    variaveis: list[str] = Field(default_factory=list)
    preview_layout: Optional[Dict[str, Any]] = None


class WorkerInspectFailPayload(BaseModel):
    worker_id: str = Field(..., min_length=1, max_length=64)
    erro: str = Field(..., min_length=1, max_length=4000)


@router.post("/worker/heartbeat")
def worker_heartbeat(payload: WorkerHeartbeatPayload):
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.record_worker_heartbeat(payload.worker_id, payload.meta)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro heartbeat worker: %s", e)
        raise HTTPException(500, "Erro ao registrar heartbeat.")


@router.post("/jobs/claim")
def worker_claim_job(payload: WorkerClaimPayload):
    try:
        from services import papelaria_jobs_service as jobs_svc

        job = jobs_svc.claim_next_job(payload.worker_id)
        if not job:
            return {"job": None}
        return {"job": job}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Erro claim job worker %s: %s", payload.worker_id, e)
        raise HTTPException(500, "Erro ao reivindicar job.")


@router.post("/jobs/{job_id}/complete")
def worker_complete_job(job_id: int, payload: WorkerCompletePayload):
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.complete_job(
            job_id=job_id,
            worker_id=payload.worker_id,
            arquivo_cdr=payload.arquivo_cdr,
            arquivo_pdf=payload.arquivo_pdf,
            log_resumo=payload.log_resumo,
            artefatos=payload.artefatos,
        )
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro complete job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao concluir job.")


@router.post("/jobs/{job_id}/fail")
def worker_fail_job(job_id: int, payload: WorkerFailPayload):
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.fail_job(
            job_id=job_id,
            worker_id=payload.worker_id,
            erro=payload.erro,
            log_resumo=payload.log_resumo,
            retryable=payload.retryable,
        )
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro fail job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao registrar falha do job.")


@router.post("/jobs/{job_id}/log")
def worker_append_log(job_id: int, payload: WorkerLogPayload):
    try:
        from services import papelaria_jobs_service as jobs_svc

        jobs_svc.worker_append_log(
            job_id=job_id,
            worker_id=payload.worker_id,
            mensagem=payload.mensagem,
            nivel=payload.nivel,
            detalhe=payload.detalhe,
        )
        return {"ok": True}
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro log job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao registrar log.")


@router.post("/worker/inspect/claim")
def worker_claim_inspect(payload: WorkerInspectClaimPayload):
    try:
        from services import papelaria_cdr_inspect_service as inspect_svc

        inspect = inspect_svc.claim_inspect_for_worker(payload.worker_id)
        if not inspect:
            return {"inspect": None}
        return {"inspect": inspect}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro claim inspect worker %s: %s", payload.worker_id, e)
        raise HTTPException(500, "Erro ao reivindicar inspeção de .cdr.")


@router.get("/worker/inspect/{inspect_id}/cdr")
def worker_download_inspect_cdr(inspect_id: str, worker_id: str):
    """Download do .cdr para inspeção local no worker (sem depender de UNC)."""
    from fastapi.responses import FileResponse

    try:
        from services import papelaria_cdr_inspect_service as inspect_svc

        path, download_name = inspect_svc.resolve_inspect_cdr_for_worker(
            inspect_id, worker_id
        )
        return FileResponse(
            path=str(path),
            media_type="application/octet-stream",
            filename=download_name,
        )
    except LookupError:
        raise HTTPException(404, "Inspeção não encontrada.")
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro download inspect %s: %s", inspect_id, e)
        raise HTTPException(500, "Erro ao baixar .cdr para inspeção.")


@router.post("/worker/inspect/{inspect_id}/complete")
def worker_complete_inspect(inspect_id: str, payload: WorkerInspectCompletePayload):
    try:
        from services import papelaria_cdr_inspect_service as inspect_svc

        return inspect_svc.complete_inspect(
            inspect_id,
            payload.worker_id,
            payload.campos,
            payload.variaveis,
            payload.preview_layout,
        )
    except LookupError:
        raise HTTPException(404, "Inspeção não encontrada.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro complete inspect %s: %s", inspect_id, e)
        raise HTTPException(500, "Erro ao concluir inspeção de .cdr.")


@router.post("/worker/inspect/{inspect_id}/fail")
def worker_fail_inspect(inspect_id: str, payload: WorkerInspectFailPayload):
    try:
        from services import papelaria_cdr_inspect_service as inspect_svc

        return inspect_svc.fail_inspect(inspect_id, payload.worker_id, payload.erro)
    except LookupError:
        raise HTTPException(404, "Inspeção não encontrada.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro fail inspect %s: %s", inspect_id, e)
        raise HTTPException(500, "Erro ao registrar falha da inspeção.")

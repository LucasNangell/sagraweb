"""Resumo em lote do pipeline Prova / Imposição para a lista de SPs."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

_MAX_ITEMS = 500

PROVA_PHASES = (
    "none",
    "queued",
    "processing",
    "ready_send",
    "alteracao",
    "approved",
)
IMPOSICAO_PHASES = (
    "hidden",
    "pending",
    "queued",
    "processing",
    "waiting_apogee",
    "ready",
)

_PROVA_JOB_TYPES = frozenset(
    {
        "create",
        "manual_corel",
        "export_existing_cdr",
        "credenciais_depol",
    }
)
_IMPOSICAO_JOB_TYPE = "imposicao"

_PROVA_SEFOC_RE = re.compile(r"ProvaSefoc\s+(\d+)\.pdf$", re.IGNORECASE)
_PROVA_LEGACY_RE = re.compile(r"Prova(\d+)_SEFOC\.pdf$", re.IGNORECASE)


def _parse_json_field(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return None


def _sp_key(ano: int, nro: int) -> str:
    return f"{int(ano)}-{int(nro)}"


def _extract_versao(*candidates: Any) -> Optional[int]:
    """Prefere número do ProvaSefoc no nome do arquivo; senão Versao do job."""
    from_name: Optional[int] = None
    from_int: Optional[int] = None
    for raw in candidates:
        if raw is None or raw == "":
            continue
        if isinstance(raw, int) and raw > 0 and from_int is None:
            from_int = raw
            continue
        text = str(raw).strip()
        if not text:
            continue
        match = _PROVA_SEFOC_RE.search(text) or _PROVA_LEGACY_RE.search(text)
        if match:
            from_name = int(match.group(1))
            break
        if text.isdigit() and from_int is None:
            val = int(text)
            if val > 0:
                from_int = val
    return from_name if from_name is not None else from_int


def _is_waiting_apogee(row: dict[str, Any]) -> bool:
    if (row.get("TipoJob") or "") != _IMPOSICAO_JOB_TYPE:
        return False
    if (row.get("Status") or "") != "completed":
        return False
    dados = _parse_json_field(row.get("DadosJson")) or {}
    if isinstance(dados, dict) and dados.get("aguardando_apogee") is True:
        return True
    pdf = (row.get("ArquivoPdfGerado") or "").strip()
    if not pdf:
        return True
    return pdf.lower().endswith(".jdf")


def _is_ready_imposicao(row: dict[str, Any]) -> bool:
    if (row.get("TipoJob") or "") != _IMPOSICAO_JOB_TYPE:
        return False
    if (row.get("Status") or "") != "completed":
        return False
    if _is_waiting_apogee(row):
        return False
    return bool((row.get("ArquivoPdfGerado") or "").strip())


def resolve_prova_phase(
    *,
    latest_prova_job: Optional[dict[str, Any]],
    has_alteracao: bool,
    alteracao_versao: Optional[int] = None,
) -> dict[str, Any]:
    """
    Prioridade: queued/processing > alteracao > approved > ready_send > none.
    """
    job_id: Optional[int] = None
    versao: Optional[int] = None
    if latest_prova_job:
        job_id = int(latest_prova_job["ID"])
        versao = _extract_versao(
            latest_prova_job.get("Versao"),
            latest_prova_job.get("ArquivoPdfGerado"),
        )
        status = (latest_prova_job.get("Status") or "").strip()
        if status == "pending":
            return {
                "phase": "queued",
                "versao": versao,
                "job_id": job_id,
            }
        if status == "processing":
            return {
                "phase": "processing",
                "versao": versao,
                "job_id": job_id,
            }

    if has_alteracao:
        return {
            "phase": "alteracao",
            "versao": alteracao_versao or versao,
            "job_id": job_id,
        }

    if latest_prova_job:
        status = (latest_prova_job.get("Status") or "").strip()
        revisao = (latest_prova_job.get("ProvaRevisao") or "").strip()
        has_pdf = bool((latest_prova_job.get("ArquivoPdfGerado") or "").strip())
        if status == "completed":
            if revisao == "approved":
                return {
                    "phase": "approved",
                    "versao": versao,
                    "job_id": job_id,
                }
            if revisao == "discarded":
                return {"phase": "none", "versao": None, "job_id": None}
            if revisao in ("pending", "") or has_pdf:
                return {
                    "phase": "ready_send",
                    "versao": versao,
                    "job_id": job_id,
                }

    return {"phase": "none", "versao": None, "job_id": None}


def resolve_imposicao_phase(
    *,
    prova_phase: str,
    latest_imposicao_job: Optional[dict[str, Any]],
) -> dict[str, Any]:
    if prova_phase != "approved":
        return {"phase": "hidden", "job_id": None}

    if latest_imposicao_job:
        job_id = int(latest_imposicao_job["ID"])
        status = (latest_imposicao_job.get("Status") or "").strip()
        if status == "pending":
            return {"phase": "queued", "job_id": job_id}
        if status == "processing":
            return {"phase": "processing", "job_id": job_id}
        if _is_waiting_apogee(latest_imposicao_job):
            return {"phase": "waiting_apogee", "job_id": job_id}
        if _is_ready_imposicao(latest_imposicao_job):
            return {"phase": "ready", "job_id": job_id}

    return {"phase": "pending", "job_id": None}


def _normalize_items(items: list[Any]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    seen: set[str] = set()
    for raw in items:
        if not isinstance(raw, dict):
            continue
        try:
            ano = int(raw.get("ano"))
            nro = int(raw.get("nro"))
        except (TypeError, ValueError):
            continue
        if ano < 2000 or ano > 2100 or nro < 1:
            continue
        key = _sp_key(ano, nro)
        if key in seen:
            continue
        seen.add(key)
        out.append((ano, nro))
        if len(out) >= _MAX_ITEMS:
            break
    return out


def _fetch_jobs_for_pairs(pairs: list[tuple[int, int]]) -> list[dict[str, Any]]:
    if not pairs:
        return []
    # (Ano, Nro) IN ((a,n), ...) — MySQL.
    placeholders = ", ".join(
        f"(%(ano_{i})s, %(nro_{i})s)" for i in range(len(pairs))
    )
    params: dict[str, Any] = {}
    for i, (ano, nro) in enumerate(pairs):
        params[f"ano_{i}"] = ano
        params[f"nro_{i}"] = nro
    return db.execute_query(
        f"""
        SELECT ID, AnoProtocolo, NroProtocolo, TipoJob, Status, ProvaRevisao,
               Versao, ArquivoPdfGerado, DadosJson, SolicitadoEm
        FROM tabPapelariaJobs
        WHERE (AnoProtocolo, NroProtocolo) IN ({placeholders})
        ORDER BY ID DESC
        """,
        params,
    ) or []


def _fetch_alteracoes_for_pairs(
    pairs: list[tuple[int, int]],
) -> dict[str, dict[str, Any]]:
    """Último pedido de alteração (token rejeitado com AlteracoesJson) por SP."""
    if not pairs:
        return {}
    placeholders = ", ".join(
        f"(%(ano_{i})s, %(nro_{i})s)" for i in range(len(pairs))
    )
    params: dict[str, Any] = {}
    for i, (ano, nro) in enumerate(pairs):
        params[f"ano_{i}"] = ano
        params[f"nro_{i}"] = nro
    rows = db.execute_query(
        f"""
        SELECT NroProtocolo, AnoProtocolo, AlteracoesJson, Versao,
               COALESCE(DataResposta, DataEnvio) AS Ordena
        FROM tabProofTokens
        WHERE Aprovado = 0
          AND AlteracoesJson IS NOT NULL
          AND (AnoProtocolo, NroProtocolo) IN ({placeholders})
        ORDER BY COALESCE(DataResposta, DataEnvio) DESC, ID DESC
        """,
        params,
    ) or []
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = _sp_key(int(row["AnoProtocolo"]), int(row["NroProtocolo"]))
        if key in out:
            continue
        parsed = _parse_json_field(row.get("AlteracoesJson"))
        versao = None
        if isinstance(parsed, dict):
            versao = _extract_versao(parsed.get("versao"), row.get("Versao"))
        else:
            versao = _extract_versao(row.get("Versao"))
        out[key] = {"versao": versao}
    return out


def build_sp_status_resumo(items: list[Any]) -> dict[str, Any]:
    """
    Monta resumo Prova/Imposição para a lista de SPs.

    Retorno: { \"items\": [ { ano, nro, prova, imposicao }, ... ] }
    """
    from services.papelaria_jobs_service import ensure_papelaria_jobs_tables

    ensure_papelaria_jobs_tables()
    pairs = _normalize_items(items)
    if not pairs:
        return {"items": []}

    jobs = _fetch_jobs_for_pairs(pairs)
    try:
        alteracoes = _fetch_alteracoes_for_pairs(pairs)
    except Exception:
        logger.exception(
            "Falha ao buscar pedidos de alteração de prova — seguindo sem eles"
        )
        alteracoes = {}

    prova_by_sp: dict[str, dict[str, Any]] = {}
    imposicao_by_sp: dict[str, dict[str, Any]] = {}
    for row in jobs:
        key = _sp_key(int(row["AnoProtocolo"]), int(row["NroProtocolo"]))
        tipo = (row.get("TipoJob") or "create").strip()
        if tipo in _PROVA_JOB_TYPES and key not in prova_by_sp:
            # Descarta prova discarded: procura próximo job útil.
            if (row.get("ProvaRevisao") or "").strip() == "discarded":
                continue
            prova_by_sp[key] = row
        if tipo == _IMPOSICAO_JOB_TYPE and key not in imposicao_by_sp:
            imposicao_by_sp[key] = row

    result: list[dict[str, Any]] = []
    for ano, nro in pairs:
        key = _sp_key(ano, nro)
        alt = alteracoes.get(key)
        prova = resolve_prova_phase(
            latest_prova_job=prova_by_sp.get(key),
            has_alteracao=bool(alt),
            alteracao_versao=(alt or {}).get("versao"),
        )
        imposicao = resolve_imposicao_phase(
            prova_phase=str(prova["phase"]),
            latest_imposicao_job=imposicao_by_sp.get(key),
        )
        result.append(
            {
                "ano": ano,
                "nro": nro,
                "prova": prova,
                "imposicao": imposicao,
            }
        )
    return {"items": result}

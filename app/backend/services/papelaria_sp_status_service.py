"""Resumo em lote do pipeline Prova / Imposição para a lista de SPs."""
from __future__ import annotations

import json
import logging
import os
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
    "waiting_client",
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

_SITUACAO_AGUARD_APROVACAO = "Aguard. Aprovação"
_SITUACAO_ENCAM_DOCUM = "Encam. de Docum."
_SITUACAO_EM_EXECUCAO = "Em Execução"

_ALTERACAO_OBS_RE = re.compile(
    r"(alterar\s+prova|solicito?u?\s+.{0,40}altera|dar\s+prosseguimento)",
    re.IGNORECASE,
)
_APROVADA_OBS_RE = re.compile(
    r"prova\s*v?\s*\d*\s*aprovada|aprovada\s+pelo\s+cliente",
    re.IGNORECASE,
)
_ALTERAR_PROVA_VERSAO_RE = re.compile(
    r"alterar\s+prova\s+(\d+)",
    re.IGNORECASE,
)
_APROVADA_VERSAO_RE = re.compile(
    r"prova\s*v?\s*(\d+)\s*aprovada",
    re.IGNORECASE,
)


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


def _situacao_matches(situacao: str, expected: str) -> bool:
    sit = (situacao or "").strip()
    exp = (expected or "").strip()
    if not sit or not exp:
        return False
    if sit == exp:
        return True
    # Prefixo com barra final (ex.: "Saída p/", "Tramit. de Prova p/")
    if exp.endswith("/") and sit.startswith(exp.rstrip("/")):
        return True
    if sit.startswith(exp):
        return True
    return False


def _is_triagem_situacao(situacao: str) -> bool:
    sit = (situacao or "").strip()
    if not sit:
        return False
    prefixes = ("Saída p/", "Tramit. de Prova p/", "Tramit. de Prévia p/")
    return any(sit.startswith(p.rstrip("/")) or sit.startswith(p) for p in prefixes)


def _obs_indicates_alteracao(obs: str) -> bool:
    return bool(_ALTERACAO_OBS_RE.search(obs or ""))


def _obs_indicates_aprovacao(obs: str) -> bool:
    return bool(_APROVADA_OBS_RE.search(obs or ""))


def _versao_from_obs(obs: str) -> Optional[int]:
    text = obs or ""
    match = _ALTERAR_PROVA_VERSAO_RE.search(text) or _APROVADA_VERSAO_RE.search(text)
    if match:
        return int(match.group(1))
    return None


def resolve_prova_phase(
    *,
    latest_prova_job: Optional[dict[str, Any]] = None,
    has_alteracao: bool = False,
    alteracao_versao: Optional[int] = None,
    andamento: Optional[dict[str, Any]] = None,
    folder_prova_versao: Optional[int] = None,
    cliente_aprovou: bool = False,
    aprovacao_versao: Optional[int] = None,
) -> dict[str, Any]:
    """
    Prioridade: job em voo > andamento/obs > pasta > job concluído/token.
    """
    job_id: Optional[int] = None
    versao: Optional[int] = None
    if latest_prova_job:
        job_id = int(latest_prova_job["ID"])
        versao = _extract_versao(
            latest_prova_job.get("ArquivoPdfGerado"),
            latest_prova_job.get("Versao"),
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

    situacao = ""
    obs = ""
    if isinstance(andamento, dict):
        situacao = str(andamento.get("situacao") or "").strip()
        obs = str(andamento.get("observacao") or "").strip()

    obs_alteracao = _obs_indicates_alteracao(obs)
    andamento_alteracao = obs_alteracao and (
        _is_triagem_situacao(situacao)
        or _situacao_matches(situacao, _SITUACAO_EM_EXECUCAO)
        or _situacao_matches(situacao, "Saída p/")
    )
    if has_alteracao or andamento_alteracao:
        return {
            "phase": "alteracao",
            "versao": alteracao_versao
            or _versao_from_obs(obs)
            or folder_prova_versao
            or versao,
            "job_id": job_id,
        }

    if _situacao_matches(situacao, _SITUACAO_AGUARD_APROVACAO):
        return {
            "phase": "waiting_client",
            "versao": folder_prova_versao or versao or _versao_from_obs(obs),
            "job_id": job_id,
        }

    # Aprovação interna + andamento Encam. = pronta para envio (ainda não é
    # aprovação final do cliente).
    if _situacao_matches(situacao, _SITUACAO_ENCAM_DOCUM):
        return {
            "phase": "ready_send",
            "versao": folder_prova_versao or versao or _versao_from_obs(obs),
            "job_id": job_id,
        }

    obs_aprovada = _obs_indicates_aprovacao(obs)
    job_approved = False
    job_ready_send = False
    if latest_prova_job:
        status = (latest_prova_job.get("Status") or "").strip()
        revisao = (latest_prova_job.get("ProvaRevisao") or "").strip()
        has_pdf = bool((latest_prova_job.get("ArquivoPdfGerado") or "").strip())
        if status == "completed":
            if revisao == "approved":
                job_approved = True
            elif revisao == "discarded":
                latest_prova_job = None
                job_id = None
                versao = None
            elif revisao in ("pending", "") or has_pdf:
                job_ready_send = True

    if job_approved or cliente_aprovou or obs_aprovada:
        return {
            "phase": "approved",
            "versao": aprovacao_versao
            or _versao_from_obs(obs)
            or folder_prova_versao
            or versao,
            "job_id": job_id,
        }

    if job_ready_send:
        return {
            "phase": "ready_send",
            "versao": folder_prova_versao or versao,
            "job_id": job_id,
        }

    if folder_prova_versao is not None:
        return {
            "phase": "ready_send",
            "versao": folder_prova_versao,
            "job_id": job_id,
        }

    return {"phase": "none", "versao": None, "job_id": None}


def resolve_imposicao_phase(
    *,
    prova_phase: str,
    latest_imposicao_job: Optional[dict[str, Any]] = None,
    has_digital_pdf: bool = False,
) -> dict[str, Any]:
    if prova_phase != "approved":
        return {"phase": "hidden", "job_id": None}

    job_id: Optional[int] = None
    if latest_imposicao_job:
        job_id = int(latest_imposicao_job["ID"])
        status = (latest_imposicao_job.get("Status") or "").strip()
        if status == "pending":
            return {"phase": "queued", "job_id": job_id}
        if status == "processing":
            return {"phase": "processing", "job_id": job_id}
        if _is_waiting_apogee(latest_imposicao_job):
            # PDF já na Digital encerra o wait mesmo com job desatualizado.
            if has_digital_pdf:
                return {"phase": "ready", "job_id": job_id}
            return {"phase": "waiting_apogee", "job_id": job_id}
        if _is_ready_imposicao(latest_imposicao_job):
            return {"phase": "ready", "job_id": job_id}

    if has_digital_pdf:
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


def _fetch_aprovacoes_for_pairs(
    pairs: list[tuple[int, int]],
) -> dict[str, dict[str, Any]]:
    """Último token de prova aprovado pelo cliente por SP."""
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
        SELECT NroProtocolo, AnoProtocolo, Versao,
               COALESCE(DataResposta, DataEnvio) AS Ordena
        FROM tabProofTokens
        WHERE Aprovado = 1
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
        out[key] = {"versao": _extract_versao(row.get("Versao"))}
    return out


def _fetch_andamentos_for_pairs(
    pairs: list[tuple[int, int]],
) -> dict[str, dict[str, Any]]:
    """Último andamento operacional (UltimoStatus=1) por SP."""
    if not pairs:
        return {}
    from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE
    from services.andamento_table import get_andamento_table

    table = get_andamento_table()
    placeholders = ", ".join(
        f"(%(ano_{i})s, %(nro_{i})s)" for i in range(len(pairs))
    )
    params: dict[str, Any] = {}
    for i, (ano, nro) in enumerate(pairs):
        params[f"ano_{i}"] = ano
        params[f"nro_{i}"] = nro
    rows = db.execute_query(
        f"""
        SELECT a.NroProtocoloLink AS nro,
               a.AnoProtocoloLink AS ano,
               a.SituacaoLink AS situacao,
               a.`Observaçao` AS observacao,
               a.`Data` AS data_andamento,
               a.CodStatus AS cod_status
        FROM {table} a
        WHERE a.UltimoStatus = 1
          AND (a.AnoProtocoloLink, a.NroProtocoloLink) IN ({placeholders})
          AND {MIRROR_EXCLUDE_CLAUSE}
        ORDER BY a.`Data` DESC, a.CodStatus DESC
        """,
        params,
    ) or []
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = _sp_key(int(row["ano"]), int(row["nro"]))
        if key in out:
            continue
        out[key] = {
            "situacao": str(row.get("situacao") or "").strip(),
            "observacao": str(row.get("observacao") or "").strip(),
        }
    return out


def _scan_folder_signals(ano: int, nro: int) -> dict[str, Any]:
    """Lê ProvaSefoc N e presença de PDF em Digital na pasta da OS."""
    result: dict[str, Any] = {
        "prova_versao": None,
        "has_digital_pdf": False,
    }
    try:
        from services.papelaria_jobs_service import resolve_os_papelaria_dir

        sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    except Exception:
        return result

    if not os.path.isdir(sefoc_dir):
        return result

    best_ver: Optional[int] = None
    try:
        for name in os.listdir(sefoc_dir):
            if not name.lower().endswith(".pdf"):
                continue
            ver = _extract_versao(name)
            if ver is None:
                continue
            if best_ver is None or ver > best_ver:
                best_ver = ver
    except OSError:
        pass
    result["prova_versao"] = best_ver

    digital_dir = os.path.normpath(os.path.join(sefoc_dir, "Digital"))
    if os.path.isdir(digital_dir):
        try:
            for name in os.listdir(digital_dir):
                if name.lower().endswith(".pdf"):
                    result["has_digital_pdf"] = True
                    break
        except OSError:
            pass
    return result


def _fetch_folder_signals_for_pairs(
    pairs: list[tuple[int, int]],
) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for ano, nro in pairs:
        key = _sp_key(ano, nro)
        try:
            out[key] = _scan_folder_signals(ano, nro)
        except Exception:
            logger.debug(
                "Falha ao inspecionar pasta SP %s/%s para status",
                nro,
                ano,
                exc_info=True,
            )
            out[key] = {"prova_versao": None, "has_digital_pdf": False}
    return out


def build_sp_status_resumo(items: list[Any]) -> dict[str, Any]:
    """
    Monta resumo Prova/Imposição para a lista de SPs.

    Combina jobs, tokens, andamento atual e arquivos na pasta Sefoc/Digital.
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

    try:
        aprovacoes = _fetch_aprovacoes_for_pairs(pairs)
    except Exception:
        logger.exception(
            "Falha ao buscar aprovações de prova — seguindo sem elas"
        )
        aprovacoes = {}

    try:
        andamentos = _fetch_andamentos_for_pairs(pairs)
    except Exception:
        logger.exception(
            "Falha ao buscar andamentos para status SP — seguindo sem eles"
        )
        andamentos = {}

    try:
        folders = _fetch_folder_signals_for_pairs(pairs)
    except Exception:
        logger.exception(
            "Falha ao inspecionar pastas para status SP — seguindo sem elas"
        )
        folders = {}

    # Alteração mais recente que aprovação: se ambos existem, preferir alteração
    # somente quando o token de alteração é o sinal ativo (já filtrado Aprovado=0).
    # Se houver aprovação e alteração, has_alteracao ainda marca alteração (fluxo
    # “cliente pediu mudança depois”); se só aprovação, cliente_aprovou.

    prova_by_sp: dict[str, dict[str, Any]] = {}
    imposicao_by_sp: dict[str, dict[str, Any]] = {}
    for row in jobs:
        key = _sp_key(int(row["AnoProtocolo"]), int(row["NroProtocolo"]))
        tipo = (row.get("TipoJob") or "create").strip()
        if tipo in _PROVA_JOB_TYPES and key not in prova_by_sp:
            if (row.get("ProvaRevisao") or "").strip() == "discarded":
                continue
            prova_by_sp[key] = row
        if tipo == _IMPOSICAO_JOB_TYPE and key not in imposicao_by_sp:
            imposicao_by_sp[key] = row

    result: list[dict[str, Any]] = []
    for ano, nro in pairs:
        key = _sp_key(ano, nro)
        alt = alteracoes.get(key)
        apr = aprovacoes.get(key)
        folder = folders.get(key) or {}
        prova = resolve_prova_phase(
            latest_prova_job=prova_by_sp.get(key),
            has_alteracao=bool(alt),
            alteracao_versao=(alt or {}).get("versao"),
            andamento=andamentos.get(key),
            folder_prova_versao=folder.get("prova_versao"),
            cliente_aprovou=bool(apr) and not bool(alt),
            aprovacao_versao=(apr or {}).get("versao"),
        )
        imposicao = resolve_imposicao_phase(
            prova_phase=str(prova["phase"]),
            latest_imposicao_job=imposicao_by_sp.get(key),
            has_digital_pdf=bool(folder.get("has_digital_pdf")),
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

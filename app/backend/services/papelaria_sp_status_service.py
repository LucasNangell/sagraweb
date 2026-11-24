"""Resumo em lote do pipeline Prova / Imposição para a lista de SPs.

O servidor é a fonte única do estado das colunas Prova e Imposição: o mesmo
resumo vale para todos os usuários (jobs e tokens no banco, andamento atual,
arquivos da pasta Sefoc e atividades em andamento registradas em
``papelaria_sp_activity``).

Prova (cronologia):
    none ──► processing ──► review ──► ready_send ──► waiting_client ──► approved
                ▲                      (Encam.)      (Aguard. Aprov.)        │
                └──────── alteracao ◄────────────────────┘ (cliente pede)    │
Imposição (só depois de approved):
    pending ──► waiting_juntada (Aguard. Juntada) ──► processing ──► ready

Regras de desempate (do mais forte para o mais fraco):
1. atividade/job em voo (fila, geração, JDF) → loading;
2. imposição feita/andando *depois* da última prova → prova aprovada;
3. prova gerada mais nova que o andamento atual, aguardando OK → review;
4. andamento atual (Aguard. Juntada / Aguard. Aprovação / Encam. de Docum.);
5. observação do andamento atual (aprovada / alteração / dar prosseguimento);
6. última resposta do cliente no portal, se mais nova que a última prova;
7. sem sinal: com prova na pasta → pendente com número; sem prova → none.

Número da prova = maior número em PDFs da pasta Sefoc com «Prova» no nome
(sem número: quantidade desses PDFs) — ver ``proof_files_service``.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

_MAX_ITEMS = 500

PROVA_PHASES = (
    "none",
    "queued",
    "processing",
    "review",
    "pending",
    "ready_send",
    "waiting_client",
    "alteracao",
    "approved",
)
IMPOSICAO_PHASES = (
    "hidden",
    "pending",
    "waiting_juntada",
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
# Gera arquivo final (sem prova), mas é processamento visível na lane Prova.
_PROVA_LANE_BUSY_TYPES = _PROVA_JOB_TYPES | {"timbrado_a4_digital"}
_IMPOSICAO_JOB_TYPE = "imposicao"

_SITUACAO_AGUARD_APROVACAO = "Aguard. Aprovação"
_SITUACAO_ENCAM_DOCUM = "Encam. de Docum."
_SITUACAO_AGUARD_JUNTADA = "Aguard. Juntada"

_ALTERACAO_OBS_RE = re.compile(
    r"(alterar\s+prova|solicito?u?\s+.{0,40}altera|dar\s+prosseguimento)",
    re.IGNORECASE,
)
_APROVADA_OBS_RE = re.compile(
    r"prova\s*v?\s*\d*\s*aprovada|aprovada\s+pelo\s+cliente",
    re.IGNORECASE,
)
_ENCAM_NAO_PROVA_RE = re.compile(r"timbrado", re.IGNORECASE)
_VERSAO_OBS_RE = re.compile(
    r"(?:alterar|enviar)\s+prova\s+(\d+)|prova\s*v?\s*(\d+)\s*aprovada|\bP(\d+)\s+enviada",
    re.IGNORECASE,
)

# Cache curto da varredura de pasta (rede): compartilhado entre usuários e
# invalidado em toda atualização de job / fim de atividade da SP.
_FOLDER_CACHE_TTL = 15.0
_folder_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_folder_cache_lock = threading.Lock()


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


def _ts(value: Any) -> Optional[float]:
    """datetime / ISO / epoch → epoch (datas do MySQL são hora local, como o mtime)."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, datetime):
        try:
            return value.timestamp()
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "")).timestamp()
    except ValueError:
        return None


def _newer(a: Optional[float], b: Optional[float]) -> bool:
    """``a`` aconteceu depois (ou junto) de ``b``; sem ``b`` conhecido, vale ``a``."""
    if a is None:
        return False
    if b is None:
        return True
    return a >= b


def _extract_versao(*candidates: Any) -> Optional[int]:
    """Número da prova no nome do arquivo; senão primeiro inteiro positivo."""
    from services.proof_files_service import extract_prova_version_from_filename

    from_int: Optional[int] = None
    for raw in candidates:
        if raw is None or raw == "":
            continue
        if isinstance(raw, int):
            if raw > 0 and from_int is None:
                from_int = raw
            continue
        text = str(raw).strip()
        if not text:
            continue
        ver = extract_prova_version_from_filename(text)
        if ver is not None:
            return ver
        if text.isdigit() and from_int is None and int(text) > 0:
            from_int = int(text)
    return from_int


def _versao_from_obs(obs: str) -> Optional[int]:
    best: Optional[int] = None
    for match in _VERSAO_OBS_RE.finditer(obs or ""):
        raw = next((g for g in match.groups() if g), None)
        if raw:
            val = int(raw)
            if best is None or val > best:
                best = val
    return best


def _situacao_matches(situacao: str, expected: str) -> bool:
    sit = (situacao or "").strip()
    exp = (expected or "").strip()
    if not sit or not exp:
        return False
    return sit == exp or sit.startswith(exp.rstrip("/"))


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


def _job_ts(row: Optional[dict[str, Any]], *, done: bool = False) -> Optional[float]:
    if not row:
        return None
    if done:
        return _ts(row.get("ConcluidoEm")) or _ts(row.get("SolicitadoEm"))
    return _ts(row.get("SolicitadoEm")) or _ts(row.get("ConcluidoEm"))


def _por(row: Optional[dict[str, Any]]) -> Optional[str]:
    if not row:
        return None
    value = str(row.get("SolicitadoPor") or "").strip()
    return value or None


# ---------------------------------------------------------------------------
# Regras
# ---------------------------------------------------------------------------


def imposicao_job_relevante(
    imposicao_job: Optional[dict[str, Any]],
    prova_ts: Optional[float],
) -> bool:
    """Job de imposição posterior à última prova (e não falho/cancelado)."""
    if not imposicao_job:
        return False
    status = (imposicao_job.get("Status") or "").strip()
    if status in ("failed", "cancelled"):
        return False
    return _newer(_job_ts(imposicao_job), prova_ts)


def resolve_prova_phase(
    *,
    prova_job: Optional[dict[str, Any]] = None,
    busy_job: Optional[dict[str, Any]] = None,
    failed_job: Optional[dict[str, Any]] = None,
    folder: Optional[dict[str, Any]] = None,
    andamento: Optional[dict[str, Any]] = None,
    last_response: Optional[dict[str, Any]] = None,
    imposicao_feita: bool = False,
) -> dict[str, Any]:
    """
    Fase da coluna Prova.

    ``prova_job``: último job de prova concluído (não descartado);
    ``busy_job``: job de prova em fila/geração; ``failed_job``: último job
    falho, quando mais novo que ``prova_job``; ``folder``: resumo da pasta
    (``prova_count``, ``prova_versao``, ``prova_mtime``); ``andamento``: atual
    (``situacao``, ``observacao``, ``data``); ``last_response``: última
    resposta do cliente no portal (``aprovado``, ``versao``, ``data``).
    """
    folder = folder or {}
    count = int(folder.get("prova_count") or 0)
    versao_pasta: Optional[int] = folder.get("prova_versao")
    prova_ts = folder.get("prova_mtime")

    situacao = ""
    obs = ""
    and_ts: Optional[float] = None
    if isinstance(andamento, dict):
        situacao = str(andamento.get("situacao") or "").strip()
        obs = str(andamento.get("observacao") or "").strip()
        and_ts = _ts(andamento.get("data"))

    job_id = int(prova_job["ID"]) if prova_job else None

    def out(phase: str, versao: Optional[int] = None, **extra: Any) -> dict[str, Any]:
        item: dict[str, Any] = {
            "phase": phase,
            "versao": versao if versao is not None else versao_pasta,
            "count": count,
            "job_id": extra.pop("job_id", job_id),
        }
        if failed_job and phase in ("none", "pending", "alteracao"):
            item["falhou"] = True
        item.update({k: v for k, v in extra.items() if v is not None})
        return item

    # 1. Job em voo (fila do worker / gerando).
    if busy_job:
        status = (busy_job.get("Status") or "").strip()
        return out(
            "queued" if status == "pending" else "processing",
            job_id=int(busy_job["ID"]),
            por=_por(busy_job),
        )

    # 2. Imposição posterior à última prova ⇒ a prova foi aprovada.
    if imposicao_feita or _situacao_matches(situacao, _SITUACAO_AGUARD_JUNTADA):
        return out("approved")

    # 3. Prova gerada depois do andamento atual, aguardando o OK do técnico.
    if prova_job:
        status = (prova_job.get("Status") or "").strip()
        revisao = (prova_job.get("ProvaRevisao") or "").strip()
        has_pdf = bool((prova_job.get("ArquivoPdfGerado") or "").strip())
        if (
            status == "completed"
            and revisao in ("pending", "")
            and has_pdf
            and _newer(_job_ts(prova_job, done=True), and_ts)
        ):
            return out("review")

    # 4. Andamento atual.
    if _situacao_matches(situacao, _SITUACAO_AGUARD_APROVACAO):
        return out("waiting_client", versao_pasta or _versao_from_obs(obs))
    if _situacao_matches(situacao, _SITUACAO_ENCAM_DOCUM) and not _ENCAM_NAO_PROVA_RE.search(
        obs
    ):
        return out("ready_send", versao_pasta or _versao_from_obs(obs))

    # 5. Observação do andamento atual (portal / e-mail / lançamento manual).
    if _APROVADA_OBS_RE.search(obs):
        return out("approved", versao_pasta or _versao_from_obs(obs))
    if _ALTERACAO_OBS_RE.search(obs):
        return out("alteracao", versao_pasta or _versao_from_obs(obs))

    # 6. Resposta do cliente no portal mais nova que a última prova.
    if last_response and _newer(_ts(last_response.get("data")), prova_ts):
        versao_resp = _extract_versao(last_response.get("versao"))
        if last_response.get("aprovado"):
            return out("approved", versao_pasta or versao_resp)
        return out("alteracao", versao_pasta or versao_resp)

    # 7. Sem sinal claro.
    if count > 0:
        return out("pending")
    return out("none", None)


def resolve_imposicao_phase(
    *,
    prova_phase: str,
    imposicao_job: Optional[dict[str, Any]] = None,
    digital_ts: Optional[float] = None,
    prova_ts: Optional[float] = None,
    andamento: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Fase da coluna Imposição (oculta enquanto a prova não foi aprovada)."""
    if prova_phase != "approved":
        return {"phase": "hidden", "job_id": None}

    situacao = ""
    if isinstance(andamento, dict):
        situacao = str(andamento.get("situacao") or "").strip()

    falhou = False
    if imposicao_job and _newer(_job_ts(imposicao_job), prova_ts):
        job_id = int(imposicao_job["ID"])
        status = (imposicao_job.get("Status") or "").strip()
        por = _por(imposicao_job)
        base: dict[str, Any] = {"job_id": job_id}
        if por:
            base["por"] = por
        dados = _parse_json_field(imposicao_job.get("DadosJson")) or {}
        ancora = dados.get("ancora") if isinstance(dados, dict) else None
        if isinstance(ancora, dict):
            base["ancora"] = {
                "ano": ancora.get("ano"),
                "nro": ancora.get("nro"),
            }
        if status == "pending":
            return {"phase": "queued", **base}
        if status == "processing":
            return {"phase": "processing", **base}
        if _is_waiting_apogee(imposicao_job):
            # PDF já na Digital encerra a espera mesmo com job desatualizado.
            if _newer(digital_ts, _job_ts(imposicao_job)):
                return {"phase": "ready", **base}
            return {"phase": "waiting_apogee", **base}
        if _is_ready_imposicao(imposicao_job):
            return {"phase": "ready", **base}
        falhou = status == "failed"

    if digital_ts is not None and _newer(digital_ts, prova_ts):
        return {"phase": "ready", "job_id": None}

    if _situacao_matches(situacao, _SITUACAO_AGUARD_JUNTADA):
        return {"phase": "waiting_juntada", "job_id": None}

    item: dict[str, Any] = {"phase": "pending", "job_id": None}
    if falhou:
        item["falhou"] = True
    return item


def apply_activity(
    prova: dict[str, Any],
    imposicao: dict[str, Any],
    activity: Optional[dict[str, dict[str, Any]]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Atividade síncrona em andamento (registrada no servidor) vira loading."""
    if not activity:
        return prova, imposicao
    prova_act = activity.get("prova")
    if prova_act and prova.get("phase") not in ("queued", "processing"):
        prova = {
            **prova,
            "phase": "processing",
            "atividade": prova_act.get("label") or None,
            "por": prova_act.get("ponto") or prova.get("por"),
        }
    imp_act = activity.get("imposicao")
    if imp_act and imposicao.get("phase") not in ("queued", "processing"):
        if prova.get("phase") not in ("queued", "processing"):
            prova = {**prova, "phase": "approved"}
        imposicao = {
            **imposicao,
            "phase": "processing",
            "atividade": imp_act.get("label") or None,
            "por": imp_act.get("ponto") or imposicao.get("por"),
        }
    return prova, imposicao


# ---------------------------------------------------------------------------
# Coleta
# ---------------------------------------------------------------------------


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


def _pairs_clause(
    pairs: list[tuple[int, int]], ano_col: str, nro_col: str
) -> tuple[str, dict[str, Any]]:
    placeholders = ", ".join(f"(%(ano_{i})s, %(nro_{i})s)" for i in range(len(pairs)))
    params: dict[str, Any] = {}
    for i, (ano, nro) in enumerate(pairs):
        params[f"ano_{i}"] = ano
        params[f"nro_{i}"] = nro
    return f"({ano_col}, {nro_col}) IN ({placeholders})", params


_JOB_COLUMNS = """
    ID, AnoProtocolo, NroProtocolo, TipoJob, Status, ProvaRevisao, Versao,
    ArquivoPdfGerado, DadosJson, SolicitadoEm, ConcluidoEm, SolicitadoPor
"""


def _fetch_jobs_for_pairs(pairs: list[tuple[int, int]]) -> list[dict[str, Any]]:
    if not pairs:
        return []
    clause, params = _pairs_clause(pairs, "AnoProtocolo", "NroProtocolo")
    return db.execute_query(
        f"""
        SELECT {_JOB_COLUMNS}
        FROM tabPapelariaJobs
        WHERE {clause}
        ORDER BY ID DESC
        """,
        params,
    ) or []


def _fetch_juntada_jobs() -> list[dict[str, Any]]:
    """Jobs de imposição pré-impressa com OSs juntadas (membros fora da âncora)."""
    return db.execute_query(
        f"""
        SELECT {_JOB_COLUMNS}
        FROM tabPapelariaJobs
        WHERE TipoJob = %(tipo)s
          AND DadosJson LIKE %(like)s
        ORDER BY ID DESC
        LIMIT 300
        """,
        {"tipo": _IMPOSICAO_JOB_TYPE, "like": '%"juntada_membros": [{%'},
    ) or []


def _fetch_last_responses_for_pairs(
    pairs: list[tuple[int, int]],
) -> dict[str, dict[str, Any]]:
    """Última resposta do cliente (aprovou / pediu alteração) por SP."""
    if not pairs:
        return {}
    clause, params = _pairs_clause(pairs, "AnoProtocolo", "NroProtocolo")
    rows = db.execute_query(
        f"""
        SELECT NroProtocolo, AnoProtocolo, Versao, Aprovado, DataResposta
        FROM tabProofTokens
        WHERE Aprovado IS NOT NULL
          AND DataResposta IS NOT NULL
          AND {clause}
        ORDER BY DataResposta DESC, ID DESC
        """,
        params,
    ) or []
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = _sp_key(int(row["AnoProtocolo"]), int(row["NroProtocolo"]))
        if key in out:
            continue
        out[key] = {
            "aprovado": bool(int(row.get("Aprovado") or 0)),
            "versao": row.get("Versao"),
            "data": row.get("DataResposta"),
        }
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
    clause, params = _pairs_clause(pairs, "a.AnoProtocoloLink", "a.NroProtocoloLink")
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
          AND {clause}
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
            "data": row.get("data_andamento"),
        }
    return out


def _empty_folder_signals() -> dict[str, Any]:
    return {
        "prova_count": 0,
        "prova_versao": None,
        "prova_mtime": None,
        "prova_latest": None,
        "digital_mtime": None,
        "has_digital_pdf": False,
    }


def _scan_folder_signals(ano: int, nro: int) -> dict[str, Any]:
    """Provas (PDFs com «Prova» no nome) e PDFs de imposição em Digital."""
    from services.proof_files_service import summarize_prova_files

    result = _empty_folder_signals()
    try:
        from services.papelaria_jobs_service import resolve_os_papelaria_dir

        sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    except Exception:
        return result

    if not os.path.isdir(sefoc_dir):
        return result

    entries: list[tuple[str, float]] = []
    try:
        with os.scandir(sefoc_dir) as it:
            for entry in it:
                if not entry.name.lower().endswith(".pdf"):
                    continue
                try:
                    if not entry.is_file():
                        continue
                    mtime = entry.stat().st_mtime
                except OSError:
                    mtime = 0.0
                entries.append((entry.name, mtime))
    except OSError:
        pass
    summary = summarize_prova_files(entries)
    result["prova_count"] = summary["count"]
    result["prova_versao"] = summary["versao"]
    result["prova_mtime"] = summary["latest_mtime"]
    result["prova_latest"] = summary["latest"]

    digital_dir = os.path.normpath(os.path.join(sefoc_dir, "Digital"))
    if os.path.isdir(digital_dir):
        latest: Optional[float] = None
        try:
            with os.scandir(digital_dir) as it:
                for entry in it:
                    if not entry.name.lower().endswith(".pdf"):
                        continue
                    try:
                        mtime = entry.stat().st_mtime
                    except OSError:
                        mtime = 0.0
                    if latest is None or mtime > latest:
                        latest = mtime
        except OSError:
            pass
        if latest is not None:
            result["digital_mtime"] = latest
            result["has_digital_pdf"] = True
    return result


def invalidate_folder_signals(ano: int, nro: int) -> None:
    with _folder_cache_lock:
        _folder_cache.pop(_sp_key(ano, nro), None)


def _folder_signals_cached(ano: int, nro: int) -> dict[str, Any]:
    key = _sp_key(ano, nro)
    now = time.monotonic()
    with _folder_cache_lock:
        hit = _folder_cache.get(key)
        if hit and now - hit[0] < _FOLDER_CACHE_TTL:
            return hit[1]
    try:
        value = _scan_folder_signals(ano, nro)
    except Exception:
        logger.debug(
            "Falha ao inspecionar pasta SP %s/%s para status", nro, ano, exc_info=True
        )
        value = _empty_folder_signals()
    with _folder_cache_lock:
        _folder_cache[key] = (time.monotonic(), value)
        if len(_folder_cache) > 4000:
            cutoff = time.monotonic() - _FOLDER_CACHE_TTL
            for k in [k for k, (t, _v) in _folder_cache.items() if t < cutoff]:
                _folder_cache.pop(k, None)
    return value


def _fetch_folder_signals_for_pairs(
    pairs: list[tuple[int, int]],
) -> dict[str, dict[str, Any]]:
    if not pairs:
        return {}
    workers = min(8, len(pairs))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="sp-status") as pool:
        values = list(pool.map(lambda p: _folder_signals_cached(*p), pairs))
    return {_sp_key(a, n): v for (a, n), v in zip(pairs, values)}


def _pick_jobs(
    jobs: list[dict[str, Any]],
) -> tuple[
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
]:
    """(último concluído, em voo, último falho, último de imposição) por SP."""
    done: dict[str, dict[str, Any]] = {}
    busy: dict[str, dict[str, Any]] = {}
    failed: dict[str, dict[str, Any]] = {}
    imposicao: dict[str, dict[str, Any]] = {}
    for row in jobs:  # ORDER BY ID DESC
        key = _sp_key(int(row["AnoProtocolo"]), int(row["NroProtocolo"]))
        tipo = (row.get("TipoJob") or "create").strip()
        status = (row.get("Status") or "").strip()
        if tipo == _IMPOSICAO_JOB_TYPE:
            if status != "cancelled":
                imposicao.setdefault(key, row)
            continue
        if tipo not in _PROVA_LANE_BUSY_TYPES:
            continue
        if status in ("pending", "processing"):
            busy.setdefault(key, row)
            continue
        if tipo not in _PROVA_JOB_TYPES:
            continue
        if status == "failed":
            if key not in done:
                failed.setdefault(key, row)
            continue
        if status != "completed":
            continue
        if (row.get("ProvaRevisao") or "").strip() == "discarded":
            continue
        done.setdefault(key, row)
    return done, busy, failed, imposicao


def _merge_juntada_jobs(
    imposicao_by_sp: dict[str, dict[str, Any]],
    juntada_jobs: list[dict[str, Any]],
    wanted: set[str],
) -> None:
    """OSs membros de juntada herdam o job de imposição da âncora (o mais novo vence)."""
    for row in juntada_jobs:
        dados = _parse_json_field(row.get("DadosJson")) or {}
        membros = dados.get("juntada_membros") if isinstance(dados, dict) else None
        if not isinstance(membros, list):
            continue
        for membro in membros:
            if not isinstance(membro, dict):
                continue
            try:
                key = _sp_key(int(membro.get("ano")), int(membro.get("nro")))
            except (TypeError, ValueError):
                continue
            if key not in wanted:
                continue
            cur = imposicao_by_sp.get(key)
            if cur is None or int(row["ID"]) > int(cur["ID"]):
                imposicao_by_sp[key] = row


def build_sp_status_resumo(items: list[Any]) -> dict[str, Any]:
    """
    Monta resumo Prova/Imposição para a lista de SPs.

    Retorno: ``{"items": [{ano, nro, prova, imposicao}, ...]}``.
    """
    from services.papelaria_jobs_service import ensure_papelaria_jobs_tables
    from services import papelaria_sp_activity as activity_svc

    ensure_papelaria_jobs_tables()
    pairs = _normalize_items(items)
    if not pairs:
        return {"items": []}

    jobs = _fetch_jobs_for_pairs(pairs)
    try:
        juntada_jobs = _fetch_juntada_jobs()
    except Exception:
        logger.exception("Falha ao buscar jobs de juntada — seguindo sem eles")
        juntada_jobs = []

    try:
        responses = _fetch_last_responses_for_pairs(pairs)
    except Exception:
        logger.exception("Falha ao buscar respostas de prova — seguindo sem elas")
        responses = {}

    try:
        andamentos = _fetch_andamentos_for_pairs(pairs)
    except Exception:
        logger.exception("Falha ao buscar andamentos para status SP — seguindo sem eles")
        andamentos = {}

    try:
        folders = _fetch_folder_signals_for_pairs(pairs)
    except Exception:
        logger.exception("Falha ao inspecionar pastas para status SP — seguindo sem elas")
        folders = {}

    activities = activity_svc.snapshot(pairs)

    done_by_sp, busy_by_sp, failed_by_sp, imposicao_by_sp = _pick_jobs(jobs)
    _merge_juntada_jobs(
        imposicao_by_sp, juntada_jobs, {_sp_key(a, n) for a, n in pairs}
    )

    result: list[dict[str, Any]] = []
    for ano, nro in pairs:
        key = _sp_key(ano, nro)
        folder = folders.get(key) or _empty_folder_signals()
        andamento = andamentos.get(key)
        imp_job = imposicao_by_sp.get(key)
        prova_ts = folder.get("prova_mtime")
        digital_ts = folder.get("digital_mtime")
        imposicao_feita = imposicao_job_relevante(imp_job, prova_ts) or (
            digital_ts is not None and _newer(digital_ts, prova_ts)
        )
        prova = resolve_prova_phase(
            prova_job=done_by_sp.get(key),
            busy_job=busy_by_sp.get(key),
            failed_job=failed_by_sp.get(key),
            folder=folder,
            andamento=andamento,
            last_response=responses.get(key),
            imposicao_feita=imposicao_feita,
        )
        imposicao = resolve_imposicao_phase(
            prova_phase=str(prova["phase"]),
            imposicao_job=imp_job,
            digital_ts=digital_ts,
            prova_ts=prova_ts,
            andamento=andamento,
        )
        prova, imposicao = apply_activity(prova, imposicao, activities.get(key))
        result.append(
            {
                "ano": ano,
                "nro": nro,
                "prova": prova,
                "imposicao": imposicao,
            }
        )
    return {"items": result}


def estado_da_sp(ano: int, nro: int) -> dict[str, Any]:
    """
    Situação atual e fase da prova de uma SP (página Papelaria): o mesmo
    cálculo dos ícones da lista. Nunca levanta — falha vira ``None``.
    """
    out: dict[str, Any] = {"andamento": None, "prova_status": None}
    try:
        andamento = _fetch_andamentos_for_pairs([(int(ano), int(nro))]).get(_sp_key(int(ano), int(nro)))
        if andamento:
            data = andamento.get("data")
            out["andamento"] = {
                "situacao": andamento.get("situacao") or "",
                "observacao": andamento.get("observacao") or "",
                "data": data.isoformat() if hasattr(data, "isoformat") else (str(data) if data else None),
            }
    except Exception as exc:  # noqa: BLE001 — o contexto da SP não pode quebrar por isso
        logger.warning("Papelaria: andamento da SP %s/%s indisponível: %s", nro, ano, exc)
    try:
        itens = build_sp_status_resumo([{"ano": int(ano), "nro": int(nro)}]).get("items") or []
        prova = (itens[0] or {}).get("prova") if itens else None
        if isinstance(prova, dict):
            out["prova_status"] = {"phase": prova.get("phase"), "versao": prova.get("versao")}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Papelaria: fase da prova da SP %s/%s indisponível: %s", nro, ano, exc)
    return out

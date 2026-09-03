"""Montagem do Gantt de Fluxo de Produção por OS."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from database import db
from services import expediente_service
from services.andamento_table import get_andamento_table
from services.orcamento_pessoal import blend_horas, prior_horas
from services.orcamento_passo_priors import ACABAMENTO_PASSOS
from services.orcamento_produto_passos_service import list_passos_por_produto
from services.os_fluxo_andamento_pares import (
    ANO_MIN_HISTORICO_PREVISAO,
    SETUP_SPLIT_MIN,
    SITUACOES_TERMINAL,
    current_cliente_pause,
    find_inicio_producao_em,
    is_setor_gantt,
    pair_setor_stints,
    sort_andamentos,
)
from os_fluxo_baseline_schema import ensure_os_fluxo_baseline_schema

logger = logging.getLogger(__name__)

MODELO_VERSAO = "fluxo-gantt-v1"
_TZ_BRASILIA = ZoneInfo("America/Sao_Paulo")


def _now_brasilia() -> datetime:
    """Horário atual em Brasília (naive, sem tzinfo) para o Gantt."""
    return datetime.now(_TZ_BRASILIA).replace(tzinfo=None)


def _is_entregue(situacao: str | None, andamentos: list[dict[str, Any]] | None = None) -> bool:
    if str(situacao or "").strip().casefold() == "entregue":
        return True
    for row in andamentos or []:
        if str(row.get("situacao") or "").strip().casefold() == "entregue":
            return True
    return False

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 12.0

_FALLBACK_MARCOS = [
    {"id": "pre-impressao", "rotulo": "Pré-impressão", "setor": "SEFOC", "tipo": "produtiva", "duracao_min": 60},
    {"id": "impressao", "rotulo": "Impressão", "setor": "SIELT", "tipo": "produtiva", "duracao_min": 120},
    {"id": "acabamento", "rotulo": "Acabamento", "setor": "SEPAC", "tipo": "produtiva", "duracao_min": 90},
    {"id": "gravacao", "rotulo": "Gravação", "setor": "Gravação", "tipo": "gravacao", "duracao_min": 45},
    {"id": "expedicao", "rotulo": "Expedição", "setor": "SEDIR", "tipo": "expedicao", "duracao_min": 30},
]


def invalidate_fluxo_producao_cache(ano: int | None = None, os_id: int | None = None) -> None:
    if ano is None or os_id is None:
        _CACHE.clear()
        return
    _CACHE.pop(f"{ano}:{os_id}", None)


def _isoformat(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _slug(text: str) -> str:
    raw = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").strip().lower()).strip("-")
    return raw or "etapa"


def _load_andamentos(ano: int, os_id: int) -> list[dict[str, Any]]:
    andamento_tbl = get_andamento_table()
    rows = (
        db.execute_query(
            f"""
            SELECT a.CodStatus, a.SituacaoLink, a.SetorLink, a.Data, a.Ponto,
                   a.`Observaçao` AS Observacao, u.Nome AS usuario_nome
            FROM {andamento_tbl} a
            LEFT JOIN tabUsuarios u
              ON u.Ponto = CAST(REPLACE(REPLACE(COALESCE(a.Ponto, ''), '.', ''), '-', '') AS UNSIGNED)
            WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
            ORDER BY a.CodStatus
            """,
            (os_id, ano),
        )
        or []
    )
    # Normaliza chave Observaçao
    for r in rows:
        if "Observacao" in r and "Observaçao" not in r:
            r["Observaçao"] = r.get("Observacao")
    return sort_andamentos(rows)


def _load_os_meta(ano: int, os_id: int) -> dict[str, Any]:
    rows = (
        db.execute_query(
            """
            SELECT p.NroProtocolo AS nr_os, p.AnoProtocolo AS ano,
                   p.EntregData, p.EntregPrazoLink AS prioridade,
                   d.Titulo AS titulo, d.TipoPublicacaoLink AS produto,
                   d.Tiragem AS tiragem, d.Pags AS pags, d.FormatoLink AS formato,
                   d.DescAcabamento AS acabamento, d.MaquinaLink AS maquina
            FROM tabProtocolos p
            LEFT JOIN tabDetalhesServico d
              ON d.NroProtocoloLinkDet = p.NroProtocolo
             AND d.AnoProtocoloLinkDet = p.AnoProtocolo
            WHERE p.NroProtocolo = %s AND p.AnoProtocolo = %s
            LIMIT 1
            """,
            (os_id, ano),
        )
        or []
    )
    if not rows:
        raise LookupError(f"OS {os_id}/{ano} não encontrada")
    row = rows[0]
    return {
        "nr_os": int(row["nr_os"]),
        "ano": int(row["ano"]),
        "titulo": row.get("titulo"),
        "produto": (row.get("produto") or "").strip(),
        "tiragem": int(row.get("tiragem") or 0),
        "pags": int(row.get("pags") or 0),
        "formato": row.get("formato"),
        "prioridade": row.get("prioridade"),
        "entrega_prevista": _isoformat(row.get("EntregData"))
        if isinstance(row.get("EntregData"), datetime)
        else (str(row.get("EntregData")) if row.get("EntregData") else None),
        "acabamento": row.get("acabamento") or "",
        "maquina": row.get("maquina"),
    }


def _folhas_estimadas(tiragem: int, pags: int) -> float:
    if pags <= 0:
        return float(max(tiragem, 0))
    # aproximação: faces/folha ~ 2
    return max(tiragem, 0) * max(pags, 1) / 2.0


def _tipo_etapa(passo: dict[str, Any]) -> str:
    tipo = str(passo.get("tipo") or "produtiva").strip().lower()
    setor = str(passo.get("setor_link") or "").strip()
    if tipo == "espera_cliente":
        return "espera_cliente"
    if tipo == "fim" or setor in {"SEDIR", "Expedição", "Correspondência"}:
        return "expedicao" if tipo != "fim" else "fim"
    if setor in {"Gravação", "SEGEP"}:
        return "gravacao"
    return "produtiva"


def _expand_passos(
    passos: list[dict[str, Any]],
    *,
    tiragem: int,
    pags: int,
    folhas: float,
    acabamento_text: str,
) -> list[dict[str, Any]]:
    etapas: list[dict[str, Any]] = []
    ordem = 0

    def append_etapa(passo: dict[str, Any], *, rotulo: str | None = None, setup_only: bool = False) -> None:
        nonlocal ordem
        setor = str(passo.get("setor_link") or "").strip()
        tipo = _tipo_etapa(passo)
        if tipo not in {"espera_cliente", "fim"} and not is_setor_gantt(setor):
            # ignora setores administrativos do roteiro
            if setor not in {"SEFOC", "SIELT", "SEIMP", "SEPAC", "Gravação", "SEGEP", "Encadernação", "SEDIR", "Expedição"}:
                return

        prior = prior_horas(passo, tiragem=tiragem, paginas=pags, folhas=folhas)
        aprendido = passo.get("aprendido") or {}
        n = int(aprendido.get("n") or passo.get("n_aprendido") or 0)
        mediana = float(aprendido.get("mediana_horas") or passo.get("mediana_horas") or 0)
        # Só usa aprendizado se houver amostras (já tipicamente ≥2024 no pipeline de aprendizado recente)
        horas = blend_horas(prior, n=n, mediana=mediana) if n > 0 else prior
        if setup_only:
            horas = max(float(passo.get("setup_min") or 0), 0.0) / 60.0
            fonte = "prior"
        else:
            fonte = "blend" if n > 0 else "prior"

        duracao_min = max(round(horas * 60.0, 1), 1.0 if tipo not in {"espera_cliente"} else 0.0)
        ordem += 10
        nome = rotulo or passo.get("nome") or setor or "Etapa"
        etapas.append(
            {
                "id": f"{_slug(nome)}-{ordem}",
                "ordem": ordem,
                "rotulo": nome,
                "rotulo_curto": nome,
                "setor": setor,
                "passo_id": passo.get("id"),
                "tipo": tipo,
                "previsto_duracao_min": duracao_min,
                "fonte_duracao": fonte,
                "amostras": n,
            }
        )

    for passo in passos or []:
        tipo = str(passo.get("tipo") or "produtiva").strip().lower()
        setup = float(passo.get("setup_min") or 0)
        nome = str(passo.get("nome") or "")
        if tipo == "produtiva" and setup >= SETUP_SPLIT_MIN and "impress" in nome.lower():
            prep = dict(passo)
            append_etapa(prep, rotulo=f"{nome} – preparação", setup_only=True)
            corpo = dict(passo)
            corpo["setup_min"] = 0
            append_etapa(corpo)
        else:
            append_etapa(passo)

    # Acabamentos tipados extras (quando texto da OS menciona e ainda não há passo)
    acab_norm = (acabamento_text or "").casefold()
    existing = " ".join(e["rotulo"].casefold() for e in etapas)
    for key, passos_acab in ACABAMENTO_PASSOS.items():
        if key.casefold() not in acab_norm:
            continue
        if key.casefold() in existing:
            continue
        for p in passos_acab:
            append_etapa(p, rotulo=f"Acabamento – {key.lower()}")

    # Filtra etapas sem setor gantt (exceto espera_cliente que fica no eixo como pausa)
    filtered: list[dict[str, Any]] = []
    for e in etapas:
        if e["tipo"] == "espera_cliente":
            filtered.append(e)
            continue
        if is_setor_gantt(e["setor"]) or e["tipo"] in {"fim", "expedicao", "gravacao"}:
            filtered.append(e)
    return filtered


def _fallback_etapas() -> list[dict[str, Any]]:
    out = []
    for i, m in enumerate(_FALLBACK_MARCOS, start=1):
        out.append(
            {
                "id": m["id"],
                "ordem": i * 10,
                "rotulo": m["rotulo"],
                "rotulo_curto": m["rotulo"],
                "setor": m["setor"],
                "passo_id": None,
                "tipo": m["tipo"],
                "previsto_duracao_min": float(m["duracao_min"]),
                "fonte_duracao": "fallback",
                "amostras": 0,
            }
        )
    return out


def _schedule_baseline(
    etapas: list[dict[str, Any]],
    *,
    inicio: datetime,
) -> list[dict[str, Any]]:
    cursor = expediente_service.clamp_to_business_window(inicio)
    scheduled = []
    for etapa in etapas:
        item = dict(etapa)
        if item["tipo"] == "espera_cliente":
            # Baseline não agenda tempo produtivo; marca âncora zero
            item["previsto_inicio"] = _isoformat(cursor)
            item["previsto_fim"] = _isoformat(cursor)
            item["previsto_duracao_min"] = 0.0
            scheduled.append(item)
            continue
        dur = float(item.get("previsto_duracao_min") or 0)
        fim = expediente_service.add_business_minutes(cursor, dur)
        item["previsto_inicio"] = _isoformat(cursor)
        item["previsto_fim"] = _isoformat(fim)
        cursor = fim
        scheduled.append(item)
    return scheduled


def _hash_entrada(meta: dict[str, Any], etapas: list[dict[str, Any]]) -> str:
    payload = {
        "produto": meta.get("produto"),
        "tiragem": meta.get("tiragem"),
        "pags": meta.get("pags"),
        "acabamento": meta.get("acabamento"),
        "passos": [
            {
                "id": e.get("passo_id"),
                "rotulo": e.get("rotulo"),
                "setor": e.get("setor"),
                "dur": e.get("previsto_duracao_min"),
            }
            for e in etapas
        ],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _load_baseline(ano: int, os_id: int) -> Optional[dict[str, Any]]:
    ensure_os_fluxo_baseline_schema()
    rows = (
        db.execute_query(
            """
            SELECT * FROM tab_os_fluxo_baseline
            WHERE nro_protocolo = %s AND ano_protocolo = %s
            LIMIT 1
            """,
            (os_id, ano),
        )
        or []
    )
    if not rows:
        return None
    row = rows[0]
    etapas = row.get("etapas_json")
    if isinstance(etapas, str):
        etapas = json.loads(etapas)
    row["etapas_json"] = etapas or []
    return row


def _save_baseline(
    ano: int,
    os_id: int,
    *,
    versao: int,
    inicio_producao_em: datetime,
    etapas: list[dict[str, Any]],
    meta: dict[str, Any],
    hash_entrada: str,
) -> None:
    ensure_os_fluxo_baseline_schema()
    db.execute_transaction(
        [
            (
                """
                INSERT INTO tab_os_fluxo_baseline (
                    nro_protocolo, ano_protocolo, versao, inicio_producao_em, etapas_json,
                    produto, tiragem, pags, tecnologia, hash_entrada, modelo_versao
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    versao = VALUES(versao),
                    inicio_producao_em = VALUES(inicio_producao_em),
                    etapas_json = VALUES(etapas_json),
                    produto = VALUES(produto),
                    tiragem = VALUES(tiragem),
                    pags = VALUES(pags),
                    tecnologia = VALUES(tecnologia),
                    hash_entrada = VALUES(hash_entrada),
                    modelo_versao = VALUES(modelo_versao)
                """,
                (
                    os_id,
                    ano,
                    versao,
                    inicio_producao_em,
                    json.dumps(etapas, ensure_ascii=False, default=str),
                    meta.get("produto"),
                    meta.get("tiragem"),
                    meta.get("pags"),
                    None,
                    hash_entrada,
                    MODELO_VERSAO,
                ),
            )
        ]
    )


def _match_stints_to_etapas(
    etapas: list[dict[str, Any]],
    stints: list[dict[str, Any]],
) -> None:
    unused = list(stints)
    for etapa in etapas:
        if etapa.get("tipo") == "espera_cliente":
            continue
        setor = etapa.get("setor")
        match_idx = next((i for i, s in enumerate(unused) if s.get("setor") == setor), None)
        if match_idx is None:
            etapa["real_inicio"] = None
            etapa["real_fim"] = None
            etapa["real_duracao_min"] = None
            etapa["pausas"] = []
            etapa["medicao"] = "estimada"
            etapa["cod_status_inicio"] = None
            etapa["cod_status_fim"] = None
            etapa["operador"] = None
            continue
        stint = unused.pop(match_idx)
        etapa["real_inicio"] = _isoformat(stint.get("inicio"))
        etapa["real_fim"] = _isoformat(stint.get("fim"))
        etapa["real_duracao_min"] = round(float(stint.get("duracao_min") or 0), 1)
        etapa["pausas"] = [
            {
                "situacao": p.get("situacao"),
                "inicio": _isoformat(p.get("inicio")),
                "fim": _isoformat(p.get("fim")),
                "minutos": round(float(p.get("minutos") or 0), 1),
            }
            for p in stint.get("pausas") or []
        ]
        etapa["medicao"] = stint.get("medicao") or "inferida"
        etapa["cod_status_inicio"] = stint.get("cod_status_inicio")
        etapa["cod_status_fim"] = stint.get("cod_status_fim")
        etapa["operador"] = stint.get("operador")


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00").split("+")[0])
    except ValueError:
        return None


def _frontier_index(
    etapas: list[dict[str, Any]],
    andamentos: list[dict[str, Any]],
    *,
    entregue: bool,
) -> int:
    """Índice da etapa mais avançada com evidência; -1 se nenhuma.

    Etapas com índice menor que o frontier e sem execução explícita
    são tratadas como concluídas (o roteiro pode pular etapas).
    """
    if entregue:
        return len(etapas)

    frontier = -1
    for i, etapa in enumerate(etapas):
        if etapa.get("tipo") == "espera_cliente":
            continue
        if etapa.get("real_inicio") or etapa.get("real_fim"):
            frontier = i

    # Último setor produtivo do histórico também avança o frontier
    # (ex.: OS já em SEPAC sem stint casado em etapas anteriores).
    for row in reversed(andamentos or []):
        situacao = str(row.get("situacao") or "")
        setor = str(row.get("setor") or "")
        if situacao in SITUACOES_TERMINAL:
            continue
        if not is_setor_gantt(setor):
            continue
        for i, etapa in enumerate(etapas):
            if etapa.get("tipo") == "espera_cliente":
                continue
            if str(etapa.get("setor") or "") == setor:
                frontier = max(frontier, i)
        break

    return frontier


def _mark_skipped_as_concluido(
    etapas: list[dict[str, Any]],
    *,
    frontier: int,
) -> None:
    """Marca etapas anteriores ao frontier como concluídas (roteiro pode pular etapas)."""
    if frontier < 0:
        return

    for i, etapa in enumerate(etapas):
        if i >= frontier:
            break
        if etapa.get("tipo") == "espera_cliente":
            if etapa.get("status") not in {"concluido", "concluido_antecipado"}:
                etapa["status"] = "concluido"
                etapa["progresso_pct"] = 100
                etapa["progresso_estimado"] = False
                if not etapa.get("real_inicio") and etapa.get("previsto_inicio"):
                    etapa["real_inicio"] = etapa.get("previsto_inicio")
                    etapa["real_fim"] = etapa.get("previsto_fim") or etapa.get("previsto_inicio")
                    etapa["medicao"] = "estimada"
            continue

        # Já tem fim real: mantém status calculado
        if etapa.get("real_fim"):
            continue
        # Em execução explícita no frontier: não forçar conclusão
        if i == frontier and etapa.get("real_inicio") and not etapa.get("real_fim"):
            continue

        etapa["status"] = "concluido"
        etapa["progresso_pct"] = 100
        etapa["progresso_estimado"] = False
        etapa["desvio_min"] = None
        if not etapa.get("real_inicio"):
            etapa["real_inicio"] = etapa.get("previsto_inicio")
            etapa["real_fim"] = etapa.get("previsto_fim") or etapa.get("previsto_inicio")
            etapa["medicao"] = "estimada"
            if etapa.get("previsto_duracao_min") is not None:
                etapa["real_duracao_min"] = etapa.get("previsto_duracao_min")
        elif not etapa.get("real_fim"):
            # Começou mas pulou o fechamento porque a OS já avançou
            etapa["real_fim"] = etapa.get("previsto_fim") or etapa.get("real_inicio")
            if etapa.get("medicao") != "medida":
                etapa["medicao"] = etapa.get("medicao") or "estimada"


def _force_entregue_concluidas(etapas: list[dict[str, Any]]) -> None:
    """Com OS Entregue, todas as etapas do roteiro estão concluídas."""
    for etapa in etapas:
        prev_fim = _parse_dt(etapa.get("previsto_fim"))
        real_fim = _parse_dt(etapa.get("real_fim"))

        if etapa.get("tipo") == "espera_cliente":
            etapa["status"] = "concluido"
            etapa["progresso_pct"] = None
            etapa["progresso_estimado"] = False
            etapa["desvio_min"] = None
            if not etapa.get("real_inicio") and etapa.get("previsto_inicio"):
                etapa["real_inicio"] = etapa.get("previsto_inicio")
                etapa["real_fim"] = etapa.get("previsto_fim") or etapa.get("previsto_inicio")
                etapa["medicao"] = "estimada"
            continue

        if real_fim is not None and prev_fim is not None and real_fim < prev_fim:
            etapa["status"] = "concluido_antecipado"
        else:
            etapa["status"] = "concluido"
        etapa["progresso_pct"] = 100
        etapa["progresso_estimado"] = False
        if etapa.get("desvio_min") is None and etapa.get("real_duracao_min") is not None:
            prev_dur = float(etapa.get("previsto_duracao_min") or 0)
            if prev_dur:
                etapa["desvio_min"] = round(float(etapa["real_duracao_min"]) - prev_dur, 1)

        if not etapa.get("real_inicio"):
            etapa["real_inicio"] = etapa.get("previsto_inicio")
            etapa["medicao"] = "estimada"
        if not etapa.get("real_fim"):
            etapa["real_fim"] = etapa.get("previsto_fim") or etapa.get("real_inicio")
            if etapa.get("medicao") != "medida":
                etapa["medicao"] = etapa.get("medicao") or "estimada"
            if etapa.get("previsto_duracao_min") is not None and etapa.get("real_duracao_min") is None:
                etapa["real_duracao_min"] = etapa.get("previsto_duracao_min")


def _compute_status_etapas(
    etapas: list[dict[str, Any]],
    *,
    now: datetime,
    pausa_ativa: bool,
    andamentos: list[dict[str, Any]] | None = None,
    ultima_situacao: str | None = None,
) -> None:
    entregue = _is_entregue(ultima_situacao, andamentos)

    for etapa in etapas:
        real_inicio = _parse_dt(etapa.get("real_inicio"))
        real_fim = _parse_dt(etapa.get("real_fim"))
        prev_inicio = _parse_dt(etapa.get("previsto_inicio"))
        prev_fim = _parse_dt(etapa.get("previsto_fim"))
        prev_dur = float(etapa.get("previsto_duracao_min") or 0)
        real_dur = etapa.get("real_duracao_min")

        desvio = None
        progresso = None
        progresso_estimado = False

        if etapa.get("tipo") == "espera_cliente":
            if pausa_ativa and not entregue:
                etapa["status"] = "pausado"
            elif real_fim or (prev_fim and prev_fim < now and not real_inicio):
                etapa["status"] = "concluido"
            else:
                etapa["status"] = "pendente"
            etapa["progresso_pct"] = None
            etapa["progresso_estimado"] = False
            etapa["desvio_min"] = None
            continue

        if real_fim is not None:
            if prev_fim and real_fim < prev_fim:
                status = "concluido_antecipado"
            else:
                status = "concluido"
            if real_dur is not None and prev_dur:
                desvio = round(float(real_dur) - prev_dur, 1)
            progresso = 100
        elif real_inicio is not None:
            if pausa_ativa:
                status = "pausado"
            elif prev_fim and now > prev_fim:
                status = "atrasado"
            elif prev_inicio and real_inicio < prev_inicio:
                status = "adiantado"
            else:
                status = "em_execucao"
            if prev_dur > 0 and real_dur is not None:
                progresso = min(99, max(1, int(round(100.0 * float(real_dur) / prev_dur))))
                progresso_estimado = True
        else:
            if prev_fim and now > prev_fim:
                status = "atrasado"
            else:
                status = "pendente"

        etapa["status"] = status
        etapa["progresso_pct"] = progresso
        etapa["progresso_estimado"] = progresso_estimado
        etapa["desvio_min"] = desvio

    if entregue:
        _force_entregue_concluidas(etapas)
        return

    frontier = _frontier_index(
        etapas,
        andamentos or [],
        entregue=False,
    )
    _mark_skipped_as_concluido(etapas, frontier=frontier)

def _pick_escala(inicio: datetime, fim: datetime) -> dict[str, Any]:
    """Escala padrão em horas (dia dividido em horas); janela cobre o fluxo completo."""
    return {
        "escala": "horas",
        "janela": {"inicio": _isoformat(inicio), "fim": _isoformat(fim)},
        "tick_min": 60,
    }


def _status_geral(
    etapas: list[dict[str, Any]],
    *,
    pausa_ativa: bool,
    ultima_situacao: str | None,
    sem_roteiro: bool,
) -> str:
    if ultima_situacao in {"Cancelada", "Cancelado"}:
        return "cancelada"
    if _is_entregue(ultima_situacao) or all(
        e.get("status") in {"concluido", "concluido_antecipado"}
        for e in etapas
        if e.get("tipo") != "espera_cliente"
    ):
        return "concluida"
    if pausa_ativa:
        return "pausada_cliente"
    if sem_roteiro:
        # ainda pode ter atraso/adianto
        pass

    atrasadas = any(e.get("status") == "atrasado" for e in etapas)
    adiantadas = any(e.get("status") in {"adiantado", "concluido_antecipado"} for e in etapas)
    if atrasadas:
        return "atrasada"
    if adiantadas:
        return "adiantada"
    if sem_roteiro:
        return "sem_roteiro"
    return "no_prazo"


def build_fluxo_producao(
    ano: int,
    os_id: int,
    *,
    now: datetime | None = None,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Monta previsto (baseline) + realizado (Recebido/Saída p/) + pausas + estado do Gantt."""
    agora = now or _now_brasilia()
    cache_key = f"{ano}:{os_id}"
    if use_cache:
        cached = _CACHE.get(cache_key)
        if cached and (time.time() - cached[0]) < _CACHE_TTL_SEC:
            return cached[1]

    meta = _load_os_meta(ano, os_id)
    andamentos = _load_andamentos(ano, os_id)
    avisos: list[str] = [
        f"Previsão baseada apenas em OS a partir de {ANO_MIN_HISTORICO_PREVISAO}",
    ]

    inicio = find_inicio_producao_em(andamentos)
    pausa = current_cliente_pause(andamentos, now=agora)
    ultima_situacao = andamentos[-1]["situacao"] if andamentos else None
    entregue = _is_entregue(ultima_situacao, andamentos)

    if inicio is None:
        payload = {
            "resumo": {
                "os": meta,
                "status_geral": "nao_iniciada",
                "agora": _isoformat(agora),
                "desvio_total_min": 0,
                "etapa_atual": None,
                "pausa_cliente": pausa,
                "previsao_termino": None,
                "previsao_termino_baseline": None,
                "confianca": "insuficiente",
                "amostras": 0,
                "escala": "horas",
                "janela": {"inicio": None, "fim": None},
                "tick_min": 60,
                "expediente": expediente_service.expediente_info(),
                "inicio_producao_em": None,
                "avisos": avisos + ["OS ainda não entrou em produção"],
            },
            "etapas": [],
        }
        if use_cache:
            _CACHE[cache_key] = (time.time(), payload)
        return payload

    passos = list_passos_por_produto(meta["produto"] or "")
    sem_roteiro = not passos
    folhas = _folhas_estimadas(meta["tiragem"], meta["pags"])

    if passos:
        etapas_base = _expand_passos(
            passos,
            tiragem=meta["tiragem"],
            pags=meta["pags"],
            folhas=folhas,
            acabamento_text=meta.get("acabamento") or "",
        )
    else:
        etapas_base = _fallback_etapas()
        avisos.append("OS sem roteiro cadastrado para o produto — usando marcos produtivos")

    if not etapas_base:
        etapas_base = _fallback_etapas()
        sem_roteiro = True
        avisos.append("Roteiro vazio após filtros — usando marcos produtivos")

    hash_entrada = _hash_entrada(meta, etapas_base)
    baseline_row = _load_baseline(ano, os_id)
    replanejado = False
    if baseline_row and baseline_row.get("hash_entrada") == hash_entrada:
        etapas = list(baseline_row.get("etapas_json") or [])
        versao = int(baseline_row.get("versao") or 1)
        inicio_base = baseline_row.get("inicio_producao_em") or inicio
        if isinstance(inicio_base, str):
            inicio_base = _parse_dt(inicio_base) or inicio
    else:
        etapas = _schedule_baseline(etapas_base, inicio=inicio)
        versao = int((baseline_row or {}).get("versao") or 0) + 1
        inicio_base = inicio
        _save_baseline(
            ano,
            os_id,
            versao=versao,
            inicio_producao_em=inicio_base,
            etapas=etapas,
            meta=meta,
            hash_entrada=hash_entrada,
        )
        if baseline_row:
            replanejado = True
            avisos.append(
                f"Baseline replanejado (versão {versao}) por alteração de produto/tiragem/roteiro"
            )

    stints = pair_setor_stints(andamentos, now=agora)
    _match_stints_to_etapas(etapas, stints)
    _compute_status_etapas(
        etapas,
        now=agora,
        pausa_ativa=bool(pausa.get("ativa")),
        andamentos=andamentos,
        ultima_situacao=ultima_situacao,
    )

    # Etapa atual
    etapa_atual = None
    for e in etapas:
        if e.get("status") in {"em_execucao", "pausado", "adiantado", "atrasado"} and e.get("real_inicio") and not e.get("real_fim"):
            etapa_atual = {"id": e["id"], "rotulo": e["rotulo"], "setor": e["setor"]}
            break
    if etapa_atual is None and not entregue:
        for e in etapas:
            if e.get("status") == "pendente" and e.get("tipo") != "espera_cliente":
                etapa_atual = {"id": e["id"], "rotulo": e["rotulo"], "setor": e["setor"]}
                break

    # Desvio total: soma desvios de etapas concluídas + atraso da atual
    desvio_total = 0.0
    for e in etapas:
        if e.get("tipo") == "espera_cliente":
            continue
        if e.get("desvio_min") is not None:
            desvio_total += float(e["desvio_min"])
        elif e.get("status") == "atrasado" and e.get("previsto_fim"):
            prev_fim = _parse_dt(e["previsto_fim"])
            if prev_fim and agora > prev_fim:
                desvio_total += expediente_service.business_minutes_between(prev_fim, agora)

    # Previsão término baseline = fim da última etapa produtiva do baseline
    previsao_baseline = None
    for e in reversed(etapas):
        if e.get("tipo") == "espera_cliente":
            continue
        previsao_baseline = e.get("previsto_fim")
        if previsao_baseline:
            break

    # Reprojeção viva: agora (ou congelado em pausa) + restante
    restante = 0.0
    started_remaining = False
    if entregue:
        previsao_termino_dt = agora
    else:
        for e in etapas:
            if e.get("tipo") == "espera_cliente":
                continue
            if e.get("status") in {"concluido", "concluido_antecipado"}:
                continue
            if e.get("real_fim"):
                continue
            prev_dur = float(e.get("previsto_duracao_min") or 0)
            if e.get("real_inicio") and not e.get("real_fim"):
                spent = float(e.get("real_duracao_min") or 0)
                restante += max(prev_dur - spent, 15.0)
                started_remaining = True
            else:
                restante += prev_dur
                started_remaining = True

        if pausa.get("ativa"):
            avisos.append(f"Cronômetro pausado em {pausa.get('situacao')}")
            previsao_termino_dt = expediente_service.add_business_minutes(agora, restante)
        else:
            previsao_termino_dt = (
                expediente_service.add_business_minutes(agora, restante)
                if started_remaining
                else _parse_dt(previsao_baseline)
            )

    # Janela do eixo
    fim_janela = previsao_termino_dt or _parse_dt(previsao_baseline) or (inicio_base + timedelta(hours=8))
    if fim_janela <= inicio_base:
        fim_janela = expediente_service.add_business_minutes(inicio_base, 8 * 60)
    escala = _pick_escala(inicio_base, fim_janela)

    status_geral = _status_geral(
        etapas,
        pausa_ativa=bool(pausa.get("ativa")),
        ultima_situacao=ultima_situacao,
        sem_roteiro=sem_roteiro,
    )

    amostras = sum(int(e.get("amostras") or 0) for e in etapas)
    if amostras >= 40:
        confianca = "alta"
    elif amostras >= 12:
        confianca = "media"
    elif amostras >= 3:
        confianca = "baixa"
    else:
        confianca = "insuficiente"

    payload = {
        "resumo": {
            "os": meta,
            "status_geral": status_geral,
            "agora": _isoformat(agora),
            "desvio_total_min": round(desvio_total, 1),
            "etapa_atual": etapa_atual,
            "pausa_cliente": pausa,
            "previsao_termino": _isoformat(previsao_termino_dt),
            "previsao_termino_baseline": previsao_baseline,
            "confianca": confianca,
            "amostras": amostras,
            **escala,
            "expediente": expediente_service.expediente_info(),
            "inicio_producao_em": _isoformat(inicio_base),
            "avisos": avisos,
            "baseline_versao": versao,
            "baseline_replanejado": replanejado,
        },
        "etapas": etapas,
    }
    if use_cache:
        _CACHE[cache_key] = (time.time(), payload)
    return payload

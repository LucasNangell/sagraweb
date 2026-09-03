"""Parser de pares Recebido / Saída p/ e pausas do cliente para o Gantt."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from services.cliente_os_timeline_service import resolve_andamento_datetime
from services.expediente_service import business_minutes_between

SETORES_INICIO_PRODUCAO = frozenset({"SEFOC", "SIELT", "SEIMP", "SEPAC"})
SETORES_POS_PRODUCAO = frozenset(
    {
        "SEGEP",
        "Gravação",
        "Encadernação",
        "SEDIR",
        "Expedição",
        "Correspondência",
        "Correspondencia",
    }
)
SITUACOES_INICIO_ETAPA = frozenset({"Recebido"})
SITUACOES_FIM_ETAPA = frozenset({"Saída p/"})
SITUACOES_PAUSA_CLIENTE = frozenset({"Aguard. Aprovação", "Pendência Usuário"})
SITUACOES_TERMINAL = frozenset({"Entregue", "Cancelada", "Cancelado"})
ANO_MIN_HISTORICO_PREVISAO = 2024

SETUP_SPLIT_MIN = 15.0


def _norm(value: Any) -> str:
    return str(value or "").strip()


def _norm_setor(value: Any) -> str:
    text = _norm(value)
    # SEDIR com sufixo → SEDIR
    upper = text.upper()
    if upper == "SEDIR" or upper.startswith("SEDIR "):
        return "SEDIR"
    if text.lower().startswith("correspond"):
        return "Correspondência"
    return text


def is_setor_inicio_producao(setor: Any) -> bool:
    return _norm_setor(setor) in SETORES_INICIO_PRODUCAO


def is_setor_gantt(setor: Any) -> bool:
    s = _norm_setor(setor)
    return s in SETORES_INICIO_PRODUCAO or s in SETORES_POS_PRODUCAO


def normalize_andamento_row(row: dict[str, Any]) -> dict[str, Any]:
    situacao = _norm(row.get("SituacaoLink") or row.get("situacao"))
    setor = _norm_setor(row.get("SetorLink") or row.get("setor"))
    obs = _norm(row.get("Observaçao") or row.get("Observacao") or row.get("observacao"))
    dt = resolve_andamento_datetime(row.get("Data") or row.get("data"), obs)
    return {
        "cod_status": _norm(row.get("CodStatus") or row.get("cod_status")),
        "situacao": situacao,
        "setor": setor,
        "observacao": obs,
        "data": dt,
        "ponto": _norm(row.get("Ponto") or row.get("ponto")),
        "usuario_nome": row.get("usuario_nome"),
        "raw": row,
    }


def sort_andamentos(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [normalize_andamento_row(r) for r in rows or []]
    normalized = [r for r in normalized if r["data"] is not None]
    normalized.sort(
        key=lambda r: (
            r["data"] or datetime.min,
            r["cod_status"],
        )
    )
    return normalized


def find_inicio_producao_em(andamentos: list[dict[str, Any]]) -> Optional[datetime]:
    for row in andamentos:
        if not is_setor_inicio_producao(row["setor"]):
            continue
        if row["situacao"] in SITUACOES_TERMINAL:
            continue
        if row["situacao"] in SITUACOES_INICIO_ETAPA or is_setor_gantt(row["setor"]):
            return row["data"]
    return None


def extract_pausas(
    andamentos: list[dict[str, Any]],
    *,
    window_start: datetime,
    window_end: Optional[datetime],
    now: datetime,
) -> list[dict[str, Any]]:
    """Extrai intervalos de pausa do cliente dentro de [window_start, window_end|now]."""
    end_limit = window_end or now
    pausas: list[dict[str, Any]] = []
    open_pause: Optional[dict[str, Any]] = None

    for row in andamentos:
        dt = row["data"]
        if dt is None or dt < window_start:
            continue
        if dt > end_limit and row["situacao"] not in SITUACOES_PAUSA_CLIENTE:
            # ainda pode fechar pausa aberta
            pass

        if row["situacao"] in SITUACOES_PAUSA_CLIENTE:
            if open_pause is None:
                open_pause = {
                    "situacao": row["situacao"],
                    "inicio": dt,
                    "fim": None,
                    "minutos": 0.0,
                }
            continue

        # Qualquer andamento não-pausa encerra a pausa aberta
        if open_pause is not None:
            open_pause["fim"] = dt
            open_pause["minutos"] = business_minutes_between(open_pause["inicio"], dt)
            if open_pause["inicio"] <= end_limit:
                pausas.append(open_pause)
            open_pause = None

    if open_pause is not None:
        fim = end_limit if end_limit > open_pause["inicio"] else now
        open_pause["fim"] = None if window_end is None and fim >= now else fim
        open_pause["minutos"] = business_minutes_between(open_pause["inicio"], now)
        pausas.append(open_pause)

    return pausas


def productive_minutes(
    start: datetime,
    end: datetime,
    pausas: list[dict[str, Any]],
) -> float:
    total = business_minutes_between(start, end)
    paused = 0.0
    for p in pausas:
        p_start = p["inicio"]
        p_end = p.get("fim") or end
        clipped_start = max(p_start, start)
        clipped_end = min(p_end, end)
        if clipped_end > clipped_start:
            paused += business_minutes_between(clipped_start, clipped_end)
    return max(total - paused, 0.0)


def pair_setor_stints(
    andamentos: list[dict[str, Any]],
    *,
    now: datetime,
) -> list[dict[str, Any]]:
    """Monta stints por setor com início=Recebido (ou 1º produtivo) e fim=Saída p/."""
    stints: list[dict[str, Any]] = []
    open_by_setor: dict[str, dict[str, Any]] = {}

    for row in andamentos:
        setor = row["setor"]
        situacao = row["situacao"]
        dt = row["data"]

        # Entregue/Cancelada fecha stints abertos mesmo com setor gantt (ex.: SEDIR).
        if situacao in SITUACOES_TERMINAL:
            for s, open_stint in list(open_by_setor.items()):
                open_stint["fim"] = dt or now
                open_stint["cod_status_fim"] = row["cod_status"]
                open_stint["aberto"] = False
                stints.append(open_stint)
                del open_by_setor[s]
            continue

        if dt is None or not is_setor_gantt(setor):
            # Pausas do cliente não fecham stint de setor aqui — só entram via extract_pausas
            if situacao in SITUACOES_PAUSA_CLIENTE:
                continue
            continue

        if situacao in SITUACOES_INICIO_ETAPA or (
            setor not in open_by_setor
            and situacao not in SITUACOES_FIM_ETAPA
            and situacao not in SITUACOES_PAUSA_CLIENTE
        ):
            # Fecha stint anterior do mesmo setor se reabrir
            if setor in open_by_setor:
                prev = open_by_setor.pop(setor)
                prev["fim"] = dt
                prev["cod_status_fim"] = row["cod_status"]
                prev["aberto"] = False
                prev["medicao"] = "estimada"
                stints.append(prev)
            open_by_setor[setor] = {
                "setor": setor,
                "inicio": dt,
                "fim": None,
                "cod_status_inicio": row["cod_status"],
                "cod_status_fim": None,
                "operador": row.get("usuario_nome") or row.get("ponto"),
                "aberto": True,
                "medicao": "inferida" if situacao in SITUACOES_INICIO_ETAPA else "estimada",
                "situacao_inicio": situacao,
            }
            continue

        if situacao in SITUACOES_FIM_ETAPA:
            if setor in open_by_setor:
                open_stint = open_by_setor.pop(setor)
                open_stint["fim"] = dt
                open_stint["cod_status_fim"] = row["cod_status"]
                open_stint["aberto"] = False
                if open_stint["medicao"] == "inferida" or situacao in SITUACOES_FIM_ETAPA:
                    if open_stint.get("situacao_inicio") in SITUACOES_INICIO_ETAPA:
                        open_stint["medicao"] = "inferida"
                stints.append(open_stint)
            else:
                # Saída sem Recebido: stint estimado sem início claro — ignora ou cria curto
                stints.append(
                    {
                        "setor": setor,
                        "inicio": dt,
                        "fim": dt,
                        "cod_status_inicio": row["cod_status"],
                        "cod_status_fim": row["cod_status"],
                        "operador": row.get("usuario_nome") or row.get("ponto"),
                        "aberto": False,
                        "medicao": "estimada",
                        "situacao_inicio": situacao,
                    }
                )

    for open_stint in open_by_setor.values():
        stints.append(open_stint)

    # Anexa pausas e duração líquida
    for stint in stints:
        start = stint["inicio"]
        end = stint["fim"]
        pausas = extract_pausas(
            andamentos,
            window_start=start,
            window_end=end,
            now=now,
        )
        stint["pausas"] = pausas
        end_for_dur = end or now
        stint["duracao_min"] = productive_minutes(start, end_for_dur, pausas)

    stints.sort(key=lambda s: s["inicio"] or datetime.min)
    return stints


def current_cliente_pause(
    andamentos: list[dict[str, Any]],
    *,
    now: datetime,
) -> dict[str, Any]:
    if not andamentos:
        return {
            "ativa": False,
            "situacao": None,
            "desde": None,
            "minutos_pausados_acumulados": 0.0,
        }

    last = andamentos[-1]
    ativa = last["situacao"] in SITUACOES_PAUSA_CLIENTE
    acumulado = 0.0
    # soma todas as pausas históricas na OS (produtiva)
    inicio = find_inicio_producao_em(andamentos)
    if inicio:
        for p in extract_pausas(andamentos, window_start=inicio, window_end=None, now=now):
            acumulado += float(p.get("minutos") or 0)

    return {
        "ativa": ativa,
        "situacao": last["situacao"] if ativa else None,
        "desde": last["data"].strftime("%Y-%m-%dT%H:%M:%S") if ativa and last["data"] else None,
        "minutos_pausados_acumulados": round(acumulado, 1),
    }

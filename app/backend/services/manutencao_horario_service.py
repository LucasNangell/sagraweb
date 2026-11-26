"""
Horário de trabalho de cada usuário da Manutenção: fora dele o celular não toca.

O operador escolhe os dias da semana e o intervalo (ex.: seg–sex, 07:00–16:00).
Fora desse horário, os avisos de novos chamados não vão para o app Android nem
para o Web Push. O registro continua na central de notificações do SAGRA.
Opcionalmente, chamados URGENTES furam o horário.

Intervalo com início maior que o fim atravessa a meia-noite (turno da noite):
22:00–06:00 numa segunda vale de segunda 22:00 até terça 06:00.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from database import db
from manutencao_schema import ensure_manutencao_schema

logger = logging.getLogger(__name__)

# Dias ISO: 1 = segunda … 7 = domingo.
DIAS_PADRAO = (1, 2, 3, 4, 5)
INICIO_PADRAO = "07:00"
FIM_PADRAO = "17:00"
_HORA_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class HorarioInvalido(ValueError):
    """Dias ou horas fora do formato esperado."""


def _ponto_str(value: Any) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def _minutos(hhmm: str) -> int:
    m = _HORA_RE.match(str(hhmm or ""))
    if not m:
        raise HorarioInvalido(f"Hora inválida: {hhmm!r} (use HH:MM)")
    return int(m.group(1)) * 60 + int(m.group(2))


def _dias(raw: Any) -> list[int]:
    if isinstance(raw, str):
        raw = [x for x in raw.split(",") if x.strip()]
    dias: set[int] = set()
    for x in raw or []:
        try:
            d = int(x)
        except (TypeError, ValueError):
            continue
        if 1 <= d <= 7:
            dias.add(d)
    return sorted(dias)


def padrao(ponto: str = "") -> dict[str, Any]:
    return {
        "ponto": _ponto_str(ponto),
        "ativo": False,
        "dias": list(DIAS_PADRAO),
        "inicio": INICIO_PADRAO,
        "fim": FIM_PADRAO,
        "urgentes_fora": False,
        "atualizado_em": None,
    }


def _row_to_cfg(row: dict[str, Any]) -> dict[str, Any]:
    atualizado = row.get("atualizado_em")
    return {
        "ponto": _ponto_str(row.get("ponto")),
        "ativo": bool(row.get("ativo")),
        "dias": _dias(row.get("dias")),
        "inicio": str(row.get("inicio") or INICIO_PADRAO),
        "fim": str(row.get("fim") or FIM_PADRAO),
        "urgentes_fora": bool(row.get("urgentes_fora")),
        "atualizado_em": atualizado.isoformat(timespec="seconds")
        if isinstance(atualizado, datetime)
        else (str(atualizado) if atualizado else None),
    }


# ------------------------------------------------------------------ regra


def dentro_do_horario(cfg: Optional[dict[str, Any]], agora: Optional[datetime] = None) -> bool:
    """True se o usuário deve ser avisado agora (sem horário definido = sempre)."""
    if not cfg or not cfg.get("ativo"):
        return True
    dias = set(_dias(cfg.get("dias")))
    if not dias:
        return False
    try:
        ini = _minutos(cfg.get("inicio"))
        fim = _minutos(cfg.get("fim"))
    except HorarioInvalido:
        return True  # configuração corrompida: não silencia o operador
    agora = agora or datetime.now()
    minuto = agora.hour * 60 + agora.minute
    hoje = agora.isoweekday()
    if ini == fim:  # dia inteiro nos dias marcados
        return hoje in dias
    if ini < fim:
        return hoje in dias and ini <= minuto < fim
    # Turno que atravessa a meia-noite: começa num dia marcado e termina no seguinte.
    if minuto >= ini:
        return hoje in dias
    ontem = (agora - timedelta(days=1)).isoweekday()
    return minuto < fim and ontem in dias


def deve_avisar(cfg: Optional[dict[str, Any]], *, urgente: bool, agora: Optional[datetime] = None) -> bool:
    if urgente and cfg and cfg.get("urgentes_fora"):
        return True
    return dentro_do_horario(cfg, agora)


# ------------------------------------------------------------------- banco


def obter_horario(ponto: str) -> dict[str, Any]:
    p = _ponto_str(ponto)
    if not p:
        return padrao()
    ensure_manutencao_schema()
    rows = db.execute_query(
        """
        SELECT ponto, ativo, dias, inicio, fim, urgentes_fora, atualizado_em
        FROM tab_manutencao_horario WHERE ponto = %s
        """,
        (p,),
    ) or []
    return _row_to_cfg(rows[0]) if rows else padrao(p)


def salvar_horario(
    ponto: str,
    *,
    ativo: bool,
    dias: Iterable[Any],
    inicio: str,
    fim: str,
    urgentes_fora: bool = False,
) -> dict[str, Any]:
    p = _ponto_str(ponto)
    if not p or p.strip("0") == "":
        raise HorarioInvalido("Sessão sem ponto identificado")
    lista = _dias(list(dias))
    _minutos(inicio)
    _minutos(fim)
    if ativo and not lista:
        raise HorarioInvalido("Escolha ao menos um dia de trabalho")
    ensure_manutencao_schema()
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tab_manutencao_horario (ponto, ativo, dias, inicio, fim, urgentes_fora)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                ativo = VALUES(ativo), dias = VALUES(dias), inicio = VALUES(inicio),
                fim = VALUES(fim), urgentes_fora = VALUES(urgentes_fora),
                atualizado_em = NOW()
            """,
            (p, 1 if ativo else 0, ",".join(map(str, lista)), inicio, fim, 1 if urgentes_fora else 0),
        )
    return obter_horario(p)


def horarios_por_ponto(pontos: Iterable[Any]) -> dict[str, dict[str, Any]]:
    alvos = sorted({p for p in (_ponto_str(x) for x in pontos) if p})
    if not alvos:
        return {}
    ensure_manutencao_schema()
    placeholders = ", ".join(["%s"] * len(alvos))
    rows = db.execute_query(
        f"""
        SELECT ponto, ativo, dias, inicio, fim, urgentes_fora, atualizado_em
        FROM tab_manutencao_horario WHERE ativo = 1 AND ponto IN ({placeholders})
        """,
        tuple(alvos),
    ) or []
    return {cfg["ponto"]: cfg for cfg in map(_row_to_cfg, rows)}


def filtrar_por_horario(
    pontos: Iterable[str], *, urgente: bool, agora: Optional[datetime] = None
) -> tuple[list[str], list[str]]:
    """Separa (avisar_agora, fora_do_horario). Erro de banco → avisa todos."""
    lista = [p for p in dict.fromkeys(pontos) if p]
    if not lista:
        return [], []
    try:
        cfgs = horarios_por_ponto(lista)
    except Exception as exc:  # pragma: no cover - nunca deixar de avisar por falha aqui
        logger.warning("Manutenção: horário de trabalho indisponível: %s", exc)
        return lista, []
    avisar, fora = [], []
    for p in lista:
        (avisar if deve_avisar(cfgs.get(_ponto_str(p)), urgente=urgente, agora=agora) else fora).append(p)
    return avisar, fora

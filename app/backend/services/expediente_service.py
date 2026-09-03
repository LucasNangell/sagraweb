"""Calendário de expediente da gráfica (horas úteis, fins de semana e feriados).

Janela default: 6h–22h (SAGRA_PCP_BUSINESS_OPEN_HOUR / CLOSE_HOUR).
Fins de semana e datas em tab_calendario_nao_util não contam como úteis.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import date, datetime, timedelta
from typing import Optional, Set, Tuple

logger = logging.getLogger(__name__)

_nao_util_cache: tuple[float, Set[date]] | None = None
_nao_util_lock = threading.Lock()
_NAO_UTIL_TTL_SEC = 300.0


def business_open_hour() -> int:
    try:
        return max(0, min(23, int(os.getenv("SAGRA_PCP_BUSINESS_OPEN_HOUR", "6"))))
    except (TypeError, ValueError):
        return 6


def business_close_hour() -> int:
    try:
        return max(1, min(24, int(os.getenv("SAGRA_PCP_BUSINESS_CLOSE_HOUR", "22"))))
    except (TypeError, ValueError):
        return 22


def invalidate_nao_util_cache() -> None:
    global _nao_util_cache
    with _nao_util_lock:
        _nao_util_cache = None


def _load_nao_util_dates() -> Set[date]:
    global _nao_util_cache
    import time

    now = time.time()
    with _nao_util_lock:
        if _nao_util_cache and (now - _nao_util_cache[0]) < _NAO_UTIL_TTL_SEC:
            return _nao_util_cache[1]

    dates: Set[date] = set()
    try:
        from database import db

        rows = (
            db.execute_query("SELECT `data` AS d FROM tab_calendario_nao_util") or []
        )
        for row in rows:
            raw = row.get("d")
            if isinstance(raw, datetime):
                dates.add(raw.date())
            elif isinstance(raw, date):
                dates.add(raw)
            elif raw:
                try:
                    dates.add(date.fromisoformat(str(raw)[:10]))
                except ValueError:
                    continue
    except Exception as exc:
        logger.debug("Calendário não-útil indisponível: %s", exc)

    with _nao_util_lock:
        _nao_util_cache = (now, dates)
    return dates


def is_non_business_day(dt: datetime | date) -> bool:
    """True para sábado, domingo ou data em tab_calendario_nao_util."""
    d = dt.date() if isinstance(dt, datetime) else dt
    if d.weekday() >= 5:
        return True
    return d in _load_nao_util_dates()


def day_business_bounds(dt: datetime) -> Tuple[datetime, datetime]:
    open_h = business_open_hour()
    close_h = business_close_hour()
    day_start = dt.replace(hour=open_h, minute=0, second=0, microsecond=0)
    day_end = dt.replace(hour=close_h, minute=0, second=0, microsecond=0)
    return day_start, day_end


def next_business_day_open(dt: datetime) -> datetime:
    open_h = business_open_hour()
    cursor = dt.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    for _ in range(400):
        if not is_non_business_day(cursor):
            return cursor.replace(hour=open_h, minute=0, second=0, microsecond=0)
        cursor += timedelta(days=1)
    return cursor.replace(hour=open_h, minute=0, second=0, microsecond=0)


def clamp_to_business_window(dt: datetime) -> datetime:
    """Posiciona o instante no início do próximo horário útil, se fora da janela."""
    if is_non_business_day(dt):
        return next_business_day_open(dt)
    day_start, day_end = day_business_bounds(dt)
    if dt < day_start:
        return day_start
    if dt >= day_end:
        return next_business_day_open(dt)
    return dt


def business_minutes_between(start: datetime, end: datetime) -> float:
    """Minutos úteis entre dois instantes (expediente, sem fins de semana/feriados)."""
    if end <= start:
        return 0.0

    total_minutes = 0.0
    cursor = start
    guard = 0
    while cursor < end and guard < 10_000:
        guard += 1
        if is_non_business_day(cursor):
            cursor = next_business_day_open(cursor)
            continue
        day_start, day_end = day_business_bounds(cursor)
        window_start = max(cursor, day_start)
        window_end = min(end, day_end)
        if window_start < window_end:
            total_minutes += (window_end - window_start).total_seconds() / 60.0
        if end <= day_end:
            break
        cursor = next_business_day_open(cursor)
    return total_minutes


def business_hours_between(start: datetime, end: datetime) -> float:
    return business_minutes_between(start, end) / 60.0


def add_business_minutes(start: datetime, minutes: float) -> datetime:
    """Soma minutos úteis a partir de um instante."""
    if minutes <= 0:
        return clamp_to_business_window(start)

    remaining = float(minutes)
    cursor = clamp_to_business_window(start)
    guard = 0
    while remaining > 0 and guard < 10_000:
        guard += 1
        if is_non_business_day(cursor):
            cursor = next_business_day_open(cursor)
            continue
        _, day_end = day_business_bounds(cursor)
        available = max((day_end - cursor).total_seconds() / 60.0, 0.0)
        if available <= 0:
            cursor = next_business_day_open(cursor)
            continue
        if remaining <= available:
            return cursor + timedelta(minutes=remaining)
        remaining -= available
        cursor = next_business_day_open(cursor)
    return cursor


def add_business_hours(start: datetime, hours: float) -> datetime:
    return add_business_minutes(start, hours * 60.0)


def expediente_info() -> dict:
    return {
        "abertura_hora": business_open_hour(),
        "fechamento_hora": business_close_hour(),
    }

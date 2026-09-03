"""Testes do serviço de expediente (fins de semana e feriados)."""
from __future__ import annotations

from datetime import date, datetime
from unittest.mock import patch

from services import expediente_service as exp


def test_business_hours_within_same_weekday():
    start = datetime(2026, 6, 15, 10, 0, 0)  # segunda
    end = datetime(2026, 6, 15, 14, 0, 0)
    assert exp.business_hours_between(start, end) == 4.0
    assert exp.business_minutes_between(start, end) == 240.0


def test_business_hours_skips_overnight():
    start = datetime(2026, 6, 15, 20, 0, 0)
    end = datetime(2026, 6, 16, 10, 0, 0)
    assert exp.business_hours_between(start, end) == 6.0


def test_add_business_hours_skips_night():
    start = datetime(2026, 6, 15, 21, 0, 0)
    result = exp.add_business_hours(start, 2.0)
    assert result == datetime(2026, 6, 16, 7, 0, 0)


def test_add_business_minutes_skips_weekend():
    # sexta 21h + 2h úteis → pula sáb/dom → segunda 7h
    start = datetime(2026, 6, 19, 21, 0, 0)  # sexta
    result = exp.add_business_minutes(start, 120)
    assert result == datetime(2026, 6, 22, 7, 0, 0)  # segunda


def test_business_minutes_skips_weekend():
    start = datetime(2026, 6, 19, 20, 0, 0)  # sexta 20h
    end = datetime(2026, 6, 22, 10, 0, 0)  # segunda 10h
    # 20-22 = 2h + 6-10 = 4h
    assert exp.business_hours_between(start, end) == 6.0


def test_clamp_holiday_moves_to_next_business_day():
    with patch.object(exp, "_load_nao_util_dates", return_value={date(2026, 6, 15)}):
        dt = datetime(2026, 6, 15, 10, 0, 0)
        clamped = exp.clamp_to_business_window(dt)
        assert clamped == datetime(2026, 6, 16, 6, 0, 0)


def test_is_non_business_day_weekend():
    assert exp.is_non_business_day(datetime(2026, 6, 20, 12, 0, 0)) is True  # sábado
    assert exp.is_non_business_day(datetime(2026, 6, 15, 12, 0, 0)) is False  # segunda

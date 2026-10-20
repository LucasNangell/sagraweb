"""Regressão: Análise aloca CodStatus com MAX(sufixo)+1, não COUNT+1."""
from __future__ import annotations

from unittest.mock import patch

from fastapi import HTTPException

from routers.analise_routes import (
    _http_error_from_andamento_write,
    add_movement_internal,
)


class _FakeCursor:
    def __init__(self, codes: list[str]):
        self.codes = codes
        self.executed: list[tuple[str, object]] = []
        self._last_sql = ""

    def execute(self, sql, params=None):
        self._last_sql = " ".join(str(sql).split())
        self.executed.append((self._last_sql, params))

    def fetchall(self):
        if "FROM tabAndamento" in self._last_sql and "CodStatus LIKE" in self._last_sql:
            return [{"CodStatus": code} for code in self.codes]
        return []

    def fetchone(self):
        return None


def _gap_codes_661_2026() -> list[str]:
    """16 linhas, buraco em -05, inclui 006612026-17 (COUNT+1 colidiria)."""
    codes = [f"006612026-{i:02d}" for i in range(1, 18) if i != 5]
    assert len(codes) == 16
    assert "006612026-17" in codes
    assert "006612026-05" not in codes
    return codes


@patch("routers.analise_routes.log_andamento_added")
@patch("routers.analise_routes.format_andamento_obs", return_value="OBS")
def test_add_movement_internal_skips_gap_uses_max_plus_one(_mock_obs, mock_log):
    cursor = _FakeCursor(_gap_codes_661_2026())

    new_cod = add_movement_internal(
        cursor, 661, 2026, "Recebido", "SEFOC", "918713", "Em análise"
    )

    assert new_cod == "006612026-18"
    sqls = " ".join(sql for sql, _ in cursor.executed)
    assert "COUNT(*)" not in sqls

    inserts = [
        params
        for sql, params in cursor.executed
        if "INSERT INTO tabAndamento" in sql
    ]
    assert inserts
    assert inserts[0][0] == "006612026-18"
    assert inserts[0][1:] == (
        661,
        2026,
        "Recebido",
        "SEFOC",
        "OBS",
        "918.713",
    )
    mock_log.assert_called_once()
    assert mock_log.call_args.kwargs["cod_status"] == "006612026-18"
    assert mock_log.call_args.kwargs["origem"] == "ANALISE"


def test_http_error_from_andamento_write_maps_duplicate_to_409():
    err = _http_error_from_andamento_write(
        Exception('(1062, "Duplicate entry \'006612026-17\' for key \'tabandamento.PRIMARY\'")')
    )
    assert isinstance(err, HTTPException)
    assert err.status_code == 409
    assert err.detail == "Erro de concorrência. Tente novamente."


def test_http_error_from_andamento_write_keeps_other_errors_as_500():
    err = _http_error_from_andamento_write(Exception("boom"))
    assert isinstance(err, HTTPException)
    assert err.status_code == 500
    assert err.detail == "boom"

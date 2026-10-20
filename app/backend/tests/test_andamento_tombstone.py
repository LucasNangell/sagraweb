"""Testes do hash canônico de tombstone de andamentos."""
from __future__ import annotations

from datetime import datetime

from services.andamento_tombstone import calculate_andamento_content_hash


def test_hash_stable_across_data_formats():
    a = {
        "SituacaoLink": "Recebido",
        "SetorLink": "SEGEP",
        "Data": "2026-08-12 10:00:00",
        "Observaçao": "obs",
        "Ponto": "1",
        "UltimoStatus": 1,
    }
    b = dict(a)
    b["Data"] = datetime(2026, 8, 12, 10, 0, 0, 123456)
    b["UltimoStatus"] = 0
    assert calculate_andamento_content_hash(a) == calculate_andamento_content_hash(b)


def test_hash_changes_when_obs_changes():
    a = {
        "SituacaoLink": "Recebido",
        "SetorLink": "SEGEP",
        "Data": "2026-08-12 10:00:00",
        "Observaçao": "a",
        "Ponto": "1",
    }
    b = dict(a)
    b["Observaçao"] = "b"
    assert calculate_andamento_content_hash(a) != calculate_andamento_content_hash(b)

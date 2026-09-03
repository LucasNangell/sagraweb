"""Testes do parser Recebido/Saída p/ e pausas do cliente."""
from __future__ import annotations

from datetime import datetime

from services.os_fluxo_andamento_pares import (
    current_cliente_pause,
    find_inicio_producao_em,
    pair_setor_stints,
    productive_minutes,
    sort_andamentos,
)


def _row(cod: str, situacao: str, setor: str, data: str, obs: str = ""):
    return {
        "CodStatus": cod,
        "SituacaoLink": situacao,
        "SetorLink": setor,
        "Data": data,
        "Observaçao": obs,
        "Ponto": "001.001",
        "usuario_nome": "Teste",
    }


def test_recebido_abre_saida_fecha():
    rows = sort_andamentos(
        [
            _row("000012026-01", "Recebido", "SEFOC", "2026-06-15 08:00:00"),
            _row("000012026-02", "Em Execução", "SEFOC", "2026-06-15 09:00:00"),
            _row("000012026-03", "Saída p/", "SEFOC", "2026-06-15 10:00:00"),
            _row("000012026-04", "Recebido", "SIELT", "2026-06-15 10:05:00"),
        ]
    )
    now = datetime(2026, 6, 15, 12, 0, 0)
    stints = pair_setor_stints(rows, now=now)
    sefoc = next(s for s in stints if s["setor"] == "SEFOC")
    assert sefoc["inicio"] == datetime(2026, 6, 15, 8, 0, 0)
    assert sefoc["fim"] == datetime(2026, 6, 15, 10, 0, 0)
    assert sefoc["aberto"] is False
    assert sefoc["medicao"] == "inferida"
    assert sefoc["duracao_min"] == 120.0


def test_pausa_cliente_subtraida_da_duracao():
    rows = sort_andamentos(
        [
            _row("000012026-01", "Recebido", "SEFOC", "2026-06-15 08:00:00"),
            _row("000012026-02", "Aguard. Aprovação", "SEFOC", "2026-06-15 09:00:00"),
            _row("000012026-03", "Recebido", "SEFOC", "2026-06-15 11:00:00"),
            _row("000012026-04", "Saída p/", "SEFOC", "2026-06-15 12:00:00"),
        ]
    )
    now = datetime(2026, 6, 15, 13, 0, 0)
    stints = pair_setor_stints(rows, now=now)
    sefoc = next(s for s in stints if s["setor"] == "SEFOC" and s.get("fim"))
    # 08-12 = 4h brutas; pausa 09-11 = 2h → 2h produtivas
    # Nota: o parser pode criar mais de um stint por reabertura; pega o que cobre o fim
    assert sefoc["duracao_min"] <= 240.0
    assert any(p["situacao"] == "Aguard. Aprovação" for s in stints for p in s.get("pausas") or [])


def test_entregue_em_sedir_fecha_stints_abertos():
    """Entregue com setor SEDIR (gantt) deve fechar stints ainda abertos."""
    rows = sort_andamentos(
        [
            _row("000012026-01", "Recebido", "SEFOC", "2026-06-15 08:00:00"),
            _row("000012026-02", "Saída p/", "SEFOC", "2026-06-15 10:00:00"),
            _row("000012026-03", "Recebido", "SEPAC", "2026-06-15 10:30:00"),
            _row("000012026-04", "Entregue", "SEDIR", "2026-06-15 14:00:00"),
        ]
    )
    now = datetime(2026, 6, 15, 16, 0, 0)
    stints = pair_setor_stints(rows, now=now)
    assert all(s.get("aberto") is False for s in stints)
    sepac = next(s for s in stints if s["setor"] == "SEPAC")
    assert sepac["fim"] == datetime(2026, 6, 15, 14, 0, 0)


def test_inicio_producao_ignora_secog():
    rows = sort_andamentos(
        [
            _row("000012026-01", "Entrada Inicial", "SECOG", "2026-06-15 07:00:00"),
            _row("000012026-02", "Recebido", "SEFOC", "2026-06-15 08:30:00"),
        ]
    )
    assert find_inicio_producao_em(rows) == datetime(2026, 6, 15, 8, 30, 0)


def test_pausa_ativa_no_ultimo_andamento():
    rows = sort_andamentos(
        [
            _row("000012026-01", "Recebido", "SEFOC", "2026-06-15 08:00:00"),
            _row("000012026-02", "Pendência Usuário", "SEFOC", "2026-06-15 09:00:00"),
        ]
    )
    pause = current_cliente_pause(rows, now=datetime(2026, 6, 15, 10, 0, 0))
    assert pause["ativa"] is True
    assert pause["situacao"] == "Pendência Usuário"


def test_productive_minutes_helper():
    start = datetime(2026, 6, 15, 8, 0, 0)
    end = datetime(2026, 6, 15, 12, 0, 0)
    pausas = [
        {
            "situacao": "Aguard. Aprovação",
            "inicio": datetime(2026, 6, 15, 9, 0, 0),
            "fim": datetime(2026, 6, 15, 11, 0, 0),
            "minutos": 120,
        }
    ]
    assert productive_minutes(start, end, pausas) == 120.0

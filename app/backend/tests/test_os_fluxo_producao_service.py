"""Testes unitários do montador do Gantt (sem banco real)."""
from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

from services.os_fluxo_producao_service import (
    _expand_passos,
    _fallback_etapas,
    _schedule_baseline,
    _status_geral,
)


def test_fallback_marcos_produtivos():
    etapas = _fallback_etapas()
    assert etapas[0]["setor"] == "SEFOC"
    assert all(e["tipo"] != "entrada" for e in etapas)


def test_schedule_baseline_forward():
    etapas = [
        {
            "id": "a",
            "ordem": 10,
            "rotulo": "Pré",
            "setor": "SEFOC",
            "tipo": "produtiva",
            "previsto_duracao_min": 60,
            "fonte_duracao": "prior",
            "amostras": 0,
        },
        {
            "id": "b",
            "ordem": 20,
            "rotulo": "Imp",
            "setor": "SIELT",
            "tipo": "produtiva",
            "previsto_duracao_min": 120,
            "fonte_duracao": "prior",
            "amostras": 0,
        },
    ]
    scheduled = _schedule_baseline(etapas, inicio=datetime(2026, 6, 15, 8, 0, 0))
    assert scheduled[0]["previsto_inicio"] == "2026-06-15T08:00:00"
    assert scheduled[0]["previsto_fim"] == "2026-06-15T09:00:00"
    assert scheduled[1]["previsto_inicio"] == "2026-06-15T09:00:00"
    assert scheduled[1]["previsto_fim"] == "2026-06-15T11:00:00"


def test_expand_passos_split_setup_impressao():
    passos = [
        {
            "id": 1,
            "nome": "SEIMP impressão offset",
            "setor_link": "SEIMP",
            "tipo": "produtiva",
            "setup_min": 30,
            "min_por_un": 0,
            "min_por_pag": 0.01,
            "min_por_folha": 0,
            "aprendido": {"n": 0},
        }
    ]
    etapas = _expand_passos(passos, tiragem=1000, pags=10, folhas=500, acabamento_text="")
    assert len(etapas) >= 2
    assert "preparação" in etapas[0]["rotulo"].lower()


def test_status_geral_pausada():
    assert (
        _status_geral(
            [{"status": "pausado", "tipo": "produtiva"}],
            pausa_ativa=True,
            ultima_situacao="Aguard. Aprovação",
            sem_roteiro=False,
        )
        == "pausada_cliente"
    )


def test_status_geral_atrasada():
    assert (
        _status_geral(
            [{"status": "atrasado", "tipo": "produtiva"}],
            pausa_ativa=False,
            ultima_situacao="Em Execução",
            sem_roteiro=False,
        )
        == "atrasada"
    )


def test_etapas_anteriores_concluidas_quando_avanca():
    from services.os_fluxo_producao_service import _compute_status_etapas

    etapas = [
        {
            "id": "a",
            "ordem": 10,
            "rotulo": "Pré",
            "setor": "SEFOC",
            "tipo": "produtiva",
            "previsto_inicio": "2026-06-15T08:00:00",
            "previsto_fim": "2026-06-15T09:00:00",
            "previsto_duracao_min": 60,
            "real_inicio": None,
            "real_fim": None,
            "medicao": "estimada",
        },
        {
            "id": "b",
            "ordem": 20,
            "rotulo": "Imp",
            "setor": "SIELT",
            "tipo": "produtiva",
            "previsto_inicio": "2026-06-15T09:00:00",
            "previsto_fim": "2026-06-15T11:00:00",
            "previsto_duracao_min": 120,
            "real_inicio": "2026-06-15T09:10:00",
            "real_fim": None,
            "real_duracao_min": 40,
            "medicao": "inferida",
        },
    ]
    andamentos = [
        {
            "situacao": "Recebido",
            "setor": "SIELT",
            "data": datetime(2026, 6, 15, 9, 10, 0),
        }
    ]
    _compute_status_etapas(
        etapas,
        now=datetime(2026, 6, 15, 10, 0, 0),
        pausa_ativa=False,
        andamentos=andamentos,
        ultima_situacao="Recebido",
    )
    assert etapas[0]["status"] == "concluido"
    assert etapas[0]["medicao"] == "estimada"
    assert etapas[0]["progresso_pct"] == 100
    assert etapas[1]["status"] == "em_execucao"


def test_entregue_marca_todas_concluidas():
    from services.os_fluxo_producao_service import _compute_status_etapas

    etapas = [
        {
            "id": "a",
            "ordem": 10,
            "rotulo": "Pré",
            "setor": "SEFOC",
            "tipo": "produtiva",
            "previsto_inicio": "2026-06-15T08:00:00",
            "previsto_fim": "2026-06-15T09:00:00",
            "previsto_duracao_min": 60,
            "real_inicio": None,
            "real_fim": None,
            "medicao": "estimada",
        },
        {
            "id": "b",
            "ordem": 20,
            "rotulo": "Imp",
            "setor": "SIELT",
            "tipo": "produtiva",
            "previsto_inicio": "2026-06-15T09:00:00",
            "previsto_fim": "2026-06-15T11:00:00",
            "previsto_duracao_min": 120,
            "real_inicio": "2026-06-15T09:10:00",
            "real_fim": None,
            "real_duracao_min": 40,
            "medicao": "inferida",
        },
        {
            "id": "c",
            "ordem": 30,
            "rotulo": "Acab",
            "setor": "SEPAC",
            "tipo": "produtiva",
            "previsto_inicio": "2026-06-15T11:00:00",
            "previsto_fim": "2026-06-15T12:00:00",
            "previsto_duracao_min": 60,
            "real_inicio": None,
            "real_fim": None,
            "medicao": "estimada",
        },
        {
            "id": "d",
            "ordem": 100,
            "rotulo": "Empacotamento",
            "setor": "SEPAC",
            "tipo": "produtiva",
            "previsto_inicio": "2026-06-15T12:00:00",
            "previsto_fim": "2026-06-15T13:00:00",
            "previsto_duracao_min": 60,
            "real_inicio": None,
            "real_fim": None,
            "medicao": "estimada",
        },
        {
            "id": "e",
            "ordem": 110,
            "rotulo": "Expedição",
            "setor": "SEDIR",
            "tipo": "fim",
            "previsto_inicio": "2026-06-15T13:00:00",
            "previsto_fim": "2026-06-15T13:30:00",
            "previsto_duracao_min": 30,
            "real_inicio": None,
            "real_fim": None,
            "medicao": "estimada",
        },
    ]
    _compute_status_etapas(
        etapas,
        now=datetime(2026, 6, 15, 15, 0, 0),
        pausa_ativa=False,
        andamentos=[{"situacao": "Entregue", "setor": "SEDIR", "data": datetime(2026, 6, 15, 14, 0, 0)}],
        ultima_situacao="Entregue",
    )
    assert all(
        e["status"] in {"concluido", "concluido_antecipado"} for e in etapas
    )
    assert all(e.get("progresso_pct") == 100 for e in etapas if e["tipo"] != "espera_cliente")
    assert etapas[-1]["status"] == "concluido"
    assert etapas[-2]["status"] == "concluido"


@patch("services.os_fluxo_producao_service._load_os_meta")
@patch("services.os_fluxo_producao_service._load_andamentos")
def test_build_nao_iniciada(mock_and, mock_meta):
    from services.os_fluxo_producao_service import build_fluxo_producao

    mock_meta.return_value = {
        "nr_os": 1,
        "ano": 2026,
        "titulo": "X",
        "produto": "Folder",
        "tiragem": 100,
        "pags": 4,
        "prioridade": "Normal",
        "entrega_prevista": None,
        "acabamento": "",
        "maquina": None,
        "formato": "A4",
    }
    mock_and.return_value = [
        {
            "cod_status": "1",
            "situacao": "Entrada Inicial",
            "setor": "SECOG",
            "observacao": "",
            "data": datetime(2026, 6, 15, 7, 0, 0),
            "ponto": "1",
            "usuario_nome": "A",
            "raw": {},
        }
    ]
    payload = build_fluxo_producao(2026, 1, now=datetime(2026, 6, 15, 12, 0, 0), use_cache=False)
    assert payload["resumo"]["status_geral"] == "nao_iniciada"
    assert payload["etapas"] == []

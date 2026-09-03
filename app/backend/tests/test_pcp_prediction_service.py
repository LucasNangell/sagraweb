"""Testes unitários do serviço de previsão PCP (sem banco)."""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from services.pcp_prediction_service import (
    _add_business_hours,
    _business_hours_between,
    _clamp_to_business_window,
    _confidence,
    _elapsed_hours_since,
    _encode_row,
    _filter_outliers_iqr,
    _finished_prediction,
    _is_work_finished_setor,
    _knn_predict,
    _priority_score,
    predict_for_item,
)


def test_priority_score_buckets():
    assert _priority_score("Prometido p/ 15/06") == 0.0
    assert _priority_score("Solicitado p/ 20/06") == 0.5
    assert _priority_score("Normal") == 1.0
    assert _priority_score(None) == 1.0


def test_elapsed_hours_with_observacao_hora():
    base = datetime.now().replace(hour=8, minute=0, second=0, microsecond=0)
    elapsed = _elapsed_hours_since(base.strftime("%Y-%m-%d %H:%M:%S"), "10h30 observação")
    assert 0 <= elapsed < 48


def test_knn_predict_returns_positive_hours():
    df = pd.DataFrame(
        [
            {
                "produto": "Folder",
                "situacao": "Em Execução",
                "formato": "A4",
                "tiragem": 1000,
                "pags": 4,
                "prioridade": "Prometido",
                "stint_hours": 2.0,
                "remaining_hours": 24.0,
            },
            {
                "produto": "Folder",
                "situacao": "Em Execução",
                "formato": "A4",
                "tiragem": 1200,
                "pags": 4,
                "prioridade": "Prometido",
                "stint_hours": 3.0,
                "remaining_hours": 30.0,
            },
            {
                "produto": "Cartaz",
                "situacao": "Em Execução",
                "formato": "A3",
                "tiragem": 500,
                "pags": 1,
                "prioridade": "Solicitado",
                "stint_hours": 4.0,
                "remaining_hours": 40.0,
            },
        ]
    )
    vocab = {
        "produto": {"Folder": 1, "Cartaz": 2},
        "situacao": {"Em Execução": 1},
        "formato": {"A4": 1, "A3": 2},
    }
    query = _encode_row("Folder", "Em Execução", "A4", 1100, 4, "Prometido", vocab)
    pred, metodo, n = _knn_predict(df, "stint_hours", query, k=3)
    assert pred is not None
    assert pred > 0
    assert n == 3
    assert metodo in ("knn", "mediana_setor")


def test_predict_for_item_with_training_df():
    training = pd.DataFrame(
        [
            {
                "produto": "Livro",
                "situacao": "Impressão",
                "formato": "A4",
                "tiragem": 2000,
                "pags": 120,
                "prioridade": "Prometido",
                "stint_hours": 6.0,
                "remaining_hours": 48.0,
            }
        ]
        * 8
    )
    item = {
        "nr_os": 100,
        "ano": 2026,
        "produto": "Livro",
        "situacao": "Impressão",
        "formato": "A4",
        "tiragem": 1800,
        "pags": 100,
        "prioridade": "Prometido p/ 20/06",
        "last_update": (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S"),
        "observacao": "",
    }
    result = predict_for_item(
        item,
        base_setor="SIELT",
        training_df=training,
    )
    assert result["previsao_proximo_andamento"] is not None
    assert result["previsao_conclusao"] is not None
    assert result["amostras"] >= 3


def test_confidence_levels():
    assert _confidence(50, "knn") == "alta"
    assert _confidence(15, "knn") == "media"
    assert _confidence(5, "mediana_setor") == "baixa"
    assert _confidence(1, "mediana_setor") == "insuficiente"


def test_business_hours_within_same_day():
    start = datetime(2026, 6, 15, 10, 0, 0)
    end = datetime(2026, 6, 15, 14, 0, 0)
    assert _business_hours_between(start, end) == 4.0


def test_business_hours_skips_overnight():
    start = datetime(2026, 6, 15, 20, 0, 0)
    end = datetime(2026, 6, 16, 10, 0, 0)
    # 20h-22h = 2h + 6h-10h = 4h
    assert _business_hours_between(start, end) == 6.0


def test_add_business_hours_skips_night():
    start = datetime(2026, 6, 15, 21, 0, 0)
    result = _add_business_hours(start, 2.0)
    # 1h até 22h + 1h no dia seguinte (6h-7h)
    assert result == datetime(2026, 6, 16, 7, 0, 0)


def test_add_business_hours_skips_weekend_via_expediente():
    # sexta 21h + 2h → segunda 7h (expediente pula sáb/dom)
    start = datetime(2026, 6, 19, 21, 0, 0)
    result = _add_business_hours(start, 2.0)
    assert result == datetime(2026, 6, 22, 7, 0, 0)


def test_clamp_before_open_moves_to_same_day_open():
    dt = datetime(2026, 6, 15, 4, 30, 0)
    assert _clamp_to_business_window(dt) == datetime(2026, 6, 15, 6, 0, 0)


def test_clamp_after_close_moves_to_next_day_open():
    dt = datetime(2026, 6, 15, 23, 0, 0)
    assert _clamp_to_business_window(dt) == datetime(2026, 6, 16, 6, 0, 0)


def test_finished_setores_detection():
    assert _is_work_finished_setor("SEDIR") is True
    assert _is_work_finished_setor("SEDIR ") is True
    assert _is_work_finished_setor("SEDIR IV") is True
    assert _is_work_finished_setor("Correspondência") is True
    assert _is_work_finished_setor("Correspondencia") is True
    assert _is_work_finished_setor("SIELT") is False


def test_predict_for_finished_setor():
    item = {
        "nr_os": 100,
        "ano": 2026,
        "setor": "SEDIR",
        "situacao": "Aguardando retirada",
        "last_update": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    result = predict_for_item(item, base_setor="SEDIR", training_df=pd.DataFrame())
    assert result["trabalho_finalizado"] is True
    assert result["previsao_conclusao"] is not None
    assert result["previsao_proximo_andamento"] is None
    assert result["confianca"] == "alta"


def test_finished_prediction_structure():
    result = _finished_prediction(datetime(2026, 6, 15, 10, 0, 0))
    assert result["trabalho_finalizado"] is True
    assert result["previsao_conclusao"] == "2026-06-15T10:00:00"


def _sample_row(stint_hours: float, remaining_hours: float = 24.0) -> dict:
    return {
        "produto": "Folder",
        "situacao": "Em Execução",
        "formato": "A4",
        "tiragem": 1000,
        "pags": 4,
        "prioridade": "Prometido",
        "stint_hours": stint_hours,
        "remaining_hours": remaining_hours,
    }


def test_finished_setor_sql_escapes_like_wildcards_for_pymysql():
    from services.pcp_prediction_service import _FINISHED_SETOR_SQL

    assert "LIKE 'SEDIR %%'" in _FINISHED_SETOR_SQL
    assert "LIKE 'Correspond%%'" in _FINISHED_SETOR_SQL


def test_filter_outliers_iqr_removes_extreme_values():
    rows = [_sample_row(h) for h in [2.0, 2.5, 3.0, 2.8, 3.2, 2.1, 3.5, 2.9]]
    rows.append(_sample_row(500.0))
    df = pd.DataFrame(rows)
    filtered = _filter_outliers_iqr(df, "stint_hours")
    assert len(filtered) == 8
    assert filtered["stint_hours"].max() < 10


def test_knn_ignores_outlier_that_would_skew_prediction():
    rows = [_sample_row(h) for h in [2.0, 2.5, 3.0, 2.8, 3.2, 2.1, 3.5, 2.9]]
    rows.append(_sample_row(500.0))
    df = pd.DataFrame(rows)
    vocab = {
        "produto": {"Folder": 1},
        "situacao": {"Em Execução": 1},
        "formato": {"A4": 1},
    }
    query = _encode_row("Folder", "Em Execução", "A4", 1000, 4, "Prometido", vocab)
    pred, _, _ = _knn_predict(df, "stint_hours", query, k=5)
    assert pred is not None
    assert pred < 10

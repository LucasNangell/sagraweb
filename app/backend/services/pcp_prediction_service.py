"""
Previsão de prazos PCP com base em OSs históricas semelhantes.

Fatores considerados:
- setor (obrigatório)
- situação atual
- produto (TipoPublicacaoLink)
- formato, tiragem e páginas (similaridade numérica)
- prioridade (Prometido / Solicitado / demais)
- tempo já decorrido no andamento atual

Modelo: KNN com pesos por distância (scikit-learn), mediana ponderada como fallback.
Horário de funcionamento da gráfica: 6h00–22h00 (somente horas úteis contam).
Setores SEDIR e Correspondência encerram o trabalho de produção (conclusão operacional).
Outliers (tempos atípicos) são removidos via IQR antes do cálculo estatístico.
"""
from __future__ import annotations

import logging
import math
import os
import re
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from database import db
from services.andamento_table import get_andamento_table

logger = logging.getLogger(__name__)

_HIST_CACHE: Dict[str, tuple[float, pd.DataFrame]] = {}

# Setores em que o trabalho de produção já está concluído.
_FINISHED_WORK_SETORES = frozenset({"SEDIR", "Correspondência", "Correspondencia"})
_FINISHED_SETOR_SQL = """
    TRIM(a.SetorLink) IN ('SEDIR', 'Correspondência', 'Correspondencia')
    OR TRIM(a.SetorLink) LIKE 'SEDIR %%'
    OR TRIM(a.SetorLink) LIKE 'Correspond%%'
"""


def _normalize_setor(setor: str | None) -> str:
    return (setor or "").strip()


def _is_work_finished_setor(setor: str | None) -> bool:
    normalized = _normalize_setor(setor)
    if not normalized:
        return False
    if normalized in _FINISHED_WORK_SETORES:
        return True
    # SEDIR legado pode vir com sufixo (ex.: "SEDIR IV") ou espaços.
    upper = normalized.upper()
    if upper == "SEDIR" or upper.startswith("SEDIR "):
        return True
    lower = normalized.lower()
    return lower.startswith("correspond")


def _finished_prediction(now: datetime | None = None) -> Dict[str, Any]:
    """Resposta padrão quando a OS já está em setor de trabalho concluído."""
    instant = _clamp_to_business_window(now or datetime.now())
    return {
        "previsao_proximo_andamento": None,
        "previsao_conclusao": instant.strftime("%Y-%m-%dT%H:%M:%S"),
        "confianca": "alta",
        "amostras": 0,
        "trabalho_finalizado": True,
    }


def _cache_ttl_sec() -> float:
    try:
        return max(60.0, float(os.getenv("SAGRA_PCP_PREDICTION_CACHE_SEC", "300")))
    except (TypeError, ValueError):
        return 300.0


def _lookback_months() -> int:
    try:
        return max(6, int(os.getenv("SAGRA_PCP_PREDICTION_LOOKBACK_MONTHS", "24")))
    except (TypeError, ValueError):
        return 24


def _outlier_iqr_multiplier() -> float:
    try:
        return max(0.5, float(os.getenv("SAGRA_PCP_OUTLIER_IQR_MULTIPLIER", "1.5")))
    except (TypeError, ValueError):
        return 1.5


def _min_samples_for_outlier_filter() -> int:
    try:
        return max(4, int(os.getenv("SAGRA_PCP_OUTLIER_MIN_SAMPLES", "8")))
    except (TypeError, ValueError):
        return 8


def _business_open_hour() -> int:
    try:
        return max(0, min(23, int(os.getenv("SAGRA_PCP_BUSINESS_OPEN_HOUR", "6"))))
    except (TypeError, ValueError):
        return 6


def _business_close_hour() -> int:
    try:
        return max(1, min(24, int(os.getenv("SAGRA_PCP_BUSINESS_CLOSE_HOUR", "22"))))
    except (TypeError, ValueError):
        return 22


def _day_business_bounds(dt: datetime) -> Tuple[datetime, datetime]:
    open_h = _business_open_hour()
    close_h = _business_close_hour()
    day_start = dt.replace(hour=open_h, minute=0, second=0, microsecond=0)
    day_end = dt.replace(hour=close_h, minute=0, second=0, microsecond=0)
    return day_start, day_end


def _next_business_day_open(dt: datetime) -> datetime:
    open_h = _business_open_hour()
    base = dt.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return base.replace(hour=open_h, minute=0, second=0, microsecond=0)


def _clamp_to_business_window(dt: datetime) -> datetime:
    """Posiciona o instante no início do próximo horário útil, se fora da janela."""
    day_start, day_end = _day_business_bounds(dt)
    if dt < day_start:
        return day_start
    if dt >= day_end:
        return _next_business_day_open(dt)
    return dt


def _business_hours_between(start: datetime, end: datetime) -> float:
    """Horas úteis (6h–22h) entre dois instantes."""
    if end <= start:
        return 0.0

    total_hours = 0.0
    cursor = start
    while cursor < end:
        day_start, day_end = _day_business_bounds(cursor)
        window_start = max(cursor, day_start)
        window_end = min(end, day_end)
        if window_start < window_end:
            total_hours += (window_end - window_start).total_seconds() / 3600.0
        if end <= day_end:
            break
        cursor = _next_business_day_open(cursor)
    return total_hours


def _add_business_hours(start: datetime, hours: float) -> datetime:
    """Soma horas úteis a partir de um instante, respeitando 6h–22h."""
    if hours <= 0:
        return _clamp_to_business_window(start)

    remaining_minutes = hours * 60.0
    cursor = _clamp_to_business_window(start)
    while remaining_minutes > 0:
        _, day_end = _day_business_bounds(cursor)
        available_minutes = max((day_end - cursor).total_seconds() / 60.0, 0.0)
        if available_minutes <= 0:
            cursor = _next_business_day_open(cursor)
            continue
        if remaining_minutes <= available_minutes:
            return cursor + timedelta(minutes=remaining_minutes)
        remaining_minutes -= available_minutes
        cursor = _next_business_day_open(cursor)
    return cursor


def _priority_score(prioridade: str | None) -> float:
    text = (prioridade or "").strip().lower()
    if "prometido" in text:
        return 0.0
    if "solicitado" in text:
        return 0.5
    return 1.0


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        parsed = float(value)
        if math.isnan(parsed) or math.isinf(parsed):
            return default
        return parsed
    except (TypeError, ValueError):
        return default


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        return None


def _elapsed_hours_since(last_update: Any, observacao: str | None) -> float:
    """Replica a lógica do frontend (observação com hora enriquece a data base)."""
    base = _parse_dt(last_update)
    if not base:
        return 0.0
    obs = observacao or ""
    m = re.match(r"^\s*(\d{1,2})h(\d{2})", obs, re.IGNORECASE)
    if m:
        base = base.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)
    return _business_hours_between(base, datetime.now())


def _fetch_historical_rows(
    base_setor: str,
    *,
    allowed_situacoes: Sequence[str] | None = None,
) -> pd.DataFrame:
    andamento_tbl = get_andamento_table()
    lookback = _lookback_months()

    situacao_filter = ""
    situacao_params: List[str] = []
    if allowed_situacoes:
        placeholders = ", ".join(["%s"] * len(allowed_situacoes))
        situacao_filter = f" AND ranked.situacao IN ({placeholders})"
        situacao_params = list(allowed_situacoes)

    sql = f"""
    WITH completed_work AS (
        SELECT DISTINCT a.NroProtocoloLink AS nr_os, a.AnoProtocoloLink AS ano
        FROM {andamento_tbl} AS a
        WHERE a.`Data` >= DATE_SUB(NOW(), INTERVAL %s MONTH)
          AND (
              a.SituacaoLink = 'Entregue'
              OR {_FINISHED_SETOR_SQL.strip()}
          )
    ),
    timeline AS (
        SELECT
            a.NroProtocoloLink AS nr_os,
            a.AnoProtocoloLink AS ano,
            a.SetorLink AS setor,
            a.SituacaoLink AS situacao,
            a.`Data` AS data_evento,
            LEAD(a.`Data`) OVER (
                PARTITION BY a.NroProtocoloLink, a.AnoProtocoloLink
                ORDER BY a.`Data`, a.CodStatus
            ) AS data_proximo,
            MIN(
                CASE
                    WHEN {_FINISHED_SETOR_SQL.strip()}
                    THEN a.`Data`
                END
            ) OVER (
                PARTITION BY a.NroProtocoloLink, a.AnoProtocoloLink
            ) AS data_fim_producao,
            MAX(
                CASE WHEN a.SituacaoLink = 'Entregue' THEN a.`Data` END
            ) OVER (
                PARTITION BY a.NroProtocoloLink, a.AnoProtocoloLink
            ) AS data_entregue
        FROM {andamento_tbl} AS a
        INNER JOIN completed_work AS d
            ON d.nr_os = a.NroProtocoloLink AND d.ano = a.AnoProtocoloLink
        WHERE a.SituacaoLink NOT IN ('Cancelada', 'Cancelado')
    ),
    ranked AS (
        SELECT
            t.nr_os,
            t.ano,
            t.setor,
            t.situacao,
            t.data_evento,
            t.data_proximo,
            COALESCE(t.data_fim_producao, t.data_entregue) AS data_conclusao_trabalho,
            TIMESTAMPDIFF(MINUTE, t.data_evento, t.data_proximo) / 60.0 AS stint_hours,
            TIMESTAMPDIFF(
                MINUTE,
                t.data_evento,
                COALESCE(t.data_fim_producao, t.data_entregue)
            ) / 60.0 AS remaining_hours
        FROM timeline AS t
        WHERE TRIM(t.setor) = TRIM(%s)
          AND t.data_proximo IS NOT NULL
          AND COALESCE(t.data_fim_producao, t.data_entregue) IS NOT NULL
          AND COALESCE(t.data_fim_producao, t.data_entregue) > t.data_evento
          AND t.situacao NOT IN ('Entregue', 'Cancelada', 'Cancelado')
    )
    SELECT
        ranked.nr_os,
        ranked.ano,
        ranked.situacao,
        ranked.data_evento,
        ranked.data_proximo,
        ranked.data_conclusao_trabalho,
        TRIM(COALESCE(d.TipoPublicacaoLink, '')) AS produto,
        TRIM(COALESCE(d.FormatoLink, '')) AS formato,
        COALESCE(d.Tiragem, 0) AS tiragem,
        COALESCE(d.Pags, 0) AS pags,
        TRIM(COALESCE(p.EntregPrazoLink, '')) AS prioridade
    FROM ranked
    INNER JOIN tabProtocolos AS p
        ON p.NroProtocolo = ranked.nr_os AND p.AnoProtocolo = ranked.ano
    LEFT JOIN tabDetalhesServico AS d
        ON d.NroProtocoloLinkDet = ranked.nr_os AND d.AnoProtocoloLinkDet = ranked.ano
    WHERE ranked.stint_hours > 0
      AND ranked.remaining_hours > 0
      {situacao_filter}
    """
    params: List[Any] = [lookback, base_setor, *situacao_params]
    rows = db.execute_query(sql, tuple(params)) or []
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    for col in ("data_evento", "data_proximo", "data_conclusao_trabalho"):
        df[col] = df[col].map(_parse_dt)

    df["stint_hours"] = df.apply(
        lambda r: _business_hours_between(r["data_evento"], r["data_proximo"])
        if r["data_evento"] and r["data_proximo"]
        else 0.0,
        axis=1,
    )
    df["remaining_hours"] = df.apply(
        lambda r: _business_hours_between(r["data_evento"], r["data_conclusao_trabalho"])
        if r["data_evento"] and r["data_conclusao_trabalho"]
        else 0.0,
        axis=1,
    )
    df["tiragem"] = pd.to_numeric(df["tiragem"], errors="coerce").fillna(0)
    df["pags"] = pd.to_numeric(df["pags"], errors="coerce").fillna(0)
    df["produto"] = df["produto"].fillna("").astype(str)
    df["formato"] = df["formato"].fillna("").astype(str)
    df["situacao"] = df["situacao"].fillna("").astype(str)
    df["prioridade_score"] = df["prioridade"].map(_priority_score)
    df = df.dropna(subset=["stint_hours", "remaining_hours"])
    df = df[(df["stint_hours"] > 0) & (df["remaining_hours"] > 0)]
    return df


def _get_training_df(
    base_setor: str,
    *,
    allowed_situacoes: Sequence[str] | None = None,
) -> pd.DataFrame:
    cache_key = f"{base_setor}|{','.join(allowed_situacoes or [])}"
    ttl = _cache_ttl_sec()
    cached = _HIST_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < ttl:
        return cached[1]

    df = _fetch_historical_rows(base_setor, allowed_situacoes=allowed_situacoes)
    _HIST_CACHE[cache_key] = (time.time(), df)
    return df


def _encode_row(
    produto: str,
    situacao: str,
    formato: str,
    tiragem: float,
    pags: float,
    prioridade: str | None,
    vocab: Dict[str, Dict[str, int]],
) -> np.ndarray:
    prod_idx = vocab["produto"].get(produto or "", 0)
    sit_idx = vocab["situacao"].get(situacao or "", 0)
    fmt_idx = vocab["formato"].get(formato or "", 0)
    return np.array(
        [
            prod_idx,
            sit_idx,
            fmt_idx,
            math.log1p(max(tiragem, 0)),
            math.log1p(max(pags, 0)),
            _priority_score(prioridade),
        ],
        dtype=float,
    )


def _build_vocab(df: pd.DataFrame) -> Dict[str, Dict[str, int]]:
    vocabs: Dict[str, Dict[str, int]] = {}
    for col in ("produto", "situacao", "formato"):
        values = sorted({str(v) for v in df[col].unique() if str(v)})
        vocabs[col] = {val: idx + 1 for idx, val in enumerate(values)}
    return vocabs


def _filter_outliers_iqr(df: pd.DataFrame, target_col: str) -> pd.DataFrame:
    """
    Remove amostras com duração atípica (método IQR) para não distorcer a previsão.
    Mantém o conjunto original se o filtro deixar poucas amostras.
    """
    if df.empty or target_col not in df.columns:
        return df

    min_samples = _min_samples_for_outlier_filter()
    if len(df) < min_samples:
        return df

    series = pd.to_numeric(df[target_col], errors="coerce")
    valid = df[series.notna()].copy()
    series = series[series.notna()]
    if len(series) < min_samples:
        return df

    q1 = float(series.quantile(0.25))
    q3 = float(series.quantile(0.75))
    iqr = q3 - q1
    multiplier = _outlier_iqr_multiplier()

    if iqr <= 0:
        upper = float(series.quantile(0.95))
        filtered = valid[series <= upper]
    else:
        lower = max(0.0, q1 - multiplier * iqr)
        upper = q3 + multiplier * iqr
        filtered = valid[(series >= lower) & (series <= upper)]

    if len(filtered) >= 3:
        return filtered.reset_index(drop=True)
    return df


def _robust_predict_value(y: np.ndarray) -> float:
    """Mediana como estimativa robusta quando KNN não é aplicável."""
    clean = y[~np.isnan(y)]
    if clean.size == 0:
        return 0.0
    return float(np.median(clean))


def _knn_predict(
    df: pd.DataFrame,
    target_col: str,
    query_vec: np.ndarray,
    *,
    k: int = 15,
) -> Tuple[Optional[float], str, int]:
    if df.empty:
        return None, "sem_historico", 0

    filtered = _filter_outliers_iqr(df, target_col)
    if filtered.empty:
        return None, "sem_amostras", 0

    vocab = _build_vocab(filtered)
    X = np.vstack(
        [
            _encode_row(
                row["produto"],
                row["situacao"],
                row["formato"],
                float(row["tiragem"]),
                float(row["pags"]),
                row.get("prioridade"),
                vocab,
            )
            for _, row in filtered.iterrows()
        ]
    )
    y = filtered[target_col].to_numpy(dtype=float)

    n_neighbors = min(k, len(filtered))
    if n_neighbors < 3:
        median = _robust_predict_value(y)
        return median, "mediana_setor", len(filtered)

    try:
        from sklearn.neighbors import KNeighborsRegressor

        model = KNeighborsRegressor(
            n_neighbors=n_neighbors,
            weights="distance",
            metric="euclidean",
        )
        model.fit(X, y)
        pred = float(model.predict(query_vec.reshape(1, -1))[0])
        if pred <= 0 or math.isnan(pred):
            pred = _robust_predict_value(y)
            return pred, "mediana_setor", len(filtered)
        return pred, "knn", len(filtered)
    except Exception as exc:
        logger.warning("KNN PCP indisponível (%s); usando mediana.", exc)
        return _robust_predict_value(y), "mediana_setor", len(filtered)


def _confidence(sample_count: int, metodo: str) -> str:
    if sample_count >= 40 and metodo == "knn":
        return "alta"
    if sample_count >= 12:
        return "media"
    if sample_count >= 3:
        return "baixa"
    return "insuficiente"


def _isoformat(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def predict_for_item(
    item: Dict[str, Any],
    *,
    base_setor: str,
    allowed_situacoes: Sequence[str] | None = None,
    training_df: pd.DataFrame | None = None,
) -> Dict[str, Any]:
    """Previsão para um item da fila PCP. Nunca levanta exceção."""
    empty = {
        "previsao_proximo_andamento": None,
        "previsao_conclusao": None,
        "confianca": "insuficiente",
        "amostras": 0,
    }
    try:
        situacao = (item.get("situacao") or "").strip()
        if not situacao:
            return empty

        current_setor = _normalize_setor(item.get("setor")) or _normalize_setor(base_setor)
        if _is_work_finished_setor(current_setor):
            return _finished_prediction()

        df = training_df if training_df is not None else _get_training_df(
            base_setor, allowed_situacoes=allowed_situacoes
        )
        if df.empty:
            return empty

        produto = (item.get("produto") or "").strip()
        formato = (item.get("formato") or "").strip()
        tiragem = _safe_float(item.get("tiragem"))
        pags = _safe_float(item.get("pags"))
        prioridade = item.get("prioridade")

        elapsed_h = _elapsed_hours_since(item.get("last_update"), item.get("observacao"))

        # Cascata de similaridade: setor+situacao+produto → setor+situacao → setor
        scoped = df[df["situacao"] == situacao]
        if produto:
            scoped_prod = scoped[scoped["produto"] == produto]
            if len(scoped_prod) >= 5:
                scoped = scoped_prod

        if len(scoped) < 5:
            scoped = df[df["situacao"] == situacao]
        if len(scoped) < 3:
            scoped = df

        vocab = _build_vocab(scoped if not scoped.empty else df)
        source = scoped if not scoped.empty else df
        query_vec = _encode_row(
            produto,
            situacao,
            formato,
            tiragem,
            pags,
            prioridade,
            vocab,
        )

        stint_h, metodo_stint, n_stint = _knn_predict(source, "stint_hours", query_vec)
        remain_h, metodo_remain, n_remain = _knn_predict(source, "remaining_hours", query_vec)

        if stint_h is None and remain_h is None:
            return empty

        now = datetime.now()
        base_dt = _parse_dt(item.get("last_update")) or now
        obs = item.get("observacao") or ""
        m = re.match(r"^\s*(\d{1,2})h(\d{2})", obs, re.IGNORECASE)
        if m and base_dt:
            base_dt = base_dt.replace(
                hour=int(m.group(1)),
                minute=int(m.group(2)),
                second=0,
                microsecond=0,
            )

        proximo_dt = None
        if stint_h is not None:
            hours_left = max(stint_h - elapsed_h, 0.25)
            proximo_dt = _add_business_hours(base_dt, hours_left)

        conclusao_dt = None
        if remain_h is not None:
            hours_left = max(remain_h - elapsed_h, 0.5)
            conclusao_dt = _add_business_hours(now, hours_left)

        samples = max(n_stint, n_remain)
        metodo = metodo_stint if n_stint >= n_remain else metodo_remain

        return {
            "previsao_proximo_andamento": _isoformat(proximo_dt) if proximo_dt else None,
            "previsao_conclusao": _isoformat(conclusao_dt) if conclusao_dt else None,
            "confianca": _confidence(samples, metodo),
            "amostras": samples,
        }
    except Exception as exc:
        logger.warning("Falha na previsão PCP para OS %s: %s", item.get("nr_os"), exc)
        return empty


def enrich_queue_items(
    items: List[Dict[str, Any]],
    *,
    base_setor: str,
    allowed_situacoes: Sequence[str] | None = None,
) -> List[Dict[str, Any]]:
    """Anexa previsões aos itens da fila sem alterar campos existentes."""
    if not items:
        return items
    try:
        training_df = _get_training_df(base_setor, allowed_situacoes=allowed_situacoes)
    except Exception as exc:
        logger.warning("Histórico PCP indisponível para %s: %s", base_setor, exc)
        training_df = pd.DataFrame()

    enriched: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            enriched.append(item)
            continue
        copy = dict(item)
        pred = predict_for_item(
            copy,
            base_setor=base_setor,
            allowed_situacoes=allowed_situacoes,
            training_df=training_df,
        )
        copy["previsao"] = pred
        enriched.append(copy)
    return enriched

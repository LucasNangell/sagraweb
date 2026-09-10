"""k-NN supervisionado incremental, condicionado à máquina e à separação.

O conjunto de exemplos é o modelo (lazy learning). Não há treino com previsões
automáticas, pickle, GPU ou leitura dos TIFFs durante a inferência do modelo.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from functools import lru_cache
from typing import Any

import numpy as np
from fastapi import HTTPException
from pymysql import MySQLError

from database import db, DatabaseConnectionError, DatabasePoolExhausted
from services.network_file_preview_service import FEATURE_VERSION, GRID_SIZE
from services.plate_filename_utils import parse_plate_filename

logger = logging.getLogger(__name__)
DB_ERRORS = (DatabaseConnectionError, DatabasePoolExhausted, MySQLError)
FEATURE_COUNT = 3 + GRID_SIZE * GRID_SIZE
MAX_TRAINING_SAMPLES = 1000
_db_retry_after = 0.0


def file_color(source_path: str) -> str:
    name = source_path.replace("\\", "/").rsplit("/", 1)[-1]
    parsed = parse_plate_filename(name)
    return (parsed.color or parsed.channel_token or "DESCONHECIDA").strip().upper()[:128]


def sample_key(analysis: dict, maquina: str, cor: str) -> str:
    raw = [analysis["content_sha256"], FEATURE_VERSION, maquina.strip().upper(), cor]
    return hashlib.sha256(json.dumps(raw, ensure_ascii=False).encode()).hexdigest()


def _vector(value: Any) -> np.ndarray | None:
    try:
        a = np.asarray(json.loads(value) if isinstance(value, str) else value, dtype=float)
    except (ValueError, TypeError):
        return None
    if a.shape != (FEATURE_COUNT,) or not np.isfinite(a).all() or (a < 0).any():
        return None
    if a[0] <= 0 or (a[1:] > 1).any():
        return None
    return a


@lru_cache(maxsize=16)
def _training_samples(maquina: str, cor: str, time_bucket: int) -> list[dict] | None:
    # Cache curto compartilhável entre requisições; outros workers atualizam em ≤10 s.
    try:
        return db.execute_query(
            """SELECT sample_key, features_json, blank_graphics FROM tab_tif_graphics_sample
               WHERE maquina=%s AND cor=%s AND feature_version=%s
               ORDER BY updated_at DESC, sample_key LIMIT %s""",
            (maquina, cor, FEATURE_VERSION, MAX_TRAINING_SAMPLES),
        ) or []
    except DB_ERRORS:
        logger.warning("Aprendizado TIFF indisponível; mantendo análise de imagem.")
        return None


def predict_neighbors(features: list[float], samples: list[dict]) -> dict | None:
    """Exige ambas as classes e três vizinhos próximos concordantes.

    A distância usa a raiz da densidade espacial para dar peso a grafismos
    pequenos. A rejeição por distância máxima evita diluição na média da grade.
    """
    query = _vector(features)
    if query is None:
        return None
    valid = [(s, _vector(s["features_json"])) for s in samples]
    valid = [(s, v) for s, v in valid if v is not None]
    if min(sum(bool(s["blank_graphics"]) == label for s, _ in valid)
           for label in (True, False)) < 3:
        return None
    matrix = np.stack([v for _, v in valid])
    diff = np.abs(matrix - query)
    spatial = np.sqrt(np.mean(diff[:, 3:] ** 2, axis=1))
    # Proporção, cobertura total e linhas ativas não podem sumir entre 256 células.
    distances = np.maximum(spatial, np.max(diff[:, :3], axis=1))
    distances = np.maximum(distances, np.max(diff[:, 3:], axis=1) / 4)
    order = np.argsort(distances, kind="stable")[:3]
    labels = [bool(valid[int(i)][0]["blank_graphics"]) for i in order]
    radius = float(distances[order[-1]])
    if len(set(labels)) != 1 or radius > 0.025:
        return None
    opposing = [float(distances[i]) for i, (s, _) in enumerate(valid)
                if bool(s["blank_graphics"]) != labels[0]]
    if min(opposing) <= max(0.01, radius * 1.5):
        return None
    return {"blank_graphics": labels[0], "neighbor_distance": radius,
            "training_samples": len(valid)}


def _decision(analysis: dict, blank: bool, source: str, reason: str) -> dict:
    return {**analysis, "blank_graphics": blank,
            "graphics_status": "blank_graphics" if blank else "with_graphics",
            "detection_source": source, "reason": reason}


def apply_learning(analysis: dict, source_path: str, maquina: str) -> dict:
    global _db_retry_after
    cor = file_color(source_path)
    maquina = maquina.strip().upper()
    result = {**analysis, "cor": cor, "detection_source": "heuristic",
              "learning_status": "awaiting_context", "feedback_revision": 0}
    if not analysis.get("features") or not maquina:
        return result
    if time.monotonic() < _db_retry_after:
        result["learning_status"] = "unavailable"
        return result
    key = sample_key(analysis, maquina, cor)
    try:
        # Busca exata fora da janela de treino, sem expirar correções antigas.
        exact = db.execute_query(
            "SELECT blank_graphics, revision FROM tab_tif_graphics_sample WHERE sample_key=%s",
            (key,),
        )
    except DB_ERRORS:
        # Não repete timeout de conexão para cada TIFF do mesmo lote.
        _db_retry_after = time.monotonic() + 10
        logger.warning("Consulta de correções TIFF indisponível; nova tentativa em 10 s.")
        result["learning_status"] = "unavailable"
        return result
    if exact:
        result.update(learning_status="corrected", feedback_revision=int(exact[0]["revision"]))
        return _decision(result, bool(exact[0]["blank_graphics"]), "feedback",
                         "Classificação corrigida por um usuário para esta máquina e cor.")
    if cor == "DESCONHECIDA":
        return result  # Armazena a correção, mas não generaliza uma cor desconhecida.
    samples = _training_samples(maquina, cor, int(time.monotonic() // 10))
    result["learning_status"] = "collecting" if samples is not None else "unavailable"
    if samples is None:
        return result
    result["training_samples"] = len(samples)
    learned = predict_neighbors(analysis["features"], samples)
    if learned:
        result.update(learned, learning_status="active")
        return _decision(result, learned["blank_graphics"], "knn",
                         "Classificação aprendida com exemplos semelhantes da mesma máquina e cor.")
    return result


def save_feedback(analysis: dict, source_path: str, maquina: str, blank: bool,
                  autor_ponto: str, expected_revision: int) -> dict:
    global _db_retry_after
    if not analysis.get("features") or not analysis.get("content_sha256"):
        raise HTTPException(422, "Este TIFF não forneceu características válidas para aprendizado.")
    maquina = maquina.strip().upper()
    if not maquina:
        raise HTTPException(422, "Informe a máquina antes de corrigir a detecção.")
    cor = file_color(source_path)
    key = sample_key(analysis, maquina, cor)
    nome = source_path.replace("\\", "/").rsplit("/", 1)[-1][:255]
    features_json = json.dumps(analysis["features"], separators=(",", ":"), allow_nan=False)

    def write(cursor):
        # O insert/upsert adquire o lock da amostra mesmo na primeira correção.
        cursor.execute(
            """INSERT INTO tab_tif_graphics_sample
               (sample_key, content_sha256, feature_version, maquina, cor, nome,
                features_json, blank_graphics, autor_ponto, revision)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,0)
               ON DUPLICATE KEY UPDATE sample_key=VALUES(sample_key)""",
            (key, analysis["content_sha256"], FEATURE_VERSION, maquina, cor, nome,
             features_json, blank, autor_ponto),
        )
        cursor.execute("SELECT revision, blank_graphics FROM tab_tif_graphics_sample WHERE sample_key=%s FOR UPDATE", (key,))
        current = cursor.fetchone()
        revision = int(current["revision"])
        if revision != expected_revision:
            # Reenvio após perda de resposta: não cria mais votos nem mais histórico.
            if bool(current["blank_graphics"]) == blank:
                return revision
            raise HTTPException(409, "A classificação foi corrigida por outro usuário. Atualize a lista.")
        revision += 1
        cursor.execute(
            """UPDATE tab_tif_graphics_sample SET blank_graphics=%s, autor_ponto=%s,
               revision=%s, updated_at=CURRENT_TIMESTAMP(6) WHERE sample_key=%s""",
            (blank, autor_ponto, revision, key),
        )
        cursor.execute(
            """INSERT INTO tab_tif_graphics_feedback
               (sample_key, autor_ponto, detected_blank, corrected_blank, detection_source, revision)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (key, autor_ponto, analysis.get("blank_graphics"), blank,
             analysis.get("detection_source", "heuristic"), revision),
        )
        return revision

    try:
        revision = db.execute_transaction([write])[0]
    except DB_ERRORS as exc:
        raise HTTPException(503, "Não foi possível salvar a correção. Tente novamente.") from exc
    _training_samples.cache_clear()
    _db_retry_after = 0.0
    result = _decision(analysis, blank, "feedback", "Correção salva para esta máquina e cor.")
    result.update(cor=cor, maquina=maquina, learning_status="corrected", feedback_revision=revision)
    return result


def public_inspection(analysis: dict) -> dict:
    return {k: v for k, v in analysis.items() if k not in {"features", "content_sha256"}}

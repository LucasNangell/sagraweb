"""Testes do serviço de identidade facial (token + similaridade)."""
from __future__ import annotations

import time

import numpy as np
import pytest
from fastapi import HTTPException

from services import face_identity_service as face_svc


def test_cosine_similarity_identical():
    a = np.ones(128, dtype=np.float32)
    a = a / np.linalg.norm(a)
    assert face_svc.cosine_similarity(a, a) == pytest.approx(1.0, abs=1e-5)


def test_cosine_similarity_orthogonal():
    a = np.zeros(128, dtype=np.float32)
    a[0] = 1.0
    b = np.zeros(128, dtype=np.float32)
    b[1] = 1.0
    assert face_svc.cosine_similarity(a, b) == pytest.approx(0.0, abs=1e-5)


def test_face_token_roundtrip(monkeypatch):
    monkeypatch.setenv("SAGRA_SESSION_SECRET", "test-session-secret-32-chars-minimum!!")
    token = face_svc.create_face_token(
        ponto=1234,
        nome="Teste",
        os_ano=2026,
        os_id=99,
        tablet_ponto=9000,
        ttl_sec=60,
    )
    payload = face_svc.verify_face_token(
        token,
        os_ano=2026,
        os_id=99,
        tablet_ponto=9000,
        consume=True,
    )
    assert payload["ponto"] == 1234
    assert payload["nome"] == "Teste"

    with pytest.raises(HTTPException) as exc:
        face_svc.verify_face_token(
            token,
            os_ano=2026,
            os_id=99,
            tablet_ponto=9000,
            consume=True,
        )
    assert exc.value.status_code == 401


def test_face_token_wrong_os(monkeypatch):
    monkeypatch.setenv("SAGRA_SESSION_SECRET", "test-session-secret-32-chars-minimum!!")
    token = face_svc.create_face_token(
        ponto=1,
        nome="A",
        os_ano=2026,
        os_id=1,
        tablet_ponto=2,
    )
    with pytest.raises(HTTPException) as exc:
        face_svc.verify_face_token(token, os_ano=2026, os_id=2, tablet_ponto=2, consume=False)
    assert exc.value.status_code == 401


def test_face_token_expired(monkeypatch):
    monkeypatch.setenv("SAGRA_SESSION_SECRET", "test-session-secret-32-chars-minimum!!")
    token = face_svc.create_face_token(
        ponto=1,
        nome="A",
        os_ano=2026,
        os_id=1,
        tablet_ponto=2,
        ttl_sec=-1,
    )
    # força exp no passado
    time.sleep(0.05)
    with pytest.raises(HTTPException) as exc:
        face_svc.verify_face_token(token, os_ano=2026, os_id=1, tablet_ponto=2, consume=False)
    assert exc.value.status_code == 401


def test_opencv_embedding_from_synthetic_face(tmp_path, monkeypatch):
    import cv2

    # Imagem com retângulo claro (Haar pode ou não detectar) — testa só embedding interno
    img = np.zeros((240, 240, 3), dtype=np.uint8)
    cv2.rectangle(img, (60, 40), (180, 200), (200, 200, 200), -1)
    cv2.circle(img, (100, 100), 8, (20, 20, 20), -1)
    cv2.circle(img, (140, 100), 8, (20, 20, 20), -1)
    emb = face_svc._opencv_embedding(img)
    assert emb.shape == (128,)
    assert abs(float(np.linalg.norm(emb)) - 1.0) < 1e-4

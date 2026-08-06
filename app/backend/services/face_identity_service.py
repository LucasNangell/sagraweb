"""Identidade facial para painel tablet — enroll, match e face_token."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
from fastapi import HTTPException

from database import db
from usuario_face_schema import face_images_dir

logger = logging.getLogger(__name__)

FACE_TOKEN_TTL_SEC = 90
MATCH_THRESHOLD = 0.72
EMBEDDING_DIM = 128

_onnx_session = None
_onnx_checked = False


@dataclass
class FaceMatch:
    ponto: int
    nome: str
    score: float


def _session_secret_bytes() -> bytes:
    from security.session_auth import _session_secret

    return _session_secret()


def _decode_image(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Imagem inválida.")
    return img


def _detect_face_bbox(bgr: np.ndarray) -> tuple[int, int, int, int]:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(str(cascade_path))
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))
    if len(faces) == 0:
        raise HTTPException(status_code=400, detail="Nenhum rosto detectado na imagem.")
    # Maior face
    x, y, w, h = max(faces, key=lambda f: int(f[2]) * int(f[3]))
    return int(x), int(y), int(w), int(h)


def _crop_face(bgr: np.ndarray, pad: float = 0.2) -> np.ndarray:
    x, y, w, h = _detect_face_bbox(bgr)
    ih, iw = bgr.shape[:2]
    px = int(w * pad)
    py = int(h * pad)
    x0 = max(0, x - px)
    y0 = max(0, y - py)
    x1 = min(iw, x + w + px)
    y1 = min(ih, y + h + py)
    crop = bgr[y0:y1, x0:x1]
    if crop.size == 0:
        raise HTTPException(status_code=400, detail="Recorte facial inválido.")
    return crop


def _opencv_embedding(face_bgr: np.ndarray) -> np.ndarray:
    """Embedding determinístico 128-d (OpenCV) — suficiente para kiosk com fotos controladas."""
    gray = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (128, 128), interpolation=cv2.INTER_AREA)
    resized = cv2.equalizeHist(resized)
    # Blocos 8×8 → 64 médias
    blocks = resized.reshape(8, 16, 8, 16).mean(axis=(1, 3)).astype(np.float32).reshape(-1)
    hist = cv2.calcHist([resized], [0], None, [64], [0, 256]).flatten().astype(np.float32)
    hist = hist / (np.linalg.norm(hist) + 1e-8)
    mixed = np.concatenate([blocks, hist])
    mixed = mixed[:EMBEDDING_DIM]
    if mixed.size < EMBEDDING_DIM:
        mixed = np.pad(mixed, (0, EMBEDDING_DIM - mixed.size))
    norm = np.linalg.norm(mixed)
    if norm < 1e-8:
        raise HTTPException(status_code=400, detail="Não foi possível extrair embedding facial.")
    return (mixed / norm).astype(np.float32)


def _try_onnx_embedding(face_bgr: np.ndarray) -> Optional[np.ndarray]:
    global _onnx_session, _onnx_checked
    if not _onnx_checked:
        _onnx_checked = True
        model_path = Path(__file__).resolve().parent.parent / "assets" / "face" / "mobilefacenet.onnx"
        if not model_path.is_file():
            logger.info("Modelo ONNX facial ausente (%s) — usando embedding OpenCV.", model_path)
            return None
        try:
            import onnxruntime as ort

            _onnx_session = ort.InferenceSession(
                str(model_path),
                providers=["CPUExecutionProvider"],
            )
            logger.info("Modelo ONNX facial carregado: %s", model_path)
        except Exception as exc:
            logger.warning("Falha ao carregar ONNX facial: %s", exc)
            _onnx_session = None
            return None

    if _onnx_session is None:
        return None

    rgb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (112, 112), interpolation=cv2.INTER_AREA)
    blob = resized.astype(np.float32) / 255.0
    blob = (blob - 0.5) / 0.5
    blob = np.transpose(blob, (2, 0, 1))[None, ...]
    input_name = _onnx_session.get_inputs()[0].name
    out = _onnx_session.run(None, {input_name: blob})[0]
    vec = np.asarray(out, dtype=np.float32).reshape(-1)
    norm = np.linalg.norm(vec)
    if norm < 1e-8:
        return None
    return vec / norm


def compute_embedding_from_bytes(image_bytes: bytes) -> np.ndarray:
    bgr = _decode_image(image_bytes)
    face = _crop_face(bgr)
    onnx_emb = _try_onnx_embedding(face)
    if onnx_emb is not None:
        return onnx_emb
    return _opencv_embedding(face)


def embedding_to_json(emb: np.ndarray) -> str:
    return json.dumps([float(x) for x in emb.tolist()])


def embedding_from_json(raw: str) -> np.ndarray:
    data = json.loads(raw)
    return np.asarray(data, dtype=np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape:
        n = min(a.size, b.size)
        a = a.reshape(-1)[:n]
        b = b.reshape(-1)[:n]
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-8:
        return 0.0
    return float(np.dot(a, b) / denom)


def enroll_user_face(ponto: int, image_bytes: bytes) -> dict[str, Any]:
    emb = compute_embedding_from_bytes(image_bytes)
    dest = face_images_dir() / f"{ponto}.jpg"
    # Regrava JPEG do rosto cropeado para auditoria
    bgr = _decode_image(image_bytes)
    face = _crop_face(bgr)
    cv2.imwrite(str(dest), face)

    db.execute_query(
        """
        INSERT INTO tabUsuarioFace (Ponto, EmbeddingJson, ImagePath, Active)
        VALUES (%s, %s, %s, 1)
        ON DUPLICATE KEY UPDATE
            EmbeddingJson = VALUES(EmbeddingJson),
            ImagePath = VALUES(ImagePath),
            Active = 1
        """,
        (ponto, embedding_to_json(emb), str(dest)),
    )
    return {"ponto": ponto, "active": True, "has_face": True}


def deactivate_user_face(ponto: int) -> None:
    db.execute_query(
        "UPDATE tabUsuarioFace SET Active = 0 WHERE Ponto = %s",
        (ponto,),
    )


def get_face_status(ponto: int) -> dict[str, Any]:
    rows = db.execute_query(
        "SELECT Active, UpdatedAt FROM tabUsuarioFace WHERE Ponto = %s",
        (ponto,),
    )
    if not rows:
        return {"ponto": ponto, "has_face": False, "active": False}
    row = rows[0]
    active = bool(row.get("Active", 0))
    return {
        "ponto": ponto,
        "has_face": active,
        "active": active,
        "updated_at": str(row.get("UpdatedAt") or ""),
    }


def list_active_embeddings() -> list[tuple[int, np.ndarray, str]]:
    rows = db.execute_query(
        """
        SELECT f.Ponto, f.EmbeddingJson, COALESCE(u.Nome, '') AS Nome
        FROM tabUsuarioFace f
        LEFT JOIN tabUsuarios u ON u.Ponto = f.Ponto
        WHERE f.Active = 1
        """
    )
    out: list[tuple[int, np.ndarray, str]] = []
    for row in rows or []:
        try:
            ponto = int(row["Ponto"])
            emb = embedding_from_json(str(row["EmbeddingJson"]))
            nome = str(row.get("Nome") or "")
            out.append((ponto, emb, nome))
        except Exception as exc:
            logger.warning("Embedding inválido para ponto %s: %s", row.get("Ponto"), exc)
    return out


def match_face(image_bytes: bytes, *, threshold: float = MATCH_THRESHOLD) -> FaceMatch:
    probe = compute_embedding_from_bytes(image_bytes)
    best: Optional[FaceMatch] = None
    for ponto, emb, nome in list_active_embeddings():
        score = cosine_similarity(probe, emb)
        if best is None or score > best.score:
            best = FaceMatch(ponto=ponto, nome=nome, score=score)
    if best is None:
        raise HTTPException(
            status_code=404,
            detail="Nenhuma face cadastrada no sistema. Cadastre fotos em Usuários.",
        )
    if best.score < threshold:
        raise HTTPException(
            status_code=401,
            detail=f"Rosto não reconhecido (score={best.score:.2f}). Tente novamente.",
        )
    return best


def create_face_token(
    *,
    ponto: int,
    nome: str,
    os_ano: int,
    os_id: int,
    tablet_ponto: int,
    ttl_sec: int = FACE_TOKEN_TTL_SEC,
) -> str:
    payload = {
        "ponto": int(ponto),
        "nome": str(nome or ""),
        "os_ano": int(os_ano),
        "os_id": int(os_id),
        "tablet_ponto": int(tablet_ponto),
        "exp": int(time.time()) + int(ttl_sec),
        "jti": uuid.uuid4().hex,
        "v": 1,
    }
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    sig = hmac.new(
        _session_secret_bytes(),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_face_token(
    token: str,
    *,
    os_ano: int,
    os_id: int,
    tablet_ponto: Optional[int] = None,
    consume: bool = True,
) -> dict[str, Any]:
    if not token or "." not in token:
        raise HTTPException(status_code=401, detail="face_token inválido.")
    payload_b64, sig = token.rsplit(".", 1)
    expected = hmac.new(
        _session_secret_bytes(),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=401, detail="face_token com assinatura inválida.")
    try:
        payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode("ascii")))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="face_token corrompido.") from exc

    if int(payload.get("exp") or 0) < int(time.time()):
        raise HTTPException(status_code=401, detail="face_token expirado. Reconheça o rosto novamente.")
    if int(payload.get("os_ano")) != int(os_ano) or int(payload.get("os_id")) != int(os_id):
        raise HTTPException(status_code=401, detail="face_token não corresponde à OS.")
    if tablet_ponto is not None and int(payload.get("tablet_ponto")) != int(tablet_ponto):
        raise HTTPException(status_code=401, detail="face_token não corresponde à sessão do tablet.")

    jti = str(payload.get("jti") or "")
    if consume and jti:
        if _is_jti_consumed(jti):
            raise HTTPException(status_code=401, detail="face_token já utilizado.")
        _mark_jti_consumed(jti)

    return payload


# jti one-time store (process memory; suficiente para TTL curto)
_consumed_jti: dict[str, float] = {}


def _is_jti_consumed(jti: str) -> bool:
    _purge_jti()
    return jti in _consumed_jti


def _mark_jti_consumed(jti: str) -> None:
    _consumed_jti[jti] = time.time() + FACE_TOKEN_TTL_SEC + 30


def _purge_jti() -> None:
    now = time.time()
    expired = [k for k, exp in _consumed_jti.items() if exp < now]
    for k in expired:
        del _consumed_jti[k]

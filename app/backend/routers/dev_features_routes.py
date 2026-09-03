"""Leitura pública (sessão) das flags de desenvolvimento."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from security.session_auth import SessionData, require_session

router = APIRouter(tags=["dev-features"])


@router.get("/dev-features")
def get_dev_features(_session: SessionData = Depends(require_session)):
    from services.dev_features import get_features_payload

    return get_features_payload()

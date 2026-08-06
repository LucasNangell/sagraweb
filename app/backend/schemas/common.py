from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class StatusResponse(BaseModel):
    status: str = Field(..., examples=["ok", "success", "updated", "deleted"])


class MessageResponse(BaseModel):
    status: str = "ok"
    message: str = ""


class ErrorDetail(BaseModel):
    detail: str


class DictRow(BaseModel):
    """Linha dinâmica do MySQL (DictCursor)."""

    model_config = {"extra": "allow"}

"""Schemas Pydantic v2 — contratos OpenAPI do SAGRA Web."""

from schemas.common import MessageResponse, StatusResponse
from schemas.permissions import ClientPermissionsResponse

__all__ = [
    "MessageResponse",
    "StatusResponse",
    "ClientPermissionsResponse",
]

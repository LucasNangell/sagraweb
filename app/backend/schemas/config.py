from __future__ import annotations

from pydantic import BaseModel, Field


class PublicConfigResponse(BaseModel):
    apiBase: str = Field(..., description="URL base da API com sufixo /api")
    wsPath: str = Field(
        ...,
        description="Path relativo do WebSocket (ex.: /api/ws ou /sagra/api/ws)",
    )
    mysqlOnly: bool = True
    syncEnabled: bool = False
    env: str = "production"
    authMode: str = Field(
        "ponto",
        description="ponto = rede local; password = login e-mail/senha (cgraf.online)",
    )

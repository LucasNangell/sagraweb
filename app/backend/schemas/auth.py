from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class SessionCreateRequest(BaseModel):
    ponto: int | str = Field(..., description="Número do ponto (apenas dígitos)")
    nome: str | None = Field(None, description="Nome do usuário (obrigatório se ainda não cadastrado)")
    password: str | None = Field(
        None,
        description="Senha exigida na intranet quando o IP não está cadastrado para o usuário",
    )

    @field_validator("ponto", mode="before")
    @classmethod
    def normalize_ponto(cls, v: int | str) -> int:
        if isinstance(v, int):
            return v
        digits = "".join(c for c in str(v) if c.isdigit())
        if not digits:
            raise ValueError("Ponto inválido")
        return int(digits)


class SessionUserResponse(BaseModel):
    ponto: int
    nome: str
    ip: str
    auth_mode: str = "local"
    setor: str | None = None
    fornecedor: bool = False


class PasswordLoginRequest(BaseModel):
    login: str = Field(..., min_length=1, description="E-mail ou número do ponto")
    password: str = Field(..., min_length=1)


class ActivateAccountRequest(BaseModel):
    token: str = Field(..., min_length=10)
    password: str = Field(..., min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=10)
    password: str = Field(..., min_length=8, max_length=128)


class SessionCreateResponse(BaseModel):
    status: str = "ok"
    message: str = "Sessão criada"
    user: SessionUserResponse


class SessionLogoutResponse(BaseModel):
    status: str = "ok"
    message: str = "Sessão encerrada"

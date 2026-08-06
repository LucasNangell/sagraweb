"""
Rotas de autenticação Fase B — sessão HttpOnly + login por e-mail (cgraf.online).
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response

from database import db
from schemas.auth import (
    ActivateAccountRequest,
    ForgotPasswordRequest,
    PasswordLoginRequest,
    ResetPasswordRequest,
    SessionCreateRequest,
    SessionCreateResponse,
    SessionLogoutResponse,
    SessionUserResponse,
)
from security.api_auth import resolve_client_ip
from security.password_auth import generate_activation_token, hash_password, verify_password
from services.user_registered_ips_service import (
    local_login_requires_password,
    verify_local_password_gate,
)
from security.public_access import AUTH_MODE_LOCAL, AUTH_MODE_PASSWORD, is_public_internet_request
from routers.setor_painel_routes import fetch_user_fornecedor, fetch_user_setor
from security.session_auth import (
    SessionData,
    clear_session_cookie,
    get_session_from_request,
    set_session_cookie,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])


def _upsert_user(ponto: int, nome: str, client_ip: str) -> str:
    rows = db.execute_query(
        "SELECT Ponto, Nome FROM tabUsuarios WHERE Ponto = %s",
        (ponto,),
    )
    if rows and rows[0].get("Nome"):
        existing_name = str(rows[0]["Nome"]).strip()
        if existing_name and not nome:
            nome = existing_name
    if not nome or not nome.strip():
        raise HTTPException(
            status_code=400,
            detail="Nome é obrigatório para o primeiro cadastro do ponto.",
        )
    nome = nome.strip()
    db.execute_query(
        """
        INSERT INTO tabUsuarios (Ponto, Nome, UltimoAcesso, IPUltimoAcesso)
        VALUES (%s, %s, NOW(), %s)
        ON DUPLICATE KEY UPDATE
            Nome = VALUES(Nome),
            UltimoAcesso = NOW(),
            IPUltimoAcesso = VALUES(IPUltimoAcesso)
        """,
        (ponto, nome, client_ip),
    )
    return nome


def _session_user(session: SessionData) -> SessionUserResponse:
    return SessionUserResponse(
        ponto=session.ponto,
        nome=session.nome,
        ip=session.ip,
        auth_mode=session.auth_mode,
        setor=fetch_user_setor(session.ponto),
        fornecedor=fetch_user_fornecedor(session.ponto),
    )


@router.post(
    "/api/auth/session",
    response_model=SessionCreateResponse,
    summary="Criar sessão (cookie HttpOnly) — rede local",
)
async def create_session(
    request: Request,
    response: Response,
    body: SessionCreateRequest,
) -> SessionCreateResponse:
    if is_public_internet_request(request):
        raise HTTPException(
            status_code=403,
            detail="Acesso via internet requer login com e-mail e senha.",
        )

    client_ip = resolve_client_ip(request)
    ponto = body.ponto
    if local_login_requires_password(ponto, client_ip):
        verify_local_password_gate(ponto, body.password)
    nome = _upsert_user(ponto, body.nome or "", client_ip)

    session = SessionData(
        ponto=ponto,
        nome=nome,
        ip=client_ip,
        iat=int(time.time()),
        auth_mode=AUTH_MODE_LOCAL,
    )
    set_session_cookie(response, session)
    logger.info("Sessão local criada: ponto=%s ip=%s", ponto, client_ip)

    return SessionCreateResponse(
        user=_session_user(session),
    )


def _lookup_password_user(login: str) -> list:
    """Busca usuário por e-mail ou ponto (apenas dígitos)."""
    raw = login.strip()
    if "@" in raw:
        return db.execute_query(
            """
            SELECT Ponto, Nome, PasswordHash, EmailVerified, AuthAtivo, Email
            FROM tabUsuarios
            WHERE Email = %s
            """,
            (raw.lower(),),
        )
    digits = "".join(c for c in raw if c.isdigit())
    if not digits:
        return []
    return db.execute_query(
        """
        SELECT Ponto, Nome, PasswordHash, EmailVerified, AuthAtivo, Email
        FROM tabUsuarios
        WHERE Ponto = %s
        """,
        (int(digits),),
    )


@router.post(
    "/api/auth/login",
    response_model=SessionCreateResponse,
    summary="Login com e-mail/ponto e senha (cgraf.online)",
)
async def login_password(
    request: Request,
    response: Response,
    body: PasswordLoginRequest,
) -> SessionCreateResponse:
    if not is_public_internet_request(request):
        raise HTTPException(
            status_code=403,
            detail="Login por e-mail/ponto disponível apenas via internet pública.",
        )

    rows = _lookup_password_user(body.login)
    if not rows:
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos.")

    row = rows[0]
    if not row.get("AuthAtivo", 1):
        raise HTTPException(status_code=403, detail="Conta desativada.")
    if not row.get("EmailVerified"):
        raise HTTPException(
            status_code=403,
            detail="Conta não ativada. Verifique seu e-mail de ativação.",
        )
    stored_hash = row.get("PasswordHash") or ""
    if not verify_password(body.password, stored_hash):
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos.")

    client_ip = resolve_client_ip(request)
    ponto = int(row["Ponto"])
    nome = str(row.get("Nome") or "")

    db.execute_query(
        """
        UPDATE tabUsuarios
        SET UltimoAcesso = NOW(), IPUltimoAcesso = %s
        WHERE Ponto = %s
        """,
        (client_ip, ponto),
    )

    session = SessionData(
        ponto=ponto,
        nome=nome,
        ip=client_ip,
        iat=int(time.time()),
        auth_mode=AUTH_MODE_PASSWORD,
    )
    set_session_cookie(response, session)
    logger.info("Sessão password criada: ponto=%s login=%s", ponto, body.login.strip())

    return SessionCreateResponse(
        user=_session_user(session),
    )


@router.get(
    "/api/auth/activate/check",
    summary="Validar token de ativação",
)
async def check_activation_token(token: str):
    token = token.strip()
    rows = db.execute_query(
        """
        SELECT Ponto, Nome, Email, ActivationExpires, EmailVerified
        FROM tabUsuarios
        WHERE ActivationToken = %s
        """,
        (token,),
    )
    if rows:
        row = rows[0]
        if row.get("EmailVerified"):
            return {
                "valid": True,
                "already_active": True,
                "nome": row.get("Nome"),
                "account_type": "interno",
            }
        expires = row.get("ActivationExpires")
        if expires and isinstance(expires, datetime) and expires < datetime.now():
            raise HTTPException(status_code=410, detail="Token expirado.")
        return {
            "valid": True,
            "already_active": False,
            "nome": row.get("Nome"),
            "email": row.get("Email"),
            "account_type": "interno",
        }

    cliente_rows = db.execute_query(
        """
        SELECT Nome, Email, Gabinete, ActivationExpires, EmailVerified
        FROM tabClienteGabinete
        WHERE ActivationToken = %s
        """,
        (token,),
    )
    if cliente_rows:
        row = cliente_rows[0]
        if row.get("EmailVerified"):
            return {
                "valid": True,
                "already_active": True,
                "nome": row.get("Nome"),
                "account_type": "cliente",
                "redirect": "/cliente/login",
            }
        expires = row.get("ActivationExpires")
        if expires and isinstance(expires, datetime) and expires < datetime.now():
            raise HTTPException(status_code=410, detail="Token expirado.")
        return {
            "valid": True,
            "already_active": False,
            "nome": row.get("Nome"),
            "email": row.get("Email"),
            "gabinete": row.get("Gabinete"),
            "account_type": "cliente",
            "redirect": "/cliente/login/activate",
        }

    raise HTTPException(status_code=404, detail="Token inválido ou expirado.")


@router.post(
    "/api/auth/activate",
    summary="Ativar conta e definir senha",
)
async def activate_account(body: ActivateAccountRequest):
    token = body.token.strip()
    rows = db.execute_query(
        """
        SELECT Ponto, ActivationExpires, EmailVerified
        FROM tabUsuarios
        WHERE ActivationToken = %s
        """,
        (token,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Token inválido ou expirado.")
    row = rows[0]
    if row.get("EmailVerified"):
        raise HTTPException(status_code=400, detail="Conta já ativada.")
    expires = row.get("ActivationExpires")
    if expires and isinstance(expires, datetime) and expires < datetime.now():
        raise HTTPException(status_code=410, detail="Token expirado.")

    ponto = int(row["Ponto"])
    pwd_hash = hash_password(body.password)
    db.execute_query(
        """
        UPDATE tabUsuarios
        SET PasswordHash = %s,
            EmailVerified = 1,
            ActivationToken = NULL,
            ActivationExpires = NULL
        WHERE Ponto = %s
        """,
        (pwd_hash, ponto),
    )
    return {"status": "ok", "message": "Conta ativada. Faça login com seu e-mail e senha."}


_FORGOT_PASSWORD_MSG = (
    "Se o e-mail estiver cadastrado e a conta estiver ativa, "
    "você receberá um link para redefinir sua senha."
)


@router.post(
    "/api/auth/forgot-password",
    summary="Solicitar link de recuperação de senha",
)
async def forgot_password(request: Request, body: ForgotPasswordRequest):
    if not is_public_internet_request(request):
        raise HTTPException(
            status_code=403,
            detail="Recuperação de senha disponível apenas via internet pública.",
        )

    email = body.email.strip().lower()
    if "@" not in email:
        return {"status": "ok", "message": _FORGOT_PASSWORD_MSG}

    rows = db.execute_query(
        """
        SELECT Ponto, Nome, Email, EmailVerified, AuthAtivo, PasswordHash
        FROM tabUsuarios
        WHERE Email = %s
        """,
        (email,),
    )
    if (
        rows
        and rows[0].get("EmailVerified")
        and rows[0].get("AuthAtivo", 1)
        and rows[0].get("PasswordHash")
    ):
        row = rows[0]
        token = generate_activation_token()
        expires = datetime.now() + timedelta(hours=1)
        ponto = int(row["Ponto"])
        nome = str(row.get("Nome") or "")
        db.execute_query(
            """
            UPDATE tabUsuarios
            SET PasswordResetToken = %s, PasswordResetExpires = %s
            WHERE Ponto = %s
            """,
            (token, expires, ponto),
        )
        try:
            from services.password_reset_email_service import send_password_reset_email

            send_password_reset_email(to_email=email, nome=nome, token=token)
        except Exception as exc:
            logger.error("forgot_password: falha no e-mail ponto=%s: %s", ponto, exc)

    return {"status": "ok", "message": _FORGOT_PASSWORD_MSG}


@router.get(
    "/api/auth/reset-password/check",
    summary="Validar token de recuperação de senha",
)
async def check_reset_password_token(token: str):
    rows = db.execute_query(
        """
        SELECT Ponto, Nome, Email, PasswordResetExpires, EmailVerified, AuthAtivo
        FROM tabUsuarios
        WHERE PasswordResetToken = %s
        """,
        (token.strip(),),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Token inválido ou expirado.")
    row = rows[0]
    if not row.get("EmailVerified") or not row.get("AuthAtivo", 1):
        raise HTTPException(status_code=403, detail="Conta indisponível para redefinição.")
    expires = row.get("PasswordResetExpires")
    if expires and isinstance(expires, datetime) and expires < datetime.now():
        raise HTTPException(status_code=410, detail="Token expirado.")
    return {
        "valid": True,
        "nome": row.get("Nome"),
        "email": row.get("Email"),
    }


@router.post(
    "/api/auth/reset-password",
    summary="Redefinir senha com token de recuperação",
)
async def reset_password(body: ResetPasswordRequest):
    token = body.token.strip()
    rows = db.execute_query(
        """
        SELECT Ponto, PasswordResetExpires, EmailVerified, AuthAtivo
        FROM tabUsuarios
        WHERE PasswordResetToken = %s
        """,
        (token,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Token inválido ou expirado.")
    row = rows[0]
    if not row.get("EmailVerified") or not row.get("AuthAtivo", 1):
        raise HTTPException(status_code=403, detail="Conta indisponível para redefinição.")
    expires = row.get("PasswordResetExpires")
    if expires and isinstance(expires, datetime) and expires < datetime.now():
        raise HTTPException(status_code=410, detail="Token expirado.")

    ponto = int(row["Ponto"])
    pwd_hash = hash_password(body.password)
    db.execute_query(
        """
        UPDATE tabUsuarios
        SET PasswordHash = %s,
            PasswordResetToken = NULL,
            PasswordResetExpires = NULL
        WHERE Ponto = %s
        """,
        (pwd_hash, ponto),
    )
    return {"status": "ok", "message": "Senha redefinida. Faça login com sua nova senha."}


@router.post(
    "/api/auth/logout",
    response_model=SessionLogoutResponse,
    summary="Encerrar sessão",
)
async def logout_session(response: Response) -> SessionLogoutResponse:
    clear_session_cookie(response)
    return SessionLogoutResponse()


@router.get(
    "/api/auth/user-name/{ponto}",
    summary="Consultar nome cadastrado por ponto (tela de login local)",
)
async def get_user_name_for_login(ponto: int, request: Request) -> dict:
    """Retorna apenas o nome — rota pública na intranet para preencher o login."""
    if is_public_internet_request(request):
        raise HTTPException(
            status_code=403,
            detail="Consulta de nome por ponto disponível apenas na rede local.",
        )

    rows = db.execute_query(
        "SELECT Nome FROM tabUsuarios WHERE Ponto = %s",
        (ponto,),
    )
    nome = None
    if rows and rows[0].get("Nome"):
        cleaned = str(rows[0]["Nome"]).strip()
        if cleaned:
            nome = cleaned
    client_ip = resolve_client_ip(request)
    requires_password = local_login_requires_password(ponto, client_ip)
    return {"nome": nome, "requires_password": requires_password}


@router.get(
    "/api/auth/me",
    response_model=SessionUserResponse,
    summary="Usuário da sessão atual",
)
async def get_current_session(request: Request) -> SessionUserResponse:
    """Rota pública no middleware: sem cookie → 401 (SPA redireciona ao login)."""
    session = get_session_from_request(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    return _session_user(session)

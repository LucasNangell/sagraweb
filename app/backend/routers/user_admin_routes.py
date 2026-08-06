"""
Cadastro de usuários com login por e-mail/senha (MASTER) e permissões por ponto.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, field_validator

from database import db
from schemas.permissions import ClientPermissionsResponse
from security.api_auth import require_master_ip
from security.password_auth import generate_activation_token
from security.session_auth import get_session_from_request
from security.user_permissions import (
    get_user_permissions_raw,
    upsert_user_permissions,
)
from services.activation_email_service import send_activation_email
from services.user_registered_ips_service import list_user_ips_detail, set_user_ips

logger = logging.getLogger(__name__)

router = APIRouter(tags=["user-admin"])


class UserCreateRequest(BaseModel):
    ponto: int | str
    nome: str = Field(..., min_length=2, max_length=255)
    email: EmailStr
    setor: Optional[str] = Field(None, max_length=32)
    fornecedor: bool = False

    @field_validator("ponto", mode="before")
    @classmethod
    def normalize_ponto(cls, v: int | str) -> int:
        if isinstance(v, int):
            return v
        digits = "".join(c for c in str(v) if c.isdigit())
        if not digits:
            raise ValueError("Ponto inválido")
        return int(digits)


class UserSetorUpdate(BaseModel):
    setor: Optional[str] = Field(None, max_length=32)


class UserProfileUpdate(BaseModel):
    nome: Optional[str] = Field(None, min_length=2, max_length=255)
    setor: Optional[str] = Field(None, max_length=32)
    fornecedor: Optional[bool] = None


class UserIpsUpdate(BaseModel):
    ips: List[str] = Field(default_factory=list)


class UserPermissionsUpdate(BaseModel):
    ctx_nova_os: Optional[bool] = None
    ctx_duplicar_os: Optional[bool] = None
    ctx_editar_os: Optional[bool] = None
    ctx_vincular_os: Optional[bool] = None
    ctx_abrir_pasta: Optional[bool] = None
    ctx_mover_pastas: Optional[bool] = None
    ctx_imprimir_ficha: Optional[bool] = None
    ctx_detalhes_os: Optional[bool] = None
    ctx_prova_web: Optional[bool] = None
    sb_inicio: Optional[bool] = None
    sb_gerencia: Optional[bool] = None
    sb_email: Optional[bool] = None
    sb_analise: Optional[bool] = None
    sb_papelaria: Optional[bool] = None
    sb_usuario: Optional[bool] = None
    sb_configuracoes: Optional[bool] = None
    sb_relatorio: Optional[bool] = None
    sb_dashboard_setor: Optional[bool] = None
    sb_dashboard_global: Optional[bool] = None
    sb_dashboard_tablet: Optional[bool] = None
    painel_setores: Optional[List[str]] = None
    sb_admin_ips: Optional[bool] = None
    sb_pcp: Optional[bool] = None
    sb_usuarios: Optional[bool] = None
    sb_active_computers: Optional[bool] = None
    sb_gravacao: Optional[bool] = None
    sb_cotas_graf: Optional[bool] = None
    sb_gravacao_externa: Optional[bool] = None
    sb_gravacao_pendente: Optional[bool] = None
    sb_gravacao_externa_operador: Optional[bool] = None
    sb_gravacao_pendente_excluir: Optional[bool] = None
    sb_gravacao_externa_entrega: Optional[bool] = None
    sb_gravacao_externa_lancar: Optional[bool] = None
    sb_estoque: Optional[bool] = None
    sb_estoque_gerente: Optional[bool] = None
    sb_lombada: Optional[bool] = None
    sb_credenciais_depol: Optional[bool] = None
    auth_ativo: Optional[bool] = None


def _to_permissions_response(perms: dict, ponto: int) -> ClientPermissionsResponse:
    from routers.ip_admin_routes import _to_permissions_response as _ip_to_resp

    return _ip_to_resp(perms, ponto=ponto)


@router.post("/api/admin/users", dependencies=[Depends(require_master_ip)])
async def create_auth_user(body: UserCreateRequest):
    """Cadastra usuário e envia e-mail de ativação (MASTER)."""
    ponto = body.ponto
    nome = body.nome.strip()
    email = str(body.email).strip().lower()
    setor = (body.setor or "").strip() or None
    fornecedor = 1 if body.fornecedor else 0

    existing_email = db.execute_query(
        "SELECT Ponto FROM tabUsuarios WHERE Email = %s AND Ponto != %s",
        (email, ponto),
    )
    if existing_email:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado para outro ponto.")

    token = generate_activation_token()
    expires = datetime.now() + timedelta(hours=48)

    db.execute_query(
        """
        INSERT INTO tabUsuarios
            (Ponto, Nome, Email, Setor, Fornecedor, EmailVerified, ActivationToken, ActivationExpires, AuthAtivo)
        VALUES (%s, %s, %s, %s, %s, 0, %s, %s, 1)
        ON DUPLICATE KEY UPDATE
            Nome = VALUES(Nome),
            Email = VALUES(Email),
            Setor = COALESCE(VALUES(Setor), Setor),
            Fornecedor = VALUES(Fornecedor),
            EmailVerified = 0,
            PasswordHash = NULL,
            ActivationToken = VALUES(ActivationToken),
            ActivationExpires = VALUES(ActivationExpires),
            AuthAtivo = 1
        """,
        (ponto, nome, email, setor, fornecedor, token, expires),
    )

    db.execute_query(
        "INSERT IGNORE INTO user_permissions (Ponto) VALUES (%s)",
        (ponto,),
    )

    if fornecedor:
        upsert_user_permissions(ponto, {"sb_gravacao_externa": True})

    try:
        send_activation_email(to_email=email, nome=nome, token=token)
    except Exception as exc:
        logger.error("create_auth_user: falha no e-mail ponto=%s: %s", ponto, exc)
        raise HTTPException(
            status_code=502,
            detail="Usuário cadastrado, mas falha ao enviar e-mail de ativação.",
        )

    return {"status": "ok", "ponto": ponto, "email": email}


@router.delete(
    "/api/admin/users/{ponto}",
    dependencies=[Depends(require_master_ip)],
)
@router.post(
    "/api/admin/users/{ponto}/delete",
    dependencies=[Depends(require_master_ip)],
)
async def delete_auth_user(ponto: int, request: Request):
    """Exclui permanentemente o usuário, permissões e IPs cadastrados (MASTER)."""
    session = get_session_from_request(request)
    if session is not None and int(session.ponto) == int(ponto):
        raise HTTPException(
            status_code=400,
            detail="Não é permitido excluir o próprio usuário.",
        )

    rows = db.execute_query(
        "SELECT Ponto FROM tabUsuarios WHERE Ponto = %s",
        (ponto,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    db.execute_query(
        "DELETE FROM user_registered_ips WHERE Ponto = %s",
        (ponto,),
    )
    db.execute_query(
        "DELETE FROM user_permissions WHERE Ponto = %s",
        (ponto,),
    )
    db.execute_query(
        "DELETE FROM tabUsuarios WHERE Ponto = %s",
        (ponto,),
    )
    return {"status": "ok", "ponto": ponto}


@router.put(
    "/api/admin/users/{ponto}",
    dependencies=[Depends(require_master_ip)],
)
async def update_user_profile(ponto: int, body: UserProfileUpdate):
    """Atualiza nome e/ou setor de qualquer usuário cadastrado (MASTER)."""
    rows = db.execute_query("SELECT Ponto FROM tabUsuarios WHERE Ponto = %s", (ponto,))
    if not rows:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    nome = body.nome.strip() if body.nome is not None else None
    setor = (body.setor or "").strip() if body.setor is not None else None
    if body.setor is not None and not setor:
        setor = None

    updates: list[str] = []
    params: list = []
    if nome is not None:
        if not nome:
            raise HTTPException(status_code=400, detail="Nome inválido.")
        updates.append("Nome = %s")
        params.append(nome)
    if body.setor is not None:
        updates.append("Setor = %s")
        params.append(setor)
    if body.fornecedor is not None:
        updates.append("Fornecedor = %s")
        params.append(1 if body.fornecedor else 0)

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="Informe nome, setor e/ou fornecedor para atualizar.",
        )

    params.append(ponto)
    db.execute_query(
        f"UPDATE tabUsuarios SET {', '.join(updates)} WHERE Ponto = %s",
        tuple(params),
    )

    if body.fornecedor is True:
        upsert_user_permissions(ponto, {"sb_gravacao_externa": True})

    return {
        "status": "ok",
        "ponto": ponto,
        "nome": nome,
        "setor": setor if body.setor is not None else None,
        "fornecedor": body.fornecedor,
    }


@router.get(
    "/api/admin/users/{ponto}/ips",
    dependencies=[Depends(require_master_ip)],
)
async def get_user_ips_admin(ponto: int):
    rows = db.execute_query("SELECT Ponto FROM tabUsuarios WHERE Ponto = %s", (ponto,))
    if not rows:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    return {"ponto": ponto, "ips": list_user_ips_detail(ponto)}


@router.put(
    "/api/admin/users/{ponto}/ips",
    dependencies=[Depends(require_master_ip)],
)
async def update_user_ips_admin(ponto: int, body: UserIpsUpdate):
    rows = db.execute_query("SELECT Ponto FROM tabUsuarios WHERE Ponto = %s", (ponto,))
    if not rows:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    try:
        saved = set_user_ips(ponto, body.ips)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "ponto": ponto, "ips": saved}


@router.put(
    "/api/admin/users/{ponto}/setor",
    dependencies=[Depends(require_master_ip)],
)
async def update_user_setor(ponto: int, body: UserSetorUpdate):
    rows = db.execute_query("SELECT Ponto FROM tabUsuarios WHERE Ponto = %s", (ponto,))
    if not rows:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    setor = (body.setor or "").strip() or None
    db.execute_query(
        "UPDATE tabUsuarios SET Setor = %s WHERE Ponto = %s",
        (setor, ponto),
    )
    return {"status": "ok", "ponto": ponto, "setor": setor}


@router.post(
    "/api/admin/users/{ponto}/resend-activation",
    dependencies=[Depends(require_master_ip)],
)
async def resend_activation(ponto: int):
    rows = db.execute_query(
        """
        SELECT Ponto, Nome, Email, EmailVerified
        FROM tabUsuarios WHERE Ponto = %s
        """,
        (ponto,),
    )
    if not rows or not rows[0].get("Email"):
        raise HTTPException(status_code=404, detail="Usuário ou e-mail não encontrado.")
    if rows[0].get("EmailVerified"):
        raise HTTPException(status_code=400, detail="Conta já ativada.")

    token = generate_activation_token()
    expires = datetime.now() + timedelta(hours=48)
    email = str(rows[0]["Email"]).strip()
    nome = str(rows[0].get("Nome") or "")

    db.execute_query(
        """
        UPDATE tabUsuarios
        SET ActivationToken = %s, ActivationExpires = %s
        WHERE Ponto = %s
        """,
        (token, expires, ponto),
    )

    send_activation_email(to_email=email, nome=nome, token=token)
    return {"status": "ok", "message": "E-mail de ativação reenviado."}


@router.get(
    "/api/admin/users/{ponto}/permissions",
    response_model=ClientPermissionsResponse,
    dependencies=[Depends(require_master_ip)],
)
async def get_user_permissions_admin(ponto: int):
    perms = get_user_permissions_raw(ponto)
    rows = db.execute_query(
        "SELECT Email, EmailVerified, AuthAtivo FROM tabUsuarios WHERE Ponto = %s",
        (ponto,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    if perms is None:
        perms = {k: False for k in (
            "ctx_nova_os", "ctx_duplicar_os", "ctx_editar_os", "ctx_vincular_os",
            "ctx_abrir_pasta", "ctx_mover_pastas", "ctx_imprimir_ficha", "ctx_detalhes_os",
            "ctx_prova_web",
            "sb_inicio", "sb_gerencia", "sb_email", "sb_analise", "sb_papelaria",
            "sb_usuario", "sb_configuracoes", "sb_relatorio", "sb_dashboard_setor",
            "sb_dashboard_global", "sb_dashboard_tablet", "sb_admin_ips", "sb_pcp", "sb_usuarios",
            "sb_active_computers", "sb_gravacao", "sb_cotas_graf", "sb_gravacao_externa", "sb_gravacao_pendente", "sb_gravacao_externa_operador", "sb_gravacao_pendente_excluir", "sb_gravacao_externa_entrega", "sb_gravacao_externa_lancar", "sb_estoque", "sb_estoque_gerente", "sb_lombada", "sb_credenciais_depol",
        )}
        perms["ip"] = f"user:{ponto}"
        perms["painel_setores"] = []
        perms["painel_setores_legacy_all"] = False
    return _to_permissions_response(perms, ponto=ponto)


@router.put(
    "/api/admin/users/{ponto}/permissions",
    dependencies=[Depends(require_master_ip)],
)
async def update_user_permissions_admin(ponto: int, body: UserPermissionsUpdate):
    rows = db.execute_query("SELECT Ponto FROM tabUsuarios WHERE Ponto = %s", (ponto,))
    if not rows:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    raw = body.model_dump(exclude={"auth_ativo"}, exclude_none=True)
    painel_setores = raw.pop("painel_setores", None)
    perm_data: dict = {k: v for k, v in raw.items() if v is not None}
    if painel_setores is not None:
        perm_data["painel_setores"] = painel_setores
        perm_data["sb_dashboard_setor"] = bool(painel_setores) or bool(
            perm_data.get("sb_dashboard_setor", body.sb_dashboard_setor)
        )
    if perm_data:
        upsert_user_permissions(ponto, perm_data)

    if body.auth_ativo is not None:
        db.execute_query(
            "UPDATE tabUsuarios SET AuthAtivo = %s WHERE Ponto = %s",
            (1 if body.auth_ativo else 0, ponto),
        )

    return {"status": "ok", "ponto": ponto}

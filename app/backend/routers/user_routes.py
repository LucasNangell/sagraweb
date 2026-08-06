"""
Rotas para gerenciamento de usuários (Ponto + Nome)
"""
import logging
import time

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from database import db
from schemas.common import MessageResponse
from security.api_auth import resolve_client_ip
from security.session_auth import SessionData, set_session_cookie
from services.user_registered_ips_service import (
    attach_ips_to_users,
    local_login_requires_password,
    verify_local_password_gate,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["users"])

class UserIdentifyRequest(BaseModel):
    ponto: str
    nome: str
    password: Optional[str] = None

class UserResponse(BaseModel):
    ponto: int
    nome: Optional[str]
    ultimo_acesso: Optional[datetime]
    ip_ultimo_acesso: Optional[str]
    online: bool = False

@router.post("/api/users/identify", response_model=MessageResponse)
def identify_user(req: UserIdentifyRequest, request: Request, response: Response):
    """
    Identifica o usuário e cria cookie de sessão (compatível com UI legada).
    Preferir POST /api/auth/session na nova UI React.
    """
    try:
        ponto_clean = int("".join(filter(str.isdigit, req.ponto)))
        nome_clean = req.nome.strip()
        if not nome_clean:
            raise HTTPException(status_code=400, detail="Nome é obrigatório")

        client_ip = resolve_client_ip(request)
        from security.public_access import is_public_internet_request

        if is_public_internet_request(request):
            raise HTTPException(
                status_code=403,
                detail="Acesso via internet requer login com e-mail e senha.",
            )

        if local_login_requires_password(ponto_clean, client_ip):
            verify_local_password_gate(ponto_clean, req.password)

        db.execute_query(
            """
            INSERT INTO tabUsuarios (Ponto, Nome, UltimoAcesso, IPUltimoAcesso)
            VALUES (%s, %s, NOW(), %s)
            ON DUPLICATE KEY UPDATE
                Nome = %s,
                UltimoAcesso = NOW(),
                IPUltimoAcesso = VALUES(IPUltimoAcesso)
            """,
            (ponto_clean, nome_clean, client_ip, nome_clean),
        )

        set_session_cookie(
            response,
            SessionData(
                ponto=ponto_clean,
                nome=nome_clean,
                ip=client_ip,
                iat=int(time.time()),
            ),
        )
        return MessageResponse(status="success", message="Usuário identificado")

    except ValueError:
        raise HTTPException(status_code=400, detail="Ponto inválido")
    except Exception as e:
        logger.error(f"Erro em identify_user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/users/{ponto:int}")
def get_user(ponto: int):
    """
    Retorna informações do usuário.
    Útil para saber se já tem nome cadastrado.
    """
    try:
        # ponto já é int devido à tipagem na rota
        ponto_clean = ponto
        
        rows = db.execute_query("SELECT Ponto, Nome, UltimoAcesso, IPUltimoAcesso FROM tabUsuarios WHERE Ponto = %s", (ponto_clean,))
        
        if rows:
            return rows[0]
        else:
            return {"Ponto": ponto_clean, "Nome": None} # Usuário não encontrado/sem cadastro
            
    except ValueError:
        raise HTTPException(status_code=400, detail="Ponto inválido")
    except Exception as e:
        logger.error(f"Erro ao buscar usuário: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/users")
def list_users():
    """
    Lista usuários para área administrativa.
    """
    try:
        # Busca usuários do banco
        users_db = db.execute_query(
            """
            SELECT Ponto, Nome, Setor, Fornecedor, UltimoAcesso, IPUltimoAcesso,
                   Email, EmailVerified, AuthAtivo
            FROM tabUsuarios ORDER BY UltimoAcesso DESC LIMIT 100
            """
        )

        return attach_ips_to_users(users_db)
        
    except Exception as e:
        logger.error(f"Erro listando usuários: {e}")
        return []

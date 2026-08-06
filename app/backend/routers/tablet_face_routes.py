"""Rotas de cadastro e verificação facial (painel tablet)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from security.api_auth import is_master_client
from security.session_auth import require_session
from security.user_permissions import get_user_permissions_raw, resolve_effective_permissions
from services import face_identity_service as face_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["tablet-face"])


class FaceStatusResponse(BaseModel):
    ponto: int
    has_face: bool
    active: bool = False
    updated_at: str = ""


class FaceVerifyResponse(BaseModel):
    ponto: int
    nome: str
    score: float
    face_token: str


class PontoVerifyRequest(BaseModel):
    ponto: int
    os_ano: int
    os_id: int


class PontoVerifyResponse(BaseModel):
    ponto: int
    nome: str
    face_token: str


class PontoLookupResponse(BaseModel):
    ponto: int
    exists: bool
    nome: str = ""
    has_face: bool = False


class PontoRegisterResponse(BaseModel):
    ponto: int
    nome: str
    face_token: str
    created: bool = False
    face_enrolled: bool = True


def _effective_has_tablet(request: Request) -> bool:
    session = require_session(request)
    try:
        from routers.ip_admin_routes import get_client_permissions

        perms = resolve_effective_permissions(
            request,
            session,
            get_client_permissions=get_client_permissions,
        )
        if perms and bool(perms.get("sb_dashboard_tablet")):
            return True
    except Exception as exc:
        logger.debug("resolve_effective_permissions falhou: %s", exc)
    raw = get_user_permissions_raw(session.ponto) or {}
    return bool(raw.get("sb_dashboard_tablet"))


def _require_master_or_usuarios(request: Request) -> None:
    if is_master_client(request):
        return
    session = require_session(request)
    raw = get_user_permissions_raw(session.ponto) or {}
    if not bool(raw.get("sb_usuarios")):
        raise HTTPException(status_code=403, detail="Acesso negado.")


@router.get(
    "/admin/users/{ponto}/face",
    response_model=FaceStatusResponse,
)
async def admin_get_face_status(ponto: int, request: Request):
    _require_master_or_usuarios(request)
    return FaceStatusResponse(**face_svc.get_face_status(ponto))


@router.post(
    "/admin/users/{ponto}/face",
    response_model=FaceStatusResponse,
)
async def admin_enroll_face(
    ponto: int,
    request: Request,
    file: UploadFile = File(...),
):
    _require_master_or_usuarios(request)
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Imagem muito grande (máx. 8MB).")
    face_svc.enroll_user_face(ponto, data)
    return FaceStatusResponse(**face_svc.get_face_status(ponto))


@router.delete("/admin/users/{ponto}/face")
async def admin_delete_face(ponto: int, request: Request):
    _require_master_or_usuarios(request)
    face_svc.deactivate_user_face(ponto)
    return {"status": "ok"}


@router.post("/tablet/face/verify", response_model=FaceVerifyResponse)
async def tablet_face_verify(
    request: Request,
    file: UploadFile = File(...),
    os_ano: int = Form(...),
    os_id: int = Form(...),
):
    session = require_session(request)
    if not _effective_has_tablet(request):
        raise HTTPException(status_code=403, detail="Permissão sb_dashboard_tablet necessária.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Imagem vazia.")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Imagem muito grande (máx. 8MB).")

    match = face_svc.match_face(data)
    token = face_svc.create_face_token(
        ponto=match.ponto,
        nome=match.nome,
        os_ano=os_ano,
        os_id=os_id,
        tablet_ponto=session.ponto,
    )
    return FaceVerifyResponse(
        ponto=match.ponto,
        nome=match.nome,
        score=round(match.score, 4),
        face_token=token,
    )


@router.post("/tablet/ponto/verify", response_model=PontoVerifyResponse)
async def tablet_ponto_verify(request: Request, body: PontoVerifyRequest):
    """Fallback touch: identifica operador pelo ponto digitado no tablet."""
    session = require_session(request)
    if not _effective_has_tablet(request):
        raise HTTPException(status_code=403, detail="Permissão sb_dashboard_tablet necessária.")

    ponto = int(body.ponto)
    if ponto <= 0:
        raise HTTPException(status_code=400, detail="Ponto inválido.")

    from database import db

    rows = db.execute_query(
        """
        SELECT Ponto, COALESCE(Nome, '') AS Nome, COALESCE(AuthAtivo, 1) AS AuthAtivo
        FROM tabUsuarios
        WHERE Ponto = %s
        LIMIT 1
        """,
        (ponto,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Ponto não encontrado.")
    if not bool(rows[0].get("AuthAtivo", 1)):
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    nome = str(rows[0].get("Nome") or f"Ponto {ponto}")
    token = face_svc.create_face_token(
        ponto=ponto,
        nome=nome,
        os_ano=body.os_ano,
        os_id=body.os_id,
        tablet_ponto=session.ponto,
    )
    return PontoVerifyResponse(ponto=ponto, nome=nome, face_token=token)


def _upsert_tablet_operator(ponto: int, nome: str) -> bool:
    """Cria ou atualiza operador na tabUsuarios. Retorna True se era novo."""
    from database import db

    existing = db.execute_query(
        "SELECT Ponto FROM tabUsuarios WHERE Ponto = %s LIMIT 1",
        (ponto,),
    )
    created = not bool(existing)
    try:
        db.execute_query(
            """
            INSERT INTO tabUsuarios (Ponto, Nome, UltimoAcesso, AuthAtivo)
            VALUES (%s, %s, NOW(), 1)
            ON DUPLICATE KEY UPDATE
                Nome = VALUES(Nome),
                UltimoAcesso = NOW(),
                AuthAtivo = 1
            """,
            (ponto, nome),
        )
    except Exception:
        db.execute_query(
            """
            INSERT INTO tabUsuarios (Ponto, Nome, UltimoAcesso)
            VALUES (%s, %s, NOW())
            ON DUPLICATE KEY UPDATE
                Nome = VALUES(Nome),
                UltimoAcesso = NOW()
            """,
            (ponto, nome),
        )
    try:
        db.execute_query(
            "INSERT IGNORE INTO user_permissions (Ponto) VALUES (%s)",
            (ponto,),
        )
    except Exception as exc:
        logger.debug("user_permissions insert ignore falhou ponto=%s: %s", ponto, exc)
    return created


@router.get("/tablet/ponto/{ponto}", response_model=PontoLookupResponse)
async def tablet_ponto_lookup(ponto: int, request: Request):
    """Consulta ponto para autocompletar nome no cadastro facial do tablet."""
    require_session(request)
    if not _effective_has_tablet(request):
        raise HTTPException(status_code=403, detail="Permissão sb_dashboard_tablet necessária.")
    if ponto <= 0:
        raise HTTPException(status_code=400, detail="Ponto inválido.")

    from database import db

    rows = db.execute_query(
        """
        SELECT COALESCE(Nome, '') AS Nome
        FROM tabUsuarios
        WHERE Ponto = %s
        LIMIT 1
        """,
        (ponto,),
    )
    if not rows:
        return PontoLookupResponse(ponto=ponto, exists=False)
    face = face_svc.get_face_status(ponto)
    return PontoLookupResponse(
        ponto=ponto,
        exists=True,
        nome=str(rows[0].get("Nome") or ""),
        has_face=bool(face.get("has_face")),
    )


@router.post("/tablet/ponto/register", response_model=PontoRegisterResponse)
async def tablet_ponto_register(
    request: Request,
    file: UploadFile = File(...),
    ponto: int = Form(...),
    nome: str = Form(...),
    os_ano: int = Form(...),
    os_id: int = Form(...),
):
    """Cadastra/atualiza operador + face no tablet e emite face_token para o andamento."""
    session = require_session(request)
    if not _effective_has_tablet(request):
        raise HTTPException(status_code=403, detail="Permissão sb_dashboard_tablet necessária.")

    ponto_n = int(ponto)
    if ponto_n <= 0:
        raise HTTPException(status_code=400, detail="Ponto inválido.")
    nome_clean = (nome or "").strip()
    if len(nome_clean) < 2:
        raise HTTPException(status_code=400, detail="Informe o nome do operador.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Imagem vazia.")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Imagem muito grande (máx. 8MB).")

    created = _upsert_tablet_operator(ponto_n, nome_clean)
    face_svc.enroll_user_face(ponto_n, data)
    token = face_svc.create_face_token(
        ponto=ponto_n,
        nome=nome_clean,
        os_ano=os_ano,
        os_id=os_id,
        tablet_ponto=session.ponto,
    )
    return PontoRegisterResponse(
        ponto=ponto_n,
        nome=nome_clean,
        face_token=token,
        created=created,
        face_enrolled=True,
    )

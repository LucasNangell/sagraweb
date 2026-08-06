"""
Portal do cliente (gabinete) — login, dashboard de OSs e subcontas.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, model_validator

from database import db
from routers.proof_portal_routes import build_proof_portal_url
from security.api_auth import require_master_ip, resolve_client_ip
from security.password_auth import generate_activation_token, hash_password, verify_password
from security.session_auth import (
    AUTH_MODE_CLIENTE,
    SessionData,
    clear_cliente_session_cookie,
    require_cliente_session,
    set_cliente_session_cookie,
)
from services.cliente_activation_email_service import send_cliente_activation_email

logger = logging.getLogger(__name__)

router = APIRouter(tags=["cliente-gabinete"])

TIPO_CONTA_GABINETE = "gabinete"
TIPO_CONTA_ORGAO = "orgao"


class ClienteLoginRequest(BaseModel):
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=1)


class ClienteActivateRequest(BaseModel):
    token: str = Field(..., min_length=10)
    password: str = Field(..., min_length=8, max_length=128)


class ClienteCreateRequest(BaseModel):
    nome: str = Field(..., min_length=2, max_length=255)
    email: EmailStr
    tipo_conta: str = Field(default=TIPO_CONTA_GABINETE)
    vinculo: Optional[str] = None
    gabinete: Optional[str] = None

    @model_validator(mode="after")
    def resolve_vinculo(self) -> "ClienteCreateRequest":
        raw = self.vinculo or self.gabinete
        if not raw or not str(raw).strip():
            raise ValueError("Informe o vínculo (gabinete ou órgão).")
        tipo = str(self.tipo_conta or TIPO_CONTA_GABINETE).strip().lower()
        if tipo not in (TIPO_CONTA_GABINETE, TIPO_CONTA_ORGAO):
            raise ValueError("tipo_conta inválido.")
        object.__setattr__(self, "vinculo", _normalize_vinculo(str(raw)))
        object.__setattr__(self, "tipo_conta", tipo)
        return self


class ClienteSubContaRequest(BaseModel):
    nome: str = Field(..., min_length=2, max_length=255)
    email: EmailStr


class ClienteUserResponse(BaseModel):
    id: int
    nome: str
    email: str
    gabinete: str
    tipo_conta: str
    is_principal: bool
    nav_credencial_depol: bool = False


class ClienteNavUpdateRequest(BaseModel):
    nav_credencial_depol: bool


class ClienteTimelineStep(BaseModel):
    ordem: int
    situacao: str
    setor: str
    concluido: bool
    data: Optional[datetime] = None
    pendencia_tipo: Optional[str] = None
    pendencia_url: Optional[str] = None
    pendencia_label: Optional[str] = None
    pendencia_mensagem: Optional[str] = None


class ClienteOsTimelineResponse(BaseModel):
    steps: List[ClienteTimelineStep]
    maquina: Optional[str] = None
    produto: Optional[str] = None
    referencia_os_count: int = 0


def _normalize_vinculo(value: str) -> str:
    return " ".join(str(value or "").strip().split())


def _normalize_tipo_conta(value: Optional[str]) -> str:
    tipo = str(value or TIPO_CONTA_GABINETE).strip().lower()
    if tipo not in (TIPO_CONTA_GABINETE, TIPO_CONTA_ORGAO):
        return TIPO_CONTA_GABINETE
    return tipo


def _vinculo_tipo_label(tipo: str) -> str:
    return "órgão" if tipo == TIPO_CONTA_ORGAO else "gabinete"


def _os_vinculo_filter_sql(tipo: str) -> str:
    # Órgãos: OSs usam NomeUsuario como unidade solicitante (OrgInteressado costuma vazio ou ser outro nível).
    if tipo == TIPO_CONTA_ORGAO:
        return "TRIM(p.NomeUsuario) = %s"
    return "TRIM(p.GabSalaUsuario) = %s"


def _fetch_primary_solicitante(vinculo: str, tipo_conta: str) -> str:
    """Nome do solicitante mais frequente nas OSs do vínculo (destaque no portal)."""
    filtro = _os_vinculo_filter_sql(tipo_conta)
    rows = db.execute_query(
        f"""
        SELECT TRIM(p.NomeUsuario) AS nome, COUNT(*) AS cnt
        FROM tabProtocolos p
        WHERE {filtro}
          AND TRIM(COALESCE(p.NomeUsuario, '')) <> ''
        GROUP BY TRIM(p.NomeUsuario)
        ORDER BY cnt DESC
        LIMIT 1
        """,
        (vinculo,),
    )
    if rows and rows[0].get("nome"):
        return str(rows[0]["nome"]).strip()
    return vinculo


def _fetch_deputado_ou_orgao(vinculo: str, tipo_conta: str) -> str:
    if tipo_conta == TIPO_CONTA_ORGAO:
        return vinculo
    filtro = _os_vinculo_filter_sql(tipo_conta)
    rows = db.execute_query(
        f"""
        SELECT TRIM(p.GabSalaUsuario) AS nome
        FROM tabProtocolos p
        WHERE {filtro}
          AND TRIM(COALESCE(p.GabSalaUsuario, '')) <> ''
        LIMIT 1
        """,
        (vinculo,),
    )
    if rows and rows[0].get("nome"):
        return str(rows[0]["nome"]).strip()
    return vinculo


def _cliente_context_from_row(row: dict) -> tuple[str, str]:
    tipo = _normalize_tipo_conta(row.get("TipoConta"))
    vinculo = _normalize_vinculo(str(row.get("Gabinete") or ""))
    return tipo, vinculo


def _cliente_context_from_session(session: SessionData) -> tuple[str, str]:
    if session.cliente_id:
        row = _fetch_cliente_by_id(session.cliente_id)
        if row:
            return _cliente_context_from_row(row)
    tipo = _normalize_tipo_conta(session.cliente_tipo)
    vinculo = _normalize_vinculo(session.gabinete or "")
    return tipo, vinculo


def _dedupe_andamentos(rows: list) -> list:
    seen: set[str] = set()
    unique: list = []
    for row in rows or []:
        cod = str(row.get("CodStatus") or "").strip()
        if not cod or cod in seen:
            continue
        seen.add(cod)
        unique.append(row)
    return unique


def _assert_os_belongs_to_cliente(
    nr_os: int,
    ano: int,
    vinculo: str,
    tipo_conta: str,
) -> None:
    filtro = _os_vinculo_filter_sql(tipo_conta)
    rows = db.execute_query(
        f"""
        SELECT 1 FROM tabProtocolos p
        WHERE p.NroProtocolo = %s AND p.AnoProtocolo = %s AND {filtro}
        LIMIT 1
        """,
        (nr_os, ano, vinculo),
    )
    if not rows:
        label = _vinculo_tipo_label(tipo_conta)
        raise HTTPException(status_code=404, detail=f"OS não encontrada para este {label}.")


def _fetch_cliente_by_id(cliente_id: int) -> Optional[dict]:
    rows = db.execute_query(
        """
        SELECT ID, Gabinete, TipoConta, Email, Nome, ParentID, AuthAtivo, EmailVerified,
               COALESCE(NavCredencialDepol, 0) AS NavCredencialDepol
        FROM tabClienteGabinete WHERE ID = %s
        """,
        (cliente_id,),
    )
    return rows[0] if rows else None


def _nav_credencial_depol_from_row(row: dict) -> bool:
    return bool(int(row.get("NavCredencialDepol") or 0))


def _cliente_to_response(row: dict) -> ClienteUserResponse:
    tipo, vinculo = _cliente_context_from_row(row)
    return ClienteUserResponse(
        id=int(row["ID"]),
        nome=str(row.get("Nome") or ""),
        email=str(row.get("Email") or ""),
        gabinete=vinculo,
        tipo_conta=tipo,
        is_principal=row.get("ParentID") is None,
        nav_credencial_depol=_nav_credencial_depol_from_row(row),
    )


def _build_pt_portal_url(os_id: int, ano: int, token: str) -> str:
    from services.activation_email_service import resolve_link_web_base

    base = resolve_link_web_base()
    return f"{base.rstrip('/')}/portal/pt/{token}?os={os_id}&ano={ano}"


def _obs_lower(observacao: str) -> str:
    return str(observacao or "").strip().lower()


def _classify_pendencia(situacao: str, observacao: str) -> Optional[str]:
    """
    Classificação de pendências no portal do cliente:
      - Problemas Técnicos / Pendência Usuário + PTV → problema técnico
      - Aguard. Aprovação → aprovação de prova
      - Pendência Usuário + envio de arquivo → envio de arquivos pelo cliente
    """
    sit = str(situacao or "").strip()
    obs = _obs_lower(observacao)

    if sit == "Aguard. Aprovação" or sit == "Aguardando Aprovação":
        return "aprovacao_prova"
    if (
        sit == "Pendência Usuário"
        and "prova" in obs
        and "ptv" not in obs
        and "enviada por e-mail" in obs
    ):
        return "aprovacao_prova"
    if sit == "Problemas Técnicos" or (sit == "Pendência Usuário" and "ptv" in obs):
        return "problema_tecnico"
    if sit == "Pendência Usuário" and "pendente o envio de arquivo" in obs:
        return "envio_arquivo"
    return None


OsKey = tuple[int, int]


def _os_in_clause(os_keys: list[OsKey]) -> tuple[str, tuple]:
    """Monta `(Nro, Ano) IN ((..),(..))` com parâmetros seguros."""
    if not os_keys:
        return "", ()
    placeholders = ", ".join(["(%s, %s)"] * len(os_keys))
    params: list[int] = []
    for nr_os, ano in os_keys:
        params.extend([nr_os, ano])
    return f"(NroProtocolo, AnoProtocolo) IN ({placeholders})", tuple(params)


def _batch_fetch_pt_tokens(os_keys: list[OsKey]) -> dict[OsKey, str]:
    if not os_keys:
        return {}
    in_sql, params = _os_in_clause(os_keys)
    rows = db.execute_query(
        f"""
        SELECT NroProtocolo, AnoProtocolo, Token
        FROM tabClientTokens
        WHERE {in_sql}
          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
        ORDER BY ID DESC
        """,
        params,
    )
    result: dict[OsKey, str] = {}
    for row in rows or []:
        key = (int(row["NroProtocolo"]), int(row["AnoProtocolo"]))
        if key not in result:
            result[key] = str(row["Token"])
    return result


def _batch_fetch_proof_tokens(os_keys: list[OsKey]) -> dict[OsKey, tuple[str, str]]:
    if not os_keys:
        return {}
    in_sql, params = _os_in_clause(os_keys)
    rows = db.execute_query(
        f"""
        SELECT NroProtocolo, AnoProtocolo, Token, Versao
        FROM tabProofTokens
        WHERE {in_sql}
          AND Aprovado IS NULL
          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
        ORDER BY ID DESC
        """,
        params,
    )
    result: dict[OsKey, tuple[str, str]] = {}
    for row in rows or []:
        key = (int(row["NroProtocolo"]), int(row["AnoProtocolo"]))
        if key not in result:
            result[key] = (
                str(row["Token"]),
                str(row.get("Versao") or "1"),
            )
    return result


def _batch_fetch_os_arquivos_tokens(os_keys: list[OsKey]) -> dict[OsKey, str]:
    if not os_keys:
        return {}
    try:
        from services.os_arquivos_service import ensure_tokens_table

        ensure_tokens_table()
    except Exception as exc:
        logger.warning("Batch tokens envio arquivos indisponível: %s", exc)
        return {}
    in_sql, params = _os_in_clause(os_keys)
    rows = db.execute_query(
        f"""
        SELECT NroProtocolo, AnoProtocolo, Token
        FROM tabOsArquivosTokens
        WHERE {in_sql}
          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
        ORDER BY ID DESC
        """,
        params,
    )
    result: dict[OsKey, str] = {}
    for row in rows or []:
        key = (int(row["NroProtocolo"]), int(row["AnoProtocolo"]))
        if key not in result:
            result[key] = str(row["Token"])
    return result


def _fetch_pt_token(nr_os: int, ano: int) -> Optional[str]:
    return _batch_fetch_pt_tokens([(nr_os, ano)]).get((nr_os, ano))


def _fetch_proof_token(nr_os: int, ano: int) -> tuple[Optional[str], str]:
    entry = _batch_fetch_proof_tokens([(nr_os, ano)]).get((nr_os, ano))
    if not entry:
        return None, "1"
    return entry[0], entry[1]


def _fetch_os_arquivos_token(nr_os: int, ano: int) -> Optional[str]:
    return _batch_fetch_os_arquivos_tokens([(nr_os, ano)]).get((nr_os, ano))


@router.post("/api/auth/cliente/login")
async def cliente_login(
    request: Request,
    response: Response,
    body: ClienteLoginRequest,
):
    email = body.email.strip().lower()
    rows = db.execute_query(
        """
        SELECT ID, Gabinete, TipoConta, Email, Nome, PasswordHash, EmailVerified, AuthAtivo,
               COALESCE(NavCredencialDepol, 0) AS NavCredencialDepol
        FROM tabClienteGabinete
        WHERE Email = %s
        """,
        (email,),
    )
    if not rows:
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos.")
    row = rows[0]
    if not row.get("AuthAtivo"):
        raise HTTPException(status_code=403, detail="Conta desativada.")
    if not row.get("EmailVerified") or not row.get("PasswordHash"):
        raise HTTPException(
            status_code=403,
            detail="Conta pendente de ativação. Verifique seu e-mail.",
        )
    if not verify_password(body.password, row["PasswordHash"]):
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos.")

    tipo, vinculo = _cliente_context_from_row(row)
    client_ip = resolve_client_ip(request)
    session = SessionData(
        ponto=0,
        nome=str(row.get("Nome") or ""),
        ip=client_ip,
        iat=int(time.time()),
        auth_mode=AUTH_MODE_CLIENTE,
        cliente_id=int(row["ID"]),
        gabinete=vinculo,
        cliente_tipo=tipo,
    )
    set_cliente_session_cookie(response, session)
    return {"status": "ok", "user": _cliente_to_response(row)}


@router.get("/api/auth/cliente/activate/check")
async def cliente_activate_check(token: str):
    rows = db.execute_query(
        """
        SELECT Nome, Email, Gabinete, TipoConta, ActivationExpires
        FROM tabClienteGabinete
        WHERE ActivationToken = %s
        """,
        (token.strip(),),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Link inválido ou já utilizado.")
    row = rows[0]
    expires = row.get("ActivationExpires")
    if expires and expires < datetime.now():
        raise HTTPException(status_code=410, detail="Link expirado. Solicite novo envio.")
    tipo, vinculo = _cliente_context_from_row(row)
    return {
        "nome": row.get("Nome"),
        "email": row.get("Email"),
        "gabinete": vinculo,
        "tipo_conta": tipo,
        "vinculo_label": _vinculo_tipo_label(tipo),
    }


@router.post("/api/auth/cliente/activate")
async def cliente_activate(body: ClienteActivateRequest):
    token = body.token.strip()
    rows = db.execute_query(
        """
        SELECT ID, ActivationExpires
        FROM tabClienteGabinete
        WHERE ActivationToken = %s
        """,
        (token,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Link inválido ou já utilizado.")
    expires = rows[0].get("ActivationExpires")
    if expires and expires < datetime.now():
        raise HTTPException(status_code=410, detail="Link expirado.")
    pwd_hash = hash_password(body.password)
    db.execute_query(
        """
        UPDATE tabClienteGabinete
        SET PasswordHash = %s, EmailVerified = 1,
            ActivationToken = NULL, ActivationExpires = NULL
        WHERE ActivationToken = %s
        """,
        (pwd_hash, token),
    )
    return {"status": "ok", "message": "Senha definida. Faça login no portal do cliente."}


@router.post("/api/auth/cliente/logout")
async def cliente_logout(response: Response):
    clear_cliente_session_cookie(response)
    return {"status": "ok"}


_CLIENTE_DYNAMIC_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
}


@router.get("/api/cliente/me")
async def cliente_me(
    response: Response,
    session: SessionData = Depends(require_cliente_session),
):
    row = _fetch_cliente_by_id(session.cliente_id or 0)
    if not row:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    for key, value in _CLIENTE_DYNAMIC_CACHE_HEADERS.items():
        response.headers[key] = value
    return _cliente_to_response(row)


@router.get("/api/cliente/dashboard")
async def cliente_dashboard(
    response: Response,
    session: SessionData = Depends(require_cliente_session),
):
    tipo_conta, vinculo = _cliente_context_from_session(session)
    if not vinculo:
        raise HTTPException(status_code=400, detail="Vínculo não configurado na conta.")

    filtro = _os_vinculo_filter_sql(tipo_conta)
    rows = db.execute_query(
        f"""
        SELECT p.NroProtocolo AS nr_os, p.AnoProtocolo AS ano,
               d.Titulo AS titulo, d.TipoPublicacaoLink AS produto,
               a.SituacaoLink AS situacao, a.`Observaçao` AS observacao,
               a.SetorLink AS setor, a.`Data` AS data_andamento
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        LEFT JOIN tabAndamento a
          ON p.NroProtocolo = a.NroProtocoloLink
         AND p.AnoProtocolo = a.AnoProtocoloLink
         AND a.UltimoStatus = 1
        WHERE {filtro}
          AND (a.SituacaoLink IS NULL OR a.SituacaoLink NOT IN ('Entregue', 'Cancelada', 'Cancelado'))
        ORDER BY p.AnoProtocolo DESC, p.NroProtocolo DESC
        """,
        (vinculo,),
    )

    em_andamento: list[dict] = []
    pendencias_pt: list[dict] = []
    pendencias_aprovacao: list[dict] = []
    pendencias_envio_arquivo: list[dict] = []
    pendencias_usuario: list[dict] = []

    classified: list[tuple[dict, Optional[str]]] = []
    keys_pt: list[OsKey] = []
    keys_proof: list[OsKey] = []
    keys_arquivos: list[OsKey] = []

    for row in rows:
        nr_os = int(row["nr_os"])
        ano = int(row["ano"])
        situacao = str(row.get("situacao") or "")
        observacao = str(row.get("observacao") or "")
        base = {
            "nr_os": nr_os,
            "ano": ano,
            "titulo": row.get("titulo") or "",
            "produto": row.get("produto") or "",
            "situacao": situacao,
            "setor": row.get("setor") or "",
            "data_andamento": row.get("data_andamento"),
            "observacao": observacao,
        }
        pendencia_tipo = _classify_pendencia(situacao, observacao)
        classified.append((base, pendencia_tipo))
        os_key = (nr_os, ano)
        if pendencia_tipo == "problema_tecnico":
            keys_pt.append(os_key)
        elif pendencia_tipo == "aprovacao_prova":
            keys_proof.append(os_key)
        elif pendencia_tipo == "envio_arquivo":
            keys_arquivos.append(os_key)

    pt_tokens = _batch_fetch_pt_tokens(keys_pt)
    proof_tokens = _batch_fetch_proof_tokens(keys_proof)
    arquivos_tokens = _batch_fetch_os_arquivos_tokens(keys_arquivos)

    from services.os_arquivos_service import build_portal_url as build_os_arquivos_url

    for base, pendencia_tipo in classified:
        nr_os = int(base["nr_os"])
        ano = int(base["ano"])
        os_key = (nr_os, ano)
        pendencia_url = None
        pendencia_label = None
        pendencia_item = {**base}

        if pendencia_tipo == "problema_tecnico":
            token = pt_tokens.get(os_key)
            pendencia_label = "Ver pendência — Problemas Técnicos"
            if token:
                pendencia_url = _build_pt_portal_url(nr_os, ano, token)
            pendencia_item["pendencia_tipo"] = pendencia_tipo
            pendencia_item["pendencia_url"] = pendencia_url
            pendencia_item["pendencia_label"] = pendencia_label
            pendencias_pt.append(pendencia_item)

        elif pendencia_tipo == "aprovacao_prova":
            proof_entry = proof_tokens.get(os_key)
            token = proof_entry[0] if proof_entry else None
            versao = proof_entry[1] if proof_entry else "1"
            pendencia_label = "Visualizar prova"
            if token:
                pendencia_url = build_proof_portal_url(nr_os, ano, token)
            pendencia_item["pendencia_tipo"] = pendencia_tipo
            pendencia_item["pendencia_url"] = pendencia_url
            pendencia_item["pendencia_label"] = pendencia_label
            pendencia_item["versao"] = versao
            pendencias_aprovacao.append(pendencia_item)

        elif pendencia_tipo == "envio_arquivo":
            token = arquivos_tokens.get(os_key)
            pendencia_label = "Enviar arquivos"
            if token:
                pendencia_url = build_os_arquivos_url(nr_os, ano, token)
            pendencia_item["pendencia_tipo"] = pendencia_tipo
            pendencia_item["pendencia_url"] = pendencia_url
            pendencia_item["pendencia_label"] = pendencia_label
            pendencias_envio_arquivo.append(pendencia_item)

        if not pendencia_tipo:
            em_andamento.append({**base, "pendencia_tipo": None, "pendencia_url": None})

        # Bucket do sidebar "Pendência usuário" (independente das buckets acima).
        if str(base.get("situacao") or "").strip() == "Pendência Usuário":
            user_item = {**base}
            if pendencia_tipo == "problema_tecnico":
                token = pt_tokens.get(os_key)
                user_item["pendencia_tipo"] = pendencia_tipo
                user_item["pendencia_label"] = "Ver pendência — Problemas Técnicos"
                user_item["pendencia_url"] = (
                    _build_pt_portal_url(nr_os, ano, token) if token else None
                )
            elif pendencia_tipo == "aprovacao_prova":
                proof_entry = proof_tokens.get(os_key)
                token = proof_entry[0] if proof_entry else None
                versao = proof_entry[1] if proof_entry else "1"
                user_item["pendencia_tipo"] = pendencia_tipo
                user_item["pendencia_label"] = "Visualizar prova"
                user_item["pendencia_url"] = (
                    build_proof_portal_url(nr_os, ano, token) if token else None
                )
                user_item["versao"] = versao
            elif pendencia_tipo == "envio_arquivo":
                token = arquivos_tokens.get(os_key)
                user_item["pendencia_tipo"] = pendencia_tipo
                user_item["pendencia_label"] = "Enviar arquivos"
                user_item["pendencia_url"] = (
                    build_os_arquivos_url(nr_os, ano, token) if token else None
                )
            else:
                user_item["pendencia_tipo"] = None
                user_item["pendencia_url"] = None
                user_item["pendencia_label"] = None
            pendencias_usuario.append(user_item)

    for key, value in _CLIENTE_DYNAMIC_CACHE_HEADERS.items():
        response.headers[key] = value

    return {
        "gabinete": vinculo,
        "tipo_conta": tipo_conta,
        "vinculo_label": _vinculo_tipo_label(tipo_conta),
        "solicitante": _fetch_primary_solicitante(vinculo, tipo_conta),
        "deputado_ou_orgao": _fetch_deputado_ou_orgao(vinculo, tipo_conta),
        "em_andamento": em_andamento,
        "pendencias_pt": pendencias_pt,
        "pendencias_aprovacao": pendencias_aprovacao,
        "pendencias_envio_arquivo": pendencias_envio_arquivo,
        "pendencias_usuario": pendencias_usuario,
    }


@router.get("/api/cliente/os/{ano}/{nr_os}/andamentos", response_model=ClienteOsTimelineResponse)
async def cliente_os_andamentos(
    ano: int,
    nr_os: int,
    session: SessionData = Depends(require_cliente_session),
):
    from services.cliente_os_timeline_service import build_cliente_os_timeline

    tipo_conta, vinculo = _cliente_context_from_session(session)
    if not vinculo:
        raise HTTPException(status_code=400, detail="Vínculo não configurado na conta.")
    _assert_os_belongs_to_cliente(nr_os, ano, vinculo, tipo_conta)

    payload = build_cliente_os_timeline(nr_os, ano)
    return ClienteOsTimelineResponse(
        steps=[ClienteTimelineStep.model_validate(s) for s in payload["steps"]],
        maquina=payload.get("maquina"),
        produto=payload.get("produto"),
        referencia_os_count=int(payload.get("referencia_os_count") or 0),
    )


@router.get("/api/cliente/contas")
async def listar_subcontas(session: SessionData = Depends(require_cliente_session)):
    row = _fetch_cliente_by_id(session.cliente_id or 0)
    if not row:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    root_id = int(row["ID"]) if row.get("ParentID") is None else int(row["ParentID"])
    contas = db.execute_query(
        """
        SELECT ID, Nome, Email, Gabinete, TipoConta, ParentID,
               COALESCE(NavCredencialDepol, 0) AS NavCredencialDepol
        FROM tabClienteGabinete
        WHERE (ID = %s OR ParentID = %s) AND AuthAtivo = 1
        ORDER BY ParentID IS NOT NULL, Nome
        """,
        (root_id, root_id),
    )
    return [_cliente_to_response(c) for c in contas]


@router.post("/api/cliente/contas")
async def criar_subconta(
    body: ClienteSubContaRequest,
    session: SessionData = Depends(require_cliente_session),
):
    principal = _fetch_cliente_by_id(session.cliente_id or 0)
    if not principal:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    root_id = int(principal["ID"]) if principal.get("ParentID") is None else int(principal["ParentID"])
    root = _fetch_cliente_by_id(root_id) or principal
    tipo_conta, vinculo = _cliente_context_from_row(principal)
    nav_depol = 1 if _nav_credencial_depol_from_row(root) else 0
    email = str(body.email).strip().lower()
    nome = body.nome.strip()

    existing = db.execute_query(
        "SELECT ID FROM tabClienteGabinete WHERE Email = %s",
        (email,),
    )
    if existing:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado.")

    token = generate_activation_token()
    expires = datetime.now() + timedelta(hours=48)
    db.execute_query(
        """
        INSERT INTO tabClienteGabinete
            (Gabinete, TipoConta, Email, Nome, ParentID, EmailVerified,
             ActivationToken, ActivationExpires, NavCredencialDepol)
        VALUES (%s, %s, %s, %s, %s, 0, %s, %s, %s)
        """,
        (vinculo, tipo_conta, email, nome, root_id, token, expires, nav_depol),
    )

    try:
        send_cliente_activation_email(
            to_email=email,
            nome=nome,
            gabinete=vinculo,
            tipo_conta=tipo_conta,
            token=token,
        )
    except Exception as exc:
        logger.error("criar_subconta: falha no e-mail: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Conta criada, mas falha ao enviar e-mail de ativação.",
        )

    return {"status": "ok", "email": email}


# --- Admin (MASTER) ---

@router.get("/api/admin/clientes/vinculo-opcoes", dependencies=[Depends(require_master_ip)])
async def admin_cliente_vinculo_opcoes(tipo: str = TIPO_CONTA_GABINETE):
    tipo_norm = _normalize_tipo_conta(tipo)
    if tipo_norm == TIPO_CONTA_ORGAO:
        rows = db.execute_query(
            """
            SELECT DISTINCT TRIM(p.NomeUsuario) AS nome
            FROM tabProtocolos p
            WHERE TRIM(COALESCE(p.NomeUsuario, '')) <> ''
              AND TRIM(COALESCE(p.CategoriaLink, '')) IN ('Orgao', 'Mesa')
            ORDER BY nome
            """
        )
    else:
        rows = db.execute_query(
            """
            SELECT DISTINCT TRIM(p.GabSalaUsuario) AS nome
            FROM tabProtocolos p
            WHERE TRIM(COALESCE(p.GabSalaUsuario, '')) <> ''
              AND TRIM(COALESCE(p.CategoriaLink, '')) = 'Deputado'
            ORDER BY nome
            """
        )
    return [str(r.get("nome") or "").strip() for r in rows if str(r.get("nome") or "").strip()]


@router.post("/api/admin/clientes", dependencies=[Depends(require_master_ip)])
async def admin_create_cliente(body: ClienteCreateRequest):
    vinculo = body.vinculo or ""
    tipo_conta = body.tipo_conta
    email = str(body.email).strip().lower()
    nome = body.nome.strip()

    existing = db.execute_query(
        "SELECT ID FROM tabClienteGabinete WHERE Email = %s",
        (email,),
    )
    if existing:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado.")

    token = generate_activation_token()
    expires = datetime.now() + timedelta(hours=48)
    db.execute_query(
        """
        INSERT INTO tabClienteGabinete
            (Gabinete, TipoConta, Email, Nome, ParentID, EmailVerified, ActivationToken, ActivationExpires)
        VALUES (%s, %s, %s, %s, NULL, 0, %s, %s)
        """,
        (vinculo, tipo_conta, email, nome, token, expires),
    )

    activation_link = None
    try:
        from services.cliente_activation_email_service import build_cliente_activation_link

        activation_link = build_cliente_activation_link(token)
        send_cliente_activation_email(
            to_email=email,
            nome=nome,
            gabinete=vinculo,
            tipo_conta=tipo_conta,
            token=token,
        )
    except Exception as exc:
        logger.error("admin_create_cliente: falha no e-mail: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Cliente cadastrado, mas falha ao enviar e-mail de ativação.",
        )

    return {
        "status": "ok",
        "email": email,
        "gabinete": vinculo,
        "tipo_conta": tipo_conta,
        "activation_link": activation_link,
    }


@router.get("/api/admin/clientes", dependencies=[Depends(require_master_ip)])
async def admin_list_clientes():
    rows = db.execute_query(
        """
        SELECT ID, Nome, Email, Gabinete, TipoConta, ParentID, EmailVerified, AuthAtivo,
               COALESCE(NavCredencialDepol, 0) AS NavCredencialDepol, CreatedAt
        FROM tabClienteGabinete
        ORDER BY TipoConta, Gabinete, ParentID IS NOT NULL, Nome
        """
    )
    return rows


@router.put(
    "/api/admin/clientes/{cliente_id}/nav",
    dependencies=[Depends(require_master_ip)],
)
async def admin_update_cliente_nav(cliente_id: int, body: ClienteNavUpdateRequest):
    rows = db.execute_query(
        "SELECT ID FROM tabClienteGabinete WHERE ID = %s",
        (cliente_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    flag = 1 if body.nav_credencial_depol else 0
    db.execute_query(
        """
        UPDATE tabClienteGabinete
        SET NavCredencialDepol = %s
        WHERE ID = %s
        """,
        (flag, cliente_id),
    )
    return {"status": "ok", "id": cliente_id, "nav_credencial_depol": bool(flag)}


@router.delete(
    "/api/admin/clientes/{cliente_id}",
    dependencies=[Depends(require_master_ip)],
)
@router.post(
    "/api/admin/clientes/{cliente_id}/delete",
    dependencies=[Depends(require_master_ip)],
)
async def admin_delete_cliente(cliente_id: int):
    rows = db.execute_query(
        "SELECT ID, Nome, Email, ParentID FROM tabClienteGabinete WHERE ID = %s",
        (cliente_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    row = rows[0]
    is_principal = row.get("ParentID") is None
    if is_principal:
        db.execute_query(
            "DELETE FROM tabClienteGabinete WHERE ParentID = %s",
            (cliente_id,),
        )
    db.execute_query(
        "DELETE FROM tabClienteGabinete WHERE ID = %s",
        (cliente_id,),
    )
    return {"status": "ok", "id": cliente_id}


@router.post(
    "/api/admin/clientes/{cliente_id}/resend-activation",
    dependencies=[Depends(require_master_ip)],
)
async def admin_resend_cliente_activation(cliente_id: int):
    rows = db.execute_query(
        "SELECT Nome, Email, Gabinete, TipoConta, EmailVerified FROM tabClienteGabinete WHERE ID = %s",
        (cliente_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    if rows[0].get("EmailVerified"):
        raise HTTPException(status_code=400, detail="Conta já ativada.")
    token = generate_activation_token()
    expires = datetime.now() + timedelta(hours=48)
    db.execute_query(
        """
        UPDATE tabClienteGabinete
        SET ActivationToken = %s, ActivationExpires = %s
        WHERE ID = %s
        """,
        (token, expires, cliente_id),
    )
    tipo, vinculo = _cliente_context_from_row(rows[0])
    send_cliente_activation_email(
        to_email=str(rows[0]["Email"]),
        nome=str(rows[0]["Nome"]),
        gabinete=vinculo,
        tipo_conta=tipo,
        token=token,
    )
    return {"status": "ok"}


# --- Credenciais DEPOL (portal cliente) ---


class ClienteDepolItemPayload(BaseModel):
    modelo_arquivo: str
    linha1: str
    linha2: Optional[str] = None
    linha3: Optional[str] = None
    ordem: Optional[int] = None


class ClienteDepolCreatePedidoPayload(BaseModel):
    titulo: Optional[str] = None
    observacao: Optional[str] = None
    itens: List[ClienteDepolItemPayload] = Field(min_length=1)


def _require_cliente_depol_nav(session: SessionData) -> dict:
    row = _fetch_cliente_by_id(session.cliente_id or 0)
    if not row:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    if not _nav_credencial_depol_from_row(row):
        raise HTTPException(
            status_code=403,
            detail="Credencial DEPOL não habilitada para esta conta.",
        )
    return row


def _cliente_depol_http_err(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    logger.exception("Erro Credenciais DEPOL (cliente)")
    return HTTPException(status_code=500, detail="Erro interno")


@router.get("/api/cliente/credenciais-depol/modelos")
async def cliente_list_depol_modelos(
    session: SessionData = Depends(require_cliente_session),
):
    _require_cliente_depol_nav(session)
    from services import credenciais_depol_service as svc

    modelos = []
    for m in svc.list_modelos():
        arquivo = str(m.get("arquivo_jpg") or m.get("nome") or "")
        modelos.append(
            {
                **m,
                "thumb_url": (
                    f"/api/cliente/credenciais-depol/modelos/"
                    f"{arquivo}/thumb"
                ),
            }
        )
    return {"modelos": modelos}


@router.get("/api/cliente/credenciais-depol/modelos/{nome}/thumb")
async def cliente_depol_modelo_thumb(
    nome: str,
    session: SessionData = Depends(require_cliente_session),
):
    from fastapi.responses import FileResponse

    from services import credenciais_depol_service as svc

    _require_cliente_depol_nav(session)
    try:
        path = svc.resolve_thumb_path(nome)
    except (ValueError, FileNotFoundError) as exc:
        raise _cliente_depol_http_err(exc) from exc
    return FileResponse(path, media_type="image/jpeg")


@router.get("/api/cliente/credenciais-depol/svgs/{nome}")
async def cliente_depol_svg(
    nome: str,
    session: SessionData = Depends(require_cliente_session),
):
    from fastapi.responses import FileResponse

    from services import credenciais_depol_service as svc

    _require_cliente_depol_nav(session)
    try:
        path = svc.resolve_svg_path(nome)
    except (ValueError, FileNotFoundError) as exc:
        raise _cliente_depol_http_err(exc) from exc
    return FileResponse(path, media_type="image/svg+xml")


@router.post("/api/cliente/credenciais-depol/pedidos")
async def cliente_create_depol_pedido(
    body: ClienteDepolCreatePedidoPayload,
    session: SessionData = Depends(require_cliente_session),
):
    from services import credenciais_depol_service as svc

    row = _require_cliente_depol_nav(session)
    criado_por = f"C{int(row['ID'])}"
    try:
        return svc.create_pedido(
            criado_por=criado_por,
            titulo=body.titulo,
            observacao=body.observacao,
            itens=[i.model_dump() for i in body.itens],
        )
    except (ValueError, FileNotFoundError, LookupError) as exc:
        raise _cliente_depol_http_err(exc) from exc

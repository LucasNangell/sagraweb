"""
Controle de Acesso (admin): simulador de acesso efetivo e resumo da Visão geral.

- GET /api/admin/access/preview  — permissões efetivas de usuário × terminal × origem,
  calculadas pelo MESMO núcleo do middleware (`resolve_effective_permissions_core`).
- GET /api/admin/access/overview — contadores da Visão geral numa só chamada.

Somente leitura; ambos exigem MASTER (como todo /api/admin/*).
"""
from __future__ import annotations

import logging
import re
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from database import db
from security.api_auth import is_privileged_ip, require_master_ip
from security.user_permissions import (
    _PERMISSION_BOOL_KEYS,
    get_user_permissions_raw,
    get_user_permissions_row,
    is_user_permissions_customized,
    resolve_effective_permissions_core,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["acesso-admin"])

_IP_PATTERN_RE = re.compile(r"^[0-9a-fA-F:.%]+$")

PreviewOrigem = Literal["local", "internet"]

_MODE_DESCRIPTIONS: dict[str, str] = {
    "master_remoto": "Ponto MASTER remoto via internet: acesso total.",
    "conta_inativa": "Conta inativa ou e-mail não verificado: login via internet bloqueado.",
    "internet_usuario": "Via internet valem só as permissões próprias do usuário.",
    "internet_sem_permissoes": "Via internet sem permissões próprias: nada é liberado.",
    "local_usuario": "Rede local: as permissões próprias do usuário substituem as do terminal.",
    "local_terminal": "Rede local: valem as permissões do terminal.",
    "terminal_nao_autorizado": "Rede local: IP não cadastrado (ou inativo) — acesso negado.",
}


def _clear_ip_cache(ip: str) -> None:
    """Descarta o cache de 30s de `get_client_permissions` para este IP (prévia fresca)."""
    from routers.ip_admin_routes import get_client_permissions

    cache = getattr(get_client_permissions, "_cache", None)
    if isinstance(cache, dict):
        cache.pop(ip, None)


def _match_terminal_record(ip: str) -> Optional[dict[str, Any]]:
    """
    Registro de ip_permissions que casa com o IP (somente para exibição; a decisão
    de acesso continua em `get_client_permissions`). Exato > curinga mais específico.
    """
    from routers.ip_admin_routes import check_ip_permission

    rows = db.execute_query(
        "SELECT id, ip, descricao, grupo FROM ip_permissions WHERE ativo = TRUE"
    ) or []
    exact = [r for r in rows if str(r.get("ip") or "") == ip]
    wildcards = sorted(
        (r for r in rows if "%" in str(r.get("ip") or "")),
        key=lambda r: (len(str(r.get("ip") or "")), str(r.get("ip") or "")),
        reverse=True,
    )
    for row in exact + wildcards:
        pattern = str(row.get("ip") or "")
        if pattern == ip or check_ip_permission(ip, pattern):
            return {
                "id": row.get("id"),
                "ip": pattern,
                "descricao": row.get("descricao"),
                "grupo": row.get("grupo"),
                "curinga": "%" in pattern,
            }
    return None


def _bool_map(perms: Optional[dict[str, Any]]) -> Optional[dict[str, bool]]:
    if perms is None:
        return None
    return {key: bool(perms.get(key, False)) for key in _PERMISSION_BOOL_KEYS}


@router.get(
    "/api/admin/access/preview",
    dependencies=[Depends(require_master_ip)],
    summary="Simula as permissões efetivas de um usuário em um terminal",
)
async def preview_access(
    ponto: int = Query(..., gt=0),
    ip: str = Query("", max_length=64),
    origem: PreviewOrigem = Query("local"),
):
    from routers.ip_admin_routes import get_client_permissions

    ip = ip.strip()
    via_internet = origem == "internet"
    if not via_internet:
        if not ip:
            raise HTTPException(status_code=422, detail="Informe o IP do terminal.")
        if "%" in ip or not _IP_PATTERN_RE.match(ip):
            raise HTTPException(
                status_code=422,
                detail="Informe um IP concreto (sem %), como o do computador do usuário.",
            )
    session_ip = ip or "internet"

    user_rows = db.execute_query(
        """
        SELECT Ponto, Nome, AuthAtivo, EmailVerified FROM tabUsuarios WHERE Ponto = %s
        """,
        (ponto,),
    )
    user_row = user_rows[0] if user_rows else None

    ip_perms_snapshot: dict[str, Any] = {}

    def _load_ip_permissions() -> Optional[dict]:
        _clear_ip_cache(ip)
        perms = get_client_permissions(ip)
        ip_perms_snapshot["value"] = perms
        return perms

    trace: dict[str, Any] = {}
    effective = resolve_effective_permissions_core(
        ponto,
        session_ip,
        via_internet=via_internet,
        load_ip_permissions=_load_ip_permissions,
        trace=trace,
    )
    mode = str(trace.get("mode") or "")

    up_row = get_user_permissions_row(ponto)
    user_customized = bool(up_row and is_user_permissions_customized(up_row))
    user_perms = get_user_permissions_raw(ponto) if up_row else None

    terminal_privileged = bool(ip) and not via_internet and is_privileged_ip(ip)
    terminal_record = (
        _match_terminal_record(ip) if ip and not via_internet and not terminal_privileged else None
    )
    terminal_perms = ip_perms_snapshot.get("value")

    sources: dict[str, str] = {}
    if effective is not None:
        for key in _PERMISSION_BOOL_KEYS:
            if mode == "master_remoto" or (mode == "local_terminal" and terminal_privileged):
                sources[key] = "master"
            elif mode in ("internet_usuario", "local_usuario", "internet_sem_permissoes"):
                sources[key] = "user"
            else:
                sources[key] = "ip"

    return {
        "ponto": ponto,
        "ip": ip or None,
        "origem": origem,
        "modo": mode,
        "descricao": _MODE_DESCRIPTIONS.get(mode, ""),
        "acesso": effective is not None,
        "usuario": (
            {
                "ponto": int(user_row.get("Ponto")),
                "nome": user_row.get("Nome"),
                "conta_ativa": bool(user_row.get("AuthAtivo", 1)),
                "email_verificado": bool(user_row.get("EmailVerified")),
                "permissoes_proprias": user_customized,
            }
            if user_row
            else None
        ),
        "terminal": (
            {
                "privilegiado": terminal_privileged,
                "cadastro": terminal_record,
            }
            if ip and not via_internet
            else None
        ),
        "permissoes": _bool_map(effective),
        "painel_setores": list((effective or {}).get("painel_setores") or []),
        "painel_setores_legacy_all": bool((effective or {}).get("painel_setores_legacy_all")),
        "origem_por_chave": sources,
        "permissoes_terminal": _bool_map(terminal_perms) if not via_internet else None,
        "permissoes_usuario": _bool_map(user_perms) if user_customized else None,
    }


def _count(sql: str, params: tuple = ()) -> int:
    rows = db.execute_query(sql, params)
    if not rows:
        return 0
    value = next(iter(rows[0].values()), 0)
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


@router.get(
    "/api/admin/access/overview",
    dependencies=[Depends(require_master_ip)],
    summary="Contadores da Visão geral do Controle de Acesso",
)
async def access_overview():
    from routers.realtime import manager

    try:
        online = len({int(p) for p in manager.get_online_users() if str(p).strip().isdigit()})
    except Exception as exc:  # presença é melhor esforço
        logger.debug("overview: falha ao contar online: %s", exc)
        online = 0

    usuarios_total = _count("SELECT COUNT(*) AS n FROM tabUsuarios")
    usuarios_internet = _count(
        """
        SELECT COUNT(*) AS n FROM tabUsuarios
        WHERE Email IS NOT NULL OR PasswordHash IS NOT NULL
           OR ActivationToken IS NOT NULL OR EmailVerified = 1
        """
    )
    usuarios_ativacao_pendente = _count(
        """
        SELECT COUNT(*) AS n FROM tabUsuarios
        WHERE (Email IS NOT NULL OR ActivationToken IS NOT NULL)
          AND (EmailVerified IS NULL OR EmailVerified = 0)
        """
    )
    terminais_total = _count("SELECT COUNT(*) AS n FROM ip_permissions")
    terminais_ativos = _count("SELECT COUNT(*) AS n FROM ip_permissions WHERE ativo = TRUE")
    try:
        solicitacoes = _count("SELECT COUNT(*) AS n FROM tabSolicitacoesAcesso")
    except Exception as exc:  # tabela criada no startup do router de IPs
        logger.debug("overview: falha ao contar solicitações: %s", exc)
        solicitacoes = 0

    return {
        "usuarios": {
            "total": usuarios_total,
            "online": online,
            "conta_internet": usuarios_internet,
            "ativacao_pendente": usuarios_ativacao_pendente,
        },
        "terminais": {"total": terminais_total, "ativos": terminais_ativos},
        "solicitacoes_pendentes": solicitacoes,
    }

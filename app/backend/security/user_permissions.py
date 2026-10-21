"""
Permissões RBAC por ponto (usuários com login via internet).
Mescla com permissões de IP: base IP, overlay do usuário prevalece.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Optional, TYPE_CHECKING

from database import db
from painel_permissions import (
    LEGACY_DASHBOARD_SETOR_KEY,
    PAINEL_SETORES_KEY,
    enrich_permissions,
    parse_painel_setores_raw,
    serialize_painel_setores,
)

if TYPE_CHECKING:
    from starlette.requests import Request

    from security.session_auth import SessionData

logger = logging.getLogger(__name__)

_PERMISSION_BOOL_KEYS = (
    "ctx_nova_os",
    "ctx_duplicar_os",
    "ctx_editar_os",
    "ctx_vincular_os",
    "ctx_abrir_pasta",
    "ctx_mover_pastas",
    "ctx_imprimir_ficha",
    "ctx_imprimir_separador",
    "ctx_detalhes_os",
    "ctx_prova_web",
    "ctx_orcamento",
    "sb_inicio",
    "sb_gerencia",
    "sb_email",
    "sb_analise",
    "sb_papelaria",
    "sb_usuario",
    "sb_configuracoes",
    "sb_relatorio",
    "sb_dashboard_setor",
    "sb_dashboard_global",
    "sb_admin_ips",
    "sb_pcp",
    "sb_usuarios",
    "sb_active_computers",
    "sb_gravacao",
    "sb_cotas_graf",
    "sb_gravacao_externa",
    "sb_gravacao_pendente",
    "sb_gravacao_externa_operador",
    "sb_gravacao_pendente_excluir",
    "sb_gravacao_externa_entrega",
    "sb_gravacao_externa_lancar",
    "sb_estoque",
    "sb_estoque_gerente",
    "sb_lombada",
    "sb_dashboard_tablet",
    "sb_credenciais_depol",
    "sb_manipular_imagem",
)


def _row_to_permissions(row: dict[str, Any], ponto: int) -> dict:
    perms: dict[str, Any] = {"ip": f"user:{ponto}"}
    for key in _PERMISSION_BOOL_KEYS:
        perms[key] = bool(row.get(key, 0))
    perms[PAINEL_SETORES_KEY] = parse_painel_setores_raw(row.get(PAINEL_SETORES_KEY))
    return enrich_permissions(perms)


def is_user_permissions_customized(row: dict[str, Any]) -> bool:
    """True quando há pelo menos uma flag/setor liberado (não só INSERT vazio ou timestamp)."""
    for key in _PERMISSION_BOOL_KEYS:
        if bool(row.get(key, 0)):
            return True
    if parse_painel_setores_raw(row.get(PAINEL_SETORES_KEY)):
        return True
    if bool(row.get(LEGACY_DASHBOARD_SETOR_KEY, 0)):
        return True
    return False


def get_user_permissions_row(ponto: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        "SELECT * FROM user_permissions WHERE Ponto = %s",
        (ponto,),
    )
    return rows[0] if rows else None


def get_user_permissions_raw(ponto: int) -> Optional[dict[str, Any]]:
    """Permissões cadastradas em user_permissions (admin / overlay), sem exigir e-mail."""
    row = get_user_permissions_row(ponto)
    if row is None:
        return None
    return _row_to_permissions(row, ponto)


def merge_permissions(
    base: Optional[dict[str, Any]],
    overlay: dict[str, Any],
    *,
    session_ip: str | None = None,
) -> dict[str, Any]:
    """Permissões do usuário prevalecem sobre as do IP."""
    if base is None:
        merged: dict[str, Any] = dict(overlay)
    else:
        merged = dict(base)
        for key in _PERMISSION_BOOL_KEYS:
            merged[key] = bool(overlay.get(key, merged.get(key, False)))
        overlay_setores = parse_painel_setores_raw(overlay.get(PAINEL_SETORES_KEY))
        if overlay_setores or bool(overlay.get(LEGACY_DASHBOARD_SETOR_KEY, False)):
            merged[PAINEL_SETORES_KEY] = overlay_setores
            if LEGACY_DASHBOARD_SETOR_KEY in overlay:
                merged[LEGACY_DASHBOARD_SETOR_KEY] = bool(
                    overlay.get(LEGACY_DASHBOARD_SETOR_KEY, False)
                )
    if session_ip:
        merged["ip"] = session_ip
    elif base and base.get("ip"):
        merged["ip"] = base["ip"]
    return enrich_permissions(merged)


def get_user_permissions(ponto: int) -> Optional[dict]:
    """Permissões do usuário com login internet; None se inativo ou e-mail não verificado."""
    rows = db.execute_query(
        """
        SELECT u.Ponto, u.AuthAtivo, u.EmailVerified, up.*
        FROM tabUsuarios u
        LEFT JOIN user_permissions up ON up.Ponto = u.Ponto
        WHERE u.Ponto = %s
        """,
        (ponto,),
    )
    if not rows:
        return None
    row = rows[0]
    if not row.get("AuthAtivo", 1):
        return None
    if not row.get("EmailVerified"):
        return None
    up_row = get_user_permissions_row(ponto)
    if up_row is None:
        return None
    return _row_to_permissions(up_row, ponto)


def _empty_user_permissions(session_ip: str) -> dict[str, Any]:
    """Permissões negadas (internet sem ACL de usuário customizado)."""
    perms: dict[str, Any] = {"ip": session_ip}
    for key in _PERMISSION_BOOL_KEYS:
        perms[key] = False
    perms[PAINEL_SETORES_KEY] = []
    return enrich_permissions(perms)


def resolve_effective_permissions(
    request: "Request",
    session: "SessionData",
    *,
    path: str | None = None,
    method: str = "GET",
    get_client_permissions: Callable[[str], Optional[dict]],
) -> Optional[dict]:
    """
    Resolve permissões efetivas.
    Internet (login senha): usuário é fonte de verdade (sem herdar IP); remote master = full.
    Rede local: base IP + overlay do usuário quando customizado.
    """
    from security.painel_access import (
        resolve_permissions_for_api,
        resolve_permissions_for_session,
    )
    from security.public_access import should_use_user_permissions
    from security.remote_master import is_remote_master_ponto

    if should_use_user_permissions(request, session) and is_remote_master_ponto(
        session.ponto
    ):
        rows = db.execute_query(
            """
            SELECT AuthAtivo, EmailVerified FROM tabUsuarios WHERE Ponto = %s
            """,
            (session.ponto,),
        )
        if not rows or not rows[0].get("AuthAtivo", 1) or not rows[0].get(
            "EmailVerified"
        ):
            return None
        from routers.ip_admin_routes import _full_access_permissions

        return _full_access_permissions(session.ip)

    if should_use_user_permissions(request, session):
        rows = db.execute_query(
            """
            SELECT AuthAtivo, EmailVerified FROM tabUsuarios WHERE Ponto = %s
            """,
            (session.ponto,),
        )
        if not rows or not rows[0].get("AuthAtivo", 1) or not rows[0].get("EmailVerified"):
            return None
        up_row = get_user_permissions_row(session.ponto)
        if up_row and is_user_permissions_customized(up_row):
            overlay = _row_to_permissions(up_row, session.ponto)
            # Internet: usuário sobrescreve IP por completo (não herda flags do IP).
            return merge_permissions(None, overlay, session_ip=session.ip)
        return _empty_user_permissions(session.ip)

    if path is not None:
        ip_perms = resolve_permissions_for_api(
            session.ip,
            path,
            method,
            get_client_permissions=get_client_permissions,
        )
    else:
        ip_perms = resolve_permissions_for_session(
            session.ip,
            get_client_permissions=get_client_permissions,
        )

    up_row = get_user_permissions_row(session.ponto)
    if up_row and is_user_permissions_customized(up_row):
        overlay = _row_to_permissions(up_row, session.ponto)
        if ip_perms is None:
            return None
        return merge_permissions(ip_perms, overlay, session_ip=session.ip)

    return ip_perms


def upsert_user_permissions(ponto: int, data: dict[str, Any]) -> None:
    """Cria ou atualiza permissões do usuário (bool + painel_setores JSON)."""
    bool_data = {
        k: bool(v)
        for k, v in data.items()
        if k in _PERMISSION_BOOL_KEYS and v is not None
    }
    painel_setores = data.get(PAINEL_SETORES_KEY)
    has_painel_json = painel_setores is not None

    cols = list(bool_data.keys())
    if not cols and not has_painel_json:
        db.execute_query(
            "INSERT IGNORE INTO user_permissions (Ponto) VALUES (%s)",
            (ponto,),
        )
        return

    if not cols:
        db.execute_query(
            "INSERT IGNORE INTO user_permissions (Ponto) VALUES (%s)",
            (ponto,),
        )

    if cols:
        placeholders = ", ".join(f"{c}=%s" for c in cols)
        values = [1 if bool_data[c] else 0 for c in cols]
        db.execute_query(
            f"""
            INSERT INTO user_permissions (Ponto, {", ".join(cols)})
            VALUES (%s, {", ".join("%s" for _ in cols)})
            ON DUPLICATE KEY UPDATE {placeholders}
            """,
            tuple([ponto, *values, *values]),
        )

    if has_painel_json:
        setores_list = (
            painel_setores
            if isinstance(painel_setores, list)
            else parse_painel_setores_raw(painel_setores)
        )
        legacy = bool(data.get(LEGACY_DASHBOARD_SETOR_KEY, bool(setores_list)))
        db.execute_query(
            f"""
            INSERT INTO user_permissions (Ponto, {PAINEL_SETORES_KEY}, {LEGACY_DASHBOARD_SETOR_KEY})
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                {PAINEL_SETORES_KEY} = VALUES({PAINEL_SETORES_KEY}),
                {LEGACY_DASHBOARD_SETOR_KEY} = VALUES({LEGACY_DASHBOARD_SETOR_KEY})
            """,
            (ponto, serialize_painel_setores(setores_list), 1 if legacy else 0),
        )

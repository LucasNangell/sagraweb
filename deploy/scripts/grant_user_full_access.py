#!/usr/bin/env python3
"""
Cadastra ou atualiza user_permissions com acesso total (equivalente ao IP MASTER / 10.120.1.14).

Uso (raiz do projeto, com config/.env apontando ao MySQL):
  python deploy/scripts/grant_user_full_access.py 918713
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "app" / "services"))

import bootstrap_paths  # noqa: F401

from database import db
from painel_permissions import LEGACY_DASHBOARD_SETOR_KEY
from security.user_permissions import upsert_user_permissions
from setor_painel_schema import ensure_setor_painel_schema
from user_auth_schema import ensure_user_auth_schema

FULL_ACCESS = {
    "ctx_nova_os": True,
    "ctx_duplicar_os": True,
    "ctx_editar_os": True,
    "ctx_vincular_os": True,
    "ctx_abrir_pasta": True,
    "ctx_mover_pastas": True,
    "ctx_imprimir_ficha": True,
    "ctx_detalhes_os": True,
    "sb_inicio": True,
    "sb_gerencia": True,
    "sb_email": True,
    "sb_analise": True,
    "sb_papelaria": True,
    "sb_usuario": True,
    "sb_configuracoes": True,
    "sb_relatorio": True,
    "sb_dashboard_setor": True,
    "sb_dashboard_global": True,
    "sb_admin_ips": True,
    "sb_pcp": True,
    "sb_usuarios": True,
    "sb_active_computers": True,
    "sb_gravacao": True,
    "sb_cotas_graf": True,
    LEGACY_DASHBOARD_SETOR_KEY: True,
    "painel_setores": [],
}


def grant(ponto: int) -> None:
    ensure_user_auth_schema()
    ensure_setor_painel_schema()

    rows = db.execute_query(
        "SELECT Ponto, Nome, Email, EmailVerified, AuthAtivo FROM tabUsuarios WHERE Ponto = %s",
        (ponto,),
    )
    if not rows:
        print(f"ERRO: ponto {ponto} não existe em tabUsuarios.")
        sys.exit(1)

    user = rows[0]
    db.execute_query(
        """
        UPDATE tabUsuarios
        SET AuthAtivo = 1, EmailVerified = 1
        WHERE Ponto = %s
        """,
        (ponto,),
    )

    upsert_user_permissions(ponto, FULL_ACCESS)

    nome = user.get("Nome") or "—"
    email = user.get("Email") or "—"
    print(f"OK: ponto {ponto} ({nome})")
    print(f"    E-mail: {email}")
    print("    AuthAtivo=1, EmailVerified=1")
    print("    user_permissions: todas as flags ativas (nível MASTER / 10.120.1.14)")
    print("\nFaça logout/login no SPA (ou cgraf.online) para recarregar permissões.")


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: python deploy/scripts/grant_user_full_access.py <ponto>")
        return 1
    raw = "".join(c for c in sys.argv[1] if c.isdigit())
    if not raw:
        print("Ponto inválido.")
        return 1
    grant(int(raw))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

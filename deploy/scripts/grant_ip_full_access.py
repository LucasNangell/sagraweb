#!/usr/bin/env python3
"""
Cadastra ou atualiza IPs em ip_permissions com acesso total (todas as flags = 1).

Uso (a partir da raiz do projeto ou app/backend):
  python deploy/scripts/grant_ip_full_access.py 10.120.1.14
  python deploy/scripts/grant_ip_full_access.py 10.120.1.14 127.0.0.1
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "app" / "services"))

import bootstrap_paths  # noqa: F401

from database import Database
from ip_permissions_schema import ensure_ip_permissions_schema

DEFAULT_IPS = ("10.120.1.14", "127.0.0.1", "::1")

UPSERT_SQL = """
INSERT INTO ip_permissions (
    ip, descricao, grupo, ativo,
    ctx_nova_os, ctx_duplicar_os, ctx_editar_os, ctx_vincular_os,
    ctx_abrir_pasta, ctx_mover_pastas, ctx_imprimir_ficha, ctx_detalhes_os,
    sb_inicio, sb_gerencia, sb_email, sb_analise, sb_papelaria,
    sb_usuario, sb_configuracoes, sb_relatorio, sb_dashboard_setor,
    sb_admin_ips, sb_pcp, sb_usuarios, sb_active_computers, sb_gravacao, sb_cotas_graf
) VALUES (
    %s, %s, %s, 1,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1
)
ON DUPLICATE KEY UPDATE
    descricao = VALUES(descricao),
    grupo = VALUES(grupo),
    ativo = 1,
    ctx_nova_os = 1, ctx_duplicar_os = 1, ctx_editar_os = 1, ctx_vincular_os = 1,
    ctx_abrir_pasta = 1, ctx_mover_pastas = 1, ctx_imprimir_ficha = 1, ctx_detalhes_os = 1,
    sb_inicio = 1, sb_gerencia = 1, sb_email = 1, sb_analise = 1, sb_papelaria = 1,
    sb_usuario = 1, sb_configuracoes = 1, sb_relatorio = 1, sb_dashboard_setor = 1,
    sb_admin_ips = 1, sb_pcp = 1, sb_usuarios = 1, sb_active_computers = 1, sb_gravacao = 1,
    sb_cotas_graf = 1
"""


def grant(ip: str, descricao: str | None = None) -> None:
    desc = descricao or f"Acesso total — {ip}"
    db = Database()
    with db.cursor() as cursor:
        cursor.execute(
            UPSERT_SQL,
            (ip, desc, "Administradores"),
        )
    print(f"OK: {ip} — todas as permissões ativas")


def main() -> int:
    ips = sys.argv[1:] if len(sys.argv) > 1 else list(DEFAULT_IPS)
    ensure_ip_permissions_schema()
    for ip in ips:
        grant(ip.strip())
    print("\nConcluído. Faça logout/login no SPA ou limpe cookies e entre de novo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

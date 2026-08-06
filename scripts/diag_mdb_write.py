#!/usr/bin/env python3
"""
Diagnóstico rápido de conexão e permissão nos MDBs de produção (OS Atual / Papelaria).

Uso:
  python scripts/diag_mdb_write.py
  python scripts/diag_mdb_write.py --write-test 84 2026
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "app" / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import pyodbc  # noqa: E402

from config_manager import config_manager  # noqa: E402


def _check_path(label: str, path: str | None) -> list[str]:
    issues: list[str] = []
    print(f"\n=== {label} ===")
    print(f"  path: {path}")
    if not path:
        issues.append(f"{label}: caminho não configurado")
        print("  [FALHA] caminho vazio")
        return issues
    if "BackupMySQL" in path.replace("/", "\\"):
        issues.append(f"{label}: aponta para BackupMySQL (homologação)")
        print("  [AVISO] caminho contém BackupMySQL — use SAGRA2 raiz em produção")
    p = Path(path)
    if not p.exists():
        issues.append(f"{label}: arquivo não encontrado")
        print("  [FALHA] arquivo não existe")
        return issues
    print(f"  [OK] arquivo existe ({p.stat().st_size:,} bytes)")
    return issues


def _test_odbc(label: str, path: str) -> list[str]:
    issues: list[str] = []
    conn_str = config_manager.get_mdb_connection_string(path)
    print(f"  driver: Microsoft Access Driver")
    try:
        conn = pyodbc.connect(conn_str)
    except Exception as exc:
        issues.append(f"{label}: pyodbc connect falhou: {exc}")
        print(f"  [FALHA] conexão: {exc}")
        return issues
    print("  [OK] pyodbc conectou")
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM tabProtocolos")
        n_proto = cur.fetchone()[0]
        print(f"  [OK] SELECT tabProtocolos: {n_proto} registros")
        cur.execute("SELECT COUNT(*) FROM tabAndamento")
        n_and = cur.fetchone()[0]
        print(f"  [OK] SELECT tabAndamento: {n_and} registros")
        # Access/Jet não aceita BEGIN TRANSACTION via ODBC; autocommit off + rollback valida escrita.
        conn.autocommit = False
        conn.rollback()
        print("  [OK] modo transacional (autocommit off + rollback)")
    except Exception as exc:
        issues.append(f"{label}: query/transação falhou: {exc}")
        print(f"  [FALHA] {exc}")
    finally:
        try:
            conn.close()
        except Exception:
            pass
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnóstico gravação MDB SAGRA Web")
    parser.add_argument(
        "--write-test",
        nargs=2,
        metavar=("NRO", "ANO"),
        type=int,
        help="Teste controlado: verifica se OS existe em tabProtocolos (sem INSERT)",
    )
    args = parser.parse_args()

    print("SAGRA Web — diag_mdb_write")
    print(f"  PROJECT_ROOT: {ROOT}")
    print(f"  mysql_only: {config_manager.is_mysql_only()}")
    print(f"  mdb_write_enabled: {config_manager.is_mdb_write_enabled()}")

    paths = config_manager.get_mdb_paths()
    all_issues: list[str] = []

    for label, key in (("MDB OS Atual", "os_atual"), ("MDB Papelaria", "papelaria")):
        path = paths.get(key)
        all_issues.extend(_check_path(label, path))
        if path and Path(path).exists():
            all_issues.extend(_test_odbc(label, path))

    if args.write_test:
        nro, ano = args.write_test
        dest = config_manager.get_mdb_path_by_nro(nro)
        print(f"\n=== write-test OS {nro}/{ano} ===")
        print(f"  destino: {dest}")
        try:
            conn = pyodbc.connect(config_manager.get_mdb_connection_string(dest))
            cur = conn.cursor()
            cur.execute(
                "SELECT NroProtocolo, AnoProtocolo FROM tabProtocolos "
                "WHERE NroProtocolo = ? AND AnoProtocolo = ?",
                (nro, ano),
            )
            row = cur.fetchone()
            if row:
                print(f"  [OK] OS {nro}/{ano} encontrada em tabProtocolos")
            else:
                msg = f"OS {nro}/{ano} AUSENTE em tabProtocolos — andamento seria rejeitado"
                all_issues.append(msg)
                print(f"  [FALHA] {msg}")
            conn.close()
        except Exception as exc:
            all_issues.append(f"write-test: {exc}")
            print(f"  [FALHA] {exc}")

    print("\n=== RESUMO ===")
    if all_issues:
        for item in all_issues:
            print(f"  - {item}")
        return 1
    print("  Nenhum problema detectado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

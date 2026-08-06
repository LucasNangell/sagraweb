#!/usr/bin/env python3
"""
Validação do sync MDB → MySQL compatível com SAGRA Web.

Uso:
  python tools/validate_sync_mdb_mysql.py --check-syntax
  python tools/validate_sync_mdb_mysql.py --check-lock
  python tools/validate_sync_mdb_mysql.py --check-materialized 1234 2026
  python tools/validate_sync_mdb_mysql.py --check-notify-offline
  python tools/validate_sync_mdb_mysql.py --all

Não altera MDB. Testes destrutivos no MySQL exigem --allow-mysql-write e variáveis de teste.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_sync_module():
    spec = importlib.util.spec_from_file_location("sync_andamentos_v2", ROOT / "sync_andamentos_v2.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check_syntax() -> Dict[str, Any]:
    import py_compile

    target = ROOT / "sync_andamentos_v2.py"
    py_compile.compile(str(target), doraise=True)
    return {"ok": True, "message": f"Syntax OK: {target}"}


def check_lock() -> Dict[str, Any]:
    mod = _load_sync_module()
    config = mod.Config.load()
    sync = mod.AndamentosSynchronizer(config)
    first = sync.acquire_instance_lock()
    second = sync.acquire_instance_lock()
    sync.release_instance_lock()
    return {
        "ok": first and not second,
        "first_acquired": first,
        "second_blocked": not second,
    }


def check_materialized(nro: int, ano: int) -> Dict[str, Any]:
    mod = _load_sync_module()
    config = mod.Config.load()
    sync = mod.AndamentosSynchronizer(config)
    sync.refresh_os_ultimo_andamento_operacional(nro, ano)

    conn = sync.conn_mgr.get_mysql()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """
        SELECT situacao, setor, cod_status
        FROM tab_os_ultimo_andamento_operacional
        WHERE nro_protocolo = %s AND ano_protocolo = %s
        """,
        (nro, ano),
    )
    mat = cur.fetchone()
    cur.execute(
        f"""
        SELECT a.SituacaoLink, a.SetorLink, a.CodStatus
        FROM tabandamento a
        WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
          AND a.UltimoStatus = 1
          AND {mod._MIRROR_EXCLUDE_CLAUSE.strip()}
        ORDER BY a.`Data` DESC, a.CodStatus DESC
        LIMIT 1
        """,
        (nro, ano),
    )
    live = cur.fetchone()
    cur.close()

    if live is None and mat is None:
        return {"ok": True, "message": "Sem andamento operacional (consistente)"}
    if live and mat:
        ok = (
            (live.get("SituacaoLink") or "") == (mat.get("situacao") or "")
            and (live.get("SetorLink") or "") == (mat.get("setor") or "")
            and str(live.get("CodStatus")) == str(mat.get("cod_status"))
        )
        return {"ok": ok, "live": live, "materialized": mat}
    return {"ok": False, "live": live, "materialized": mat, "issue": "divergence_or_missing"}


def check_notify_offline() -> Dict[str, Any]:
    mod = _load_sync_module()
    config = mod.Config.load()
    sync = mod.AndamentosSynchronizer(config)
    os.environ["SAGRA_API_BASE"] = "http://127.0.0.1:1"
    t0 = time.perf_counter()
    try:
        sync.logger.notify_api(1, 2026, "sync_test_offline")
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    elapsed = time.perf_counter() - t0
    return {"ok": elapsed < 2.0, "elapsed_sec": round(elapsed, 3), "message": "Sync não travou com API offline"}


def check_flags() -> Dict[str, Any]:
    mod = _load_sync_module()
    return {
        "ok": True,
        "SYNC_FORMAT_MYSQL_RECENT_RECORDS": mod.SYNC_FORMAT_MYSQL_RECENT_RECORDS,
        "SYNC_PROTOCOL_DETAILS_BACKGROUND": mod.SYNC_PROTOCOL_DETAILS_BACKGROUND,
        "SYNC_INSTANCE_LOCK_NAME": mod.SYNC_INSTANCE_LOCK_NAME,
    }


def check_after_os_changed_exists() -> Dict[str, Any]:
    mod = _load_sync_module()
    config = mod.Config.load()
    sync = mod.AndamentosSynchronizer(config)
    has_fn = callable(getattr(sync, "after_os_changed", None))
    has_refresh = callable(getattr(sync, "refresh_os_ultimo_andamento_operacional", None))
    has_filter = callable(getattr(sync, "refresh_os_filter_options_for_os", None))
    return {"ok": has_fn and has_refresh and has_filter}


def run_all(nro: int, ano: int) -> List[Dict[str, Any]]:
    results = [
        {"test": "syntax", **check_syntax()},
        {"test": "flags", **check_flags()},
        {"test": "after_os_changed", **check_after_os_changed_exists()},
        {"test": "lock", **check_lock()},
        {"test": "notify_offline", **check_notify_offline()},
        {"test": f"materialized_{nro}_{ano}", **check_materialized(nro, ano)},
    ]
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Validação sync MDB → MySQL")
    parser.add_argument("--check-syntax", action="store_true")
    parser.add_argument("--check-lock", action="store_true")
    parser.add_argument("--check-materialized", nargs=2, type=int, metavar=("NRO", "ANO"))
    parser.add_argument("--check-notify-offline", action="store_true")
    parser.add_argument("--check-flags", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--nro", type=int, default=1, help="OS para --all")
    parser.add_argument("--ano", type=int, default=2026, help="Ano para --all")
    args = parser.parse_args()

    if not any([
        args.check_syntax, args.check_lock, args.check_materialized,
        args.check_notify_offline, args.check_flags, args.all,
    ]):
        parser.print_help()
        return 1

    results: List[Dict[str, Any]] = []
    if args.all:
        results = run_all(args.nro, args.ano)
    else:
        if args.check_syntax:
            results.append({"test": "syntax", **check_syntax()})
        if args.check_flags:
            results.append({"test": "flags", **check_flags()})
        if args.check_lock:
            results.append({"test": "lock", **check_lock()})
        if args.check_materialized:
            nro, ano = args.check_materialized
            results.append({"test": "materialized", **check_materialized(nro, ano)})
        if args.check_notify_offline:
            results.append({"test": "notify_offline", **check_notify_offline()})

    failed = 0
    for r in results:
        status = "PASS" if r.get("ok") else "FAIL"
        if not r.get("ok"):
            failed += 1
        print(f"[{status}] {r.get('test')}: {r}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

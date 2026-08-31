"""Aplica tab_os_edit_lock no MySQL atual (dev) e, se distinto, no host de produção."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import pymysql

from os_edit_lock_schema import CREATE_TAB_OS_EDIT_LOCK_SQL, ensure_os_edit_lock_schema


def _table_exists(conn) -> bool:
    with conn.cursor() as cursor:
        cursor.execute("SHOW TABLES LIKE 'tab_os_edit_lock'")
        return cursor.fetchone() is not None


def _apply_on_host(host: str, port: int, user: str, password: str, database: str) -> bool:
    conn = pymysql.connect(
        host=host,
        port=int(port),
        user=user,
        password=password or "",
        database=database,
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=10,
        read_timeout=30,
        write_timeout=30,
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute(CREATE_TAB_OS_EDIT_LOCK_SQL)
        return _table_exists(conn)
    finally:
        conn.close()


def _loopback(host: str) -> bool:
    h = (host or "").strip().lower()
    return h in ("127.0.0.1", "localhost", "::1")


def _password_from_env_file(path: Path) -> str:
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, _, value = raw.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key in ("DB_PASSWORD", "SAGRA_DB_PASSWORD") and value:
            return value
    return ""


def _prod_password(disk: dict) -> str:
    password = str(disk.get("db_password") or "").strip()
    if password:
        return password
    config_dir = ROOT / "config"
    for name in (".env.production", ".env.production.test"):
        found = _password_from_env_file(config_dir / name)
        if found:
            return found
    return ""


def main() -> None:
    from config_manager import config_manager

    print("Aplicando tab_os_edit_lock no MySQL da config atual...")
    ensure_os_edit_lock_schema()
    current = config_manager.get_mysql_config()
    current_host = str(current.get("host") or "")
    print(f"  atual ({current_host}): OK")

    disk = getattr(config_manager, "_disk_config", {}) or {}
    prod_host = str(disk.get("db_host") or "").strip()
    if not prod_host or _loopback(prod_host) or prod_host == current_host:
        print("  produção: mesmo host da config atual — nada extra a aplicar.")
        return

    prod_port = int(disk.get("db_port") or 3306)
    prod_user = str(disk.get("db_user") or "")
    prod_password = _prod_password(disk)
    prod_db = str(disk.get("db_name") or "sagrafulldb")
    if not prod_password:
        print(
            "  produção: senha MySQL ausente em config.json / "
            "config/.env.production — não foi possível aplicar em "
            f"{prod_host}."
        )
        sys.exit(1)
    print(f"Aplicando tab_os_edit_lock em produção ({prod_host})...")
    ok = _apply_on_host(prod_host, prod_port, prod_user, prod_password, prod_db)
    print(f"  {prod_host}: {'OK' if ok else 'FALTA'}")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()

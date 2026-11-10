"""Paridade das chaves RBAC entre backend e o catálogo do frontend (Controle de Acesso).

Uma chave nova em `_PERMISSION_BOOL_KEYS` precisa existir em `PERMISSION_KEYS`
(`apps/web/src/features/auth/types.ts`) — e, pelo teste Vitest do catálogo, ganhar
rótulo/categoria/escopo em `features/acesso/permissionCatalog.ts`.
"""
from __future__ import annotations

import re
from pathlib import Path

from routers.ip_admin_routes import _full_access_permissions
from security.user_permissions import _PERMISSION_BOOL_KEYS

REPO_ROOT = Path(__file__).resolve().parents[3]
TYPES_TS = REPO_ROOT / "apps" / "web" / "src" / "features" / "auth" / "types.ts"
CATALOG_TS = REPO_ROOT / "apps" / "web" / "src" / "features" / "acesso" / "permissionCatalog.ts"


def _frontend_permission_keys() -> set[str]:
    text = TYPES_TS.read_text(encoding="utf-8")
    match = re.search(
        r"export const PERMISSION_KEYS: PermissionKey\[\] = \[(.*?)\];",
        text,
        re.S,
    )
    assert match, "PERMISSION_KEYS não encontrado em types.ts"
    return set(re.findall(r'"([a-z_]+)"', match.group(1)))


def _catalog_keys() -> set[str]:
    text = CATALOG_TS.read_text(encoding="utf-8")
    return set(re.findall(r'entry\(\s*"([a-z_]+)"', text))


def test_backend_keys_match_frontend_permission_keys():
    assert set(_PERMISSION_BOOL_KEYS) == _frontend_permission_keys()


def test_catalog_covers_backend_keys():
    assert set(_PERMISSION_BOOL_KEYS) == _catalog_keys()


def test_full_access_grants_every_key():
    perms = _full_access_permissions("10.0.0.1")
    for key in _PERMISSION_BOOL_KEYS:
        assert perms.get(key) is True, key

"""Servir frontend estático (SPA React ou HTML legado)."""
from __future__ import annotations

import logging
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

_BLOCKED_STATIC_SUFFIXES = {
    ".sql", ".json", ".env", ".yaml", ".yml", ".pkl", ".log", ".py", ".md", ".bat", ".spec",
}

_SW_NO_CACHE = "no-cache, no-store, must-revalidate"


def strip_spa_base_prefix(path: str) -> str:
    """Vite dist fica na raiz; o browser pede /sagra/assets/... quando BASE=/sagra/."""
    norm = (path or "").replace("\\", "/").lstrip("/")
    lower = norm.lower()
    if lower == "sagra":
        return ""
    if lower.startswith("sagra/"):
        return norm[len("sagra/") :]
    return norm


def is_service_worker_script_path(path: str) -> bool:
    """sw.js, push-sw.js e workbox-*.js devem sempre revalidar no browser."""
    name = Path(path.replace("\\", "/")).name.lower()
    return name in {"sw.js", "push-sw.js"} or (
        name.startswith("workbox-") and name.endswith(".js")
    )


def apply_sw_cache_headers(path: str, response) -> None:
    if not is_service_worker_script_path(path):
        return
    try:
        response.headers["Cache-Control"] = _SW_NO_CACHE
    except Exception:
        pass


def resolve_frontend_dir(project_root: Path) -> Path | None:
    """Prioriza SPA (index.html na raiz); senão legado em app/frontend."""
    candidates = (
        project_root / "app" / "frontend",
        project_root / "app" / "frontend" / "legacy",
    )
    for directory in candidates:
        if (directory / "index.html").is_file():
            return directory
    if candidates[0].is_dir():
        return candidates[0]
    return None


def resolve_legacy_portal_dir(project_root: Path) -> Path | None:
    """Pasta com client_pt.html (legado), usada quando o frontend ativo é SPA."""
    legacy = project_root / "app" / "frontend" / "legacy"
    if (legacy / "client_pt.html").is_file():
        return legacy
    direct = project_root / "app" / "frontend"
    if (direct / "client_pt.html").is_file():
        return direct
    return None


def is_legacy_dashboard_static_path(norm: str) -> bool:
    """Painéis HTML legados (dashboard_setor/global) em app/frontend/legacy/."""
    return norm in (
        "dashboard_setor.html",
        "dashboard_setor.css",
        "dashboard_setor.js",
        "dashboard_global.html",
        "dashboard_global.css",
        "dashboard_global.js",
        "config_painel_global.json",
    )


def is_portal_static_path(norm: str) -> bool:
    """Arquivos do portal cliente servidos a partir de legacy/."""
    if is_legacy_dashboard_static_path(norm):
        return True
    if norm in ("client_pt.html", "client_proof.html", "styles.css"):
        return True
    return norm.startswith(("js/", "lib/"))


def is_spa_frontend(frontend_dir: Path) -> bool:
    """Detecta build Vite/React (pasta assets/ ou div#root no index)."""
    index = frontend_dir / "index.html"
    if not index.is_file():
        return False
    if (frontend_dir / "assets").is_dir():
        return True
    text = index.read_text(encoding="utf-8", errors="ignore")
    return 'id="root"' in text or "id='root'" in text


class SafeStaticFiles(StaticFiles):
    async def __call__(self, scope, receive, send):
        # Mount "/" recebe scopes WebSocket quando a rota exata não casa (ex.: /api/ws/).
        if scope["type"] != "http":
            if scope["type"] == "websocket":
                from starlette.websockets import WebSocket

                ws = WebSocket(scope, receive, send)
                await ws.close(code=1000)
            return
        await super().__call__(scope, receive, send)

    async def get_response(self, path: str, scope):
        norm = path.replace("\\", "/").lstrip("/").lower()
        blocked_parts = ("venv", "config", "data", "legacy_or_unused", "app/backend", "app/services")
        if any(part in norm for part in blocked_parts):
            raise HTTPException(status_code=404, detail="Not found")
        if Path(norm).suffix.lower() in _BLOCKED_STATIC_SUFFIXES:
            raise HTTPException(status_code=404, detail="Not found")
        response = await super().get_response(path, scope)
        apply_sw_cache_headers(norm, response)
        return response


class SpaStaticFiles(SafeStaticFiles):
    """Arquivos estáticos com fallback para index.html (rotas do React Router)."""

    def __init__(self, *args, legacy_directory: str | None = None, **kwargs):
        self._legacy_directory = Path(legacy_directory) if legacy_directory else None
        self._legacy_static: SafeStaticFiles | None = None
        super().__init__(*args, **kwargs)

    def _legacy_files(self) -> SafeStaticFiles | None:
        if not self._legacy_directory or not self._legacy_directory.is_dir():
            return None
        if self._legacy_static is None:
            self._legacy_static = SafeStaticFiles(
                directory=str(self._legacy_directory),
                html=True,
            )
        return self._legacy_static

    async def _try_legacy(self, norm: str, scope):
        if not norm or not is_portal_static_path(norm):
            return None
        legacy = self._legacy_files()
        if not legacy:
            return None
        try:
            return await legacy.get_response(norm, scope)
        except HTTPException as exc:
            if exc.status_code == 404:
                return None
            raise

    async def get_response(self, path: str, scope):
        lookup = strip_spa_base_prefix(path)
        norm = lookup.replace("\\", "/").lstrip("/")
        legacy_resp = await self._try_legacy(norm, scope)
        if legacy_resp is not None:
            apply_sw_cache_headers(norm, legacy_resp)
            return legacy_resp

        try:
            response = await super().get_response(lookup or "index.html", scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            legacy_resp = await self._try_legacy(norm, scope)
            if legacy_resp is not None:
                apply_sw_cache_headers(norm, legacy_resp)
                return legacy_resp
            if norm and "." in Path(norm).name:
                raise
            return await super().get_response("index.html", scope)

        if getattr(response, "status_code", None) == 404:
            legacy_resp = await self._try_legacy(norm, scope)
            if legacy_resp is not None:
                apply_sw_cache_headers(norm, legacy_resp)
                return legacy_resp
            if norm and "." in Path(norm).name:
                return response
            return await super().get_response("index.html", scope)
        return response

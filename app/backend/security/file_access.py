"""
Validação de caminhos para servir/listar arquivos da OS e storage interno.
Bloqueia path traversal e acesso fora de roots autorizados.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import HTTPException

logger = logging.getLogger(__name__)

_ALLOWED_EXTENSIONS = frozenset({".pdf", ".jpg", ".jpeg", ".png", ".webp"})
_BLOCKED_EXTENSIONS = frozenset({
    ".env", ".json", ".yaml", ".yml", ".sql", ".py", ".bat", ".ps1",
    ".spec", ".log", ".md", ".pkl", ".mdb", ".accdb", ".exe", ".dll",
    ".pem", ".key", ".crt", ".pfx",
})
_BLOCKED_DIR_NAMES = frozenset({
    "config", "venv", ".venv", "logs", "legacy_or_unused", "node_modules",
    "app", "deploy", "data", ".git",
})


def _norm_path(path: str) -> str:
    return os.path.normcase(os.path.normpath(path.strip()))


def _is_under_root(candidate: str, root: str) -> bool:
    """True se candidate está dentro de root (Windows/UNC)."""
    if not candidate or not root:
        return False
    c = _norm_path(candidate)
    r = _norm_path(root)
    if not r.endswith(os.sep):
        r = r + os.sep
    return c == _norm_path(root.rstrip(os.sep)) or c.startswith(r)


def _blocked_path_segments(path: str) -> bool:
    parts = {p.lower() for p in Path(path).parts if p and p not in (".", "..")}
    return bool(parts & _BLOCKED_DIR_NAMES)


def get_allowed_roots() -> list[str]:
    """Roots autorizados: storage local + pastas DFS de OS."""
    from config_manager import PROJECT_ROOT, config_manager

    roots: list[str] = []

    storage = PROJECT_ROOT / "storage"
    if storage.is_dir():
        roots.append(str(storage.resolve()))

    network = config_manager.get("network_paths") or {}
    for key in ("dfs_deputados", "dfs_deputados_papelaria"):
        raw = network.get(key)
        if raw and isinstance(raw, str) and raw.strip():
            roots.append(raw.strip())

    # Fallback alinhado a os_routes._get_os_folder_path
    default_dfs = r"\\redecamara\DfsData\CGraf\Sefoc\Deputados"
    if not any(_norm_path(r).startswith(_norm_path(default_dfs)) for r in roots):
        roots.append(default_dfs)

    return roots


def get_network_browse_roots() -> list[str]:
    """Raízes para navegação de arquivos na rede (CGraf, Apogee, etc.).

    Exclui o storage local do projeto (uso interno de serve), mantendo-o
    apenas em get_allowed_roots.
    """
    from config_manager import PROJECT_ROOT, config_manager

    storage_path = PROJECT_ROOT / "storage"
    storage_norm = (
        _norm_path(str(storage_path.resolve())) if storage_path.is_dir() else None
    )

    roots: list[str] = []
    cgraf_root = r"\\redecamara\DfsData\CGraf"
    roots.append(cgraf_root)

    network = config_manager.get("network_paths") or {}
    apogee_root = network.get("apogee_files") or r"\\cgrafsysvm\ApogeeFiles"
    if isinstance(apogee_root, str) and apogee_root.strip():
        roots.append(apogee_root.strip())

    drive_roots = config_manager.get("mdb_drive_unc_roots") or {}
    if isinstance(drive_roots, dict):
        for unc in drive_roots.values():
            if unc and isinstance(unc, str) and unc.strip():
                roots.append(unc.strip())

    for root in get_allowed_roots():
        if not root or root in roots:
            continue
        if storage_norm and _norm_path(root) == storage_norm:
            continue
        roots.append(root)

    unique: list[str] = []
    seen: set[str] = set()
    for root in roots:
        key = _norm_path(root)
        if key not in seen:
            seen.add(key)
            unique.append(root)
    return unique


def match_network_browse_root(path: str) -> str:
    """Retorna a raiz de navegação que contém o caminho informado."""
    roots = get_network_browse_roots()
    for root in roots:
        if _is_under_root(path, root):
            return root
    return roots[0] if roots else ""


def _resolve_path_with_drive_letter(raw: str) -> str:
    from config_manager import config_manager

    path = str(raw).strip()
    if len(path) >= 2 and path[1] == ":":
        letter = path[0].upper()
        unc = config_manager._drive_path_to_unc(path)
        if unc:
            return unc
    return path


def resolve_network_file_path(path: str, *, must_be_dir: bool = False) -> str:
    """Resolve e valida caminho dentro das raízes de navegação na rede."""
    if not path or not str(path).strip():
        raise HTTPException(status_code=400, detail="Caminho inválido.")

    raw = _resolve_path_with_drive_letter(path)
    if ".." in raw.replace("\\", "/"):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    if os.path.isabs(raw) or raw.startswith("\\\\"):
        resolved = os.path.normpath(raw)
    else:
        root = get_network_browse_roots()[0]
        resolved = os.path.normpath(os.path.join(root, raw.replace("/", os.sep)))

    if _blocked_path_segments(resolved):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    roots = get_network_browse_roots()
    if not any(_is_under_root(resolved, root) for root in roots):
        raise HTTPException(status_code=403, detail="Caminho fora da área permitida.")

    if must_be_dir:
        if not os.path.isdir(resolved):
            raise HTTPException(status_code=404, detail="Pasta não encontrada.")
    elif not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")

    return resolved


def resolve_allowed_file_path(filepath: str) -> Path:
    """
    Valida e retorna Path absoluto de arquivo permitido.
    Erros genéricos — sem vazar caminho interno completo.
    """
    from security.safe_log import mask_path_for_log

    if not filepath or not str(filepath).strip():
        raise HTTPException(status_code=400, detail="Caminho inválido.")

    raw = str(filepath).strip()
    if ".." in raw.replace("\\", "/"):
        logger.warning("files/serve bloqueado: path traversal em %s", mask_path_for_log(raw))
        raise HTTPException(status_code=403, detail="Acesso negado.")

    if _blocked_path_segments(raw):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    ext = Path(raw).suffix.lower()
    if ext in _BLOCKED_EXTENSIONS:
        raise HTTPException(status_code=403, detail="Acesso negado.")
    if ext and ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=403, detail="Tipo de arquivo não permitido.")

    if not os.path.isfile(raw):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")

    resolved = os.path.abspath(raw)
    if _blocked_path_segments(resolved):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    roots = get_allowed_roots()
    if not any(_is_under_root(resolved, root) for root in roots):
        logger.warning(
            "files/serve bloqueado: fora de allowlist (%s)",
            mask_path_for_log(resolved),
        )
        raise HTTPException(status_code=403, detail="Acesso negado.")

    return Path(resolved)


def resolve_allowed_directory(dirpath: str) -> Path:
    """Valida pasta para listagem de arquivos (mesma allowlist)."""
    from security.safe_log import mask_path_for_log

    if not dirpath or not str(dirpath).strip():
        raise HTTPException(status_code=400, detail="Caminho inválido.")

    raw = str(dirpath).strip()
    if ".." in raw.replace("\\", "/"):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    if _blocked_path_segments(raw):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    if not os.path.isdir(raw):
        resolved = os.path.normpath(raw)
    else:
        resolved = os.path.abspath(raw)

    if _blocked_path_segments(resolved):
        raise HTTPException(status_code=403, detail="Acesso negado.")

    roots = get_allowed_roots()
    if not any(_is_under_root(resolved, root) for root in roots):
        logger.warning(
            "files/list bloqueado: fora de allowlist (%s)",
            mask_path_for_log(resolved),
        )
        raise HTTPException(status_code=403, detail="Acesso negado.")

    return Path(resolved)

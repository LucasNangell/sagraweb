"""Navegação e validação de arquivos na rede (CGraf/UNC)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from security.file_access import (
    get_network_browse_roots,
    match_network_browse_root,
    resolve_network_file_path,
)

ALLOWED_EXTENSIONS = frozenset({".pdf", ".tif", ".tiff"})


def _root_display_name(root: str) -> str:
    parts = [part for part in root.replace("/", os.sep).split(os.sep) if part]
    return parts[-1] if parts else root


def is_allowed_extension(name: str) -> bool:
    return Path(name).suffix.lower() in ALLOWED_EXTENSIONS



def browse_network_folder(relative: str = "") -> dict[str, Any]:
    rel = (relative or "").strip()
    roots = get_network_browse_roots()
    if not roots:
        raise HTTPException(status_code=503, detail="Raiz de navegação não configurada.")

    if not rel:
        entries: list[dict[str, Any]] = []
        for root in roots:
            label = _root_display_name(root)
            entries.append({"name": label, "type": "dir", "path": root})
        entries.sort(key=lambda e: str(e.get("name") or "").lower())
        return {
            "root_path": "",
            "relative": "",
            "current_path": "",
            "entries": entries,
        }

    path = rel.replace("/", os.sep)
    current = resolve_network_file_path(path, must_be_dir=True)
    matched_root = match_network_browse_root(current)

    entries: list[dict[str, Any]] = []
    try:
        names = sorted(os.listdir(current), key=lambda s: s.lower())
    except OSError as exc:
        raise HTTPException(status_code=403, detail="Acesso negado à pasta.") from exc

    for name in names:
        if name.startswith("."):
            continue
        full = os.path.join(current, name)
        is_dir = os.path.isdir(full)
        if is_dir:
            entries.append({"name": name, "type": "dir"})
        elif is_allowed_extension(name):
            size = None
            try:
                size = os.path.getsize(full)
            except OSError:
                size = None
            entries.append({"name": name, "type": "file", "size": size})

    return {
        "root_path": matched_root,
        "relative": rel,
        "current_path": current,
        "entries": entries,
    }


def validate_network_arquivos_input(
    arquivos: list[dict[str, str]],
) -> list[dict[str, Any]]:
    if not arquivos:
        raise ValueError("Selecione ao menos um arquivo.")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idx, item in enumerate(arquivos):
        raw_path = str(item.get("absolute_path") or item.get("path") or "").strip()
        if not raw_path:
            continue
        full = resolve_network_file_path(raw_path, must_be_dir=False)
        norm = os.path.normcase(os.path.normpath(full))
        if norm in seen:
            continue
        seen.add(norm)
        nome = str(item.get("nome") or Path(full).name).strip() or Path(full).name
        ext = Path(full).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(f"Tipo de arquivo não permitido: {ext}")
        size = None
        try:
            size = os.path.getsize(full)
        except OSError:
            size = None
        maquina_raw = item.get("maquina")
        maquina = str(maquina_raw).strip() if maquina_raw else None
        validated.append(
            {
                "absolute_path": full,
                "nome": nome,
                "tamanho_bytes": size,
                "ordem": idx,
                "maquina": maquina or None,
            }
        )
    if not validated:
        raise ValueError("Selecione ao menos um arquivo válido.")
    return validated

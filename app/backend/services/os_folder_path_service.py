"""Resolução compartilhada da pasta da OS na rede (UNC/DFS) com cache curto."""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

_CACHE_TTL_SEC = 90.0
# (ano, nro) -> (expires_at_monotonic, path_or_None)
_path_cache: dict[tuple[int, int], tuple[float, Optional[str]]] = {}


def clear_os_folder_path_cache() -> None:
    """Utilitário de testes."""
    _path_cache.clear()


def _base_path_for_os(ano: int, nro: int) -> str:
    if nro >= 5000:
        return (
            fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}"
            fr"\Deputados_Papelaria_{ano}"
        )
    return (
        fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}"
        fr"\Deputados_{ano}"
    )


def _resolve_uncached(ano: int, nro: int) -> Optional[str]:
    """Localiza a pasta da OS; pode levantar FsTimeoutError."""
    from resilience.fs_timeout import (
        FsTimeoutError,
        glob_with_timeout,
        path_exists_with_timeout,
    )

    # Fallback local (testes / dev sem DFS)
    try:
        if not path_exists_with_timeout(r"\\redecamara\DfsData"):
            local_path = os.path.abspath(f"storage_test/{ano}/{nro}")
            if path_exists_with_timeout(local_path):
                return local_path
    except FsTimeoutError:
        # DFS root timeout: ainda tenta o padrão UNC abaixo
        pass

    base_path = _base_path_for_os(ano, nro)
    os_pattern = os.path.join(base_path, f"{nro:05d}*")
    logger.debug("Resolvendo pasta OS %s/%s pattern=%s", nro, ano, os_pattern)
    found = glob_with_timeout(os_pattern)
    if found:
        return found[0]
    return None


def resolve_os_folder_path(
    ano: int,
    nro: int,
    *,
    use_cache: bool = True,
) -> Optional[str]:
    """
    Retorna o caminho absoluto da pasta da OS ou None se não existir.

    Cacheia positivo e negativo por ~90s para reduzir glob UNC repetido entre
    contexto/cdr-path/proof-files e sp-status-resumo.
    Pode levantar ``FsTimeoutError`` se o DFS não responder a tempo.
    """
    key = (int(ano), int(nro))
    now = time.monotonic()
    if use_cache:
        hit = _path_cache.get(key)
        if hit is not None and hit[0] > now:
            return hit[1]

    path = _resolve_uncached(ano, nro)
    if use_cache:
        _path_cache[key] = (now + _CACHE_TTL_SEC, path)
    return path

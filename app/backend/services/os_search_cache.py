"""
Cache em memória da busca de OS (GET /api/os/search) — home, painéis/TVs e PCP.

Motivo (medido em produção, nov/2026): a mesma busca pesada (~5 s, ~420 mil linhas lidas)
era executada por cada cliente a cada evento WebSocket e a cada poll dos painéis,
mantendo ~10 queries simultâneas no MySQL o tempo todo.

Regras:
- Chave = todos os parâmetros da busca (o resultado não depende do usuário).
- Versão global: qualquer broadcast WebSocket de alteração (o mesmo sinal que faz os
  clientes recarregarem) chama ``bump_os_search_cache_version()``; entradas antigas
  deixam de valer na hora.
- TTL curto de segurança (``SAGRA_OS_SEARCH_CACHE_TTL_SEC``, padrão 15 s) para mudanças
  feitas fora da API sem notificação.
- Single-flight: requisições idênticas simultâneas esperam a primeira em vez de
  disparar N queries iguais.
- ``SAGRA_OS_SEARCH_CACHE=0`` desliga o cache (comportamento anterior).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Hashable, Optional, Tuple

logger = logging.getLogger(__name__)

_MAX_ENTRIES = 48

_lock = threading.Lock()
_version = 0
# key -> (version, stored_at_monotonic, result, etag)
_entries: "OrderedDict[Hashable, Tuple[int, float, Dict[str, Any], str]]" = OrderedDict()
_key_locks: Dict[Hashable, threading.Lock] = {}
_stats = {"hits": 0, "misses": 0, "waits": 0, "bumps": 0}


def is_enabled() -> bool:
    raw = (os.getenv("SAGRA_OS_SEARCH_CACHE") or "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _ttl_sec() -> float:
    try:
        return max(1.0, float(os.getenv("SAGRA_OS_SEARCH_CACHE_TTL_SEC", "15")))
    except (TypeError, ValueError):
        return 15.0


def make_key(params: Dict[str, Any]) -> Hashable:
    """Chave estável e hashável a partir dos parâmetros (listas viram tuplas)."""
    items = []
    for name in sorted(params):
        value = params[name]
        if isinstance(value, (list, tuple, set)):
            value = tuple(value)
        items.append((name, value))
    return tuple(items)


def bump_os_search_cache_version(reason: str = "") -> None:
    global _version
    with _lock:
        _version += 1
        _stats["bumps"] += 1
    logger.debug("os_search_cache: versão %s (%s)", _version, reason)


def _lookup(key: Hashable) -> Optional[Tuple[Dict[str, Any], str]]:
    now = time.monotonic()
    with _lock:
        entry = _entries.get(key)
        if entry is None:
            return None
        version, stored_at, result, etag = entry
        if version != _version or (now - stored_at) > _ttl_sec():
            _entries.pop(key, None)
            return None
        _entries.move_to_end(key)
        return result, etag


def _store(key: Hashable, version: int, result: Dict[str, Any], etag: str) -> None:
    with _lock:
        if version != _version:
            return  # houve alteração durante o cálculo — não guardar resultado velho
        _entries[key] = (version, time.monotonic(), result, etag)
        _entries.move_to_end(key)
        while len(_entries) > _MAX_ENTRIES:
            _entries.popitem(last=False)


def _key_lock(key: Hashable) -> threading.Lock:
    with _lock:
        lk = _key_locks.get(key)
        if lk is None:
            if len(_key_locks) > _MAX_ENTRIES * 4:
                # descarta locks ociosos para não crescer sem limite
                for k in [k for k, v in _key_locks.items() if not v.locked()]:
                    _key_locks.pop(k, None)
            lk = threading.Lock()
            _key_locks[key] = lk
        return lk


def get_or_compute(
    key: Hashable,
    compute: Callable[[], Dict[str, Any]],
    build_etag: Callable[[Dict[str, Any]], str],
) -> Tuple[Dict[str, Any], str, bool]:
    """
    Retorna (result, etag, from_cache). O ``result`` devolvido é compartilhado:
    quem chama não deve alterá-lo.
    """
    if not is_enabled():
        result = compute()
        return result, build_etag(result), False

    cached = _lookup(key)
    if cached is not None:
        with _lock:
            _stats["hits"] += 1
        return cached[0], cached[1], True

    lk = _key_lock(key)
    waited = lk.locked()
    with lk:
        cached = _lookup(key)
        if cached is not None:
            with _lock:
                _stats["hits"] += 1
                if waited:
                    _stats["waits"] += 1
            return cached[0], cached[1], True
        with _lock:
            version = _version
            _stats["misses"] += 1
        result = compute()
        etag = build_etag(result)
        _store(key, version, result, etag)
        return result, etag, False


def snapshot() -> Dict[str, Any]:
    with _lock:
        return {
            "enabled": is_enabled(),
            "version": _version,
            "entries": len(_entries),
            "ttl_sec": _ttl_sec(),
            **_stats,
        }


def clear_for_tests() -> None:
    global _version
    with _lock:
        _entries.clear()
        _key_locks.clear()
        _version = 0
        for k in _stats:
            _stats[k] = 0

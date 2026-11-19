"""Atividades em andamento por SP (Prova / Imposição), visíveis a todos os usuários.

Operações síncronas da papelaria (criar job, montar JDF da imposição, aprovar
prova e gerar a prévia do portal…) levam segundos antes de existir um job no
banco. Enquanto a requisição roda, a SP fica marcada aqui e todos os clientes
recebem ``papelaria_sp_activity`` pelo WebSocket — a lista de SPs mostra o
loading no item para quem estiver olhando, não só para quem clicou.

Produção roda um único processo Uvicorn, então o registro em memória é
compartilhado por todas as sessões. O TTL evita loading eterno se algo travar.
"""
from __future__ import annotations

import itertools
import logging
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterable, Iterator, Optional

logger = logging.getLogger(__name__)

LANES = ("prova", "imposicao")
ACTIVITY_TTL_SECONDS = 15 * 60

_lock = threading.Lock()
_seq = itertools.count(1)
# token -> {ano, nro, lane, label, ponto, since}
_active: dict[int, dict[str, Any]] = {}


def _sp_key(ano: int, nro: int) -> str:
    return f"{int(ano)}-{int(nro)}"


def _broadcast(ano: int, nro: int, lane: str, active: bool) -> None:
    try:
        from routers.realtime import schedule_broadcast

        schedule_broadcast(
            {
                "type": "papelaria_sp_activity",
                "ano": int(ano),
                "nro": int(nro),
                "lane": lane,
                "active": bool(active),
            }
        )
    except Exception as exc:  # pragma: no cover - WS indisponível em testes
        logger.debug("Falha ao emitir papelaria_sp_activity: %s", exc)


def _invalidate_status_cache(ano: int, nro: int) -> None:
    try:
        from services.papelaria_sp_status_service import invalidate_folder_signals

        invalidate_folder_signals(ano, nro)
    except Exception:  # pragma: no cover
        pass


def begin_activity(
    ano: int,
    nro: int,
    lane: str,
    label: str,
    ponto: str = "",
) -> int:
    if lane not in LANES:
        raise ValueError(f"Lane inválida: {lane}")
    token = next(_seq)
    with _lock:
        _active[token] = {
            "ano": int(ano),
            "nro": int(nro),
            "lane": lane,
            "label": (label or "").strip(),
            "ponto": (ponto or "").strip(),
            "since": time.time(),
        }
    _broadcast(ano, nro, lane, True)
    return token


def end_activity(token: int) -> None:
    with _lock:
        info = _active.pop(token, None)
    if not info:
        return
    _invalidate_status_cache(info["ano"], info["nro"])
    _broadcast(info["ano"], info["nro"], info["lane"], False)


@contextmanager
def sp_activity(
    targets: Iterable[tuple[int, int]],
    lane: str,
    label: str,
    ponto: str = "",
) -> Iterator[None]:
    """Marca as SPs ``targets`` como «processando» durante o bloco."""
    tokens: list[int] = []
    seen: set[str] = set()
    try:
        for ano, nro in targets:
            key = _sp_key(ano, nro)
            if key in seen:
                continue
            seen.add(key)
            tokens.append(begin_activity(ano, nro, lane, label, ponto))
        yield
    finally:
        for token in tokens:
            end_activity(token)


def _prune_expired(now: Optional[float] = None) -> None:
    limit = (now or time.time()) - ACTIVITY_TTL_SECONDS
    expired = [t for t, info in _active.items() if info["since"] < limit]
    for token in expired:
        _active.pop(token, None)


def snapshot(
    pairs: Optional[Iterable[tuple[int, int]]] = None,
) -> dict[str, dict[str, dict[str, Any]]]:
    """``{"ano-nro": {lane: {label, ponto, since}}}`` (mais recente por lane)."""
    wanted = None if pairs is None else {_sp_key(a, n) for a, n in pairs}
    out: dict[str, dict[str, dict[str, Any]]] = {}
    with _lock:
        _prune_expired()
        items = list(_active.values())
    for info in items:
        key = _sp_key(info["ano"], info["nro"])
        if wanted is not None and key not in wanted:
            continue
        lanes = out.setdefault(key, {})
        cur = lanes.get(info["lane"])
        if cur is None or info["since"] > cur["since"]:
            lanes[info["lane"]] = {
                "label": info["label"],
                "ponto": info["ponto"],
                "since": info["since"],
            }
    return out


def reset_for_tests() -> None:
    with _lock:
        _active.clear()

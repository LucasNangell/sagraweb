"""Atualiza materialização da busca — delega para after_andamento_changed."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def refresh_materialized_os_operacional(nro: int, ano: int) -> None:
    """Recalcula tab_os_ultimo_andamento_operacional (sem WebSocket)."""
    if not nro or not ano:
        return
    from services.os_andamento_post_change_service import after_andamento_changed

    after_andamento_changed(
        nro,
        ano,
        "materialized_refresh",
        source="refresh_materialized_os_operacional",
        notify=False,
    )

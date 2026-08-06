"""
Atualização central das fontes MySQL da lista home (/api/os/search).

Ordem obrigatória:
1. tabAndamento/tabandamento consistente (via refresh materializada)
2. tab_os_ultimo_andamento_operacional
3. tab_os_filter_* (incremental)
4. WebSocket (somente após 1–3)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_LOG_PREFIX = "[OS HOME SOURCE]"
_WS_PREFIX = "[OS HOME WS]"


def refresh_home_os_sources(
    nro: int,
    ano: int,
    action: str,
    *,
    source: str = "unknown",
    codstatus: str | int | None = None,
    notify: bool = True,
    setor: str | None = None,
    situacao: str | None = None,
    sub_os_id: int | None = None,
    scope: str | None = None,
    cursor=None,
    refresh_filter_options: bool = True,
) -> Dict[str, Any]:
    """Ponto único pós-alteração relevante à lista home."""
    result: Dict[str, Any] = {
        "nro": nro,
        "ano": ano,
        "action": action,
        "source": source,
        "notified": False,
    }
    if not nro or not ano:
        return result

    cod_label = str(codstatus) if codstatus is not None else "-"
    logger.info(
        "%s START os=%s/%s action=%s codstatus=%s source=%s",
        _LOG_PREFIX,
        nro,
        ano,
        action,
        cod_label,
        source,
    )

    try:
        from services.andamento_table import get_andamento_table
        from services.os_ultimo_andamento_service import (
            fetch_materialized_operacional_row,
            fetch_operacional_row,
            refresh_os_ultimo_andamento_operacional,
        )

        prev_row = fetch_materialized_operacional_row(nro, ano, cursor=cursor)
        prev_setor = (prev_row or {}).get("setor") if prev_row else None
        prev_situacao = (prev_row or {}).get("situacao") if prev_row else None

        refresh_os_ultimo_andamento_operacional(nro, ano, cursor=cursor)
        live = fetch_operacional_row(nro, ano, cursor=cursor)
        if live:
            result.update(
                {
                    "situacao": live.get("situacao"),
                    "setor": live.get("setor"),
                    "cod_status": live.get("cod_status"),
                    "andamento_table": get_andamento_table(),
                    "prev_setor": prev_setor,
                    "prev_situacao": prev_situacao,
                }
            )
            logger.info(
                '%s OK os=%s/%s situacao="%s" setor="%s"',
                _LOG_PREFIX,
                nro,
                ano,
                live.get("situacao") or "",
                live.get("setor") or "",
            )
        else:
            result["cleared"] = True
            result["prev_setor"] = prev_setor
            result["prev_situacao"] = prev_situacao
            logger.info(
                "%s OK os=%s/%s (sem andamento operacional — linha removida da materializada)",
                _LOG_PREFIX,
                nro,
                ano,
            )
    except Exception as exc:
        logger.error(
            "%s ERROR os=%s/%s action=%s source=%s erro=%s",
            _LOG_PREFIX,
            nro,
            ano,
            action,
            source,
            exc,
            exc_info=True,
        )
        result["error"] = str(exc)
        return result

    if refresh_filter_options:
        if cursor is not None:
            try:
                from services.os_filter_options_service import upsert_filter_options_for_os

                upsert_filter_options_for_os(nro, ano, cursor=cursor)
                result["filter_options_refreshed"] = True
            except Exception as exc:
                logger.warning(
                    "Falha ao atualizar filtros auxiliares OS %s/%s: %s",
                    nro,
                    ano,
                    exc,
                )
                result["filter_options_error"] = str(exc)
        else:
            import threading

            def _deferred_filter_upsert() -> None:
                try:
                    from services.os_filter_options_service import upsert_filter_options_for_os

                    upsert_filter_options_for_os(nro, ano)
                except Exception as exc:
                    logger.warning(
                        "Falha ao atualizar filtros auxiliares OS %s/%s (background): %s",
                        nro,
                        ano,
                        exc,
                    )

            threading.Thread(
                target=_deferred_filter_upsert,
                daemon=True,
                name=f"os-filter-{nro}-{ano}",
            ).start()
            result["filter_options_refreshed"] = "deferred"

    if not notify:
        return result

    try:
        from routers.pcp_routes import invalidate_pcp_queue_cache

        invalidate_pcp_queue_cache(setor or result.get("setor"))
    except Exception as exc:
        logger.warning("Falha ao invalidar cache PCP: %s", exc)

    try:
        from routers.realtime import schedule_broadcast

        payload: Dict[str, Any] = {
            "type": "system_update",
            "id": nro,
            "ano": ano,
            "action": action,
            "origem": source,
        }
        eff_setor = setor or result.get("setor")
        eff_situacao = situacao or result.get("situacao")
        if eff_setor:
            payload["setor"] = eff_setor
        if eff_situacao:
            payload["situacao"] = eff_situacao
        if sub_os_id is not None:
            payload["sub_os_id"] = sub_os_id
        if scope:
            payload["scope"] = scope

        schedule_broadcast(payload)
        result["notified"] = True
        logger.info(
            "%s EMIT system_update os=%s/%s action=%s source=%s",
            _WS_PREFIX,
            nro,
            ano,
            action,
            source,
        )
    except Exception as exc:
        logger.error(
            "%s ERROR os=%s/%s action=%s erro=%s",
            _WS_PREFIX,
            nro,
            ano,
            action,
            exc,
            exc_info=True,
        )
        result["ws_error"] = str(exc)

    eff_situacao = situacao or result.get("situacao")
    eff_setor = setor or result.get("setor")
    if eff_situacao or eff_setor or action in ("add", "update", "delete"):
        import threading

        def _dispatch_watch_andamento() -> None:
            try:
                from services.os_notificacao_dispatch_service import (
                    dispatch_andamento_notifications,
                )

                dispatch_andamento_notifications(
                    nro=nro,
                    ano=ano,
                    situacao=eff_situacao,
                    setor=eff_setor,
                    action=action,
                )
            except Exception as dispatch_exc:
                logger.warning(
                    "Falha ao notificar watchers de andamento OS %s/%s: %s",
                    nro,
                    ano,
                    dispatch_exc,
                )

        threading.Thread(
            target=_dispatch_watch_andamento,
            daemon=True,
            name=f"os-watch-and-{nro}-{ano}",
        ).start()

        prev_setor = result.get("prev_setor")
        prev_situacao = result.get("prev_situacao")

        def _dispatch_painel_tablet_push() -> None:
            try:
                from services.painel_tablet_push_service import (
                    dispatch_painel_tablet_sector_push,
                )

                dispatch_painel_tablet_sector_push(
                    nro=nro,
                    ano=ano,
                    prev_setor=prev_setor if isinstance(prev_setor, str) or prev_setor is None else str(prev_setor),
                    new_setor=eff_setor,
                    prev_situacao=prev_situacao if isinstance(prev_situacao, str) or prev_situacao is None else str(prev_situacao),
                    new_situacao=eff_situacao,
                )
            except Exception as dispatch_exc:
                logger.warning(
                    "Falha ao notificar painel tablet OS %s/%s: %s",
                    nro,
                    ano,
                    dispatch_exc,
                )

        threading.Thread(
            target=_dispatch_painel_tablet_push,
            daemon=True,
            name=f"painel-tablet-push-{nro}-{ano}",
        ).start()

    return result

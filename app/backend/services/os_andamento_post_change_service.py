"""

Pós-alteração em tabAndamento — refresh da materializada + WebSocket.



Qualquer alteração em tabAndamento deve chamar after_andamento_changed (ou refresh_home_os_sources).

"""

from __future__ import annotations



import logging

from typing import Any, Dict, Optional



logger = logging.getLogger(__name__)



_WS_PREFIX = "[OS HOME WS]"





def after_andamento_changed(

    nro: int,

    ano: int,

    action: str,

    *,

    codstatus: str | int | None = None,

    source: str = "unknown",

    notify: bool = True,

    setor: str | None = None,

    situacao: str | None = None,

    sub_os_id: int | None = None,

    scope: str | None = None,

    cursor=None,

) -> Dict[str, Any]:

    """Wrapper retrocompatível — delega para refresh_home_os_sources."""

    from services.os_home_source_service import refresh_home_os_sources



    return refresh_home_os_sources(

        nro,

        ano,

        action,

        source=source,

        codstatus=codstatus,

        notify=notify,

        setor=setor,

        situacao=situacao,

        sub_os_id=sub_os_id,

        scope=scope,

        cursor=cursor,

        refresh_filter_options=True,

    )





def emit_force_refresh_home(*, reason: str = "reconcile", count: int = 0) -> None:

    """Broadcast consolidado quando muitas OSs foram reconciliadas de uma vez."""

    try:

        from routers.realtime import schedule_broadcast



        schedule_broadcast(

            {

                "type": "force_refresh",

                "scope": "os_search",

                "reason": reason,

                "count": count,

            }

        )

        logger.info(

            "%s EMIT force_refresh reason=%s count=%s",

            _WS_PREFIX,

            reason,

            count,

        )

    except Exception as exc:

        logger.warning("Falha ao emitir force_refresh: %s", exc)



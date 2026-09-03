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



    result = refresh_home_os_sources(

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

    try:
        from services.os_fluxo_producao_service import invalidate_fluxo_producao_cache

        invalidate_fluxo_producao_cache(ano, nro)
    except Exception:
        logger.debug("Falha ao invalidar cache de fluxo de produção", exc_info=True)

    _maybe_aprender_orcamento(nro, ano, situacao or result.get("situacao"), cursor=cursor)

    return result


def _maybe_aprender_orcamento(

    nro: int,

    ano: int,

    situacao: str | None,

    *,

    cursor=None,

) -> None:

    """Na Entregue, grava realizado/aprendizado sem falhar o andamento.

    Se o cursor da transação ainda estiver aberto, adia — o notify pós-commit cobre,
    e a página de orçamento recalcula se a linha ainda não existir.
    """

    if cursor is not None:

        return

    if (situacao or "").strip().casefold() != "entregue":

        return

    try:

        from services.orcamento_realizado_service import on_os_entregue

        on_os_entregue(nro, ano)

    except Exception:

        logger.exception("Orçamento: aprendizado na entrega falhou OS %s/%s", nro, ano)





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



"""Web Push quando uma OS entra no setor inscrito do Painel OS (tablet)."""
from __future__ import annotations

import logging
from typing import Any

from services.painel_tablet_push_pref_service import list_pontos_for_setores
from services.web_push_service import send_web_push_to_ponto

logger = logging.getLogger(__name__)

_GRAVACAO_SITUACOES = frozenset({"Gravação", "Gravação Parcial"})


def _norm(value: str | None) -> str:
    return (value or "").strip()


def is_gravacao_situacao(situacao: str | None) -> bool:
    return _norm(situacao) in _GRAVACAO_SITUACOES


def resolve_entered_setores(
    *,
    prev_setor: str | None,
    new_setor: str | None,
    prev_situacao: str | None,
    new_situacao: str | None,
) -> list[str]:
    """Setores que a OS acabou de passar a pertencer (regra do quadro tablet)."""
    entered: list[str] = []
    prev_s = _norm(prev_setor)
    new_s = _norm(new_setor)
    if new_s and new_s != prev_s:
        entered.append(new_s)

    was_grav = is_gravacao_situacao(prev_situacao)
    now_grav = is_gravacao_situacao(new_situacao)
    if now_grav and not was_grav:
        if "Gravação" not in entered:
            entered.append("Gravação")

    return entered


def format_os_push_title(nro: int, ano: int) -> str:
    return f"OS {int(nro)}/{int(ano) % 100:02d}"


def _tablet_url() -> str:
    try:
        from config_manager import config_manager

        base = config_manager.get_public_web_base().rstrip("/")
        return f"{base}/painel/tablet"
    except Exception:
        return "/painel/tablet"


def dispatch_painel_tablet_sector_push(
    *,
    nro: int,
    ano: int,
    prev_setor: str | None,
    new_setor: str | None,
    prev_situacao: str | None,
    new_situacao: str | None,
) -> dict[str, Any]:
    """Envia Web Push aos pontos com preferência ativa nos setores recém-entrados."""
    result: dict[str, Any] = {"entered": [], "pontos": [], "sent": 0}
    entered = resolve_entered_setores(
        prev_setor=prev_setor,
        new_setor=new_setor,
        prev_situacao=prev_situacao,
        new_situacao=new_situacao,
    )
    result["entered"] = entered
    if not entered:
        return result

    pontos = list_pontos_for_setores(entered)
    result["pontos"] = pontos
    if not pontos:
        return result

    title = format_os_push_title(nro, ano)
    body = _norm(new_situacao) or "Nova no setor"
    url = _tablet_url()
    tag = f"painel-tablet-{nro}-{ano}"
    sent_total = 0
    for ponto in pontos:
        try:
            sent_total += send_web_push_to_ponto(
                ponto=ponto,
                title=title,
                body=body,
                url=url,
                tag=tag,
                nro=nro,
                ano=ano,
            )
        except Exception as exc:
            logger.warning(
                "Falha Web Push painel tablet ponto=%s OS %s/%s: %s",
                ponto,
                nro,
                ano,
                exc,
            )
    result["sent"] = sent_total
    return result

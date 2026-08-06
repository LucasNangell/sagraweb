"""Normalização de Ponto para WebSocket / chat de suporte."""
from __future__ import annotations


def normalize_ponto(value: str | int | None) -> str:
    """Retorna string trimada (identificador bruto)."""
    if value is None:
        return ""
    return str(value).strip()


def normalize_ponto_digits(value: str | int | None) -> str:
    """Retorna apenas dígitos — comparação principal owner/subscribe."""
    return "".join(c for c in normalize_ponto(value) if c.isdigit())


def ponto_matches(a: str | int | None, b: str | int | None) -> bool:
    """True se pontos representam o mesmo usuário."""
    if a is None or b is None:
        return False
    da = normalize_ponto_digits(a)
    db = normalize_ponto_digits(b)
    if da and db:
        return da == db
    return normalize_ponto(a) == normalize_ponto(b)


def extract_support_ticket_id(payload: dict) -> int | None:
    """Extrai ticket_id de payloads WS heterogêneos."""
    if not isinstance(payload, dict):
        return None
    nested = payload.get("payload")
    nested_dict = nested if isinstance(nested, dict) else {}
    raw = (
        payload.get("ticket_id")
        or payload.get("ticketId")
        or payload.get("ticket")
        or nested_dict.get("ticket_id")
        or nested_dict.get("ticketId")
    )
    if raw is None:
        return None
    try:
        tid = int(raw)
    except (TypeError, ValueError):
        return None
    return tid if tid > 0 else None

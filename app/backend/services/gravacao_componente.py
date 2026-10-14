"""Valores e formatação do componente enviado para gravação externa."""
from __future__ import annotations

from typing import Any

COMPONENTE_TODOS = "todos"
COMPONENTE_CAPA = "capa"
COMPONENTE_MIOLO = "miolo"
COMPONENTES_VALIDOS = frozenset(
    {COMPONENTE_TODOS, COMPONENTE_CAPA, COMPONENTE_MIOLO}
)


def normalize_gravacao_componente(value: Any) -> str:
    componente = str(value or COMPONENTE_TODOS).strip().lower()
    if componente not in COMPONENTES_VALIDOS:
        raise ValueError("Componente inválido. Use todos, capa ou miolo.")
    return componente


def normalize_stored_gravacao_componente(value: Any) -> str:
    """Lê dados persistidos legados sem derrubar listas por valor ausente/inválido."""
    if not isinstance(value, str):
        return COMPONENTE_TODOS
    componente = value.strip().lower()
    return componente if componente in COMPONENTES_VALIDOS else COMPONENTE_TODOS


def gravacao_componente_label(value: Any) -> str:
    componente = normalize_gravacao_componente(value)
    return {
        COMPONENTE_TODOS: "Todos os componentes",
        COMPONENTE_CAPA: "Capa",
        COMPONENTE_MIOLO: "Miolo",
    }[componente]


def with_gravacao_componente_obs_prefix(obs_body: str, componente: Any) -> str:
    """Identifica Capa/Miolo na primeira linha do corpo do andamento."""
    normalized = normalize_gravacao_componente(componente)
    body = str(obs_body or "")
    if normalized == COMPONENTE_TODOS:
        return body
    line = f"Componente: {gravacao_componente_label(normalized)}"
    return f"{line}\n\n{body}" if body else line

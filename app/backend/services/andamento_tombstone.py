"""Hash canônico de conteúdo de andamento para tombstones (deleted_andamentos).

UltimoStatus é flag operacional e NÃO entra no hash — evita falso "reuso legítimo"
quando o flag diverge entre MySQL e MDB após exclusão/heal.
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime
from typing import Any, Mapping, Optional


def _normalize_data(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(text, fmt)
            if " " in fmt:
                return dt.replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return text


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def calculate_andamento_content_hash(andamento: Optional[Mapping[str, Any]]) -> str:
    """SHA-256 do payload de negócio (sem CodStatus / Nro / Ano / UltimoStatus)."""
    row = andamento or {}
    content_fields = [
        _normalize_text(row.get("SituacaoLink", "")),
        _normalize_text(row.get("SetorLink", "")),
        _normalize_data(row.get("Data", "")),
        _normalize_text(row.get("Observaçao", "")),
        _normalize_text(row.get("Ponto", "")),
    ]
    content_str = "|".join(content_fields)
    return hashlib.sha256(content_str.encode("utf-8")).hexdigest()

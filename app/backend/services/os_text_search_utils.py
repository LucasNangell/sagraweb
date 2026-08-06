"""
Normalização de termos para busca FULLTEXT (BOOLEAN MODE) na lista de OSs.
"""
from __future__ import annotations

import logging
import re
from typing import List, Optional

logger = logging.getLogger(__name__)

OS_TEXT_SEARCH_MIN_CHARS = 3

# Caracteres especiais do modo booleano MySQL FULLTEXT.
_FT_SPECIAL_RE = re.compile(r"[+\-><()~*\"@]+")

# Stopwords comuns em português (evita tokens vazios no boolean mode).
_FT_STOPWORDS = frozenset(
    {
        "a",
        "o",
        "os",
        "as",
        "de",
        "da",
        "do",
        "das",
        "dos",
        "e",
        "em",
        "para",
        "por",
        "com",
        "um",
        "uma",
    }
)


def normalize_text_search_term(value: Optional[str]) -> Optional[str]:
    """Trim e colapsa espaços; retorna None se vazio."""
    if not value:
        return None
    collapsed = " ".join(str(value).strip().split())
    return collapsed or None


def is_text_search_term_too_short(
    term: Optional[str],
    *,
    has_nr_os: bool = False,
    has_ano: bool = False,
) -> bool:
    """Termo com menos de 3 caracteres (salvo nr_os como âncora).

    ``has_ano`` permanece na assinatura por compatibilidade, mas não libera
    o mínimo — o ano default da home não deve disparar FULLTEXT em 1–2 chars.
    """
    del has_ano  # não é âncora de tamanho mínimo
    normalized = normalize_text_search_term(term)
    if not normalized:
        return False
    if has_nr_os:
        return False
    return len(normalized) < OS_TEXT_SEARCH_MIN_CHARS


def parse_text_search_term(
    value: Optional[str],
    *,
    has_nr_os: bool = False,
    has_ano: bool = False,
) -> Optional[str]:
    """
    Retorna termo utilizável na busca ou None se vazio/curto demais.
    Compatível com _os_search_like_term legado.
    """
    del has_ano  # não é âncora de tamanho mínimo
    normalized = normalize_text_search_term(value)
    if not normalized:
        return None
    if len(normalized) < OS_TEXT_SEARCH_MIN_CHARS and not has_nr_os:
        return None
    return normalized


def build_fulltext_boolean_query(term: str) -> Optional[str]:
    """
    Converte texto livre em query BOOLEAN MODE segura.
    Ex.: "cartao visita" -> "+cartao* +visita*"
    """
    normalized = normalize_text_search_term(term)
    if not normalized:
        return None

    tokens: List[str] = []
    for raw in normalized.split():
        cleaned = _FT_SPECIAL_RE.sub("", raw)
        if not cleaned:
            continue
        lower = cleaned.lower()
        if lower in _FT_STOPWORDS:
            continue
        if len(cleaned) < OS_TEXT_SEARCH_MIN_CHARS:
            tokens.append(f"+{cleaned}*")
        else:
            tokens.append(f"+{cleaned}*")

    if not tokens:
        return None
    return " ".join(tokens)


def build_solicitante_prefix_pattern(term: str) -> str:
    """Fallback indexável: LIKE 'termo%' (não '%termo%')."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%"

"""Interpretação do campo Pags e acabamento da OS."""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

_ACABAMENTO_COM_CAPA = re.compile(
    r"lombada|grampo\s*canoa|capa\s*dura|brochur|livret|livro|encadern",
    re.IGNORECASE,
)
_PAGS_PLUS = re.compile(r"(\d+)\s*\+\s*(\d+)")
_PAGS_CAPA_MIOLO_TEXT = re.compile(
    r"(\d+)\s*(?:p[aá]g(?:s|inas?)?\.?\s*)?(?:de\s+)?capa.*?(?:\+|e)\s*(\d+)",
    re.IGNORECASE,
)


def parse_pags_field(pags: Optional[str]) -> Dict[str, Any]:
    raw = str(pags or "").strip()
    if not raw:
        return {
            "raw": raw,
            "total_declared": None,
            "capa_declared": None,
            "miolo_declared": None,
            "expects_capa_miolo": False,
        }

    m = _PAGS_PLUS.search(raw)
    if m:
        capa, miolo = int(m.group(1)), int(m.group(2))
        return {
            "raw": raw,
            "total_declared": capa + miolo,
            "capa_declared": capa,
            "miolo_declared": miolo,
            "expects_capa_miolo": True,
        }

    m2 = _PAGS_CAPA_MIOLO_TEXT.search(raw)
    if m2:
        capa, miolo = int(m2.group(1)), int(m2.group(2))
        return {
            "raw": raw,
            "total_declared": capa + miolo,
            "capa_declared": capa,
            "miolo_declared": miolo,
            "expects_capa_miolo": True,
        }

    if re.search(r"\bcapa\b", raw, re.IGNORECASE):
        numbers = [int(x) for x in re.findall(r"\d+", raw)]
        capa = numbers[0] if numbers else 4
        miolo = numbers[1] if len(numbers) > 1 else None
        total = sum(numbers) if numbers else None
        return {
            "raw": raw,
            "total_declared": total,
            "capa_declared": capa,
            "miolo_declared": miolo,
            "expects_capa_miolo": True,
        }

    digits = re.findall(r"\d+", raw)
    total = int(digits[0]) if digits else None
    return {
        "raw": raw,
        "total_declared": total,
        "capa_declared": None,
        "miolo_declared": None,
        "expects_capa_miolo": False,
    }


def expects_capa_miolo_separate(os_details: Dict[str, Any]) -> bool:
    pags_info = parse_pags_field(os_details.get("Pags"))
    if pags_info.get("expects_capa_miolo"):
        return True
    acab = str(os_details.get("DescAcabamento") or "")
    if _ACABAMENTO_COM_CAPA.search(acab):
        return True
    produto = str(os_details.get("TipoPublicacaoLink") or "")
    if re.search(r"livro|brochur|revista|publica", produto, re.IGNORECASE):
        return True
    return False


def is_grampo_canoa(os_details: Dict[str, Any]) -> bool:
    acab = str(os_details.get("DescAcabamento") or "")
    return bool(re.search(r"grampo\s*canoa", acab, re.IGNORECASE))


_LOMBADA_MM = re.compile(
    r"lombada(?:\s+de)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*mm",
    re.IGNORECASE,
)


def parse_lombada_mm_from_acabamento(desc_acabamento: Optional[str]) -> Optional[float]:
    """Ex.: 'Lombada de 21mm' → 21.0"""
    text = str(desc_acabamento or "").strip()
    if not text:
        return None
    match = _LOMBADA_MM.search(text)
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", "."))
    except ValueError:
        return None


def produto_com_capa(os_details: Dict[str, Any]) -> bool:
    """
    Produtos que costumam ter arquivo de capa separado (livro, livreto/revista com capa, etc.).
    """
    produto = str(os_details.get("TipoPublicacaoLink") or "").strip()
    if produto:
        pl = produto.lower()
        if re.search(r"\blivro\b", pl):
            return True
        if re.search(r"brochur|encadern", pl, re.IGNORECASE):
            return True
        if re.search(r"livreto|revista", pl, re.IGNORECASE):
            return bool(
                re.search(r"capa|c/\s*capa|com\s+capa", pl, re.IGNORECASE)
            )
    return expects_capa_miolo_separate(os_details)


def os_especifica_lombada(os_details: Dict[str, Any]) -> bool:
    acab = str(os_details.get("DescAcabamento") or "")
    return bool(re.search(r"lombada", acab, re.IGNORECASE))


def lombada_esperada_mm(os_details: Dict[str, Any]) -> Optional[float]:
    """Medida da lombada na OS (DescAcabamento), se informada."""
    return parse_lombada_mm_from_acabamento(os_details.get("DescAcabamento"))

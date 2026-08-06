"""
Resolve altura/largura (mm) a partir do nome do formato.

Convenção do sistema (coeficiente A4): altura × largura — ex. A4 → 210 × 297.
"""
from __future__ import annotations

import re
from typing import Optional, Tuple

# Chaves em maiúsculas para comparação
ISO_FORMATOS_MM = {
    "A2": (420.0, 594.0),
    "A3": (297.0, 420.0),
    "A4": (210.0, 297.0),
    "A4 PAISAGEM": (297.0, 210.0),
    "A5": (148.0, 210.0),
    "A6": (105.0, 148.0),
}

# Aceita unidades opcionais coladas ao número (ex.: 50mmx50mm, 210mm x 297mm).
_DIM_PATTERN = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m)?\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m)?",
    re.IGNORECASE,
)

_ISO_SUFFIX_ORDER = ("A6", "A5", "A4", "A3", "A2")


def resolve_formato_dimensions(formato: Optional[str]) -> Optional[Tuple[float, float]]:
    """Retorna (altura_mm, largura_mm) ou None se o formato não for reconhecido."""
    if not formato or not str(formato).strip():
        return None

    text = str(formato).strip()
    upper = text.upper()

    if upper in ISO_FORMATOS_MM:
        return ISO_FORMATOS_MM[upper]

    match = _DIM_PATTERN.search(text)
    if match:
        altura = float(match.group(1).replace(",", "."))
        largura = float(match.group(2).replace(",", "."))
        if altura > 0 and largura > 0:
            return (altura, largura)

    if re.search(r"\bA4\s+PAISAGEM\b", upper):
        return ISO_FORMATOS_MM["A4 PAISAGEM"]

    for iso in _ISO_SUFFIX_ORDER:
        if re.search(rf"\b{iso}\b", upper):
            return ISO_FORMATOS_MM[iso]

    return None

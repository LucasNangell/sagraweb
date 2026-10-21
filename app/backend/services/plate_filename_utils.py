"""Parser de nomenclatura de arquivos TIF de chapa (CMYK + Cad + Pantone)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

PlateColor = Literal["C", "M", "Y", "K"]
PlateChannelKind = Literal["cmyk", "pantone"]

PLATE_CHANNEL_SUFFIX = re.compile(r"\s*\(([^)]+)\)\.tiff?$", re.IGNORECASE)
# Kept for callers that still import the CMYK-only pattern name.
PLATE_COLOR_SUFFIX = re.compile(r"\s*\(([CMYK])\)\.tiff?$", re.IGNORECASE)
CHAPA_LABEL_RE = re.compile(r"\((Cad\s+\d+\s+[A-Z])\)", re.IGNORECASE)
CADERNO_PARTS_RE = re.compile(r"^Cad\s+(\d+)\s+([A-Z])$", re.IGNORECASE)
CADERNO_UNTIL_MAX = 99

PLATE_CHANNEL_RGB: dict[str, tuple[int, int, int]] = {
    "C": (0, 174, 239),
    "M": (236, 0, 140),
    "Y": (255, 242, 0),
    "K": (30, 30, 30),
}


@dataclass(frozen=True)
class ParsedPlateFilename:
    color: str | None
    kind: str | None
    chapa_label: str | None
    group_key: str | None
    channel_token: str | None = None


def _is_cmyk_token(token: str) -> bool:
    return token.upper() in {"C", "M", "Y", "K"}


def _is_cad_label_token(token: str) -> bool:
    return bool(re.fullmatch(r"Cad\s+\d+\s+[A-Z]", token.strip(), re.IGNORECASE))


def parse_plate_color_from_filename(name: str) -> str | None:
    match = PLATE_CHANNEL_SUFFIX.search(name.strip())
    if not match:
        return None
    token = match.group(1).strip()
    if not _is_cmyk_token(token):
        return None
    return token.upper()


def parse_chapa_label_from_filename(name: str) -> str | None:
    match = CHAPA_LABEL_RE.search(name.strip())
    if not match:
        return None
    return match.group(1)


def parse_plate_filename(name: str) -> ParsedPlateFilename:
    trimmed = name.strip()
    match = PLATE_CHANNEL_SUFFIX.search(trimmed)
    chapa_label = parse_chapa_label_from_filename(trimmed)
    if not match:
        return ParsedPlateFilename(
            color=None,
            kind=None,
            chapa_label=chapa_label,
            group_key=None,
            channel_token=None,
        )

    token = match.group(1).strip()
    # Last paren is the Cad label itself — no color channel.
    if _is_cad_label_token(token):
        return ParsedPlateFilename(
            color=None,
            kind=None,
            chapa_label=chapa_label,
            group_key=None,
            channel_token=None,
        )

    group_key = PLATE_CHANNEL_SUFFIX.sub("", trimmed).strip() or None

    if _is_cmyk_token(token):
        return ParsedPlateFilename(
            color=token.upper(),
            kind="cmyk",
            chapa_label=chapa_label,
            group_key=group_key,
            channel_token=token,
        )

    return ParsedPlateFilename(
        color=None,
        kind="pantone",
        chapa_label=chapa_label,
        group_key=group_key,
        channel_token=token,
    )


def _is_tiff_filename(name: str) -> bool:
    lower = name.strip().lower()
    return lower.endswith(".tif") or lower.endswith(".tiff")


def caderno_number_from_filename(name: str) -> int | None:
    """Número do caderno em TIF `...(Cad N A|B)...`, ou None."""
    if not _is_tiff_filename(name):
        return None
    label = parse_chapa_label_from_filename(name)
    if not label:
        return None
    match = CADERNO_PARTS_RE.match(label.strip())
    if not match:
        return None
    number = int(match.group(1))
    if number < 1:
        return None
    return number


def caderno_until_from_filenames(names: list[str] | tuple[str, ...]) -> int | None:
    """Maior Cad N nos TIFFs; None se nenhum arquivo tiver caderno no nome."""
    numbers = [
        n
        for n in (caderno_number_from_filename(name) for name in names)
        if n is not None
    ]
    if not numbers:
        return None
    return min(max(numbers), CADERNO_UNTIL_MAX)

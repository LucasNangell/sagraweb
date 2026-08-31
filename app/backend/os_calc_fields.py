"""
Campos Calc* e TiragemSolicitada para tabDetalhesServico (MySQL e réplica MDB).

Regras de negócio:
- CalcPgs1..3: coeficiente A4 arredondado (inteiro), por componente CAPA / MIOLO / ENCARTE.
- CalcQtdCores1..3: 1 (PB) ou 4 (policromia), conforme o componente.
- CalcCor1..3: texto de cores do componente (tech spec ou CoresDescricao).
- TiragemSolicitada: tiragem pretendida (campo op_tiragem_pret / TiragemSolicitada).
"""
from __future__ import annotations

import math
import re
from typing import Any, Dict, Optional

COMPONENT_SLOT_ORDER = ("CAPA", "MIOLO", "ENCARTE")
_COMPONENT_LABELS = {
    "CAPA": ("Capa", "capa"),
    "MIOLO": ("Miolo", "miolo"),
    "ENCARTE": ("Encarte", "encarte"),
}
_CORES_XY_RE = re.compile(r"(\d)\s*[xX×/]\s*(\d)")


def _to_float(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip().replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


PAPELARIA_OS_MIN = 5000


def is_papelaria_os(nro: int) -> bool:
    return int(nro) >= PAPELARIA_OS_MIN


def cota_protocolo_column(nro: int) -> str:
    """Coluna de cota estimada em tabProtocolos (OS e SP usam CotaRepro)."""
    return "CotaRepro"


def parse_cota_repro_value(value: Any) -> Optional[int]:
    """Converte Cota Estimada (decimal) para inteiro (CotaRepro)."""
    if value is None or value == "":
        return None
    try:
        normalized = str(value).strip().replace(",", ".")
        return int(math.ceil(float(normalized)))
    except (TypeError, ValueError):
        return None


def cota_repro_from_calculos(calculos: Any) -> Optional[int]:
    if calculos is None:
        return None
    cal: Dict[str, Any] = {}
    if hasattr(calculos, "model_dump"):
        cal = calculos.model_dump()
    elif isinstance(calculos, dict):
        cal = calculos
    return parse_cota_repro_value(cal.get("cota_total"))


def _to_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        n = int(float(str(value).strip().replace(",", ".")))
        return n
    except (TypeError, ValueError):
        return None


def calculate_coef_a4(altura_mm: Any, largura_mm: Any) -> float:
    """Coeficiente A4 = área A4 / área do formato (mm²)."""
    area_a4 = 210 * 297
    h = _to_float(altura_mm)
    w = _to_float(largura_mm)
    area_prod = h * w
    if area_prod <= 0:
        return 0.0
    return area_a4 / area_prod


def parse_impressao(cores: Optional[str]) -> Optional[tuple[int, int]]:
    if not cores or not str(cores).strip():
        return None
    match = _CORES_XY_RE.search(str(cores).replace(" ", ""))
    if not match:
        return None
    frente, verso = int(match.group(1)), int(match.group(2))
    if frente < 1 or frente > 4 or verso < 0 or verso > 4:
        return None
    return frente, verso


def printed_pages_for_cota(
    pages: int,
    *,
    impressao: Optional[str] = None,
    cores_link: Optional[str] = None,
    verso_em_branco: bool = False,
) -> int:
    pages = max(0, int(pages or 0))
    parsed = parse_impressao(impressao)
    if parsed is not None:
        return math.ceil(pages / 2) if parsed[1] == 0 else pages
    if verso_em_branco:
        return math.ceil(pages / 2)
    parsed_cores = parse_impressao(cores_link)
    if parsed_cores is not None and parsed_cores[1] == 0:
        return math.ceil(pages / 2)
    return pages


def classify_cores_kind(cores: Optional[str]) -> Optional[str]:
    """Retorna 'PB', 'COLOR' ou None."""
    c = (cores or "").strip().upper()
    if not c:
        return None
    parsed = parse_impressao(c)
    if parsed is not None:
        frente, verso = parsed
        if frente >= 4 or verso >= 4:
            return "COLOR"
        if frente == 1 and verso <= 1:
            return "PB"
        return None
    if (
        "P/B" in c
        or " PB" in c
        or c.startswith("PB")
        or "1X1" in c
        or "1X0" in c
        or "1/1" in c
        or "1/0" in c
        or c == "PRETO"
        or "PRETO" in c
        or "RELEV" in c
    ):
        return "PB"
    if "4" in c or "CMYK" in c or "POLIC" in c or "COLOR" in c:
        return "COLOR"
    return None


def qtd_cores_from_pages(color_pages: int, pb_pages: int) -> Optional[int]:
    if color_pages > 0:
        return 4
    if pb_pages > 0:
        return 1
    return None


def qtd_cores_from_cores_text(cores: Optional[str]) -> Optional[int]:
    kind = classify_cores_kind(cores)
    if kind == "COLOR":
        return 4
    if kind == "PB":
        return 1
    return None


def _parse_cores_descricao(cores_descricao: Optional[str]) -> Dict[str, str]:
    """Extrai texto de cores por componente a partir de CoresDescricao agregada."""
    out: Dict[str, str] = {t: "" for t in COMPONENT_SLOT_ORDER}
    if not cores_descricao:
        return out
    normalized = str(cores_descricao).replace("\r\n", "\n").replace("\r", "\n")
    chunks: list[str] = []
    for line in normalized.replace("|", "\n").split("\n"):
        part = line.strip()
        if part:
            chunks.append(part)
    for part in chunks:
        for tipo in COMPONENT_SLOT_ORDER:
            for label, _key in [_COMPONENT_LABELS[tipo]]:
                prefix = f"{label}:"
                if part.lower().startswith(prefix.lower()):
                    out[tipo] = part.split(":", 1)[1].strip()
                    break
    return out


def _component_pages_from_calculos(calculos: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    """Páginas color/PB por tipo a partir do payload Calculos."""
    keys = {
        "CAPA": ("capa_color", "capa_pb"),
        "MIOLO": ("miolo_color", "miolo_pb"),
        "ENCARTE": ("encarte_color", "encarte_pb"),
    }
    result: Dict[str, Dict[str, int]] = {}
    for tipo, (k_color, k_pb) in keys.items():
        result[tipo] = {
            "color": _to_int(calculos.get(k_color)) or 0,
            "pb": _to_int(calculos.get(k_pb)) or 0,
        }
    return result


def _lote_get(lote: Any, key: str) -> Any:
    if isinstance(lote, dict):
        return lote.get(key)
    return getattr(lote, key, None)


def _comp_get(comp: Any, key: str) -> Any:
    if isinstance(comp, dict):
        return comp.get(key)
    return getattr(comp, key, None)


def _lote_printed_kind(lote: Any, *, verso_em_branco: bool) -> tuple[int, Optional[str]]:
    pages = _to_int(_lote_get(lote, "paginas")) or 0
    impressao = _lote_get(lote, "impressao")
    cores_link = _lote_get(lote, "cores_link")
    cores_desc = _lote_get(lote, "cores_desc")
    printed = printed_pages_for_cota(
        pages,
        impressao=impressao,
        cores_link=cores_link,
        verso_em_branco=verso_em_branco,
    )
    kind = classify_cores_kind(impressao) or classify_cores_kind(cores_link) or classify_cores_kind(cores_desc)
    return printed, kind


def _component_pages_from_techspec(techspec: Any) -> Dict[str, Dict[str, int]]:
    result: Dict[str, Dict[str, int]] = {t: {"color": 0, "pb": 0} for t in COMPONENT_SLOT_ORDER}
    if not techspec:
        return result
    componentes = getattr(techspec, "componentes", None)
    if componentes is None and isinstance(techspec, dict):
        componentes = techspec.get("componentes") or []
    for comp in componentes or []:
        tipo = str(_comp_get(comp, "tipo") or "").upper()
        if tipo not in result:
            continue
        lotes = _comp_get(comp, "lotes") or []
        verso_em_branco = bool(_comp_get(comp, "verso_em_branco"))
        color = pb = 0
        for lote in lotes or []:
            pages, kind = _lote_printed_kind(lote, verso_em_branco=verso_em_branco)
            if kind == "PB":
                pb += pages
            elif kind == "COLOR":
                color += pages
        result[tipo] = {"color": color, "pb": pb}

    has_legacy_pages = any(
        result[t]["color"] or result[t]["pb"] for t in COMPONENT_SLOT_ORDER
    )
    if not has_legacy_pages:
        for comp in componentes or []:
            tipo = str(_comp_get(comp, "tipo") or "").upper()
            if tipo in result:
                continue
            lotes = _comp_get(comp, "lotes") or []
            verso_em_branco = bool(_comp_get(comp, "verso_em_branco"))
            color = pb = 0
            for lote in lotes or []:
                pages, kind = _lote_printed_kind(lote, verso_em_branco=verso_em_branco)
                if kind == "PB":
                    pb += pages
                elif kind == "COLOR":
                    color += pages
                else:
                    pb += pages
            if color or pb:
                result["MIOLO"] = {"color": color, "pb": pb}
                break
    return result


def _primary_cores_from_techspec_component(comp: Any) -> str:
    lotes = getattr(comp, "lotes", None)
    if lotes is None and isinstance(comp, dict):
        lotes = comp.get("lotes") or []
    for lote in lotes or []:
        cores = (
            getattr(lote, "cores_link", None)
            if not isinstance(lote, dict)
            else lote.get("cores_link")
        )
        if cores and str(cores).strip():
            return str(cores).strip()
    return ""


def _cores_text_per_component(
    techspec: Any,
    cores_descricao: Optional[str],
    cores_fallback: Optional[str],
) -> Dict[str, str]:
    parsed = _parse_cores_descricao(cores_descricao)
    if not techspec:
        return {t: parsed.get(t) or (cores_fallback or "") for t in COMPONENT_SLOT_ORDER}

    componentes = getattr(techspec, "componentes", None)
    if componentes is None and isinstance(techspec, dict):
        componentes = techspec.get("componentes") or []

    by_tipo: Dict[str, str] = {t: "" for t in COMPONENT_SLOT_ORDER}
    for comp in componentes or []:
        tipo = (getattr(comp, "tipo", None) or (comp.get("tipo") if isinstance(comp, dict) else "") or "").upper()
        if tipo in by_tipo:
            by_tipo[tipo] = _primary_cores_from_techspec_component(comp)

    for tipo in COMPONENT_SLOT_ORDER:
        if not by_tipo[tipo]:
            by_tipo[tipo] = parsed.get(tipo) or (cores_fallback or "")

    if not by_tipo["MIOLO"]:
        for comp in componentes or []:
            tipo = (
                getattr(comp, "tipo", None)
                or (comp.get("tipo") if isinstance(comp, dict) else "")
                or ""
            ).upper()
            if tipo in by_tipo:
                continue
            cores_text = _primary_cores_from_techspec_component(comp)
            if cores_text:
                by_tipo["MIOLO"] = cores_text
                break

    return by_tipo


def compute_detalhes_calc_fields(
    *,
    calculos: Optional[Any] = None,
    techspec: Optional[Any] = None,
    cores: Optional[str] = None,
    cores_descricao: Optional[str] = None,
    tiragem_solicitada: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Retorna dict com CalcPgs1..3, CalcQtdCores1..3, CalcCor1..3, TiragemSolicitada.
    Valores None = não preencher / limpar no UPDATE opcional.
    """
    cal: Dict[str, Any] = {}
    if calculos is not None:
        if hasattr(calculos, "model_dump"):
            cal = calculos.model_dump()
        elif isinstance(calculos, dict):
            cal = calculos
        else:
            cal = dict(calculos)

    coef = _to_float(cal.get("coef_a4"))
    if coef <= 0:
        coef = calculate_coef_a4(cal.get("altura_mm"), cal.get("largura_mm"))
    coef_int = int(round(coef)) if coef > 0 else 0

    pages_cal = _component_pages_from_calculos(cal)
    pages_spec = _component_pages_from_techspec(techspec)
    cores_by_tipo = _cores_text_per_component(techspec, cores_descricao, cores)

    out: Dict[str, Any] = {}

    for idx, tipo in enumerate(COMPONENT_SLOT_ORDER, start=1):
        pc = pages_spec.get(tipo) or {"color": 0, "pb": 0}
        pcal = pages_cal.get(tipo) or {"color": 0, "pb": 0}
        color_pages = pc["color"] or pcal["color"]
        pb_pages = pc["pb"] or pcal["pb"]
        total = color_pages + pb_pages

        if total <= 0:
            out[f"CalcPgs{idx}"] = None
            out[f"CalcQtdCores{idx}"] = None
            out[f"CalcCor{idx}"] = None
            continue

        cores_text = (cores_by_tipo.get(tipo) or "").strip()
        if not cores_text:
            cores_text = (cores or "").strip()

        out[f"CalcPgs{idx}"] = coef_int
        qtd = qtd_cores_from_pages(color_pages, pb_pages)
        if qtd is None:
            qtd = qtd_cores_from_cores_text(cores_text)
        out[f"CalcQtdCores{idx}"] = qtd
        out[f"CalcCor{idx}"] = cores_text or None

    out["TiragemSolicitada"] = _to_int(tiragem_solicitada)

    return out


def merge_calc_into_detalhes_row(row: Dict[str, Any], calc_fields: Dict[str, Any]) -> Dict[str, Any]:
    """Mescla campos calculados em dict de detalhes (para MDB)."""
    merged = dict(row)
    for key, value in calc_fields.items():
        if value is not None:
            merged[key] = value
    return merged

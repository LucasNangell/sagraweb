#!/usr/bin/env python3
"""Gera PreviewConfigJson a partir dos PDFs em Modelos/papelaria/pdfs/."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
PDF_DIR = ROOT / "Modelos" / "papelaria" / "pdfs"
OUT_DIR = PDF_DIR / "json"
SCALE = 4
FONT_STACK = '"ITC Stone Sans Std", "Stone Sans", Arial, Helvetica, sans-serif'
COLOR = "#231f20"

MODEL_FIELDS: dict[str, list[str]] = {
    "BlocoA5": ["Cabecalho", "Rodape"],
    "CtDpPsTp": ["NomeDep", "Genero", "PartidoDep"],
    "CtDpRtLt": ["NomeDep", "Genero", "PartidoDep"],
    "CtGabSimples": ["NomeDep"],
    "CtGabSimplesRS": ["NomeDep", "Genero", "PartidoDep"],
    "CtVisita": ["NomeDep", "Genero", "PartidoDep", "Endereco", "Contato"],
    "CtVisitaFVAssissor": [
        "NomeDep",
        "Genero",
        "PartidoDep",
        "Endereco",
        "Contato",
        "NomeAssessor",
        "ContatoAssessor",
        "Funcao",
    ],
    "CtVisitaFVIngles": ["NomeDep", "Genero", "PartidoDep", "Endereco", "Contato"],
    "PastaCBolso": ["NomeDep", "Genero", "PartidoDep"],
    "TimbradoA4": ["Cabecalho", "Rodape"],
}

VISITA_FIELD_ALIGN: dict[str, str] = {
    "NomeDep": "center",
    "Genero": "center",
    "PartidoDep": "center",
    "Endereco": "left",
    "Contato": "right",
    "NomeAssessor": "center",
    "Funcao": "center",
    "ContatoAssessor": "center",
}

MODEL_FIELD_ALIGN: dict[str, dict[str, str]] = {
    "BlocoA5": {"Cabecalho": "center", "Rodape": "center"},
    "TimbradoA4": {"Cabecalho": "center", "Rodape": "center"},
    "CtGabSimples": {"NomeDep": "center"},
    "CtGabSimplesRS": {"NomeDep": "center", "Genero": "center", "PartidoDep": "center"},
    "CtDpRtLt": {"NomeDep": "center", "Genero": "center", "PartidoDep": "center"},
    "CtDpPsTp": {"NomeDep": "center", "Genero": "center", "PartidoDep": "center"},
    "PastaCBolso": {"NomeDep": "center", "Genero": "center", "PartidoDep": "center"},
    "CtVisita": VISITA_FIELD_ALIGN,
    "CtVisitaFVIngles": VISITA_FIELD_ALIGN,
    "CtVisitaFVAssissor": VISITA_FIELD_ALIGN,
}

TEMPLATES_PT: dict[str, str] = {
    "NomeDep": "{nome_deputado}",
    "Genero": "{genero}",
    "PartidoDep": "{partido}/{uf}",
    "Endereco": "Câmara dos Deputados\nAnexo {anexo}, Gabinete {gabinete}\nCEP 70160-900 - Brasília/DF",
    "Contato": "Fones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}",
    "NomeAssessor": "{nome_assessor}",
    "ContatoAssessor": "{contato_assessor}",
    "Funcao": "{funcao_assessor}",
    "Cabecalho": "Gabinete {artigo} {genero_curto}\n{nome_deputado}\n- {partido}/{uf}",
    "Rodape": "Câmara dos Deputados | Anexo {anexo} - Gabinete {gabinete} | CEP 70160-900 - Brasília/DF\nTels (61) 3215-5{gabinete}/3{gabinete} | {email}",
}

TEMPLATES_EN: dict[str, str] = {
    "NomeDep": "{nome_deputado}",
    "Genero": "Federal Deputy",
    "PartidoDep": "{partido}/{uf}",
    "Endereco": "Chamber of Deputies\nAnnex {anexo}, Office {gabinete}\nZip Code 70160-900 - Brasília/DF",
    "Contato": "Phones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}",
}

FIELD_TAG_RE = re.compile(r"\((\w+)\)")
PARTIDO_GENERO_RE = re.compile(r"^([A-Za-z0-9]+/[A-Za-z]{2})(.+)$")


def pt(v: float) -> int:
    return int(round(v * SCALE))


def font_weight(font_name: str, flags: int) -> int:
    lower = font_name.lower()
    if "semibold" in lower or "bold" in lower or (flags & 16):
        return 600
    return 500


def field_align(model: str, field_id: str, fallback: str = "left") -> str:
    return MODEL_FIELD_ALIGN.get(model, {}).get(field_id, fallback)


def infer_line_align(x0: float, x1: float, page_w: float) -> str:
    """Detecta alinhamento real comparando bordas da linha com margens da página."""
    margin = page_w * 0.035
    cx = (x0 + x1) / 2
    right_edge = page_w - margin

    if x1 >= right_edge - page_w * 0.04 and x0 > page_w * 0.33:
        return "right"
    if x0 <= margin + page_w * 0.04 and x1 < page_w * 0.67:
        return "left"
    if abs(cx - page_w / 2) < page_w * 0.12:
        return "center"
    if cx < page_w * 0.4:
        return "left"
    if cx > page_w * 0.6:
        return "right"
    return "center"


def make_element(
    field_id: str,
    x: int,
    y: int,
    width: int,
    height: int,
    font_size: int,
    font_weight_val: int,
    align: str,
    anchor: str = "middle",
    line_height: float = 1.0,
    template: str | None = None,
) -> dict:
    return {
        "id": field_id,
        "tipo": "texto",
        "template": template or TEMPLATES_PT[field_id],
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "fontFamily": FONT_STACK,
        "fontSize": font_size,
        "fontWeight": font_weight_val,
        "fontStyle": "normal",
        "color": COLOR,
        "align": align,
        "anchor": anchor,
        "lineHeight": line_height,
        "letterSpacing": 0,
    }


def extract_lines(page: fitz.Page) -> list[dict]:
    lines: list[dict] = []
    pw = page.rect.width
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            parts: list[str] = []
            sizes: list[float] = []
            fonts: list[str] = []
            flags_list: list[int] = []
            x0 = y0 = 9999.0
            x1 = y1 = 0.0
            for span in line.get("spans", []):
                t = span.get("text", "")
                if not t:
                    continue
                parts.append(t)
                sizes.append(float(span.get("size", 0)))
                fonts.append(span.get("font", ""))
                flags_list.append(int(span.get("flags", 0)))
                bx0, by0, bx1, by1 = span["bbox"]
                x0, y0 = min(x0, bx0), min(y0, by0)
                x1, y1 = max(x1, bx1), max(y1, by1)
            text = "".join(parts).strip()
            if not text:
                continue
            align = infer_line_align(x0, x1, pw)
            lines.append(
                {
                    "text": text,
                    "x0": x0,
                    "y0": y0,
                    "x1": x1,
                    "y1": y1,
                    "w": x1 - x0,
                    "h": y1 - y0,
                    "cx": (x0 + x1) / 2,
                    "size": max(sizes) if sizes else 10,
                    "font": fonts[0] if fonts else "",
                    "flags": flags_list[0] if flags_list else 0,
                    "align": align,
                }
            )
    return lines


def extract_blocks(page: fitz.Page) -> list[dict]:
    """Agrupa linhas consecutivas do mesmo bloco PyMuPDF (compatibilidade)."""
    blocks: list[dict] = []
    pw = page.rect.width
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        block_lines = extract_lines_from_block(block, pw)
        if not block_lines:
            continue
        x0 = min(l["x0"] for l in block_lines)
        y0 = min(l["y0"] for l in block_lines)
        x1 = max(l["x1"] for l in block_lines)
        y1 = max(l["y1"] for l in block_lines)
        blocks.append(
            {
                "text": "\n".join(l["text"] for l in block_lines),
                "lines": block_lines,
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "w": x1 - x0,
                "h": y1 - y0,
                "cx": (x0 + x1) / 2,
                "size": max(l["size"] for l in block_lines),
                "font": block_lines[0]["font"],
                "flags": block_lines[0]["flags"],
                "align": dominant_align(block_lines),
            }
        )
    return blocks


def extract_lines_from_block(block: dict, page_w: float) -> list[dict]:
    lines: list[dict] = []
    for line in block.get("lines", []):
        parts: list[str] = []
        sizes: list[float] = []
        fonts: list[str] = []
        flags_list: list[int] = []
        x0 = y0 = 9999.0
        x1 = y1 = 0.0
        for span in line.get("spans", []):
            t = span.get("text", "")
            if not t:
                continue
            parts.append(t)
            sizes.append(float(span.get("size", 0)))
            fonts.append(span.get("font", ""))
            flags_list.append(int(span.get("flags", 0)))
            bx0, by0, bx1, by1 = span["bbox"]
            x0, y0 = min(x0, bx0), min(y0, by0)
            x1, y1 = max(x1, bx1), max(y1, by1)
        text = "".join(parts).strip()
        if not text:
            continue
        lines.append(
            {
                "text": text,
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "w": x1 - x0,
                "h": y1 - y0,
                "cx": (x0 + x1) / 2,
                "size": max(sizes) if sizes else 10,
                "font": fonts[0] if fonts else "",
                "flags": flags_list[0] if flags_list else 0,
                "align": infer_line_align(x0, x1, page_w),
            }
        )
    return lines


def dominant_align(lines: list[dict]) -> str:
    if not lines:
        return "left"
    counts = {"left": 0.0, "center": 0.0, "right": 0.0}
    for line in lines:
        counts[line["align"]] += line["w"]
    return max(counts, key=counts.get)


def vertical_anchor(align: str, multiline: bool = False) -> str:
    if align in {"left", "right", "center"} and multiline:
        return "start"
    if align == "center":
        return "middle"
    return "start"


def center_text_box(page_w: float, y0: float, height: float, margin_ratio: float = 0.12) -> tuple[int, int, int, int]:
    margin = page_w * margin_ratio
    return pt(margin), pt(y0), pt(page_w - 2 * margin), max(pt(height), pt(8))


def left_column_box(page_w: float, y0: float, height: float, margin_ratio: float = 0.035) -> tuple[int, int, int, int]:
    margin = page_w * margin_ratio
    width = page_w * 0.52 - margin
    return pt(margin), pt(y0), pt(width), max(pt(height), pt(8))


def right_column_box(page_w: float, y0: float, height: float, margin_ratio: float = 0.035) -> tuple[int, int, int, int]:
    margin = page_w * margin_ratio
    x_left = page_w * 0.48
    width = page_w - margin - x_left
    return pt(x_left), pt(y0), pt(width), max(pt(height), pt(8))


def right_center_text_box(
    page_w: float,
    y0: float,
    height: float,
    margin_ratio: float = 0.035,
    width_ratio: float = 0.22,
) -> tuple[int, int, int, int]:
    """Caixa centralizada na faixa inferior direita (CtGabSimplesRS)."""
    margin = page_w * margin_ratio
    width = page_w * width_ratio
    x_left = page_w - margin - width
    return pt(x_left), pt(y0), pt(width), max(pt(height), pt(8))


def box_for_lines(page_w: float, lines: list[dict], align: str, line_height_factor: float = 1.2) -> tuple[int, int, int, int]:
    y0 = min(l["y0"] for l in lines)
    y1 = max(l["y1"] for l in lines)
    height = max(y1 - y0, max(l["size"] for l in lines) * line_height_factor * len(lines) * 0.85)
    if align == "center":
        return center_text_box(page_w, y0, height)
    if align == "right":
        return right_column_box(page_w, y0, height)
    return left_column_box(page_w, y0, height)


def box_for_line(page_w: float, line: dict, align: str, height_factor: float = 1.35) -> tuple[int, int, int, int]:
    height = max(line["h"], line["size"] * height_factor)
    if align == "center":
        return center_text_box(page_w, line["y0"], height)
    if align == "right":
        return right_column_box(page_w, line["y0"], height)
    return left_column_box(page_w, line["y0"], height)


def is_contact_footer_text(text: str) -> bool:
    u = text.upper()
    return any(
        k in u
        for k in (
            "CEP ",
            "FONES",
            "PHONES",
            "3215",
            "@CAMARA",
            "BRASÍLIA",
            "BRASILIA",
            "ANEXO ",
            "ANNEX ",
            "ZIP CODE",
        )
    )


def is_institution_header(text: str) -> bool:
    u = text.upper()
    if "NOME" in u and "DEPUT" in u:
        return False
    if "PARTIDO" in u or "GABINETE" in u:
        return False
    if re.search(r"DEPUTAD[OA]\s+FEDERAL", u):
        return False
    if ("DEPUTADOS" in u or "CHAMBER" in u) and len(u) < 45:
        return True
    t = re.sub(r"[^A-Za-z]", "", text).upper()
    return "CAMARADOSDEPUTADOS" in t or "CHAMBEROFDEPUTIES" in t


def is_institution_only_line(text: str) -> bool:
    u = text.upper().strip()
    if "GABINETE" in u or "PARTIDO" in u:
        return False
    return is_institution_header(text)


def split_partido_genero_line(line: dict) -> list[dict]:
    merged = line["text"].replace(" ", "")
    partido_m = PARTIDO_GENERO_RE.match(merged)
    if not partido_m:
        return [line]
    return [
        {**line, "text": partido_m.group(2), "y0": line["y0"]},
        {**line, "text": partido_m.group(1).upper(), "y0": line["y0"] + line["size"] * 0.95},
    ]


def build_from_field_tags(lines: list[dict], page_w: float, fields: list[str], model: str) -> list[dict]:
    elementos: list[dict] = []
    for line in lines:
        m = FIELD_TAG_RE.search(line["text"])
        if not m:
            continue
        fid = m.group(1)
        if fid not in fields:
            continue
        align = field_align(model, fid, "center")
        x, y, w, h = box_for_line(page_w, line, align)
        elementos.append(
            make_element(
                fid,
                x,
                y,
                w,
                h,
                pt(line["size"]),
                font_weight(line["font"], line["flags"]),
                align,
                vertical_anchor(align),
            )
        )
    order = {f: i for i, f in enumerate(fields)}
    elementos.sort(key=lambda e: order.get(e["id"], 99))
    return elementos


def build_visita_blocks(
    lines: list[dict],
    page: fitz.Page,
    fields: list[str],
    model: str,
    lang: str = "pt",
) -> list[dict]:
    pw, ph = page.rect.width, page.rect.height
    templates = TEMPLATES_EN if lang == "en" else TEMPLATES_PT
    body = [
        l
        for l in lines
        if not is_institution_header(l["text"]) and l["y0"] < ph * 0.68
    ]
    footer = [l for l in lines if l["y0"] >= ph * 0.68]

    left_footer = [l for l in footer if field_align(model, "Endereco") == "left" and l["align"] == "left"]
    right_footer = [l for l in footer if field_align(model, "Contato") == "right" and l["align"] == "right"]
    if not left_footer:
        left_footer = [l for l in footer if l["cx"] < pw * 0.42]
    if not right_footer:
        right_footer = [l for l in footer if l["cx"] > pw * 0.58]

    center_body = [
        l
        for l in body
        if field_align(model, "NomeDep") == "center"
        and (l["align"] == "center" or abs(l["cx"] - pw / 2) < pw * 0.15)
        and not is_institution_header(l["text"])
    ]
    center_body = sorted(center_body, key=lambda l: l["y0"])

    elementos: list[dict] = []
    nome_candidates = [l for l in center_body if font_weight(l["font"], l["flags"]) >= 600]

    if "NomeDep" in fields:
        src = nome_candidates[0] if nome_candidates else (center_body[0] if center_body else None)
        if src:
            align = field_align(model, "NomeDep")
            x, y, w, h = box_for_line(pw, src, align)
            elementos.append(
                make_element(
                    "NomeDep",
                    x,
                    y,
                    w,
                    h,
                    pt(src["size"]),
                    font_weight(src["font"], src["flags"]),
                    align,
                    vertical_anchor(align),
                    template=templates["NomeDep"],
                )
            )

    rest_center = [l for l in center_body if l not in nome_candidates]
    expanded: list[dict] = []
    for line in rest_center:
        expanded.extend(split_partido_genero_line(line))
    expanded = sorted(expanded, key=lambda l: l["y0"])

    if "Genero" in fields and expanded:
        src = expanded[0]
        align = field_align(model, "Genero")
        x, y, w, h = box_for_line(pw, src, align)
        elementos.append(
            make_element(
                "Genero",
                x,
                y,
                w,
                h,
                pt(src["size"]),
                500,
                align,
                vertical_anchor(align),
                template=templates.get("Genero", TEMPLATES_PT["Genero"]),
            )
        )
    if "PartidoDep" in fields and len(expanded) > 1:
        src = expanded[1]
        align = field_align(model, "PartidoDep")
        x, y, w, h = box_for_line(pw, src, align)
        elementos.append(
            make_element(
                "PartidoDep",
                x,
                y,
                w,
                h,
                pt(src["size"]),
                500,
                align,
                vertical_anchor(align),
                template=templates["PartidoDep"],
            )
        )

    if "Endereco" in fields and left_footer:
        align = field_align(model, "Endereco")
        x, y, w, h = box_for_lines(pw, left_footer, align, 1.2)
        h = max(h, pt(max(l["size"] for l in left_footer) * 3.2))
        elementos.append(
            make_element(
                "Endereco",
                x,
                y,
                w,
                h,
                pt(max(l["size"] for l in left_footer)),
                500,
                align,
                vertical_anchor(align, multiline=True),
                1.2,
                template=templates["Endereco"],
            )
        )

    if "Contato" in fields and right_footer:
        align = field_align(model, "Contato")
        x, y, w, h = box_for_lines(pw, right_footer, align, 1.2)
        h = max(h, pt(max(l["size"] for l in right_footer) * 3.2))
        elementos.append(
            make_element(
                "Contato",
                x,
                y,
                w,
                h,
                pt(max(l["size"] for l in right_footer)),
                500,
                align,
                vertical_anchor(align, multiline=True),
                1.2,
                template=templates["Contato"],
            )
        )

    return elementos


def build_assessor_verso(lines: list[dict], page: fitz.Page, model: str) -> list[dict]:
    pw = page.rect.width
    center = sorted(
        [l for l in lines if abs(l["cx"] - pw / 2) < pw * 0.2],
        key=lambda l: l["y0"],
    )
    mapping = [
        ("NomeAssessor", 600),
        ("Funcao", 500),
        ("ContatoAssessor", 500),
    ]
    elementos: list[dict] = []
    for (fid, _), src in zip(mapping, center):
        align = field_align(model, fid, "center")
        x, y, w, h = box_for_line(pw, src, align)
        elementos.append(
            make_element(
                fid,
                x,
                y,
                w,
                h,
                pt(src["size"]),
                font_weight(src["font"], src["flags"]) if fid == "NomeAssessor" else 500,
                align,
                vertical_anchor(align),
            )
        )
    return elementos


def build_three_center_blocks(lines: list[dict], page: fitz.Page, model: str) -> list[dict]:
    pw = page.rect.width
    body = [
        l
        for l in lines
        if not is_institution_header(l["text"]) and not is_contact_footer_text(l["text"])
    ]
    center_body = [
        l
        for l in body
        if l["align"] == "center" or abs(l["cx"] - pw / 2) < pw * 0.15
    ]
    center_body = sorted(center_body, key=lambda l: l["y0"])

    elementos: list[dict] = []
    candidates = [l for l in center_body if font_weight(l["font"], l["flags"]) >= 600]
    if candidates:
        src = candidates[0]
        align = field_align(model, "NomeDep")
        x, y, w, h = box_for_line(pw, src, align)
        elementos.append(
            make_element(
                "NomeDep",
                x,
                y,
                w,
                h,
                pt(src["size"]),
                font_weight(src["font"], src["flags"]),
                align,
                vertical_anchor(align),
            )
        )
    rest = [l for l in center_body if l not in candidates]
    expanded: list[dict] = []
    for line in rest:
        expanded.extend(split_partido_genero_line(line))
    expanded = sorted(expanded, key=lambda l: l["y0"])
    if expanded:
        src = expanded[0]
        align = field_align(model, "Genero")
        x, y, w, h = box_for_line(pw, src, align)
        elementos.append(
            make_element("Genero", x, y, w, h, pt(src["size"]), 500, align, vertical_anchor(align))
        )
    if len(expanded) > 1:
        src = expanded[1]
        align = field_align(model, "PartidoDep")
        x, y, w, h = box_for_line(pw, src, align)
        elementos.append(
            make_element("PartidoDep", x, y, w, h, pt(src["size"]), 500, align, vertical_anchor(align))
        )
    return elementos


def build_gab_simples_rs(lines: list[dict], page: fitz.Page, model: str) -> list[dict]:
    """CtGabSimplesRS: nome/cargo/partido centralizados no canto inferior direito."""
    pw, ph = page.rect.width, page.rect.height
    body = sorted(
        [
            l
            for l in lines
            if not is_institution_only_line(l["text"])
            and l["y0"] > ph * 0.55
            and l["cx"] > pw * 0.6
        ],
        key=lambda l: l["y0"],
    )
    if not body:
        body = sorted(
            [l for l in lines if not is_institution_only_line(l["text"])],
            key=lambda l: l["y0"],
        )[-3:]

    mapping: list[tuple[str, int]] = [
        ("NomeDep", 600),
        ("Genero", 500),
        ("PartidoDep", 500),
    ]
    elementos: list[dict] = []
    for (fid, default_weight), src in zip(mapping, body):
        weight = (
            font_weight(src["font"], src["flags"])
            if fid == "NomeDep"
            else default_weight
        )
        align = field_align(model, fid, "center")
        height = max(src["h"], src["size"] * 1.35)
        x, y, w, h = right_center_text_box(pw, src["y0"], height)
        elementos.append(
            make_element(
                fid,
                x,
                y,
                w,
                h,
                pt(src["size"]),
                weight,
                align,
                vertical_anchor(align),
            )
        )
    return elementos


def build_simple_name(lines: list[dict], page: fitz.Page, model: str) -> list[dict]:
    pw = page.rect.width
    body = [l for l in lines if not is_institution_only_line(l["text"])]
    if not body:
        body = [l for l in lines if not is_institution_header(l["text"])]
    if not body:
        return []

    src = None
    for line in body:
        u = line["text"].upper()
        if "GABINETE" in u or "DEPUTADO" in u or "NOME" in u:
            src = line
            break
    if src is None:
        src = max(body, key=lambda l: (font_weight(l["font"], l["flags"]), l["size"]))

    align = field_align(model, "NomeDep", "center")
    x, y, w, h = box_for_line(pw, src, align, 1.5)
    return [
        make_element(
            "NomeDep",
            x,
            y,
            w,
            h,
            pt(src["size"]),
            font_weight(src["font"], src["flags"]),
            align,
            vertical_anchor(align),
        )
    ]


def build_cabecalho_rodape(lines: list[dict], page: fitz.Page, model: str) -> list[dict]:
    ph = page.rect.height
    header_lines = sorted([l for l in lines if l["y0"] < ph * 0.2], key=lambda l: l["y0"])
    footer_lines = sorted([l for l in lines if l["y0"] > ph * 0.85], key=lambda l: l["y0"])
    if not header_lines:
        header_lines = sorted(lines, key=lambda l: l["y0"])[:4]
    if not footer_lines:
        footer_lines = sorted(lines, key=lambda l: l["y0"])[-2:]

    elementos: list[dict] = []
    if header_lines:
        skip = [l for l in header_lines if not is_institution_only_line(l["text"])]
        use = skip if skip else header_lines
        align = field_align(model, "Cabecalho", dominant_align(use))
        x, y, w, h = box_for_lines(page.rect.width, use, align, 1.15)
        h = max(h, pt(max(l["size"] for l in use) * 4))
        elementos.append(
            make_element(
                "Cabecalho",
                x,
                y,
                w,
                h,
                pt(max(l["size"] for l in use)),
                500,
                align,
                vertical_anchor(align, multiline=True),
                1.15,
            )
        )
    if footer_lines:
        align = field_align(model, "Rodape", dominant_align(footer_lines))
        x, y, w, h = box_for_lines(page.rect.width, footer_lines, align, 1.15)
        h = max(h, pt(max(l["size"] for l in footer_lines) * 2.5))
        elementos.append(
            make_element(
                "Rodape",
                x,
                y,
                w,
                h,
                pt(max(l["size"] for l in footer_lines)),
                500,
                align,
                vertical_anchor(align, multiline=True),
                1.15,
            )
        )
    return elementos


def manual_ctdp_pstp() -> dict:
    """CtDpPsTp: texto em curvas — caixas inferiores centralizadas (paisagem)."""
    return {
        "canvas": {"width": 1684, "height": 1191},
        "faces": [
            {
                "id": "frente",
                "nome": "Frente",
                "baseImage": "frente_base.png",
                "pageIndex": 0,
                "elementos": [
                    make_element("NomeDep", 422, 900, 840, 53, 44, 600, "center", "middle"),
                    make_element("Genero", 422, 958, 840, 38, 32, 500, "center", "middle"),
                    make_element("PartidoDep", 422, 1000, 840, 38, 32, 500, "center", "middle"),
                ],
            }
        ],
    }


def build_config(pdf_path: Path) -> dict:
    stem = pdf_path.stem
    if stem == "CtDpPsTp":
        return manual_ctdp_pstp()

    fields = MODEL_FIELDS.get(stem, ["NomeDep", "Genero", "PartidoDep"])
    doc = fitz.open(pdf_path)
    faces = []

    for pi in range(doc.page_count):
        page = doc[pi]
        lines = extract_lines(page)
        lang = "en" if stem == "CtVisitaFVIngles" and pi == 1 else "pt"

        if stem == "PastaCBolso":
            elementos = build_from_field_tags(lines, page.rect.width, fields, stem)
        elif stem in {"CtVisita", "CtVisitaFVIngles"}:
            elementos = build_visita_blocks(lines, page, fields, stem, lang=lang)
        elif stem == "CtVisitaFVAssissor":
            if pi == 0:
                elementos = build_visita_blocks(lines, page, fields[:5], stem, lang="pt")
            else:
                elementos = build_assessor_verso(lines, page, stem)
        elif stem == "CtGabSimplesRS":
            elementos = build_gab_simples_rs(lines, page, stem)
        elif stem == "CtGabSimples":
            elementos = build_simple_name(lines, page, stem)
        elif stem in {"BlocoA5", "TimbradoA4"}:
            elementos = build_cabecalho_rodape(lines, page, stem)
        elif fields == ["NomeDep", "Genero", "PartidoDep"]:
            elementos = build_three_center_blocks(lines, page, stem)
        else:
            elementos = build_visita_blocks(lines, page, fields, stem, lang=lang)

        face_id = "frente" if pi == 0 else ("verso" if pi == 1 else f"pagina_{pi}")
        face_nome = "Frente" if pi == 0 else ("Verso" if pi == 1 else f"Página {pi + 1}")
        faces.append(
            {
                "id": face_id,
                "nome": face_nome,
                "baseImage": f"{face_id}_base.png",
                "pageIndex": pi,
                "elementos": elementos,
            }
        )

    canvas = {"width": pt(doc[0].rect.width), "height": pt(doc[0].rect.height)}
    doc.close()
    return {"canvas": canvas, "faces": faces}


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"Nenhum PDF em {PDF_DIR}", file=sys.stderr)
        return 1

    for pdf in pdfs:
        cfg = build_config(pdf)
        out = OUT_DIR / f"{pdf.stem}.json"
        out.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        n_el = sum(len(f["elementos"]) for f in cfg["faces"])
        print(f"OK {pdf.name} -> {out.name} ({len(cfg['faces'])} face(s), {n_el} campo(s))")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

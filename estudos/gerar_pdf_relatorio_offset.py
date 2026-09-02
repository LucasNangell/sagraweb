from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageTemplate,
    PageBreak,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


BASE_DIR = Path(__file__).resolve().parent
SOURCE = BASE_DIR / "relatorio_padroes_offset.md"
OUTPUT = BASE_DIR / "relatorio_padroes_offset.pdf"


def register_font() -> tuple[str, str]:
    regular = Path("C:/Windows/Fonts/arial.ttf")
    bold = Path("C:/Windows/Fonts/arialbd.ttf")
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("Arial", str(regular)))
        pdfmetrics.registerFont(TTFont("Arial-Bold", str(bold)))
        return "Arial", "Arial-Bold"
    return "Helvetica", "Helvetica-Bold"


FONT, FONT_BOLD = register_font()


def esc(text: str) -> str:
    text = html.escape(text.strip())
    text = re.sub(r"`([^`]+)`", rf'<font name="{FONT_BOLD}">\1</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    return text


def clean_cell(text: str) -> str:
    text = text.replace("\\|", "|").replace("<br>", "<br/>").strip()
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    return text


def split_table_row(line: str) -> list[str]:
    row = line.strip().strip("|")
    parts: list[str] = []
    buf = []
    escaped = False
    for ch in row:
        if escaped:
            buf.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == "|":
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf).strip())
    return parts


def is_table(lines: list[str], idx: int) -> bool:
    if idx + 1 >= len(lines):
        return False
    return lines[idx].strip().startswith("|") and re.match(r"^\|\s*:?-{3,}", lines[idx + 1].strip()) is not None


def build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=base["BodyText"],
        fontName=FONT,
        fontSize=9.2,
        leading=12.5,
        textColor=colors.HexColor("#222222"),
        spaceAfter=5,
        alignment=TA_LEFT,
    )
    return {
        "title": ParagraphStyle(
            "Title",
            parent=body,
            fontName=FONT_BOLD,
            fontSize=19,
            leading=23,
            textColor=colors.HexColor("#17324D"),
            spaceAfter=14,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=body,
            fontName=FONT_BOLD,
            fontSize=13.2,
            leading=16,
            textColor=colors.HexColor("#1F4E79"),
            spaceBefore=13,
            spaceAfter=7,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=body,
            fontName=FONT_BOLD,
            fontSize=10.8,
            leading=13.5,
            textColor=colors.HexColor("#243B53"),
            spaceBefore=9,
            spaceAfter=5,
        ),
        "body": body,
        "small": ParagraphStyle(
            "Small",
            parent=body,
            fontSize=7.2,
            leading=9,
            spaceAfter=0,
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            parent=body,
            fontName=FONT_BOLD,
            fontSize=7.0,
            leading=8.5,
            textColor=colors.white,
            spaceAfter=0,
        ),
        "table_cell": ParagraphStyle(
            "TableCell",
            parent=body,
            fontSize=6.7,
            leading=8.2,
            spaceAfter=0,
        ),
    }


def make_table(raw_rows: list[list[str]], styles: dict[str, ParagraphStyle]) -> Table:
    header, *body = raw_rows
    col_count = len(header)
    if col_count == 2:
        widths = [12.4 * cm, 2.0 * cm]
    elif col_count == 3:
        widths = [8.8 * cm, 2.0 * cm, 2.2 * cm]
    elif col_count == 4:
        widths = [2.1 * cm, 3.0 * cm, 7.0 * cm, 4.0 * cm]
    elif col_count == 5:
        widths = [1.7 * cm, 2.4 * cm, 6.0 * cm, 3.6 * cm, 3.4 * cm]
    else:
        widths = [16.5 * cm / col_count] * col_count

    data = [
        [Paragraph(esc(clean_cell(cell)), styles["table_header"]) for cell in header],
    ]
    for row in body:
        row = row + [""] * (col_count - len(row))
        data.append([Paragraph(esc(clean_cell(cell)), styles["table_cell"]) for cell in row[:col_count]])

    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT", splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F4E79")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F7F9FB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#FFFFFF"), colors.HexColor("#F4F7FA")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def flush_paragraph(buf: list[str], story: list, styles: dict[str, ParagraphStyle]) -> None:
    if not buf:
        return
    text = " ".join(part.strip() for part in buf if part.strip())
    if text:
        story.append(Paragraph(esc(text), styles["body"]))
    buf.clear()


def parse_markdown(text: str) -> list:
    styles = build_styles()
    story: list = []
    lines = text.splitlines()
    idx = 0
    para: list[str] = []

    while idx < len(lines):
        line = lines[idx]
        stripped = line.strip()

        if not stripped:
            flush_paragraph(para, story, styles)
            idx += 1
            continue

        if is_table(lines, idx):
            flush_paragraph(para, story, styles)
            raw_rows = [split_table_row(lines[idx])]
            idx += 2
            while idx < len(lines) and lines[idx].strip().startswith("|"):
                raw_rows.append(split_table_row(lines[idx]))
                idx += 1
            story.append(make_table(raw_rows, styles))
            story.append(Spacer(1, 7))
            continue

        if stripped.startswith("# "):
            flush_paragraph(para, story, styles)
            story.append(Paragraph(esc(stripped[2:]), styles["title"]))
            idx += 1
            continue

        if stripped.startswith("## "):
            flush_paragraph(para, story, styles)
            heading = stripped[3:]
            if heading in {"Regras candidatas para automação", "Proposta de motor de regras", "Divergências e cuidados"}:
                story.append(PageBreak())
            story.append(Paragraph(esc(heading), styles["h2"]))
            idx += 1
            continue

        if stripped.startswith("### "):
            flush_paragraph(para, story, styles)
            story.append(Paragraph(esc(stripped[4:]), styles["h3"]))
            idx += 1
            continue

        bullet_match = re.match(r"^-\s+(.*)$", stripped)
        if bullet_match:
            flush_paragraph(para, story, styles)
            items = []
            while idx < len(lines):
                m = re.match(r"^-\s+(.*)$", lines[idx].strip())
                if not m:
                    break
                items.append(ListItem(Paragraph(esc(m.group(1)), styles["body"]), leftIndent=10))
                idx += 1
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=16, bulletFontName=FONT, bulletFontSize=6))
            story.append(Spacer(1, 2))
            continue

        number_match = re.match(r"^\d+\.\s+(.*)$", stripped)
        if number_match:
            flush_paragraph(para, story, styles)
            items = []
            while idx < len(lines):
                m = re.match(r"^\d+\.\s+(.*)$", lines[idx].strip())
                if not m:
                    break
                items.append(ListItem(Paragraph(esc(m.group(1)), styles["body"]), leftIndent=12))
                idx += 1
            story.append(ListFlowable(items, bulletType="1", leftIndent=18, bulletFontName=FONT, bulletFontSize=8.5))
            story.append(Spacer(1, 2))
            continue

        para.append(stripped)
        idx += 1

    flush_paragraph(para, story, styles)
    return story


def footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont(FONT, 7.5)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(1.5 * cm, 1.05 * cm, "Relatório de padrões - trabalhos offset")
    canvas.drawRightString(A4[0] - 1.5 * cm, 1.05 * cm, f"Página {doc.page}")
    canvas.restoreState()


def main() -> None:
    story = parse_markdown(SOURCE.read_text(encoding="utf-8"))
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=1.45 * cm,
        rightMargin=1.45 * cm,
        topMargin=1.45 * cm,
        bottomMargin=1.65 * cm,
        title="Relatório de padrões - trabalhos offset",
        author="SagraWeb",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=footer)])
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()

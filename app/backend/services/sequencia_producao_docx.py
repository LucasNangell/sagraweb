from __future__ import annotations

from pathlib import Path

from services.sequencia_producao_models import SequenciaDraft

_WINE = "800000"


def _qn(name: str) -> str:
    from docx.oxml.ns import qn

    return qn(name)


def _set_style_id(style, style_id: str) -> None:
    style.element.set(_qn("w:styleId"), style_id)


def _child(parent, tag: str):
    from docx.oxml import OxmlElement

    element = OxmlElement(tag)
    parent.append(element)
    return element


def _get_or_add(parent, tag: str):
    existing = parent.find(_qn(tag))
    return existing if existing is not None else _child(parent, tag)


def _set_fonts(rpr, font: str) -> None:
    rfonts = _get_or_add(rpr, "w:rFonts")
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        rfonts.set(_qn(attr), font)


def _set_size(rpr, half_points: int) -> None:
    for tag in ("w:sz", "w:szCs"):
        size = _get_or_add(rpr, tag)
        size.set(_qn("w:val"), str(half_points))


def _set_paragraph_style_numbering(style, num_id: int) -> None:
    ppr = _get_or_add(style.element, "w:pPr")
    num_pr = _get_or_add(ppr, "w:numPr")
    num_id_el = _get_or_add(num_pr, "w:numId")
    num_id_el.set(_qn("w:val"), str(num_id))
    jc = _get_or_add(ppr, "w:jc")
    jc.set(_qn("w:val"), "both")


def _define_style_sheet(doc) -> None:
    from docx.enum.style import WD_STYLE_TYPE
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt

    styles = doc.styles
    styles["Normal"].font.name = "Times New Roman"

    title = styles.add_style("Tit1", WD_STYLE_TYPE.PARAGRAPH)
    _set_style_id(title, "Tit1")
    title.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.font.name = "Arial"
    title.font.size = Pt(14)

    section = styles.add_style("TitA2n", WD_STYLE_TYPE.PARAGRAPH)
    _set_style_id(section, "TitA2n")
    section.font.size = Pt(14)
    section.font.name = "Arial"
    section.font.color.rgb = None
    ppr = _get_or_add(section.element, "w:pPr")
    shd = _get_or_add(ppr, "w:shd")
    shd.set(_qn("w:val"), "clear")
    shd.set(_qn("w:color"), "auto")
    shd.set(_qn("w:fill"), _WINE)

    subsection = styles.add_style("TitA3n", WD_STYLE_TYPE.PARAGRAPH)
    _set_style_id(subsection, "TitA3n")
    subsection.font.name = "Arial"
    subsection.font.size = Pt(12)
    rpr = _get_or_add(subsection.element, "w:rPr")
    color = _get_or_add(rpr, "w:color")
    color.set(_qn("w:val"), _WINE)
    underline = _get_or_add(rpr, "w:u")
    underline.set(_qn("w:val"), "single")

    body = styles.add_style("Txt6", WD_STYLE_TYPE.PARAGRAPH)
    _set_style_id(body, "Txt6")
    body.font.name = "Calibri"
    body.font.size = Pt(12)
    body.paragraph_format.left_indent = Pt(42.55)

    bullet = styles.add_style("Txt6Hif1", WD_STYLE_TYPE.PARAGRAPH)
    _set_style_id(bullet, "Txt6Hif1")
    bullet.font.name = "Calibri"
    bullet.font.size = Pt(12)
    _set_paragraph_style_numbering(bullet, 37)

    nested = styles.add_style("Txt7Hif1", WD_STYLE_TYPE.PARAGRAPH)
    _set_style_id(nested, "Txt7Hif1")
    nested.font.name = "Calibri"
    nested.font.size = Pt(12)
    _set_paragraph_style_numbering(nested, 39)


def _ensure_numbering(doc) -> None:
    from docx.oxml import OxmlElement

    numbering = doc.part.numbering_part.element

    def has_num(num_id: str) -> bool:
        return any(num.get(_qn("w:numId")) == num_id for num in numbering.findall(_qn("w:num")))

    def add_bullet_numbering(num_id: int, abstract_id: int, style_id: str, bullet_text: str, font: str, left: int, hanging: int) -> None:
        if has_num(str(num_id)):
            return
        abstract = OxmlElement("w:abstractNum")
        abstract.set(_qn("w:abstractNumId"), str(abstract_id))
        _child(abstract, "w:multiLevelType").set(_qn("w:val"), "hybridMultilevel")
        lvl = _child(abstract, "w:lvl")
        lvl.set(_qn("w:ilvl"), "0")
        _child(lvl, "w:start").set(_qn("w:val"), "1")
        _child(lvl, "w:numFmt").set(_qn("w:val"), "bullet")
        _child(lvl, "w:pStyle").set(_qn("w:val"), style_id)
        _child(lvl, "w:lvlText").set(_qn("w:val"), bullet_text)
        _child(lvl, "w:lvlJc").set(_qn("w:val"), "left")
        ppr = _child(lvl, "w:pPr")
        tabs = _child(ppr, "w:tabs")
        tab = _child(tabs, "w:tab")
        tab.set(_qn("w:val"), "num")
        tab.set(_qn("w:pos"), str(left))
        ind = _child(ppr, "w:ind")
        ind.set(_qn("w:left"), str(left))
        ind.set(_qn("w:hanging"), str(hanging))
        rpr = _child(lvl, "w:rPr")
        _set_fonts(rpr, font)
        _child(rpr, "w:b").set(_qn("w:val"), "0")
        _child(rpr, "w:i").set(_qn("w:val"), "0")
        _set_size(rpr, 20)
        numbering.append(abstract)

        num = OxmlElement("w:num")
        num.set(_qn("w:numId"), str(num_id))
        _child(num, "w:abstractNumId").set(_qn("w:val"), str(abstract_id))
        numbering.append(num)

    add_bullet_numbering(37, 37, "Txt6Hif1", "\uf09f", "Wingdings", 992, 141)
    add_bullet_numbering(39, 39, "Txt7Hif1", "-", "Stone Sans", 1191, 199)


def _set_direct_numbering(paragraph, num_id: int) -> None:
    ppr = _get_or_add(paragraph._p, "w:pPr")
    num_pr = _get_or_add(ppr, "w:numPr")
    ilvl = _get_or_add(num_pr, "w:ilvl")
    ilvl.set(_qn("w:val"), "0")
    num_id_el = _get_or_add(num_pr, "w:numId")
    num_id_el.set(_qn("w:val"), str(num_id))


def _is_signature_line(line: str) -> bool:
    text = line.lower()
    return "pgs" in text or "pág" in text or "pag" in text


def _is_nested_line(line: str) -> bool:
    return line.strip().lower().startswith(("dobra", "dobr"))


def _add_text_line(doc, line: str) -> None:
    if not line.strip():
        return
    style_name = "Txt7Hif1" if _is_nested_line(line) else "Txt6Hif1"
    paragraph = doc.add_paragraph(style=style_name)
    _set_direct_numbering(paragraph, 39 if style_name == "Txt7Hif1" else 37)
    run = paragraph.add_run(line.strip())
    run.font.name = "Calibri"
    run.font.size = None
    if _is_signature_line(line):
        run.bold = True


def _add_block_title(doc, title: str) -> None:
    parts = [part.strip() for part in title.split(">") if part.strip()]
    if not parts:
        return
    if len(parts) > 1:
        doc.add_paragraph(parts[0], style="TitA2n")
        doc.add_paragraph(parts[1], style="TitA3n")
    elif parts[0].lower() == "acabamento":
        doc.add_paragraph(parts[0], style="TitA2n")
    else:
        doc.add_paragraph(parts[0], style="TitA3n")


def write_sequencia_docx(draft: SequenciaDraft, target_path: str | Path) -> Path:
    try:
        from docx import Document
        from docx.shared import Twips
    except ImportError as exc:
        raise RuntimeError(
            "Dependência python-docx não instalada. Instale as dependências do backend."
        ) from exc

    path = Path(target_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    doc = Document()
    section = doc.sections[0]
    section.page_width = Twips(8391)
    section.page_height = Twips(11907)
    section.top_margin = Twips(851)
    section.right_margin = Twips(453)
    section.bottom_margin = Twips(567)
    section.left_margin = Twips(709)
    section.header_distance = Twips(720)
    section.footer_distance = Twips(720)

    _define_style_sheet(doc)
    _ensure_numbering(doc)

    doc.add_paragraph(
        f"Sequência de Produção da OS {draft.os.numero:05d}/{draft.os.ano}",
        style="Tit1",
    )

    doc.add_paragraph()

    for section_draft in draft.sections:
        for block in section_draft.blocks:
            if not block.title.strip() and not any(line.strip() for line in block.lines):
                continue
            _add_block_title(doc, block.title.strip())
            for line in block.lines:
                _add_text_line(doc, line)
            doc.add_paragraph()

    doc.save(path)
    return path

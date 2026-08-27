"""Gera o ofício de orçamento em PDF (fpdf2), no formato do DOC-modelo."""
from __future__ import annotations

from datetime import date
from io import BytesIO
from typing import Any

from fpdf import FPDF

_MESES = (
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
)


def _txt(value: Any) -> str:
    return str(value or "").encode("latin-1", "replace").decode("latin-1")


def _brl(value: Any) -> str:
    try:
        n = float(value)
    except (TypeError, ValueError):
        n = 0.0
    formatted = f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatted}"


def _data_extenso(value: Any) -> str:
    d: date
    if isinstance(value, date):
        d = value
    else:
        text = str(value or "")[:10]
        try:
            y, m, day = (int(p) for p in text.split("-"))
            d = date(y, m, day)
        except (ValueError, TypeError):
            d = date.today()
    return f"Brasília, {d.day} de {_MESES[d.month - 1]} de {d.year}."


class OrcamentoOficioPDF(FPDF):
    def __init__(self, endereco: str, telefone: str):
        super().__init__(format="A4")
        self._endereco = endereco
        self._telefone = telefone
        self.set_auto_page_break(auto=True, margin=22)
        self.set_margins(20, 18, 20)

    def footer(self):
        self.set_y(-18)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(80, 80, 80)
        self.cell(0, 4, _txt(f"Endereço: {self._endereco}"), align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 4, _txt(f"Telefone: {self._telefone}"), align="C", new_x="LMARGIN", new_y="NEXT")


def build_orcamento_pdf(record: dict) -> bytes:
    snap = record.get("snapshot") or {}
    oficio = (snap.get("oficio") or {})
    entrada = snap.get("entrada") or {}
    os_meta = entrada.get("os") or {}
    pdf = OrcamentoOficioPDF(
        endereco=oficio.get("endereco") or "",
        telefone=oficio.get("telefone") or "",
    )
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(
        0,
        10,
        _txt(f"ORÇAMENTO {record['numero']}/{record['ano']}"),
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 11)
    processo = oficio.get("processo") or os_meta.get("processo") or ""
    if processo:
        pdf.cell(0, 6, _txt(f"Processo nº {processo}"), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(
        0,
        6,
        _txt(f"Ordem de serviço nº {record['nro_protocolo']}/{record['ano_protocolo']}"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)
    pdf.cell(0, 6, _txt(_data_extenso(os_meta.get("data_entrada"))), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, _txt(f"Solicitante: {oficio.get('solicitante') or ''}"), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, _txt(f"Título: {oficio.get('titulo') or ''}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, _txt("Especificação Solicitada:"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(0, 5.5, _txt(oficio.get("especificacao") or ""), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, _txt("Especificação Orçada:"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(0, 5.5, _txt(oficio.get("especificacao") or ""), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pags = oficio.get("paginas") or 0
    pdf.cell(0, 6, _txt(f"Nº.de páginas: {int(pags):02d}"), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, _txt(f"Tiragem: {oficio.get('tiragem') or 0}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, _txt(f"Valor total: {_brl(oficio.get('valor_total'))}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(0, 5, _txt("- " + (oficio.get("clausula_validade") or "")), new_x="LMARGIN", new_y="NEXT")
    pdf.multi_cell(0, 5, _txt("- " + (oficio.get("clausula_entrega") or "")), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(14)

    col_w = 85
    y = pdf.get_y()
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(
        col_w,
        5,
        _txt("Encaminho o presente orçamento conforme solicitação recebida e obedecida a norma vigente."),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    y_left = pdf.get_y()
    pdf.set_xy(20 + col_w + 10, y)
    pdf.multi_cell(col_w, 5, _txt("Autorizo a execução do trabalho especificado."), new_x="LMARGIN", new_y="NEXT")
    pdf.set_xy(20, max(y_left, pdf.get_y()) + 16)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(col_w, 5, _txt(oficio.get("signatario") or ""), new_x="RIGHT", new_y="TOP")
    pdf.cell(col_w, 5, _txt("Responsável"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(col_w, 5, _txt(oficio.get("cargo") or ""), new_x="RIGHT", new_y="TOP")
    pdf.cell(col_w, 5, _txt("Assinatura e Carimbo"), new_x="LMARGIN", new_y="NEXT")

    buffer = BytesIO()
    pdf.output(buffer)
    buffer.seek(0)
    return buffer.read()

"""
Conversão de PDF (PT individual) para HTML_Snapshot no padrão visual de tabProblemasPadrao.

Baseado em convertpdf.py (PyMuPDF); o conteúdo extraído é envolvido em .document-container
com as mesmas classes CSS usadas nos PTs registrados pelo sistema.
"""
from __future__ import annotations

import html as html_module
import logging
import os
import re
from typing import Optional

logger = logging.getLogger(__name__)

# Mesmo bloco de estilos dos snapshots em tabProblemasPadrao (AnaliseHtmlViewer).
PT_DOCUMENT_STYLES = """
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Calibri", "Arial", sans-serif; line-height: 1.4; color: #000000; background-color: #f0f0f0; padding: 20px; font-size: 11pt; }
    .document-container { max-width: 210mm; margin: 0 auto; background: white; padding: 20mm; box-shadow: 0 0 15px rgba(0,0,0,0.1); }

    .section-title { font-size: 14pt; font-weight: bold; font-style: italic; color: #800000; margin-top: 25pt; margin-bottom: 10pt; padding-bottom: 5pt; border-bottom: 1px solid #BFBFBF; text-transform: uppercase; }
    .section-title:first-child { margin-top: 0; }

    .description { margin-bottom: 10pt; text-align: justify; white-space: pre-wrap; }

    .providencias-bar { background-color: #404040; color: white; padding: 3px 10px; margin-bottom: 8pt; font-weight: bold; display: block; width: 100%; }
    .providencias-bar::before { content: "\\25ba"; color: white; margin-right: 8px; }

    .action-list { list-style: none; margin-bottom: 15pt; }
    .action-item { margin-bottom: 6pt; padding-left: 20px; position: relative; text-align: justify; }
    .action-item::before { content: "-"; position: absolute; left: 0; font-weight: bold; color: #333; }

    .alert-sefoc { color: #C00000; font-weight: bold; font-style: italic; margin: 10pt 0; padding-left: 20px; border-left: 3px solid #C00000; }

    .tips-title { color: #2c3e50; font-weight: bold; margin-top: 15pt; margin-bottom: 5pt; text-decoration: underline; }
    .tip-content { font-size: 10.5pt; color: #555; margin-left: 10px; margin-bottom: 5pt; }

    .obs { font-style: italic; font-weight: bold; margin-top: 10px; }

    .pdf-pages { margin-top: 12pt; }
    .pagina-pdf { position: relative; margin: 0 auto 16pt; background: #fff; overflow: hidden; max-width: 100%; }
    .pagina-pdf p { margin: 0; }
"""

_PYMUPDF_PAGE_WRAPPER_RE = re.compile(
    r"^<html>\s*<body>\s*|\s*</body>\s*</html>\s*$",
    re.IGNORECASE | re.DOTALL,
)


def extract_pdf_pages_html(pdf_path: str) -> str:
    """Extrai páginas do PDF como HTML posicionado (PyMuPDF)."""
    import fitz  # pymupdf — já em requirements.txt

    if not pdf_path or not os.path.isfile(pdf_path):
        raise FileNotFoundError(f"PDF não encontrado: {pdf_path}")

    doc = fitz.open(pdf_path)
    try:
        parts: list[str] = []
        for num_pagina in range(len(doc)):
            pagina = doc[num_pagina]
            rect = pagina.rect
            largura = rect.width
            altura = rect.height
            conteudo = pagina.get_text("html") or ""
            conteudo_limpo = _PYMUPDF_PAGE_WRAPPER_RE.sub("", conteudo.strip())
            parts.append(
                f"<div class='pagina-pdf' style='width:{largura}px;min-height:{altura}px;'>"
                f"{conteudo_limpo}</div>"
            )
        return "\n".join(parts)
    finally:
        doc.close()


def wrap_pt_document_html(*, titulo: str, body_inner_html: str, page_title: str = "Problema Técnico") -> str:
    """Monta documento completo com estilos padrão Sagra."""
    safe_title = html_module.escape((titulo or "Problema técnico").strip())
    safe_page_title = html_module.escape(page_title)
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"/><title>{safe_page_title}</title>
<style>
{PT_DOCUMENT_STYLES}
</style>
</head>
<body>
    <div class="document-container">
        <h2 class="section-title">{safe_title}</h2>
        <div class="pdf-pages">
{body_inner_html}
        </div>
    </div>
</body>
</html>"""


def build_metadata_fallback_html(
    *,
    titulo: str,
    mensagem: str,
    versao_label: Optional[str] = None,
    componente: Optional[str] = None,
) -> str:
    """HTML mínimo no padrão Sagra quando o PDF não está disponível."""
    safe_title = html_module.escape((titulo or "Problema técnico").strip())
    safe_msg = html_module.escape(mensagem)
    meta_parts = []
    if versao_label:
        meta_parts.append(f"Versão {html_module.escape(versao_label)}")
    if componente:
        meta_parts.append(html_module.escape(componente))
    meta_html = ""
    if meta_parts:
        meta_html = f'<p class="description">{" · ".join(meta_parts)}</p>'
    return wrap_pt_document_html(
        titulo=titulo,
        body_inner_html=(
            f'{meta_html}<div class="alert-sefoc">{safe_msg}</div>'
        ),
        page_title=titulo or "Problema Técnico",
    )


def convert_pdf_file_to_pt_html(pdf_path: str, titulo: str) -> str:
    """Converte PDF para HTML completo no padrão document-container."""
    pages_html = extract_pdf_pages_html(pdf_path)
    if not pages_html.strip():
        raise ValueError(f"PDF sem conteúdo extraível: {pdf_path}")
    return wrap_pt_document_html(titulo=titulo, body_inner_html=pages_html)


def convert_pdf_file_to_pt_html_safe(pdf_path: str, titulo: str) -> Optional[str]:
    """Converte PDF ou retorna None em caso de falha (log sem propagar)."""
    try:
        return convert_pdf_file_to_pt_html(pdf_path, titulo)
    except Exception as exc:
        logger.warning("Falha ao converter PDF para HTML (%s): %s", pdf_path, exc)
        return None

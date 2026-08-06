#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Converte docs/MANUAL_COMPLETO_SAGRA_WEB.md em PDF profissional.

Dependências:
  pip install markdown playwright
  python -m playwright install chromium

Uso:
  python docs/manual_pdf_assets/convert_manual_to_pdf.py
  python docs/manual_pdf_assets/convert_manual_to_pdf.py --part 2
  python docs/manual_pdf_assets/convert_manual_usuario_to_pdf.py
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

import markdown
from markdown.extensions.toc import slugify_unicode
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
ASSETS = DOCS / "manual_pdf_assets"
MD_PATH = DOCS / "MANUAL_COMPLETO_SAGRA_WEB.md"
PDF_PATH = DOCS / "MANUAL_COMPLETO_SAGRA_WEB.pdf"
CSS_PATH = ASSETS / "manual-style.css"
HTML_PATH = ASSETS / "MANUAL_COMPLETO_SAGRA_WEB.html"


def read_markdown() -> str:
    text = MD_PATH.read_text(encoding="utf-8")
    # Correções simples de formatação (preserva conteúdo técnico)
    text = text.replace(
        "| PDF legado SAT | link | `GET /api/analise/legacy-pt/{sat}/pdf` | Consulta |",
        "| PDF legado SAT | `GET /api/analise/legacy-pt/{sat}/pdf` | Consulta |",
    )
    return text


def extract_part2_sumario(sumario_md: str) -> str:
    idx = sumario_md.find("### Parte 2")
    if idx != -1:
        return sumario_md[idx:].strip()
    lines = []
    for line in sumario_md.splitlines():
        m = re.match(r"^(\d+)\.\s+\[", line.strip())
        if m and int(m.group(1)) >= 15:
            lines.append(line)
    return "\n".join(lines)


def extract_part2_content(text: str) -> str:
    start = text.find("# PARTE 2")
    if start == -1:
        raise ValueError("Parte 2 não encontrada no Markdown.")
    return text[start:].strip()


def split_markdown(text: str, part: str = "all") -> tuple[str, str, str, str]:
    """Retorna (título, capa_md, sumário_md, conteúdo_md)."""
    title_match = re.match(r"^#\s+(.+?)\s*$", text, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else "MANUAL SAGRA WEB"

    capa_m = re.search(r"## Capa\s*\n+(.*?)\n+---", text, re.DOTALL)
    capa_md = capa_m.group(1).strip() if capa_m else ""

    sum_m = re.search(r"## Sumário\s*\n+(.*?)\n+---", text, re.DOTALL)
    sumario_md = sum_m.group(1).strip() if sum_m else ""

    if part == "2":
        sumario_md = extract_part2_sumario(sumario_md)
        content_md = extract_part2_content(text)
        return title, capa_md, sumario_md, content_md

    start = text.find("# PARTE 1")
    if start == -1:
        start = text.find("## 1. Apresentação do Sistema")
    if start == -1:
        start = text.find("## 1.")
    content_md = text[start:].strip() if start != -1 else text

    return title, capa_md, sumario_md, content_md


def parse_capa_table(capa_md: str) -> dict[str, str]:
    data: dict[str, str] = {}
    for line in capa_md.splitlines():
        if not line.strip().startswith("|") or "---" in line:
            continue
        parts = [p.strip() for p in line.strip("|").split("|")]
        if len(parts) >= 2:
            key = re.sub(r"\*\*", "", parts[0]).strip()
            val = re.sub(r"\*\*", "", parts[1]).strip()
            data[key] = val
    return data


def build_cover_html(capa: dict[str, str], title: str) -> str:
    nome = capa.get("Nome do sistema", title)
    if "—" in nome:
        main_title, subtitle = [p.strip() for p in nome.split("—", 1)]
    else:
        main_title, subtitle = nome, "Sistema de Acompanhamento Gráfico"

    versao = capa.get("Versão do manual", "2.0")
    data_ger = capa.get("Data de geração", "")
    org = capa.get(
        "Subtítulo",
        capa.get("Organização", "DEAPA / SEFOC — Câmara dos Deputados"),
    )
    doc_type = capa.get(
        "Finalidade do documento",
        capa.get("Tipo do documento", "Manual técnico e operacional"),
    )
    if len(doc_type) > 120:
        doc_type = "Manual técnico e operacional — Parte 1 (técnica) e Parte 2 (usuário final)"

    return f"""
<section class="cover-page" aria-label="Capa">
  <div class="cover-org">{org}</div>
  <h1 class="cover-title">{main_title}</h1>
  <p class="cover-subtitle">{subtitle}</p>
  <p class="cover-doc-type">{doc_type}</p>
  <div class="cover-meta">
    <p><strong>Versão:</strong> {versao}</p>
    <p><strong>Data de geração:</strong> {data_ger}</p>
    <p><strong>Última revisão:</strong> {capa.get("Última revisão", data_ger)}</p>
  </div>
</section>
"""


def build_cover_html_usuario(capa: dict[str, str], title: str) -> str:
    nome = capa.get("Nome do sistema", title)
    if "—" in nome:
        main_title, _ = [p.strip() for p in nome.split("—", 1)]
    else:
        main_title = nome

    versao = capa.get("Versão do manual", "2.0")
    data_ger = capa.get("Data de geração", "")
    org = capa.get(
        "Subtítulo",
        capa.get("Organização", "DEAPA / SEFOC — Câmara dos Deputados"),
    )

    return f"""
<section class="cover-page" aria-label="Capa">
  <div class="cover-org">{org}</div>
  <h1 class="cover-title">{main_title}</h1>
  <p class="cover-subtitle">Manual do Usuário Final</p>
  <p class="cover-doc-type">Parte 2 — Guia operacional para operadores e clientes</p>
  <div class="cover-meta">
    <p><strong>Versão:</strong> {versao}</p>
    <p><strong>Data de geração:</strong> {data_ger}</p>
    <p><strong>Seções:</strong> 15 a 33</p>
  </div>
</section>
"""


def build_doc_info_usuario(capa: dict[str, str]) -> str:
    rows = [
        ("Versão do manual", capa.get("Versão do manual", "2.0")),
        ("Data de geração", capa.get("Data de geração", "")),
        ("Público-alvo", capa.get("Público-alvo", "")),
        ("Confidencialidade", capa.get("Confidencialidade", "")),
    ]
    body = "\n".join(f"| **{k}** | {v} |" for k, v in rows if v)
    table = f"| Campo | Valor |\n|-------|-------|\n{body}"
    inner = md_to_html(f"## Informações do Documento\n\n{table}")
    return f'<section class="doc-info">{inner}</section>'


def preprocess_mermaid(md_text: str) -> str:
    """Converte blocos ```mermaid em divs HTML para renderização via mermaid.js."""

    def repl(match: re.Match[str]) -> str:
        code = match.group(1).strip()
        return f'\n<div class="mermaid">\n{code}\n</div>\n'

    return re.sub(r"```mermaid\s*\n(.*?)```", repl, md_text, flags=re.DOTALL)


def md_to_html(md_text: str) -> str:
    md_text = preprocess_mermaid(md_text)
    md = markdown.Markdown(
        extensions=[
            "tables",
            "fenced_code",
            "toc",
            "sane_lists",
            "nl2br",
        ],
        extension_configs={
            "toc": {
                "slugify": slugify_unicode,
                "permalink": False,
                "toc_depth": 4,
            }
        },
    )
    html = md.convert(md_text)
    return enhance_html(html)


def enhance_html(html: str) -> str:
    """Caixas de aviso, validação manual e checklists."""
    patterns = [
        (
            r"<blockquote>\s*<p><strong>Atenção:</strong>\s*(.*?)</p>\s*</blockquote>",
            r'<div class="alert alert-atencao"><strong>Atenção:</strong> \1</div>',
        ),
        (
            r"<blockquote>\s*<p><strong>Importante:</strong>\s*(.*?)</p>\s*</blockquote>",
            r'<div class="alert alert-importante"><strong>Importante:</strong> \1</div>',
        ),
        (
            r"<blockquote>\s*<p><strong>Risco:</strong>\s*(.*?)</p>\s*</blockquote>",
            r'<div class="alert alert-risco"><strong>Risco:</strong> \1</div>',
        ),
    ]
    for pat, repl in patterns:
        html = re.sub(pat, repl, html, flags=re.DOTALL | re.IGNORECASE)

    # Avisos cujo conteúdo continua em lista imediatamente abaixo (sem tags intermediárias)
    html = merge_adjacent_alert_lists(html)

    # Validação manual (markdown e HTML já convertido)
    html = re.sub(
        r"\*\*necessita validação manual\*\*",
        '<strong class="alert-validacao-inline">necessita validação manual</strong>',
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r"<strong>necessita validação manual</strong>",
        '<strong class="alert-validacao-inline">necessita validação manual</strong>',
        html,
        flags=re.IGNORECASE,
    )

    # Checklists markdown [ ] -> checkbox visual
    html = re.sub(
        r"<li>\s*\[ \]\s*",
        '<li><input type="checkbox" disabled> ',
        html,
    )

    # Blocos **Atenção:** / **Importante:** / **Resultado esperado:** em parágrafos
    for label, css in [
        ("Atenção", "alert-atencao"),
        ("Importante", "alert-importante"),
        ("Resultado esperado", "alert-resultado"),
    ]:
        html = re.sub(
            rf"<p><strong>{label}:</strong>\s*(.*?)</p>",
            rf'<div class="alert alert-{css}"><strong>{label}:</strong> \1</div>',
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )

    # Separador visual Parte 1 / Parte 2
    html = html.replace(
        "<h1>PARTE 1 — MANUAL TÉCNICO DO SISTEMA</h1>",
        '<section class="part-divider part-1"><h1>PARTE 1 — MANUAL TÉCNICO DO SISTEMA</h1></section>',
    )
    html = html.replace(
        "<h1>PARTE 2 — MANUAL DO USUÁRIO FINAL</h1>",
        '<section class="part-divider part-2"><h1>PARTE 2 — MANUAL DO USUÁRIO FINAL</h1></section>',
    )

    return html


def merge_adjacent_alert_lists(html: str) -> str:
    """Agrupa alerta + lista somente quando a lista vem logo após o alerta."""
    alert_pat = re.compile(
        r'<div class="alert alert-(?:atencao|importante|risco)">.*?</div>',
        re.DOTALL | re.IGNORECASE,
    )
    list_pat = re.compile(r"^\s*(<[ou]l>.*?</[ou]l>)", re.DOTALL)

    out: list[str] = []
    last = 0
    for match in alert_pat.finditer(html):
        out.append(html[last : match.start()])
        alert_html = match.group(0)
        tail = html[match.end() :]
        list_match = list_pat.match(tail)
        if list_match and not re.search(r"<(?!/[ou]l)", tail[: list_match.start()]):
            out.append(
                f'<div class="alert-block">{alert_html}{list_match.group(1)}</div>'
            )
            last = match.end() + list_match.end()
        else:
            out.append(alert_html)
            last = match.end()
    out.append(html[last:])
    return "".join(out)


def build_sumario_html(sumario_md: str) -> str:
    # Converte lista numerada com links internos
    lines = sumario_md.splitlines()
    html_lines = ["<section class=\"toc-section\">", "<h2 id=\"sumario\">Sumário</h2>", "<div class=\"toc-body\">"]
    in_sub = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Sub-item com indentação
        sub_m = re.match(r"^\s*-\s+\[(.+?)\]\((#.+?)\)\s*$", line)
        num_m = re.match(r"^(\d+)\.\s+\[(.+?)\]\((#.+?)\)\s*$", stripped)
        if num_m:
            if in_sub:
                html_lines.append("</ul>")
                in_sub = False
            html_lines.append(
                f'<p class="toc-item"><strong>{num_m.group(1)}.</strong> '
                f'<a href="{num_m.group(3)}">{num_m.group(2)}</a></p>'
            )
        elif sub_m:
            if not in_sub:
                html_lines.append("<ul>")
                in_sub = True
            html_lines.append(
                f'<li><a href="{sub_m.group(2)}">{sub_m.group(1)}</a></li>'
            )
        elif stripped.startswith("-"):
            if not in_sub:
                html_lines.append("<ul>")
                in_sub = True
            html_lines.append(f"<li>{stripped.lstrip('- ')}</li>")
        elif stripped.startswith("### "):
            if in_sub:
                html_lines.append("</ul>")
                in_sub = False
            html_lines.append(f'<h3 class="toc-part">{stripped[4:]}</h3>')
        else:
            html_lines.append(f"<p>{stripped}</p>")
    if in_sub:
        html_lines.append("</ul>")
    html_lines.extend(["</div>", "</section>"])
    return "\n".join(html_lines)


def build_doc_info_html(capa_md: str) -> str:
    body = md_to_html(f"## Informações do Documento\n\n{capa_md}")
    return f'<section class="doc-info">{body}</section>'


def build_full_html(title: str, body_inner: str) -> str:
    css_uri = CSS_PATH.as_uri()
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <link rel="stylesheet" href="{css_uri}">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body>
{body_inner}
<script>
  document.addEventListener("DOMContentLoaded", function() {{
    if (typeof mermaid !== "undefined") {{
      mermaid.initialize({{ startOnLoad: true, theme: "neutral", securityLevel: "loose" }});
    }}
  }});
</script>
</body>
</html>
"""


def render_pdf(
    html_path: Path,
    pdf_path: Path,
    version: str = "2.0",
    doc_label: str = "Manual Técnico-Operacional",
) -> None:
    footer = f"""
    <div style="width:100%;font-size:8pt;color:#64748b;padding:0 18mm 0 18mm;
                font-family:Segoe UI,Arial,sans-serif;display:flex;
                justify-content:space-between;align-items:center;">
      <span>SAGRA Web — {doc_label} v{version}</span>
      <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
    </div>
    """
    header = """
    <div style="width:100%;font-size:7.5pt;color:#94a3b8;padding:0 18mm 2mm 18mm;
                font-family:Segoe UI,Arial,sans-serif;border-bottom:1px solid #e2e8f0;">
      DEAPA / SEFOC — Sistema de Acompanhamento Gráfico
    </div>
    """
    cover_footer = f"""
    <div style="width:100%;font-size:8pt;color:#64748b;padding:0 18mm;
                font-family:Segoe UI,Arial,sans-serif;text-align:center;">
      <span>SAGRA Web — {doc_label} v{version}</span>
    </div>
    """

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(html_path.as_uri(), wait_until="networkidle")
        page.wait_for_timeout(1500)
        page.evaluate(
            """async () => {
              if (typeof mermaid !== 'undefined') {
                try { await mermaid.run({ querySelector: '.mermaid' }); } catch (e) {}
              }
            }"""
        )
        page.wait_for_timeout(2500)

        cover_pdf = pdf_path.with_suffix(".cover.tmp.pdf")
        content_pdf = pdf_path.with_suffix(".content.tmp.pdf")

        # Capa isolada — sem cabeçalho/rodapé numerado
        page.pdf(
            path=str(cover_pdf),
            format="A4",
            print_background=True,
            display_header_footer=True,
            header_template="<div></div>",
            footer_template=cover_footer,
            page_ranges="1",
            margin={"top": "12mm", "bottom": "16mm", "left": "0", "right": "0"},
            prefer_css_page_size=True,
        )

        # Conteúdo restante com cabeçalho e numeração (páginas 2+)
        page.pdf(
            path=str(content_pdf),
            format="A4",
            print_background=True,
            display_header_footer=True,
            header_template=header,
            footer_template=footer,
            page_ranges="2-",
            margin={"top": "20mm", "bottom": "22mm", "left": "0", "right": "0"},
            prefer_css_page_size=True,
        )

        browser.close()

    merge_pdfs([cover_pdf, content_pdf], pdf_path)
    cover_pdf.unlink(missing_ok=True)
    content_pdf.unlink(missing_ok=True)


def merge_pdfs(sources: list[Path], dest: Path) -> None:
    from pypdf import PdfWriter

    writer = PdfWriter()
    for src in sources:
        if src.is_file():
            writer.append(str(src))
    with dest.open("wb") as f:
        writer.write(f)


def generate_pdf(part: str = "all") -> int:
    if not MD_PATH.is_file():
        print(f"ERRO: Markdown não encontrado: {MD_PATH}", file=sys.stderr)
        return 1

    ASSETS.mkdir(parents=True, exist_ok=True)

    if part == "2":
        pdf_path = DOCS / "MANUAL_USUARIO_FINAL_SAGRA_WEB.pdf"
        html_path = ASSETS / "MANUAL_USUARIO_FINAL_SAGRA_WEB.html"
        doc_label = "Manual do Usuário Final"
    else:
        pdf_path = PDF_PATH
        html_path = HTML_PATH
        doc_label = "Manual Técnico-Operacional"

    raw = read_markdown()
    title, capa_md, sumario_md, content_md = split_markdown(raw, part=part)
    capa = parse_capa_table(capa_md)

    if part == "2":
        cover_html = build_cover_html_usuario(capa, title)
        doc_info_html = build_doc_info_usuario(capa)
    else:
        cover_html = build_cover_html(capa, title)
        doc_info_html = build_doc_info_html(capa_md)

    sumario_html = build_sumario_html(sumario_md)
    content_html = md_to_html(content_md)

    body = (
        cover_html
        + doc_info_html
        + sumario_html
        + f'<main class="content">{content_html}</main>'
    )
    page_title = (
        "SAGRA Web — Manual do Usuário Final"
        if part == "2"
        else title
    )
    full_html = build_full_html(page_title, body)

    html_path.write_text(full_html, encoding="utf-8")
    print(f"HTML gerado: {html_path}")

    versao = capa.get("Versão do manual", "2.0")
    render_pdf(html_path, pdf_path, version=versao, doc_label=doc_label)

    if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
        print("ERRO: PDF não foi criado ou está vazio.", file=sys.stderr)
        return 1

    size_kb = pdf_path.stat().st_size / 1024
    print(f"PDF gerado: {pdf_path} ({size_kb:.1f} KB)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Converte manual SAGRA Web em PDF.")
    parser.add_argument(
        "--part",
        choices=("all", "2"),
        default="all",
        help="Gerar manual completo (all) ou apenas Parte 2 — usuário final (2).",
    )
    args = parser.parse_args()
    return generate_pdf(part=args.part)


if __name__ == "__main__":
    sys.exit(main())

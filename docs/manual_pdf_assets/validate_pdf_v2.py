#!/usr/bin/env python3
"""Validação do PDF manual v2.0."""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "docs" / "MANUAL_COMPLETO_SAGRA_WEB.pdf"
HTML = ROOT / "docs" / "manual_pdf_assets" / "MANUAL_COMPLETO_SAGRA_WEB.html"
MD = ROOT / "docs" / "MANUAL_COMPLETO_SAGRA_WEB.md"


def norm(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn"
    )


def main() -> dict:
    r = PdfReader(str(PDF))
    combined = "\n".join((p.extract_text() or "") for p in r.pages)
    cn = norm(combined)
    html = HTML.read_text(encoding="utf-8")

    checks = {
        "pdf_exists": PDF.is_file(),
        "pdf_not_empty": PDF.is_file() and PDF.stat().st_size > 10_000,
        "page_count": len(r.pages),
        "md_preserved": MD.is_file() and MD.stat().st_size > 50_000,
        "cover": "sagra web" in cn,
        "sumario": "sumario" in cn,
        "parte1": "parte 1" in cn or "visao geral tecnica" in cn,
        "parte2": "parte 2" in cn or "manual do usuario final" in cn,
        "endpoints": "apis e endpoints" in cn or "api/auth" in cn,
        "glossario": "glossario" in cn,
        "checklists": "checklists operacionais" in cn or "checklist" in cn,
        "portal_cliente": "portal do cliente" in cn,
        "html_tables": html.count("<table"),
        "html_mermaid_divs": html.count('class="mermaid"'),
        "html_alerts": html.count('class="alert'),
        "mermaid_in_pdf_text": any(
            k in cn for k in ("flowchart", "sequencediagram", "erdiagram", "participant")
        ),
    }
    return checks


if __name__ == "__main__":
    c = main()
    for k, v in c.items():
        print(f"{k}: {v}")

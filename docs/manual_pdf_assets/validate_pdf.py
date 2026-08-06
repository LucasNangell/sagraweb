#!/usr/bin/env python3
"""Validação estrutural do PDF do manual."""
from pathlib import Path
import re
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "docs" / "MANUAL_COMPLETO_SAGRA_WEB.pdf"
HTML = ROOT / "docs" / "manual_pdf_assets" / "MANUAL_COMPLETO_SAGRA_WEB.html"
MD = ROOT / "docs" / "MANUAL_COMPLETO_SAGRA_WEB.md"

SECTIONS = [
    "1. Apresentação do Sistema",
    "2. Conceitos Básicos",
    "3. Perfis de Usuário",
    "4. Acesso ao Sistema",
    "5. Estrutura Geral da Interface",
    "6. Mapa Completo de Páginas",
    "7. Manual Detalhado por Página",
    "8. Manual Completo de Funcionalidades",
    "9. Manual de Botões, Menus e Ações",
    "10. Manual de Formulários",
    "11. Manual de Permissões",
    "12. Manual dos Portais Públicos por Token",
    "13. Manual dos Painéis",
    "14. Manual Técnico da API",
    "15. Manual Técnico de Dados",
    "16. Integrações",
    "17. Erros Comuns e Soluções",
    "18. Checklist de Testes Manuais",
    "19. Glossário",
    "20. Anexos Técnicos",
    "21. Conclusão",
    "22. Matriz de Conferência de Cobertura",
    "23. Histórico de Revisão do Manual",
]


def main():
    r = PdfReader(str(PDF))
    pages_text = [(i + 1, (p.extract_text() or "")) for i, p in enumerate(r.pages)]
    combined = "\n".join(t for _, t in pages_text)

    print("=== PDF ===")
    print(f"Pages: {len(r.pages)}")
    print(f"Size: {PDF.stat().st_size} bytes")

    print("\n=== SECTIONS ===")
    missing = []
    for s in SECTIONS:
        # Normalize for search - pypdf may strip accents oddly
        key = s.split(". ", 1)[1][:20] if ". " in s else s
        found = key.lower() in combined.lower() or s[:15] in combined
        status = "OK" if found else "MISSING"
        print(f"  [{status}] {s}")
        if not found:
            missing.append(s)

    print("\n=== FRONT MATTER ===")
    for label, needle in [
        ("Capa SAGRA Web", "SAGRA Web"),
        ("Informações do Documento", "Informações do Documento"),
        ("Sumário", "Sumário"),
        ("Versão 1.1", "1.1"),
    ]:
        print(f"  {'OK' if needle in combined else 'MISSING'}: {label}")

    print("\n=== HTML COUNTS ===")
    html = HTML.read_text(encoding="utf-8")
    print(f"  tables: {html.count('<table')}")
    alert_n = html.count('class="alert')
    cb_n = html.count('type="checkbox"')
    print(f"  alerts: {alert_n}")
    print(f"  checkboxes: {cb_n}")
    print(f"  pre blocks: {html.count('<pre>')}")
    print(f"  h2 sections: {len(re.findall(r'<h2 id=', html))}")

    md = MD.read_text(encoding="utf-8")
    print("\n=== MD COUNTS ===")
    h2_pat = re.compile(r"^## \d+\.", re.M)
    tbl_pat = re.compile(r"^\|[-: |]+\|$", re.M)
    chk_pat = re.compile(r"^- \[ \]", re.M)
    alr_pat = re.compile(r"^> \*\*(Atenção|Importante|Risco):", re.M)
    print(f"  ## sections: {len(h2_pat.findall(md))}")
    print(f"  tables (| --- |): {len(tbl_pat.findall(md))}")
    print(f"  checklists [ ]: {len(chk_pat.findall(md))}")
    print(f"  alerts: {len(alr_pat.findall(md))}")

    print("\n=== ACCENTS (HTML sample) ===")
    samples = ["Apresentação", "Gráfico", "Permissões", "Histórico", "Validação"]
    for s in samples:
        print(f"  {s}: {'OK' if s in html else 'MISSING'}")

    print("\n=== TOC LINKS ===")
    toc_links = re.findall(r'href="(#.+?)"', html[:8000])
    ids = set(re.findall(r'id="([^"]+)"', html))
    broken = [l for l in toc_links if l.lstrip("#") not in ids]
    print(f"  toc links: {len(toc_links)}, broken: {len(broken)}")
    if broken[:5]:
        print("  examples:", broken[:5])

    if missing:
        print(f"\nWARNING: {len(missing)} sections possibly missing in PDF text extraction")


if __name__ == "__main__":
    main()

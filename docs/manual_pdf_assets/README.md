# Conversão do Manual SAGRA Web para PDF

## Dependências

```bash
pip install markdown playwright
python -m playwright install chromium
```

## Gerar PDF

A partir da raiz do repositório:

```bash
python docs/manual_pdf_assets/convert_manual_to_pdf.py
```

## Saídas

| Arquivo | Descrição |
|---------|-----------|
| `docs/MANUAL_COMPLETO_SAGRA_WEB.pdf` | PDF final |
| `docs/manual_pdf_assets/MANUAL_COMPLETO_SAGRA_WEB.html` | HTML intermediário (depuração) |
| `docs/manual_pdf_assets/manual-style.css` | Folha de estilos |

## Pipeline

1. Lê `docs/MANUAL_COMPLETO_SAGRA_WEB.md`
2. Separa capa, metadados, sumário e conteúdo
3. Converte Markdown → HTML (tabelas, código, TOC)
4. Estiliza avisos (Atenção, Importante, Risco)
5. Exporta via Playwright/Chromium (A4, cabeçalho/rodapé, numeração)

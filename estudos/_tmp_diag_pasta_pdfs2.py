"""Mede PDFs relevantes da OS Pasta 6220 e config de imposição no DB."""
from __future__ import annotations

import os
import sys

import fitz

paths = [
    r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026\Deputados_Papelaria_2026\06220-JoaoCury-PastaAvulsocBolso\Sefoc\06220-JoaoCury-PastaAvulsocBolso-BaseSefoc.pdf",
    r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026\Deputados_Papelaria_2026\06220-JoaoCury-PastaAvulsocBolso\Sefoc\Offset\06220-JoaoCury-PastaAvulsocBolso_Offset_2Up_A4-Paisagem.pdf",
    r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026\Deputados_Papelaria_2026\06220-JoaoCury-PastaAvulsocBolso\Sefoc\Digital\06220-JoaoCury-PastaAvulsocBolso-Base_Digit_1Up_CC_478x328.pdf",
    r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026\Deputados_Papelaria_2026\06220-JoaoCury-PastaAvulsocBolso\Sefoc\AdminDocs\06220-JoaoCury-PastaAvulsocBolso-Base-Prova1_SEFOC.pdf",
]

# Varre Sefoc por PreImpresso / Gang / JDF
root = r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026\Deputados_Papelaria_2026\06220-JoaoCury-PastaAvulsocBolso"
for dirpath, _dirs, files in os.walk(root):
    for name in files:
        low = name.lower()
        if any(k in low for k in ("preimpresso", "pre-impresso", "imposicao", ".jdf", "gang")):
            paths.append(os.path.join(dirpath, name))

seen = set()
for p in paths:
    if p in seen:
        continue
    seen.add(p)
    print("FILE", p, "exists", os.path.isfile(p))
    if not os.path.isfile(p):
        continue
    if p.lower().endswith(".jdf"):
        with open(p, encoding="utf-8", errors="replace") as f:
            print(f.read()[:1500])
        continue
    doc = fitz.open(p)
    for i in range(doc.page_count):
        page = doc[i]
        r = page.rect
        print(
            f"  p{i + 1}: {r.width:.2f}x{r.height:.2f} pt = "
            f"{r.width * 25.4 / 72:.1f}x{r.height * 25.4 / 72:.1f} mm "
            f"mediabox={page.mediabox} crop={page.cropbox}"
        )
    doc.close()

# Config DB
sys.path.insert(0, r"C:\dev\SagraWeb\app\backend")
os.chdir(r"C:\dev\SagraWeb\app\backend")
from database import db  # noqa: E402

rows = db.execute_query(
    "SELECT Produto, Variante, ImposicaoConfigJson "
    "FROM tabPapelariaProdutoImposicao WHERE Produto LIKE %s",
    ("%Pasta%",),
)
print("DB rows", len(rows) if rows is not None else None)
if rows:
    for row in rows:
        print("---", row.get("Produto"), row.get("Variante"))
        print(row.get("ImposicaoConfigJson"))

job_rows = db.execute_query(
    "SELECT ID, Status, DadosJson, ConcluidoEm, TipoJob FROM tabPapelariaJobs "
    "WHERE NroProtocolo=%s AND AnoProtocolo=%s "
    "ORDER BY ID DESC LIMIT 8",
    (6220, 2026),
)
for j in job_rows or []:
    print(
        "JOB",
        j.get("ID"),
        j.get("TipoJob"),
        j.get("Status"),
        j.get("ConcluidoEm"),
    )
    dados = j.get("DadosJson") or ""
    print((dados[:2500] if isinstance(dados, str) else dados))

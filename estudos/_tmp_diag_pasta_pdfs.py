"""Diagnóstico rápido: tamanhos PDF Pasta + config DB."""
from __future__ import annotations

import os
import sys

import fitz

base = (
    r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026"
    r"\Deputados_Papelaria_2026\06220-JoaoCury-PastaAvulsocBolso\Sefoc"
)
print("exists", os.path.isdir(base))
if os.path.isdir(base):
    for name in sorted(os.listdir(base)):
        if not name.lower().endswith(".pdf"):
            continue
        p = os.path.join(base, name)
        doc = fitz.open(p)
        for i in range(doc.page_count):
            r = doc[i].rect
            print(
                f"{name} p{i + 1}: {r.width:.2f}x{r.height:.2f} pt = "
                f"{r.width * 25.4 / 72:.1f}x{r.height * 25.4 / 72:.1f} mm"
            )
        doc.close()

sys.path.insert(0, r"C:\dev\SagraWeb\app\backend")
from db import get_connection  # noqa: E402

conn = get_connection()
cur = conn.cursor()
cur.execute(
    "SELECT Produto, Variante, ImposicaoConfigJson "
    "FROM tabPapelariaProdutoImposicao WHERE Produto LIKE %s",
    ("%Pasta%",),
)
for row in cur.fetchall():
    print("---", row[0], row[1])
    print(row[2])
conn.close()

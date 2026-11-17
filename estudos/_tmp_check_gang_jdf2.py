import os
import re

import fitz

p = r"\\apogee\JDFImportRoot\Papelaria_Pasta\06220-JoaoCury-PastaAvulsocBolso-ImposicaoGang.pdf"
d = fitz.open(p)
for i in range(d.page_count):
    pix = d[i].get_pixmap(matrix=fitz.Matrix(0.15, 0.15), alpha=False)
    s = pix.pixel(pix.width // 2, pix.height // 2)
    print(f"page {i + 1} center rgb={s} sum={sum(s)}")
d.close()

jdf = r"\\apogee\JDFImportRoot\Papelaria_Pasta\2026_06220_JoaoCury-PastaAvulsocBolso_passthrough.jdf"
print("jdf exists", os.path.isfile(jdf))
if os.path.isfile(jdf):
    t = open(jdf, encoding="utf-8").read()
    m = re.search(r'NPage="(\d+)"', t)
    print("NPage", m.group(1) if m else None)
    for ln in t.splitlines():
        if any(k in ln for k in ("FileSpec", "UserFileName", "JobID=", "JobPartID=", "NPage=")):
            print(ln.strip()[:200])

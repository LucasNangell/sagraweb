from __future__ import annotations

import json
import os
import sys

import fitz

sys.path.insert(0, r"C:\dev\SagraWeb\app\backend")
os.chdir(r"C:\dev\SagraWeb\app\backend")
from database import db

rows = db.execute_query(
    "SELECT ID, Status, DadosJson, ArquivoPdfGerado, ConcluidoEm "
    "FROM tabPapelariaJobs WHERE NroProtocolo=%s AND AnoProtocolo=%s "
    "AND TipoJob=%s ORDER BY ID DESC LIMIT 3",
    (6220, 2026, "imposicao"),
)
for r in rows or []:
    d = json.loads(r["DadosJson"] or "{}")
    print("--- job", r["ID"], r["Status"], r["ConcluidoEm"])
    print("pasta_art_blank", d.get("pasta_art_blank_pages"))
    print("sem_imp", d.get("jdf_sem_imposicao"))
    print("gang", d.get("gang_pdf_path"))
    print("jdf", d.get("jdf_name"), d.get("jdf_path"))
    print("hotfolder_pdf", d.get("hotfolder_pdf"))
    print("jdf_dir", d.get("jdf_dir"))
    jdf_path = d.get("jdf_path") or ""
    if jdf_path and os.path.isfile(jdf_path):
        txt = open(jdf_path, encoding="utf-8", errors="replace").read()
        print("jdf exists, NPage", "NPage=" in txt)
        for line in txt.splitlines():
            if "FileSpec" in line or "NPage" in line or "JobID" in line or "JobPartID" in line:
                print(" ", line.strip()[:180])

paths = [
    r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026\Deputados_Papelaria_2026\06220-JoaoCury-PastaAvulsocBolso\Sefoc\06220-JoaoCury-PastaAvulsocBolso-ImposicaoGang.pdf",
    r"\\redecamara\DfsData\CGraf\Sefoc\Deputados\2026\Deputados_Papelaria_2026\06220-JoaoCury-PastaAvulsocBolso\Sefoc\06220-JoaoCury-PastaAvulsocBolso-BaseSefoc-PreImpresso.pdf",
    r"\\apogee\JDFImportRoot\Papelaria_Pasta\06220-JoaoCury-PastaAvulsocBolso-ImposicaoGang.pdf",
]
for p in paths:
    print("FILE", os.path.isfile(p), p)
    if not os.path.isfile(p):
        continue
    doc = fitz.open(p)
    for i in range(doc.page_count):
        rect = doc[i].rect
        print(
            f"  p{i + 1}: {rect.width * 25.4 / 72:.1f}x{rect.height * 25.4 / 72:.1f} mm"
        )
    doc.close()

hot = r"\\apogee\JDFImportRoot\Papelaria_Pasta"
print("HOT dir", os.path.isdir(hot))
if os.path.isdir(hot):
    names = os.listdir(hot)
    names.sort(key=lambda n: os.path.getmtime(os.path.join(hot, n)), reverse=True)
    for n in names[:20]:
        p = os.path.join(hot, n)
        print(" ", n, os.path.getsize(p) if os.path.isfile(p) else "")

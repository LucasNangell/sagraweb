from __future__ import annotations

import os
import sys

sys.path.insert(0, r"C:\dev\SagraWeb\app\backend")
os.chdir(r"C:\dev\SagraWeb\app\backend")
from database import db

rows = db.execute_query(
    "SELECT Produto, Variante, ImposicaoConfigJson, PastaImposicao "
    "FROM tabPapelariaProdutoImposicaoConfigs WHERE Produto LIKE %s",
    ("%Pasta%",),
)
print("configs", len(rows or []))
for row in rows or []:
    print("---", row.get("Produto"), row.get("Variante"), row.get("PastaImposicao"))
    print(row.get("ImposicaoConfigJson"))

jobs = db.execute_query(
    "SELECT ID, TipoJob, Status, DadosJson, ConcluidoEm FROM tabPapelariaJobs "
    "WHERE NroProtocolo=%s AND AnoProtocolo=%s ORDER BY ID DESC LIMIT 6",
    (6220, 2026),
)
for j in jobs or []:
    print("JOB", j.get("ID"), j.get("TipoJob"), j.get("Status"), j.get("ConcluidoEm"))
    print((j.get("DadosJson") or "")[:3000])

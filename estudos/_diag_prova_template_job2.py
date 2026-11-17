"""Diagnóstico job 241 / modelo 8."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(r"C:\dev\SagraWeb")
sys.path.insert(0, str(ROOT / "app" / "backend"))
os.chdir(ROOT / "app" / "backend")

env_path = ROOT / "config" / ".env"
if env_path.is_file():
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from database import db
from services import papelaria_jobs_service as jobs_svc
from services import papelaria_models_service as models_svc
from services.papelaria_prova_modo import get_modo

print("prova_modo", get_modo())
m = models_svc.get_modelo_by_id(8)
print("modelo8", {k: m.get(k) for k in ("id", "produto", "arquivo_modelo", "prova_email_template_pdf")} if m else None)
print("resolve", models_svc.resolve_prova_email_template_abs(m.get("prova_email_template_pdf") if m else None))

cols = db.execute_query("SHOW COLUMNS FROM tabPapelariaJobs")
print("job_cols", [c.get("Field") for c in cols])

jobs = db.execute_query(
    """
    SELECT ID, NroProtocolo, AnoProtocolo, ModeloID, Status, TipoJob, ArquivoPdfGerado
    FROM tabPapelariaJobs
    WHERE NroProtocolo = 6069 AND AnoProtocolo = 2026
    ORDER BY ID DESC
    LIMIT 5
    """
)
for j in jobs or []:
    print("job", dict(j))
    try:
        full = jobs_svc.get_job(int(j["ID"]))
        payload = jobs_svc.prepare_worker_payload(full) if full else None
        if payload:
            print(
                " payload prova_modo=",
                payload.get("prova_modo"),
                "template=",
                payload.get("prova_email_template_pdf"),
                "prova_pdf=",
                payload.get("prova_email_pdf_name"),
                "modelo_id=",
                payload.get("modelo_id"),
            )
    except Exception as exc:
        print(" payload_err", type(exc).__name__, exc)

# logs table?
for table in ("tabPapelariaJobLogs", "tabPapelariaJobsLogs", "tabPapelariaJobLog"):
    try:
        n = db.execute_query(f"SELECT COUNT(*) AS c FROM {table} WHERE JobID IN (240,241)")
        print(table, n)
        rows = db.execute_query(
            f"SELECT JobID, Mensagem FROM {table} WHERE JobID IN (240,241) ORDER BY ID DESC LIMIT 30"
        )
        for r in rows or []:
            print(" ", r.get("JobID"), (r.get("Mensagem") or "")[:200])
    except Exception as exc:
        print(table, "err", type(exc).__name__)

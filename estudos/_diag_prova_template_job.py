"""Diagnóstico: template prova e-mail vs jobs recentes OS 6069."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(r"C:\dev\SagraWeb")
sys.path.insert(0, str(ROOT / "app" / "backend"))
os.chdir(ROOT / "app" / "backend")

# Carrega .env DEV
env_path = ROOT / "config" / ".env"
if env_path.is_file():
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from database import db  # noqa: E402
from services import papelaria_models_service as models_svc  # noqa: E402

print("PROJECT_ROOT", models_svc.PROJECT_ROOT)
print("TEMPLATE_ROOT", models_svc.PROVA_EMAIL_TEMPLATE_ROOT)

rows = db.execute_query(
    """
    SELECT ID, Produto, ArquivoModelo, ProvaEmailTemplatePdf, Ativo
    FROM tabPapelariaModelos
    WHERE ProvaEmailTemplatePdf IS NOT NULL AND ProvaEmailTemplatePdf <> ''
    ORDER BY ID
    """
)
print("modelos_com_template", len(rows or []))
for r in rows or []:
    print(" modelo", dict(r))
    abs_path = models_svc.resolve_prova_email_template_abs(r.get("ProvaEmailTemplatePdf"))
    print("  resolved", abs_path, "exists", bool(abs_path and Path(abs_path).is_file()))

jobs = db.execute_query(
    """
    SELECT ID, NroProtocolo, AnoProtocolo, ModeloID, Status, TipoJob,
           ArquivoPdfGerado, CriadoEm, ConcluidoEm
    FROM tabPapelariaJobs
    WHERE NroProtocolo = 6069 AND AnoProtocolo = 2026
    ORDER BY ID DESC
    LIMIT 5
    """
)
print("jobs_6069", len(jobs or []))
for j in jobs or []:
    print(" job", dict(j))
    mid = j.get("ModeloID")
    if mid:
        m = models_svc.get_modelo_by_id(int(mid))
        print("  get_modelo_by_id keys template=", None if not m else m.get("prova_email_template_pdf"))
        if m:
            print("  resolve", models_svc.resolve_prova_email_template_abs(m.get("prova_email_template_pdf")))

# modo atual
from services.papelaria_prova_modo import get_modo

print("prova_modo", get_modo())

# logs do job 241 se existirem
try:
    logs = db.execute_query(
        """
        SELECT JobID, Nivel, Mensagem, CriadoEm
        FROM tabPapelariaJobLogs
        WHERE JobID IN (240, 241)
        ORDER BY ID DESC
        LIMIT 40
        """
    )
    print("logs", len(logs or []))
    for row in logs or []:
        print(" ", row.get("JobID"), row.get("Nivel"), (row.get("Mensagem") or "")[:180])
except Exception as exc:
    print("logs_err", type(exc).__name__, exc)

#!/usr/bin/env python3
"""Contagens pré-purge: OSs com ano < 2024."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402

YEAR_CUTOFF = 2024

QUERIES = [
    ("tabProtocolos", f"SELECT COUNT(*) c FROM tabProtocolos WHERE AnoProtocolo < {YEAR_CUTOFF}"),
    ("tabProtocolos (>=2024)", f"SELECT COUNT(*) c FROM tabProtocolos WHERE AnoProtocolo >= {YEAR_CUTOFF}"),
    ("tabAndamento", f"SELECT COUNT(*) c FROM tabAndamento WHERE AnoProtocoloLink < {YEAR_CUTOFF}"),
    ("tabAndamento (>=2024)", f"SELECT COUNT(*) c FROM tabAndamento WHERE AnoProtocoloLink >= {YEAR_CUTOFF}"),
    ("tabDetalhesServico", f"SELECT COUNT(*) c FROM tabDetalhesServico WHERE AnoProtocoloLinkDet < {YEAR_CUTOFF}"),
    ("tab_os_ultimo_andamento_operacional", f"SELECT COUNT(*) c FROM tab_os_ultimo_andamento_operacional WHERE ano_protocolo < {YEAR_CUTOFF}"),
    ("tab_os_sub_os", f"SELECT COUNT(*) c FROM tab_os_sub_os WHERE ano_protocolo < {YEAR_CUTOFF}"),
    ("tabMidiaDigital", f"SELECT COUNT(*) c FROM tabMidiaDigital WHERE AnoProtocoloLinkMidia < {YEAR_CUTOFF}"),
    ("tab_pcp_fila", f"SELECT COUNT(*) c FROM tab_pcp_fila WHERE ano < {YEAR_CUTOFF}"),
    ("tab_os_audit_log", f"SELECT COUNT(*) c FROM tab_os_audit_log WHERE ano < {YEAR_CUTOFF}"),
    ("andamento órfão (<2024, sem protocolo)", """
        SELECT COUNT(*) c FROM tabAndamento a
        LEFT JOIN tabProtocolos p ON p.NroProtocolo=a.NroProtocoloLink AND p.AnoProtocolo=a.AnoProtocoloLink
        WHERE a.AnoProtocoloLink < 2024 AND p.NroProtocolo IS NULL
    """),
]

def main():
    print(f"=== Contagens ano < {YEAR_CUTOFF} ===")
    for label, sql in QUERIES:
        try:
            c = db.execute_query(sql)[0]["c"]
            print(f"  {label}: {c:,}")
        except Exception as e:
            print(f"  {label}: ERRO {e}")

if __name__ == "__main__":
    main()

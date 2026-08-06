import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.cliente_os_timeline_service import build_cliente_os_timeline


def show(nr, ano):
    data = build_cliente_os_timeline(nr, ano)
    print(f"\n=== Timeline {nr}/{ano} (refs={data['referencia_os_count']}) ===")
    for s in data["steps"]:
        mark = "OK" if s["concluido"] else ".."
        dt = s.get("data")
        pend = ""
        if s.get("pendencia_label"):
            pend = f" | PEND: {s['pendencia_label']}"
        print(f"  [{mark}] {s['situacao']} | {s.get('setor') or '-'} | {dt}{pend}")


for nr, ano in [(952, 2026), (957, 2026), (186, 2026)]:
    show(nr, ano)

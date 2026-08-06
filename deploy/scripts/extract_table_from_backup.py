"""Extract a MySQL dump section for one table from a large backup file."""
from __future__ import annotations

import re
import sys
from pathlib import Path


def extract_table(path: Path, table: str) -> str:
    start_markers = [
        f"-- Table structure for table `{table}`",
        f"-- Table structure for table `{table.lower()}`",
    ]
    end_marker = "-- Table structure for table `"

    lines: list[str] = []
    in_section = False

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not in_section:
                if any(marker.lower() in line.lower() for marker in start_markers):
                    in_section = True
                    lines.append(line)
                continue

            if line.startswith(end_marker) and table.lower() not in line.lower():
                break

            lines.append(line)

    return "".join(lines)


def count_insert_rows(section: str) -> int:
    rows = 0
    for line in section.splitlines():
        if "INSERT INTO" in line.upper():
            rows += max(1, line.count("),(") + 1)
    return rows


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: python extract_table_from_backup.py <backup.sql> <table> [out.sql]")
        return 1

    path = Path(sys.argv[1])
    table = sys.argv[2]
    section = extract_table(path, table)
    if not section:
        print(f"Seção não encontrada para {table}")
        return 2

    row_count = count_insert_rows(section)
    print(f"Tabela: {table}")
    print(f"Tamanho da seção: {len(section)} bytes")
    print(f"Linhas INSERT (aprox.): {row_count}")

    preview = section[:1200]
    print("\n--- PREVIEW ---")
    print(preview)

    if len(sys.argv) >= 4:
        out = Path(sys.argv[3])
        out.write_text(section, encoding="utf-8")
        print(f"\nSeção salva em: {out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

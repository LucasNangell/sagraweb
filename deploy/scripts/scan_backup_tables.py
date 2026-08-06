"""Scan a MySQL dump for CREATE/INSERT markers of selected tables."""
from __future__ import annotations

import sys
from pathlib import Path

TABLES = [
    "tabProblemasPadrao",
    "tabAnalises",
    "tabAnaliseItens",
    "tabClientTokens",
    "tabMidiaDigital",
]


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scan_backup_tables.py <backup.sql>")
        return 1

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"Arquivo não encontrado: {path}")
        return 1

    needles = []
    for table in TABLES:
        needles.append((f"CREATE TABLE `{table}`", table, "create"))
        needles.append((f"INSERT INTO `{table}`", table, "insert"))

    counts: dict[tuple[str, str], int] = {}
    first_offset: dict[tuple[str, str], int | None] = {}
    for table in TABLES:
        counts[(table, "create")] = 0
        counts[(table, "insert")] = 0
        first_offset[(table, "create")] = None
        first_offset[(table, "insert")] = None

    chunk = 64 * 1024 * 1024
    overlap = 512
    offset = 0
    prev = b""

    with path.open("rb") as handle:
        while True:
            data = handle.read(chunk)
            if not data:
                break

            buf = prev + data
            for needle_text, table, kind in needles:
                needle = needle_text.encode("ascii")
                idx = 0
                while True:
                    pos = buf.find(needle, idx)
                    if pos == -1:
                        break
                    key = (table, kind)
                    counts[key] += 1
                    if first_offset[key] is None:
                        first_offset[key] = offset + pos - len(prev)
                    idx = pos + len(needle)

            prev = buf[-overlap:]
            offset += len(data)
            if offset % (512 * 1024 * 1024) == 0:
                print(f"bytes {offset // (1024 * 1024)} MB", flush=True)

    print("DONE")
    for table in TABLES:
        create_count = counts[(table, "create")]
        insert_count = counts[(table, "insert")]
        print(
            f"{table}: CREATE={create_count} INSERT={insert_count} "
            f"(first_create={first_offset[(table, 'create')]}, "
            f"first_insert={first_offset[(table, 'insert')]})"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

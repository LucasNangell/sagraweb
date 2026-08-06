"""Find table name occurrences in a MySQL dump."""
from __future__ import annotations

import sys
from pathlib import Path

NEEDLES = [
    b"tabProblemasPadrao",
    b"tabAnalises",
    b"tabAnaliseItens",
    b"tabClientTokens",
    b"tabMidiaDigital",
    b"ProblemasPadrao",
    b"AnaliseItens",
    b"ClientTokens",
]


def main() -> int:
    path = Path(sys.argv[1])
    counts = {n.decode("ascii"): 0 for n in NEEDLES}
    first = {n.decode("ascii"): None for n in NEEDLES}

    chunk = 64 * 1024 * 1024
    overlap = max(len(n) for n in NEEDLES) + 8
    offset = 0
    prev = b""

    with path.open("rb") as handle:
        while True:
            data = handle.read(chunk)
            if not data:
                break
            buf = prev + data
            for needle in NEEDLES:
                key = needle.decode("ascii")
                idx = 0
                while True:
                    pos = buf.find(needle, idx)
                    if pos == -1:
                        break
                    counts[key] += 1
                    if first[key] is None:
                        first[key] = offset + pos - len(prev)
                    idx = pos + len(needle)
            prev = buf[-overlap:]
            offset += len(data)

    for key in counts:
        print(f"{key}: count={counts[key]} first_offset={first[key]}")


if __name__ == "__main__":
    raise SystemExit(main())

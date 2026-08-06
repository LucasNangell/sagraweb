"""Find lowercase/variant table markers in MySQL dump."""
from __future__ import annotations

import sys
from pathlib import Path

NEEDLES = [
    b"tabproblemaspadrao",
    b"tabanalises",
    b"tabanaliseitens",
    b"tabclienttokens",
    b"tabmidiaDigital".lower(),
    b"problemaspadrao",
    b"analiseitens",
    b"clienttokens",
]


def scan(path: Path) -> None:
    counts = {n.decode("ascii"): 0 for n in NEEDLES}
    first = {n.decode("ascii"): None for n in NEEDLES}
    chunk = 64 * 1024 * 1024
    overlap = 64
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
    print(f"FILE: {path.name}")
    for key in counts:
        if counts[key]:
            print(f"  {key}: count={counts[key]} first_offset={first[key]}")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        scan(Path(arg))

#!/usr/bin/env python3
"""Gera mockups base da Papelaria (SVG + config.json + preview.png)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mockup_lib import (  # noqa: E402
    create_sample_art,
    get_mockup_definitions,
    mockups_root,
    save_mockup_bundle,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Gera mockups base da Papelaria.")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Pasta de saída (padrão: Modelos/papelaria/mockups)",
    )
    parser.add_argument(
        "--sample-art",
        action="store_true",
        help="Também cria tools/papelaria_mockups/sample_art.png para testes",
    )
    args = parser.parse_args(argv)

    out_root = args.output or mockups_root()
    out_root.mkdir(parents=True, exist_ok=True)

    created: list[Path] = []
    for mockup in get_mockup_definitions():
        target = save_mockup_bundle(mockup, out_root)
        created.append(target)
        print(f"OK  {target}")

    if args.sample_art:
        sample = create_sample_art(_ROOT / "sample_art.png")
        print(f"OK  {sample}")

    print(f"\n{len(created)} mockup(s) em {out_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

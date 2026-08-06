#!/usr/bin/env python3
"""Aplica uma imagem de arte sobre um mockup base da Papelaria."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mockup_lib import apply_art_to_mockup, repo_root  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Aplica arte em mockup da Papelaria.")
    parser.add_argument(
        "--mockup",
        type=Path,
        required=True,
        help="Diretório do mockup (ex.: Modelos/papelaria/mockups/cartao_visita_frente)",
    )
    parser.add_argument(
        "--arte",
        type=Path,
        required=True,
        help="Imagem da arte (PNG/JPG)",
    )
    parser.add_argument(
        "--face",
        default=None,
        help="ID da face no config.json (padrão: primeira face)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Caminho de saída (padrão: <mockup>/mockup_result.png)",
    )
    args = parser.parse_args(argv)

    mockup_dir = args.mockup
    if not mockup_dir.is_absolute():
        mockup_dir = repo_root() / mockup_dir

    out = apply_art_to_mockup(
        mockup_dir.resolve(),
        args.arte.resolve(),
        face_id=args.face,
        output_path=args.output.resolve() if args.output else None,
    )
    print(f"Mockup gerado: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

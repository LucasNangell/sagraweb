#!/usr/bin/env python3
"""Gera PDF apenas da Parte 2 — Manual do Usuário Final."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from convert_manual_to_pdf import generate_pdf

if __name__ == "__main__":
    sys.exit(generate_pdf(part="2"))

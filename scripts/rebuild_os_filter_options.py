#!/usr/bin/env python3
"""Backfill idempotente das tabelas auxiliares de filtros (produto/solicitante)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from services.os_filter_options_service import backfill_all_filter_options  # noqa: E402


def main() -> int:
    result = backfill_all_filter_options()
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

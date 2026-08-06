"""
Ajusta sys.path para imports do layout reorganizado (app/services, etc.).
Deve ser importado antes dos routers.
"""
from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_DIR.parent.parent

# Ordem: inserir app/services primeiro; backend por último fica no início do sys.path.
_PATHS = (
    _PROJECT_ROOT / "app" / "services",
    _BACKEND_DIR,
)

for _path in _PATHS:
    _path_str = str(_path)
    if _path.is_dir() and _path_str not in sys.path:
        sys.path.insert(0, _path_str)

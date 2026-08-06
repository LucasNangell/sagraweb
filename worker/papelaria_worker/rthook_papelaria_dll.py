"""Runtime hook: garante resolução de DLLs em _MEIPASS (pywin32, OpenSSL, etc.)."""
from __future__ import annotations

import os
import sys

if getattr(sys, "frozen", False):
    base = getattr(sys, "_MEIPASS", "")
    if base and os.path.isdir(base):
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(base)
        os.environ["PATH"] = base + os.pathsep + os.environ.get("PATH", "")

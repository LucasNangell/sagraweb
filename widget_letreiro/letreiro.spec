# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — SAGRA Letreiro (onefile, portátil, sem instalação)."""

import sys
from pathlib import Path

block_cipher = None
root = Path(SPECPATH)
py_base = Path(sys.base_prefix)
system32 = Path(r"C:\Windows\System32")


def _collect_runtime_dlls() -> list[tuple[str, str]]:
    binaries: list[tuple[str, str]] = []
    seen: set[str] = set()

    def _add(path: Path) -> None:
        key = path.name.lower()
        if key in seen or not path.is_file():
            return
        binaries.append((str(path), "."))
        seen.add(key)

    search_roots = (
        py_base,
        py_base / "DLLs",
        system32,
        system32 / "downlevel",
    )
    explicit_names = (
        "vcruntime140.dll",
        "vcruntime140_1.dll",
        "msvcp140.dll",
        "ucrtbase.dll",
        "api-ms-win-core-path-l1-1-0.dll",
    )
    for dll in py_base.glob("python*.dll"):
        _add(dll)
    for name in explicit_names:
        for base in search_roots:
            _add(base / name)
            if name.lower() in seen:
                break
    for folder in (system32, system32 / "downlevel"):
        if folder.is_dir():
            for path in sorted(folder.glob("api-ms-win-crt-*.dll")):
                _add(path)
    return binaries


a = Analysis(
    [str(root / "letreiro.py")],
    pathex=[str(root)],
    binaries=_collect_runtime_dlls(),
    datas=[(str(root / "config.example.yaml"), ".")],
    hiddenimports=[
        "api_client",
        "board",
        "config_store",
        "overlay",
        "settings_ui",
        "taskbar",
        "yaml",
        "requests",
        "urllib3",
        "certifi",
        "charset_normalizer",
        "idna",
        "tkinter",
        "tkinter.ttk",
        "tkinter.font",
        "tkinter.messagebox",
        "_tkinter",
        "win32api",
        "win32con",
        "win32gui",
        "pywintypes",
        "pythoncom",
        "win32timezone",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="SAGRA-Letreiro",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    contents_directory=".",
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — SAGRA Papelaria CorelDRAW Worker (onefile, autossuficiente)."""

import sys
from pathlib import Path

block_cipher = None
root = Path(SPECPATH)
py_base = Path(sys.base_prefix)
system32 = Path(r"C:\Windows\System32")

# None = %TEMP%\_MEI* (comportamento padrão PyInstaller, mais compatível).
RUNTIME_TMPDIR = None


def _collect_runtime_dlls() -> list[tuple[str, str]]:
    """
    Runtime Python + MSVC + UCRT na raiz do _MEIPASS.
    python310.dll depende dos forwarders api-ms-win-crt-* (não só vcruntime140).
    No Windows 10/11 recentes, os forwarders ficam em System32\\downlevel\\.
    """
    explicit_names = (
        "python310.dll",
        "python3.dll",
        "vcruntime140.dll",
        "vcruntime140_1.dll",
        "msvcp140.dll",
        "ucrtbase.dll",
        "api-ms-win-core-path-l1-1-0.dll",
    )
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
    [str(root / "worker.py")],
    pathex=[str(root)],
    binaries=_collect_runtime_dlls(),
    datas=[(str(root / "config.yaml"), ".")],
    hiddenimports=[
        "api_client",
        "config",
        "corel_generator",
        "credenciais_depol_generator",
        "timbrado_a4_digital_generator",
        "runtime",
        "system_load",
        "power",
        "auto_update",
        "psutil",
        "yaml",
        "requests",
        "urllib3",
        "certifi",
        "charset_normalizer",
        "idna",
        "pythoncom",
        "pywintypes",
        "win32com",
        "win32com.client",
        "win32timezone",
        "win32api",
        "win32con",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[str(root / "rthook_papelaria_dll.py")],
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
    name="SAGRA-Papelaria-Worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=RUNTIME_TMPDIR,
    contents_directory=".",
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

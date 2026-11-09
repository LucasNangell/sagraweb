# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['folder_opener_service.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'win32print',
        'win32ui',
        'win32con',
        'win32gui',
        'fitz',
        'PIL',
        'PIL.Image',
        'PIL.ImageWin',
        'cv2',
        'numpy',
        'fpdf',
        'pdf_compare_engine',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='SAGRA-FolderOpener',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

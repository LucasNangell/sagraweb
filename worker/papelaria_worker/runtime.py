"""Utilitários de execução (script Python vs executável PyInstaller)."""
from __future__ import annotations

import sys
from pathlib import Path

COREL_PROGID = "CorelDRAW.Application"
COREL_TLB_CLSID_PREFIX = "95E23C91-BC5A-49F3-8CD1-1FC515597048"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def application_dir() -> Path:
    """Pasta do .exe (frozen) ou do pacote worker (desenvolvimento)."""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def bundled_config_path() -> Path | None:
    """config.yaml embutido no pacote PyInstaller (_internal ou _MEIPASS)."""
    if not is_frozen():
        return None
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return None
    return Path(meipass) / "config.yaml"


def default_config_path() -> Path:
    embutido = bundled_config_path()
    if embutido is not None and embutido.is_file():
        return embutido
    return application_dir() / "config.yaml"


def config_embutida_no_exe() -> bool:
    embutido = bundled_config_path()
    return embutido is not None and embutido.is_file()


def _is_genpy_cache_error(exc: BaseException) -> bool:
    msg = str(exc)
    return (
        "CLSIDToClassMap" in msg
        or "CLSIDToPackageMap" in msg
        or ("win32com.gen_py" in msg and COREL_TLB_CLSID_PREFIX[:8] in msg)
    )


def _purge_corel_genpy_modules() -> None:
    prefix = COREL_TLB_CLSID_PREFIX.lower()
    for key in list(sys.modules):
        if prefix in key.lower():
            sys.modules.pop(key, None)


def clear_corrupted_corel_genpy_cache() -> list[str]:
    """Remove módulos gen_py corrompidos do Corel (sem CLSIDToClassMap)."""
    removed: list[str] = []
    try:
        import shutil

        import win32com.client.gencache as gencache

        gen_path = Path(gencache.GetGeneratePath())
        if gen_path.is_dir():
            for child in gen_path.iterdir():
                if child.is_dir() and COREL_TLB_CLSID_PREFIX in child.name.upper():
                    shutil.rmtree(child, ignore_errors=True)
                    removed.append(child.name)
        if removed:
            gencache.Rebuild()
        _purge_corel_genpy_modules()
    except Exception:
        pass
    return removed


def dispatch_corel_application():
    """Dispatch funciona com Corel instalado; gen_py corrompido exige limpeza do cache."""
    import win32com.client

    def _try_dispatch():
        return win32com.client.Dispatch(COREL_PROGID)

    try:
        return _try_dispatch()
    except AttributeError as exc:
        if not _is_genpy_cache_error(exc):
            raise
        clear_corrupted_corel_genpy_cache()
        return _try_dispatch()

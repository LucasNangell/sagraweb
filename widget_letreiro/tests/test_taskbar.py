"""Atributos layered e mensagens de fechamento do overlay."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from taskbar import (  # noqa: E402
    LWA_ALPHA,
    LWA_COLORKEY,
    SC_CLOSE,
    WM_CLOSE,
    WM_SYSCOMMAND,
    hex_to_colorref,
    is_close_message,
    layered_attribute_flags,
)


def test_hex_to_colorref_chroma():
    # #ff00fe → RGB(255, 0, 254) em COLORREF 0x00bbggrr
    assert hex_to_colorref("#ff00fe") == 0x00FE00FF
    assert hex_to_colorref("ff00fe") == hex_to_colorref("#FF00FE")


def test_layered_flags_combine_alpha_and_colorkey():
    assert layered_attribute_flags(color_key=False) == LWA_ALPHA
    assert layered_attribute_flags(color_key=True) == (LWA_ALPHA | LWA_COLORKEY)


def test_is_close_message_covers_explorer_paths():
    assert is_close_message(WM_CLOSE) is True
    assert is_close_message(WM_SYSCOMMAND, SC_CLOSE) is True
    assert is_close_message(WM_SYSCOMMAND, SC_CLOSE | 0x0002) is True
    assert is_close_message(WM_SYSCOMMAND, 0xF030) is False
    assert is_close_message(0x0002) is False


def test_report_callback_exception_survives_null_stdio(monkeypatch):
    """Exe sem console deixa stderr=None; o handler padrão do Tk derruba o processo."""
    import overlay

    monkeypatch.setattr(sys, "stderr", None)
    monkeypatch.setattr(sys, "stdout", None)
    overlay.LetreiroOverlay._report_callback_exception(
        None, RuntimeError, RuntimeError("boom"), None
    )


def test_close_guard_installs_on_tk_window():
    if sys.platform != "win32":
        return
    import tkinter as tk

    from taskbar import OverlayCloseGuard, apply_overlay_styles, resolve_hwnd

    root = tk.Tk()
    try:
        root.withdraw()
        root.update_idletasks()
        hwnd = resolve_hwnd(root)
        apply_overlay_styles(hwnd)
        guard = OverlayCloseGuard()
        guard.install(hwnd)
        root.update()
        guard.allow_close = True
    finally:
        root.destroy()

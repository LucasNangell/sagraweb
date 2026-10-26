"""Geometria da barra de tarefas e janela always-on-top."""
from __future__ import annotations

import ctypes
import logging
import sys
from ctypes import wintypes
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("sagra.letreiro")

GWL_EXSTYLE = -20
GWL_WNDPROC = -4
WS_EX_APPWINDOW = 0x00040000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_TOPMOST = 0x00000008
WS_EX_LAYERED = 0x00080000
WS_EX_NOACTIVATE = 0x08000000
HWND_TOPMOST = -1
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
SW_SHOW = 5
MONITOR_DEFAULTTONEAREST = 2
LWA_COLORKEY = 0x00000001
LWA_ALPHA = 0x00000002
WM_CLOSE = 0x0010
WM_SYSCOMMAND = 0x0112
SC_CLOSE = 0xF060
OVERLAY_TITLE = "SAGRA Letreiro"

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, ctypes.c_uint, wintypes.WPARAM, wintypes.LPARAM)


@dataclass
class TaskbarGeom:
    left: int
    top: int
    right: int
    bottom: int
    thickness: int
    edge: str
    monitor_left: int
    monitor_top: int
    monitor_right: int
    monitor_bottom: int

    @property
    def width(self) -> int:
        return max(1, self.right - self.left)

    @property
    def height(self) -> int:
        return max(1, self.thickness)


def enable_dpi_awareness() -> None:
    if sys.platform != "win32":
        return
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        logger.debug("Não foi possível marcar o processo como DPI-aware.")


def _monitor_rects(x: int, y: int) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    import win32api
    import win32con

    monitor = win32api.MonitorFromPoint((int(x), int(y)), win32con.MONITOR_DEFAULTTONEAREST)
    info = win32api.GetMonitorInfo(monitor)
    return tuple(info["Monitor"]), tuple(info["Work"])


def taskbar_geom_at(x: int, y: int) -> TaskbarGeom:
    """Taskbar do monitor sob (x, y), via área de trabalho vs. monitor."""
    try:
        mon, work = _monitor_rects(x, y)
    except Exception:
        try:
            import win32api

            w = int(win32api.GetSystemMetrics(0))
            h = int(win32api.GetSystemMetrics(1))
        except Exception:
            w, h = 1920, 1080
        mon = (0, 0, w, h)
        work = (0, 0, w, h - 48)

    ml, mt, mr, mb = mon
    wl, wt, wr, wb = work
    left_gap = wl - ml
    top_gap = wt - mt
    right_gap = mr - wr
    bottom_gap = mb - wb

    if bottom_gap >= max(left_gap, top_gap, right_gap, 1):
        thickness = max(bottom_gap, 40)
        return TaskbarGeom(ml, mb - thickness, mr, mb, thickness, "bottom", ml, mt, mr, mb)
    if top_gap >= max(left_gap, right_gap, 1):
        thickness = max(top_gap, 40)
        return TaskbarGeom(ml, mt, mr, mt + thickness, thickness, "top", ml, mt, mr, mb)
    if left_gap >= right_gap:
        thickness = max(left_gap, 40)
        return TaskbarGeom(ml, mt, ml + thickness, mb, thickness, "left", ml, mt, mr, mb)
    thickness = max(right_gap, 40)
    return TaskbarGeom(mr - thickness, mt, mr, mb, thickness, "right", ml, mt, mr, mb)


def clamp_overlay_rect(
    x: int,
    width: int,
    geom: TaskbarGeom,
    *,
    min_width: int = 320,
) -> tuple[int, int, int, int]:
    """Retorna (x, y, width, height) colado na taskbar horizontal do monitor."""
    max_width = max(min_width, geom.width if geom.edge in {"bottom", "top"} else (geom.monitor_right - geom.monitor_left))
    width = max(min_width, min(int(width), max_width))
    if geom.edge in {"bottom", "top"}:
        left_bound = geom.left
        right_bound = geom.right
        y = geom.top
        height = geom.thickness
    else:
        left_bound = geom.monitor_left
        right_bound = geom.monitor_right
        height = geom.thickness
        y = geom.monitor_bottom - height
    x = max(left_bound, min(int(x), right_bound - width))
    return x, y, width, height


def hex_to_colorref(hex_color: str) -> int:
    """RGB #rrggbb → COLORREF 0x00bbggrr."""
    raw = (hex_color or "").strip().lstrip("#")
    if len(raw) != 6:
        raise ValueError(f"Cor inválida: {hex_color!r}")
    red = int(raw[0:2], 16)
    green = int(raw[2:4], 16)
    blue = int(raw[4:6], 16)
    return red | (green << 8) | (blue << 16)


def layered_attribute_flags(*, color_key: bool) -> int:
    flags = LWA_ALPHA
    if color_key:
        flags |= LWA_COLORKEY
    return flags


def is_close_message(msg: int, wparam: int = 0) -> bool:
    if int(msg) == WM_CLOSE:
        return True
    return int(msg) == WM_SYSCOMMAND and (int(wparam) & 0xFFF0) == SC_CLOSE


def window_alive(hwnd: int) -> bool:
    if sys.platform != "win32" or not hwnd:
        return False
    try:
        return bool(ctypes.windll.user32.IsWindow(hwnd))
    except Exception:
        return False


def _window_long_fns():
    user32 = ctypes.windll.user32
    if ctypes.sizeof(ctypes.c_void_p) == 8:
        get_long, set_long = user32.GetWindowLongPtrW, user32.SetWindowLongPtrW
    else:
        get_long, set_long = user32.GetWindowLongW, user32.SetWindowLongW
    get_long.restype = ctypes.c_void_p
    get_long.argtypes = [wintypes.HWND, ctypes.c_int]
    set_long.restype = ctypes.c_void_p
    set_long.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
    return get_long, set_long


def apply_overlay_styles(hwnd: int) -> None:
    if sys.platform != "win32" or not hwnd:
        return
    get_long, set_long = _window_long_fns()
    try:
        style = int(get_long(hwnd, GWL_EXSTYLE) or 0)
        wanted = (style | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW
        if style != wanted:
            set_long(hwnd, GWL_EXSTYLE, wanted)
    except Exception as exc:
        logger.debug("Falha ao aplicar estilos da janela: %s", exc)
    reassert_topmost(hwnd)


def apply_layered_attributes(
    hwnd: int,
    opacity: float,
    color_key_hex: Optional[str] = None,
) -> None:
    """Aplica alpha e chroma-key numa única chamada (não perde o fundo após SetWindowPos)."""
    if sys.platform != "win32" or not hwnd:
        return
    alpha = int(round(max(0.0, min(1.0, float(opacity))) * 255))
    key = 0
    if color_key_hex:
        try:
            key = hex_to_colorref(color_key_hex)
        except ValueError:
            color_key_hex = None
    flags = layered_attribute_flags(color_key=bool(color_key_hex))
    try:
        fn = ctypes.windll.user32.SetLayeredWindowAttributes
        fn.restype = wintypes.BOOL
        fn.argtypes = [wintypes.HWND, wintypes.DWORD, wintypes.BYTE, wintypes.DWORD]
        fn(hwnd, key, alpha, flags)
    except Exception as exc:
        logger.debug("Falha ao aplicar atributos layered: %s", exc)


def reassert_topmost(hwnd: int, *, show: bool = False) -> None:
    if sys.platform != "win32" or not hwnd:
        return
    flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
    if show:
        flags |= SWP_SHOWWINDOW
    try:
        ctypes.windll.user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags)
    except Exception:
        pass


def restore_existing_overlay() -> bool:
    """Reexibe uma instância já aberta. Retorna True se achou a janela."""
    if sys.platform != "win32":
        return False
    try:
        hwnd = ctypes.windll.user32.FindWindowW(None, OVERLAY_TITLE)
    except Exception:
        return False
    if not hwnd:
        return False
    try:
        ctypes.windll.user32.ShowWindow(hwnd, SW_SHOW)
    except Exception:
        pass
    reassert_topmost(int(hwnd), show=True)
    return True


def notify_already_running() -> None:
    if restore_existing_overlay():
        text = "O letreiro já está em execução e foi trazido para frente."
    else:
        text = (
            "O letreiro já está em execução neste usuário.\n"
            "Se a faixa não aparecer, encerre SAGRA-Letreiro.exe no Gerenciador de Tarefas e abra de novo."
        )
    if sys.platform == "win32":
        try:
            ctypes.windll.user32.MessageBoxW(0, text, OVERLAY_TITLE, 0x40)
            return
        except Exception:
            pass
    print(text)


class OverlayCloseGuard:
    """Ignora WM_CLOSE/SC_CLOSE do Explorer, que derruba janelas overrideredirect na taskbar."""

    def __init__(self) -> None:
        self.allow_close = False
        self._hwnd = 0
        self._old_proc = 0
        self._callback = None

    def install(self, hwnd: int) -> None:
        if sys.platform != "win32" or not hwnd or hwnd == self._hwnd:
            return
        get_long, set_long = _window_long_fns()

        def _wndproc(hwnd_msg, msg, wparam, lparam):
            if is_close_message(msg, wparam) and not self.allow_close:
                logger.info("Pedido de fechamento do sistema ignorado (overlay).")
                return 0
            if not self._old_proc:
                return ctypes.windll.user32.DefWindowProcW(hwnd_msg, msg, wparam, lparam)
            return ctypes.windll.user32.CallWindowProcW(
                ctypes.c_void_p(self._old_proc),
                hwnd_msg,
                msg,
                wparam,
                lparam,
            )

        try:
            user32 = ctypes.windll.user32
            user32.CallWindowProcW.restype = LRESULT
            user32.CallWindowProcW.argtypes = [
                ctypes.c_void_p,
                wintypes.HWND,
                ctypes.c_uint,
                wintypes.WPARAM,
                wintypes.LPARAM,
            ]
            callback = WNDPROC(_wndproc)
            old = get_long(hwnd, GWL_WNDPROC)
            set_long(hwnd, GWL_WNDPROC, ctypes.cast(callback, ctypes.c_void_p).value)
            self._callback = callback
            self._old_proc = int(old or 0)
            self._hwnd = hwnd
        except Exception as exc:
            logger.warning("Não instalou proteção contra fechamento: %s", exc)


def resolve_hwnd(root, *, idle: bool = True) -> int:
    """HWND top-level do Tk no Windows."""
    try:
        if idle:
            root.update_idletasks()
        frame = root.wm_frame()
        if frame:
            return int(frame, 16)
    except Exception:
        pass
    try:
        return int(root.winfo_id())
    except Exception:
        return 0

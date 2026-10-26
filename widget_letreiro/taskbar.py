"""Geometria da barra de tarefas e janela always-on-top."""
from __future__ import annotations

import ctypes
import logging
import sys
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("sagra.letreiro")

GWL_EXSTYLE = -20
WS_EX_APPWINDOW = 0x00040000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_TOPMOST = 0x00000008
WS_EX_LAYERED = 0x00080000
HWND_TOPMOST = -1
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
MONITOR_DEFAULTTONEAREST = 2


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


def apply_overlay_styles(hwnd: int) -> None:
    if sys.platform != "win32" or not hwnd:
        return
    user32 = ctypes.windll.user32
    if ctypes.sizeof(ctypes.c_void_p) == 8:
        get_long = user32.GetWindowLongPtrW
        set_long = user32.SetWindowLongPtrW
    else:
        get_long = user32.GetWindowLongW
        set_long = user32.SetWindowLongW
    try:
        style = get_long(hwnd, GWL_EXSTYLE)
        style = (style | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED) & ~WS_EX_APPWINDOW
        set_long(hwnd, GWL_EXSTYLE, style)
    except Exception as exc:
        logger.debug("Falha ao aplicar estilos da janela: %s", exc)
    reassert_topmost(hwnd)


def reassert_topmost(hwnd: int) -> None:
    if sys.platform != "win32" or not hwnd:
        return
    try:
        ctypes.windll.user32.SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    except Exception:
        pass


def resolve_hwnd(root) -> int:
    """HWND top-level do Tk no Windows."""
    try:
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

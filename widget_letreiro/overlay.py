"""Janela overlay na taskbar: drag, resize e letreiro de mini-cards."""
from __future__ import annotations

import logging
import queue
import threading
import time
import tkinter as tk
from tkinter import font as tkfont
from typing import Any, Callable, Optional

from api_client import LetreiroApiClient, LetreiroApiError
from board import (
    dashboard_config_has_inbox_column,
    flatten_ticker_cards,
    process_dashboard_data,
    ticker_content_overflows,
)
from config_store import save_config
from taskbar import (
    OVERLAY_TITLE,
    OverlayCloseGuard,
    apply_layered_attributes,
    apply_overlay_styles,
    clamp_overlay_rect,
    reassert_topmost,
    resolve_hwnd,
    taskbar_geom_at,
    window_alive,
)

logger = logging.getLogger("sagra.letreiro")

BG = "#121214"
CHROMA = "#ff00fe"
HANDLE_BG = "#202024"
CARD_BG = "#333338"
TEXT = "#e1e1e6"
TEXT_DIM = "#a8a8b3"
SUCCESS = "#04d361"
WARNING = "#fba94c"
DANGER = "#ff6961"
PRIORITY_HIGH = "#d31111"
PRIORITY_MEDIUM = "#ff9800"
PRIORITY_MEDIUM_TEXT = "#1a1a1a"
SUB_OS_BORDER = "#f59e0b"
COLUMN_BORDERS = ("#b46d03", "#04618d", "#a30d0d", "#02461e", "#ff6b6b", "#202024")

HANDLE_W = 42
RESIZE_W = 12
EDGE = 14
MIN_WIDTH = 320
GAP = 8
CARD_MAX_W = 260


class LetreiroOverlay:
    def __init__(
        self,
        config: dict[str, Any],
        *,
        on_open_settings: Callable[[], None],
        on_quit: Callable[[], None],
    ):
        self.config = config
        self.on_open_settings = on_open_settings
        self.on_quit = on_quit
        self.client = LetreiroApiClient(
            config["api_base_url"],
            ssl_verify=bool(config.get("ssl_verify")),
        )
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._queue: queue.Queue = queue.Queue()
        self._master: dict[str, Any] = {}
        self._initial = True
        self._cards: list[dict[str, Any]] = []
        self._layout: list[dict[str, Any]] = []
        self._status = "disconnected"
        self._status_msg = "Conectando…"
        self._paused = False
        self._offset = 0.0
        self._last_tick = time.monotonic()
        self._hwnd = 0
        self._styled_hwnd = 0
        self._drag: Optional[dict[str, Any]] = None
        self._poll_thread: Optional[threading.Thread] = None
        self._quitting = False
        self._restore_tries = 0
        self._close_guard = OverlayCloseGuard()

        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title(OVERLAY_TITLE)
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.configure(bg=BG)
        self.root.report_callback_exception = self._report_callback_exception
        self._build_ui()
        self._apply_chrome()
        self.root.bind("<Map>", self._on_map)
        self.root.bind("<Unmap>", self._on_unmap)
        self.root.bind("<Destroy>", self._on_destroy)
        self.root.protocol("WM_DELETE_WINDOW", self.quit)

    def start(self) -> None:
        self._place(initial=True)
        self.root.deiconify()
        self.root.update_idletasks()
        self._ensure_styles()
        self._poll_thread = threading.Thread(target=self._poll_loop, name="letreiro-poll", daemon=True)
        self._poll_thread.start()
        self._tick_marquee()
        self._drain_queue()
        self._keep_topmost()
        self._sync_taskbar()
        logger.info("Loop da janela iniciado")
        self.root.mainloop()
        if not self._quitting:
            logger.error("Loop da janela terminou sem pedido de saída")

    def apply_config(self, config: dict[str, Any], *, relogin: bool = False) -> None:
        with self._lock:
            self.config = config
            self.client.configure(config["api_base_url"], bool(config.get("ssl_verify")))
            if relogin:
                self.client.logged_in = False
                self._master.clear()
                self._initial = True
        self._apply_chrome()
        self._place()
        self.request_refresh()

    def request_refresh(self) -> None:
        self._wake.set()

    def quit(self) -> None:
        self._quitting = True
        self._close_guard.allow_close = True
        self._stop.set()
        self._wake.set()
        try:
            self.root.destroy()
        except tk.TclError:
            pass
        self.on_quit()

    def _report_callback_exception(self, exc, val, tb) -> None:
        logger.error("Erro no callback Tk", exc_info=(exc, val, tb))

    def _live_hwnd(self) -> int:
        if window_alive(self._hwnd):
            return self._hwnd
        hwnd = resolve_hwnd(self.root, idle=False)
        if window_alive(hwnd):
            self._hwnd = hwnd
            return hwnd
        hwnd = resolve_hwnd(self.root, idle=True)
        self._hwnd = hwnd
        return hwnd

    def _ensure_styles(self) -> None:
        hwnd = self._live_hwnd()
        if not hwnd:
            return
        if hwnd != self._styled_hwnd:
            apply_overlay_styles(hwnd)
            self._close_guard.install(hwnd)
            self._styled_hwnd = hwnd
        self._apply_layered()

    def _apply_layered(self) -> None:
        hwnd = self._hwnd if window_alive(self._hwnd) else self._live_hwnd()
        opacity = 0.95
        try:
            opacity = float(self.config["window"].get("opacity") or 0.95)
        except (TypeError, ValueError):
            pass
        chroma = CHROMA if self._transparent_bg() else None
        apply_layered_attributes(hwnd, opacity, chroma)

    def _build_ui(self) -> None:
        self.handle = tk.Frame(self.root, bg=HANDLE_BG, width=HANDLE_W, cursor="fleur")
        self.handle.pack(side="left", fill="y")
        self.handle.pack_propagate(False)

        self.grip = tk.Canvas(self.handle, bg=HANDLE_BG, highlightthickness=0, width=HANDLE_W, height=10)
        self.grip.pack(side="top", pady=(2, 0))
        for gx in (14, 21, 28):
            self.grip.create_oval(gx, 3, gx + 3, 6, fill=TEXT_DIM, outline="")

        self.status_dot = tk.Canvas(self.handle, bg=HANDLE_BG, highlightthickness=0, width=HANDLE_W, height=12)
        self.status_dot.pack(side="top", pady=(1, 0))
        self._dot_id = self.status_dot.create_oval(16, 1, 26, 11, fill=TEXT_DIM, outline="")

        self.gear = tk.Label(
            self.handle,
            text="⚙",
            bg=HANDLE_BG,
            fg=TEXT,
            cursor="hand2",
            font=("Segoe UI", 10),
        )
        self.gear.pack(side="bottom", pady=(0, 1))
        self.gear.bind("<Button-1>", self._on_gear)
        self.gear.bind("<Button-3>", self._on_context)

        self.resize = tk.Frame(self.root, bg="#2a2a32", width=RESIZE_W, cursor="sb_h_double_arrow")
        self.resize.pack(side="right", fill="y")
        self.resize.pack_propagate(False)
        self.resize_grip = tk.Canvas(
            self.resize,
            bg="#2a2a32",
            highlightthickness=0,
            width=RESIZE_W,
            cursor="sb_h_double_arrow",
        )
        self.resize_grip.pack(fill="both", expand=True)
        self.resize.bind("<Configure>", self._draw_resize_grip)

        self.canvas = tk.Canvas(self.root, bg=BG, highlightthickness=0, cursor="arrow")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.canvas.bind("<Enter>", lambda _e: self._set_paused(True))
        self.canvas.bind("<Leave>", lambda _e: self._set_paused(False))
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        for widget in (
            self.root,
            self.handle,
            self.grip,
            self.status_dot,
            self.canvas,
            self.resize,
            self.resize_grip,
        ):
            widget.bind("<Motion>", self._on_motion)
            widget.bind("<Button-1>", self._on_press)
            widget.bind("<B1-Motion>", self._on_drag)
            widget.bind("<ButtonRelease-1>", self._on_release)
            widget.bind("<Button-3>", self._on_context)

        self._font_num = tkfont.Font(family="Segoe UI", size=10, weight="bold")
        self._font_sit = tkfont.Font(family="Segoe UI", size=8)
        self._font_empty = tkfont.Font(family="Segoe UI", size=9)

    def _set_paused(self, paused: bool) -> None:
        self._paused = paused

    def _on_map(self, event=None) -> None:
        if event is not None and event.widget is not self.root:
            return
        self._restore_tries = 0
        self._ensure_styles()

    def _on_unmap(self, event=None) -> None:
        if event is not None and event.widget is not self.root:
            return
        if self._quitting or self._stop.is_set():
            return
        self._restore_tries += 1
        if self._restore_tries > 20:
            logger.error("Overlay sumiu e não foi possível restaurar")
            return
        logger.warning("Overlay desmapeado; restaurando (%s)", self._restore_tries)
        try:
            self.root.after(80, self._restore_visibility)
        except tk.TclError:
            pass

    def _on_destroy(self, event=None) -> None:
        if event is not None and event.widget is not self.root:
            return
        if not self._quitting:
            logger.error("Janela do letreiro destruída inesperadamente")

    def _restore_visibility(self) -> None:
        if self._quitting or self._stop.is_set():
            return
        try:
            self.root.deiconify()
            self.root.lift()
            self.root.attributes("-topmost", True)
        except tk.TclError:
            return
        hwnd = resolve_hwnd(self.root, idle=True)
        self._hwnd = hwnd
        self._styled_hwnd = 0
        self._ensure_styles()
        reassert_topmost(hwnd, show=True)
        self._apply_layered()

    def _transparent_bg(self) -> bool:
        return bool(self.config.get("window", {}).get("transparent_bg"))

    def _panel_bg(self) -> str:
        return CHROMA if self._transparent_bg() else BG

    def _apply_chrome(self) -> None:
        fill = self._panel_bg()
        try:
            self.root.configure(bg=fill)
            self.canvas.configure(bg=fill)
        except tk.TclError:
            return
        try:
            if self._transparent_bg():
                self.root.attributes("-transparentcolor", CHROMA)
            else:
                try:
                    self.root.attributes("-transparentcolor", "")
                except tk.TclError:
                    pass
        except tk.TclError:
            pass
        # Não usar Tk -alpha: ele substitui o chroma-key. Alpha + key via Win32,
        # reaplicado depois de cada SetWindowPos.
        self._apply_layered()

    def _place(self, initial: bool = False) -> None:
        win = self.config["window"]
        geom = taskbar_geom_at(int(win.get("x") or 0), 0)
        if win.get("x") is None:
            x = geom.right - int(win["width"]) - 8
        else:
            x = int(win["x"])
        x, y, width, height = clamp_overlay_rect(x, int(win["width"]), geom, min_width=MIN_WIDTH)
        self.root.geometry(f"{width}x{height}+{x}+{y}")
        size = max(8, int(height * 0.22))
        self._font_num.configure(size=size)
        self._font_sit.configure(size=max(7, int(height * 0.17)))
        if not initial:
            self._persist_window(x, width)

    def _persist_window(self, x: int, width: int) -> None:
        with self._lock:
            self.config["window"]["x"] = x
            self.config["window"]["width"] = width
            snapshot = dict(self.config)
        try:
            save_config(snapshot)
        except OSError as exc:
            logger.warning("Não gravou posição: %s", exc)

    def _keep_topmost(self) -> None:
        if self._stop.is_set() or self._quitting:
            return
        try:
            hwnd = self._live_hwnd()
            reassert_topmost(hwnd)
            self._apply_layered()
        except Exception:
            logger.exception("Falha ao reafirmar topmost")
        try:
            self.root.after(700, self._keep_topmost)
        except tk.TclError:
            pass

    def _sync_taskbar(self) -> None:
        if self._stop.is_set() or self._quitting:
            return
        try:
            if self._drag is None:
                x = self.root.winfo_x()
                width = self.root.winfo_width()
                geom = taskbar_geom_at(x + width // 2, self.root.winfo_y())
                nx, ny, nw, nh = clamp_overlay_rect(x, width, geom, min_width=MIN_WIDTH)
                cur = f"{self.root.winfo_width()}x{self.root.winfo_height()}+{self.root.winfo_x()}+{self.root.winfo_y()}"
                nxt = f"{nw}x{nh}+{nx}+{ny}"
                if cur != nxt:
                    self.root.geometry(nxt)
        except tk.TclError:
            pass
        except Exception:
            logger.exception("Falha ao sincronizar com a taskbar")
        try:
            self.root.after(2000, self._sync_taskbar)
        except tk.TclError:
            pass

    def _draw_resize_grip(self, _event=None) -> None:
        c = self.resize_grip
        c.delete("all")
        h = max(1, c.winfo_height())
        x = RESIZE_W // 2
        cy = h // 2
        for dy in (-6, 0, 6):
            c.create_oval(x - 1, cy + dy - 1, x + 2, cy + dy + 2, fill=TEXT_DIM, outline="")

    def _on_motion(self, event) -> None:
        if self._drag:
            cursor = "sb_h_double_arrow" if self._drag.get("mode") in {"left", "right"} else "fleur"
            self._set_cursors(cursor)
            return
        zone = self._hit_zone(event)
        if zone in {"left", "right"}:
            self._set_cursors("sb_h_double_arrow")
        elif zone == "move":
            self._set_cursors("fleur")
        else:
            self._set_cursors("arrow")

    def _set_cursors(self, cursor: str) -> None:
        self.root.configure(cursor=cursor)
        self.canvas.configure(cursor=cursor)
        if cursor != "sb_h_double_arrow":
            self.resize.configure(cursor="sb_h_double_arrow")
            self.resize_grip.configure(cursor="sb_h_double_arrow")

    def _hit_zone(self, event) -> Optional[str]:
        widget = event.widget
        if widget in (self.resize, self.resize_grip):
            return "right"
        left = self.root.winfo_x()
        width = self.root.winfo_width()
        local = event.x_root - left
        if local >= width - RESIZE_W - 2:
            return "right"
        if local <= EDGE:
            return "left"
        if local <= HANDLE_W or widget in (self.handle, self.grip, self.status_dot):
            return "move"
        return None

    def _on_gear(self, _event) -> None:
        self._drag = None
        self.on_open_settings()

    def _on_press(self, event) -> None:
        if event.widget is self.gear:
            return
        zone = self._hit_zone(event)
        if not zone:
            return
        self._drag = {
            "mode": zone,
            "origin_x": event.x_root,
            "win_x": self.root.winfo_x(),
            "width": self.root.winfo_width(),
        }
        try:
            self.root.grab_set()
        except tk.TclError:
            pass
        if zone in {"left", "right"}:
            self._set_cursors("sb_h_double_arrow")

    def _on_drag(self, event) -> None:
        self._apply_drag(event.x_root)

    def _on_canvas_configure(self, _event=None) -> None:
        try:
            if self._layout:
                self._draw_cards()
            elif self._status != "connected":
                self._draw_empty(self._status_msg)
            else:
                self._draw_empty("")
        except tk.TclError:
            pass

    def _apply_drag(self, x_root: int) -> None:
        if not self._drag:
            return
        dx = x_root - int(self._drag["origin_x"])
        mode = self._drag["mode"]
        win_x = int(self._drag["win_x"])
        width = int(self._drag["width"])
        if mode == "move":
            x = win_x + dx
            geom = taskbar_geom_at(x_root, self.root.winfo_y())
            x, y, width, height = clamp_overlay_rect(x, width, geom, min_width=MIN_WIDTH)
        elif mode == "left":
            x = win_x + dx
            width = width - dx
            geom = taskbar_geom_at(x, self.root.winfo_y())
            x, y, width, height = clamp_overlay_rect(x, width, geom, min_width=MIN_WIDTH)
        else:
            width = width + dx
            geom = taskbar_geom_at(win_x + width // 2, self.root.winfo_y())
            x, y, width, height = clamp_overlay_rect(win_x, width, geom, min_width=MIN_WIDTH)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    def _on_release(self, _event=None) -> None:
        self._finish_drag()

    def _finish_drag(self) -> None:
        if not self._drag:
            return
        self._drag = None
        try:
            self.root.grab_release()
        except tk.TclError:
            pass
        try:
            self._persist_window(self.root.winfo_x(), self.root.winfo_width())
        except tk.TclError:
            pass
        self._set_cursors("arrow")

    def _on_context(self, event) -> None:
        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(label="Ajustes…", command=self.on_open_settings)
        menu.add_command(label="Recarregar", command=self.request_refresh)
        menu.add_separator()
        menu.add_command(label="Sair", command=self.quit)
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._refresh_once()
            except Exception as exc:
                logger.exception("Falha no poll do letreiro")
                self._queue.put(("error", str(exc)))
            wait = 10
            with self._lock:
                wait = int(self.config.get("poll_interval_sec") or 10)
            self._wake.clear()
            self._wake.wait(wait)

    def _refresh_once(self) -> None:
        with self._lock:
            cfg = self.config
            initial = self._initial
        self.client.configure(cfg["api_base_url"], bool(cfg.get("ssl_verify")))
        ponto = str(cfg.get("ponto") or "").strip()
        if ponto and not self.client.logged_in:
            try:
                self.client.login(ponto, str(cfg.get("nome") or ""), str(cfg.get("password") or ""))
            except LetreiroApiError as exc:
                self._queue.put(("error", f"Login: {exc}"))
                return

        try:
            items = self.client.fetch_dashboard(cfg["board"])
        except LetreiroApiError as exc:
            self._queue.put(("error", str(exc)))
            return

        inbox = None
        inbox_note = ""
        if dashboard_config_has_inbox_column(cfg["board"]):
            if self.client.logged_in:
                try:
                    inbox = self.client.fetch_inbox_os()
                except LetreiroApiError as exc:
                    inbox_note = f"Inbox: {exc}"
            else:
                inbox_note = "Inbox exige login (ponto)."

        processed = process_dashboard_data(
            items,
            cfg["board"],
            self._master,
            is_initial_load=initial,
            inbox_os=inbox,
        )
        cards = flatten_ticker_cards(processed["columns"])
        with self._lock:
            self._initial = False
        self._queue.put(("data", cards, inbox_note))

    def _drain_queue(self) -> None:
        if self._stop.is_set() or self._quitting:
            return
        try:
            while True:
                msg = self._queue.get_nowait()
                kind = msg[0]
                if kind == "data":
                    self._cards = msg[1]
                    note = msg[2] or ""
                    self._status = "connected"
                    self._status_msg = note or f"{len(self._cards)} OP(s)"
                    self._rebuild_layout()
                    self._paint_status()
                elif kind == "error":
                    self._status = "disconnected"
                    self._status_msg = str(msg[1])
                    self._paint_status()
                    self._draw_empty(self._status_msg)
        except queue.Empty:
            pass
        except Exception:
            logger.exception("Falha ao aplicar dados do letreiro")
        try:
            self.root.after(200, self._drain_queue)
        except tk.TclError:
            pass

    def _paint_status(self) -> None:
        color = {"connected": SUCCESS, "degraded": WARNING}.get(self._status, DANGER)
        self.status_dot.itemconfigure(self._dot_id, fill=color)
        self.handle.configure(bg=HANDLE_BG)
        try:
            self.status_dot.tooltip = self._status_msg
        except Exception:
            pass

    def _rebuild_layout(self) -> None:
        self._layout = []
        for card in self._cards:
            label = str(card.get("label") or "")
            situacao = str(card.get("situacao") or "")
            label_w = self._font_num.measure(label)
            sit_w = self._font_sit.measure(situacao)
            inner = min(CARD_MAX_W - 16, max(label_w, sit_w, 64))
            if sit_w > inner:
                situacao = _ellipsis(self._font_sit, situacao, inner)
            width = inner + 16
            self._layout.append({**card, "label": label, "situacao": situacao, "width": width})
        self._offset = 0.0
        self._draw_cards()

    def _card_widths(self) -> list[int]:
        return [int(card["width"]) for card in self._layout]

    def _needs_scroll(self) -> bool:
        return ticker_content_overflows(
            self._card_widths(),
            GAP,
            max(1, self.canvas.winfo_width()),
        )

    def _tick_marquee(self) -> None:
        if self._stop.is_set() or self._quitting:
            return
        try:
            now = time.monotonic()
            dt = max(0.0, min(0.1, now - self._last_tick))
            self._last_tick = now
            if not self._layout:
                self._draw_empty("" if self._status == "connected" else self._status_msg)
            elif self._needs_scroll() and not self._paused:
                speed = float(self.config["window"].get("speed_px_per_sec") or 40)
                self._offset += speed * dt
                self._draw_cards()
            elif self._offset:
                self._offset = 0.0
                self._draw_cards()
        except tk.TclError:
            pass
        except Exception:
            logger.exception("Falha no letreiro")
        try:
            self.root.after(33, self._tick_marquee)
        except tk.TclError:
            pass

    def _draw_empty(self, text: str) -> None:
        try:
            self.canvas.delete("all")
        except tk.TclError:
            return
        shown = (text or "").strip()
        if not shown:
            return
        h = max(1, self.canvas.winfo_height())
        if len(shown) >= 80:
            shown = shown[:77] + "…"
        self.canvas.create_text(
            12,
            h / 2,
            text=shown,
            fill=TEXT_DIM,
            font=self._font_empty,
            anchor="w",
        )

    def _draw_cards(self) -> None:
        try:
            self.canvas.delete("all")
        except tk.TclError:
            return
        height = max(1, self.canvas.winfo_height())
        width = max(1, self.canvas.winfo_width())
        if not self._layout:
            self._draw_empty("" if self._status == "connected" else self._status_msg)
            return
        if not self._needs_scroll():
            x = 8
            for card in self._layout:
                self._paint_card(x, height, card)
                x += card["width"] + GAP
            return
        loop = sum(card["width"] + GAP for card in self._layout)
        if loop <= 0:
            return
        n = len(self._layout)
        origin = -(self._offset % loop)
        x = origin
        idx = 0
        safety = 0
        while x < width + 8 and safety < n * 4:
            card = self._layout[idx % n]
            self._paint_card(x, height, card)
            x += card["width"] + GAP
            idx += 1
            safety += 1

    def _paint_card(self, x: float, canvas_h: int, card: dict[str, Any]) -> None:
        y = 3
        h = max(18, canvas_h - 6)
        w = int(card["width"])
        priority = card.get("priority")
        if priority == "priority-high":
            bg, fg, sit_fg = PRIORITY_HIGH, "#ffffff", "#f0f0f0"
        elif priority == "priority-medium":
            bg, fg, sit_fg = PRIORITY_MEDIUM, PRIORITY_MEDIUM_TEXT, PRIORITY_MEDIUM_TEXT
        else:
            bg, fg, sit_fg = CARD_BG, TEXT, "#ffffff"
        if card.get("is_new"):
            border = SUCCESS
        elif card.get("is_sub_os"):
            border = SUB_OS_BORDER
        else:
            border = COLUMN_BORDERS[int(card.get("column_index") or 0) % len(COLUMN_BORDERS)]
        self.canvas.create_rectangle(x, y, x + w, y + h, fill=bg, outline="", width=0)
        self.canvas.create_rectangle(x, y, x + 4, y + h, fill=border, outline="")
        self.canvas.create_text(
            x + w / 2,
            y + h * 0.36,
            text=card.get("label") or "",
            fill=fg,
            font=self._font_num,
        )
        self.canvas.create_text(
            x + w / 2,
            y + h * 0.72,
            text=card.get("situacao") or "",
            fill=sit_fg,
            font=self._font_sit,
        )


def _ellipsis(font: tkfont.Font, text: str, max_w: int) -> str:
    if font.measure(text) <= max_w:
        return text
    trimmed = text
    while trimmed and font.measure(trimmed + "…") > max_w:
        trimmed = trimmed[:-1]
    return (trimmed + "…") if trimmed else "…"

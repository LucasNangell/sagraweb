"""Janela de ajustes local do letreiro (independente do painel web)."""
from __future__ import annotations

import copy
import tkinter as tk
from tkinter import messagebox, ttk
from typing import Any, Callable, Optional

from api_client import LetreiroApiClient, LetreiroApiError
from board import INBOX_COLUMN_SOURCE, INBOX_DISPLAY_SITUACAO
from config_store import normalize_config, restore_default_board, save_config

MAX_COLUMNS = 6


class SettingsWindow:
    def __init__(
        self,
        parent: tk.Tk,
        config: dict[str, Any],
        client: LetreiroApiClient,
        on_save: Callable[[dict[str, Any], bool], None],
    ):
        self.parent = parent
        self.client = client
        self.on_save = on_save
        self._draft = copy.deepcopy(config)
        self._win: Optional[tk.Toplevel] = None
        self._setores: list[str] = []
        self._andamentos: list[str] = []
        self._column_vars: list[dict[str, Any]] = []

    def open(self, config: dict[str, Any] | None = None) -> None:
        if config is not None:
            self._draft = copy.deepcopy(config)
        if self._win and self._win.winfo_exists():
            self._close()
        self._win = tk.Toplevel(self.parent)
        self._win.title("Letreiro — ajustes")
        self._win.geometry("640x720")
        self._win.minsize(520, 520)
        self._win.configure(bg="#121214")
        self._win.transient(self.parent)
        self._win.attributes("-topmost", True)
        self._win.protocol("WM_DELETE_WINDOW", self._close)
        self._win.bind("<Escape>", lambda _e: self._close())
        self._build()
        self._load_lookups()

    def _close(self) -> None:
        if self._win is not None:
            self._win.destroy()
            self._win = None

    def _build(self) -> None:
        win = self._win
        assert win is not None
        style = ttk.Style(win)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background="#121214")
        style.configure("TLabel", background="#121214", foreground="#e1e1e6")
        style.configure("TCheckbutton", background="#121214", foreground="#e1e1e6")
        style.configure("TButton", padding=4)
        style.configure("TLabelframe", background="#121214", foreground="#e1e1e6")
        style.configure("TLabelframe.Label", background="#121214", foreground="#e1e1e6")
        style.configure("TNotebook", background="#121214")
        style.configure("TNotebook.Tab", background="#29292e", foreground="#e1e1e6")

        outer = ttk.Frame(win)
        outer.pack(fill="both", expand=True, padx=12, pady=12)

        conn = ttk.LabelFrame(outer, text="Conexão")
        conn.pack(fill="x", pady=(0, 8))
        self.var_api = tk.StringVar(value=self._draft.get("api_base_url") or "")
        self.var_ponto = tk.StringVar(value=str(self._draft.get("ponto") or ""))
        self.var_nome = tk.StringVar(value=str(self._draft.get("nome") or ""))
        self.var_password = tk.StringVar(value=str(self._draft.get("password") or ""))
        self.var_ssl = tk.BooleanVar(value=bool(self._draft.get("ssl_verify")))
        _row(conn, 0, "API", ttk.Entry(conn, textvariable=self.var_api, width=52))
        _row(conn, 1, "Ponto", ttk.Entry(conn, textvariable=self.var_ponto, width=20))
        _row(conn, 2, "Nome", ttk.Entry(conn, textvariable=self.var_nome, width=32))
        _row(conn, 3, "Senha", ttk.Entry(conn, textvariable=self.var_password, show="*", width=32))
        ttk.Checkbutton(conn, text="Verificar SSL", variable=self.var_ssl).grid(
            row=4, column=1, sticky="w", pady=4
        )

        board_box = ttk.LabelFrame(outer, text="Painel")
        board_box.pack(fill="x", pady=(0, 8))
        self.var_sector = tk.StringVar(value=self._draft["board"].get("sector") or "SEFOC")
        self.cmb_sector = ttk.Combobox(board_box, textvariable=self.var_sector, state="readonly", width=28)
        _row(board_box, 0, "Setor", self.cmb_sector)
        self.var_count = tk.IntVar(value=int(self._draft["board"].get("columnCount") or 1))
        count = ttk.Spinbox(
            board_box,
            from_=1,
            to=MAX_COLUMNS,
            textvariable=self.var_count,
            width=6,
            command=self._sync_column_count,
        )
        _row(board_box, 1, "Grupos", count)

        vis = ttk.LabelFrame(outer, text="Letreiro")
        vis.pack(fill="x", pady=(0, 8))
        self.var_speed = tk.DoubleVar(value=float(self._draft["window"].get("speed_px_per_sec") or 40))
        self.var_opacity = tk.DoubleVar(value=float(self._draft["window"].get("opacity") or 0.95))
        _row(vis, 0, "Velocidade", ttk.Scale(vis, from_=8, to=120, variable=self.var_speed, orient="horizontal"))
        self.lbl_speed = ttk.Label(vis, text="")
        self.lbl_speed.grid(row=0, column=2, padx=6)
        _row(vis, 1, "Opacidade", ttk.Scale(vis, from_=0.5, to=1.0, variable=self.var_opacity, orient="horizontal"))
        self.lbl_opacity = ttk.Label(vis, text="")
        self.lbl_opacity.grid(row=1, column=2, padx=6)
        self.var_speed.trace_add("write", lambda *_: self._refresh_scale_labels())
        self.var_opacity.trace_add("write", lambda *_: self._refresh_scale_labels())
        self._refresh_scale_labels()

        cols_box = ttk.LabelFrame(outer, text="Grupos (equivalente às colunas do painel)")
        cols_box.pack(fill="both", expand=True, pady=(0, 8))
        self.notebook = ttk.Notebook(cols_box)
        self.notebook.pack(fill="both", expand=True, padx=6, pady=6)
        self._rebuild_columns()

        btns = ttk.Frame(outer)
        btns.pack(fill="x")
        ttk.Button(btns, text="Restaurar padrão", command=self._restore).pack(side="left")
        ttk.Button(btns, text="Cancelar", command=self._close).pack(side="right")
        ttk.Button(btns, text="Salvar", command=self._save).pack(side="right", padx=(0, 8))

    def _refresh_scale_labels(self) -> None:
        try:
            self.lbl_speed.configure(text=f"{self.var_speed.get():.0f} px/s")
            self.lbl_opacity.configure(text=f"{self.var_opacity.get() * 100:.0f}%")
        except (tk.TclError, AttributeError):
            pass

    def _load_lookups(self) -> None:
        try:
            self.client.configure(self.var_api.get().strip(), bool(self.var_ssl.get()))
            ponto = self.var_ponto.get().strip()
            if ponto and not self.client.logged_in:
                self.client.login(ponto, self.var_nome.get().strip(), self.var_password.get())
            self._setores = self.client.fetch_setores()
            self._andamentos = self.client.fetch_andamentos()
        except LetreiroApiError as exc:
            messagebox.showwarning("Letreiro", f"Não carregou listas da API:\n{exc}", parent=self._win)
            if not self._setores:
                self._setores = [self.var_sector.get() or "SEFOC", "Gravação"]
            if not self._andamentos:
                self._andamentos = sorted(
                    {s for col in self._draft["board"]["columns"] for s in (col.get("statuses") or [])}
                )
        current = self.var_sector.get().strip()
        if current and current not in self._setores:
            self._setores = [current, *self._setores]
        self.cmb_sector.configure(values=self._setores or [current or "SEFOC"])
        self._rebuild_columns()

    def _sync_column_count(self) -> None:
        try:
            count = int(self.var_count.get())
        except (tk.TclError, ValueError):
            return
        count = max(1, min(MAX_COLUMNS, count))
        cols = self._collect_columns_from_ui() or copy.deepcopy(self._draft["board"]["columns"])
        while len(cols) < count:
            cols.append(
                {
                    "id": f"col_{len(cols)}",
                    "title": f"Coluna {len(cols) + 1}",
                    "statuses": [],
                }
            )
        cols = cols[:count]
        self._draft["board"]["columns"] = cols
        self._draft["board"]["columnCount"] = len(cols)
        self._rebuild_columns()

    def _rebuild_columns(self) -> None:
        for tab in self.notebook.tabs():
            self.notebook.forget(tab)
        self._column_vars = []
        setores = self._setores or [self.var_sector.get() or "SEFOC"]
        andamentos = self._andamentos or []
        for idx, col in enumerate(self._draft["board"]["columns"]):
            frame = ttk.Frame(self.notebook)
            self.notebook.add(frame, text=col.get("title") or f"Grupo {idx + 1}")
            vars_map: dict[str, Any] = {
                "id": col.get("id") or f"col_{idx}",
                "title": tk.StringVar(value=col.get("title") or f"Coluna {idx + 1}"),
                "sector": tk.StringVar(value=str(col.get("sector") or "")),
                "inbox": tk.BooleanVar(value=col.get("source") == INBOX_COLUMN_SOURCE),
                "hide": tk.BooleanVar(value=bool(col.get("hideWhenEmpty"))),
                "statuses": {},
            }
            ttk.Label(frame, text="Título").grid(row=0, column=0, sticky="w", padx=6, pady=4)
            ttk.Entry(frame, textvariable=vars_map["title"], width=28).grid(row=0, column=1, sticky="w")
            ttk.Label(frame, text="Setor da coluna").grid(row=1, column=0, sticky="w", padx=6, pady=4)
            cmb = ttk.Combobox(
                frame,
                textvariable=vars_map["sector"],
                values=[""] + setores,
                width=26,
            )
            cmb.grid(row=1, column=1, sticky="w")
            ttk.Checkbutton(
                frame,
                text="Fonte: caixa de entrada",
                variable=vars_map["inbox"],
            ).grid(row=2, column=0, columnspan=2, sticky="w", padx=6)
            ttk.Checkbutton(
                frame,
                text="Ocultar quando vazio",
                variable=vars_map["hide"],
            ).grid(row=3, column=0, columnspan=2, sticky="w", padx=6)

            canvas = tk.Canvas(frame, bg="#121214", highlightthickness=0, height=280)
            scroll = ttk.Scrollbar(frame, orient="vertical", command=canvas.yview)
            inner = ttk.Frame(canvas)
            inner.bind("<Configure>", lambda e, c=canvas: c.configure(scrollregion=c.bbox("all")))
            canvas.create_window((0, 0), window=inner, anchor="nw")
            canvas.configure(yscrollcommand=scroll.set)
            canvas.grid(row=4, column=0, columnspan=2, sticky="nsew", padx=6, pady=6)
            scroll.grid(row=4, column=2, sticky="ns")
            frame.rowconfigure(4, weight=1)
            frame.columnconfigure(1, weight=1)

            selected = set(col.get("statuses") or [])
            names = list(dict.fromkeys([*andamentos, *selected]))
            ttk.Label(inner, text="Andamentos deste grupo:").grid(row=0, column=0, columnspan=2, sticky="w")
            for i, name in enumerate(names, start=1):
                var = tk.BooleanVar(value=name in selected)
                vars_map["statuses"][name] = var
                ttk.Checkbutton(inner, text=name, variable=var).grid(row=i, column=0, sticky="w")
            self._column_vars.append(vars_map)

    def _collect_columns_from_ui(self) -> list[dict[str, Any]]:
        columns: list[dict[str, Any]] = []
        for idx, vars_map in enumerate(self._column_vars):
            col: dict[str, Any] = {
                "id": vars_map["id"],
                "title": vars_map["title"].get().strip() or f"Coluna {idx + 1}",
                "statuses": [name for name, var in vars_map["statuses"].items() if var.get()],
            }
            if vars_map["inbox"].get():
                col["source"] = INBOX_COLUMN_SOURCE
                if not col["title"] or col["title"].startswith("Coluna "):
                    col["title"] = INBOX_DISPLAY_SITUACAO
            else:
                sector = vars_map["sector"].get().strip()
                if sector:
                    col["sector"] = sector
            if vars_map["hide"].get():
                col["hideWhenEmpty"] = True
            columns.append(col)
        return columns

    def _restore(self) -> None:
        if not messagebox.askyesno(
            "Letreiro",
            "Restaurar grupos e setor padrão (SEFOC, 4 colunas)?",
            parent=self._win,
        ):
            return
        self._draft = restore_default_board(self._draft)
        self.var_sector.set(self._draft["board"]["sector"])
        self.var_count.set(self._draft["board"]["columnCount"])
        self._rebuild_columns()

    def _save(self) -> None:
        columns = self._collect_columns_from_ui()
        if not columns:
            messagebox.showerror("Letreiro", "É necessário pelo menos um grupo.", parent=self._win)
            return
        old_api = self._draft.get("api_base_url")
        old_ponto = self._draft.get("ponto")
        old_password = self._draft.get("password")
        payload = {
            **self._draft,
            "api_base_url": self.var_api.get().strip(),
            "ssl_verify": bool(self.var_ssl.get()),
            "ponto": self.var_ponto.get().strip(),
            "nome": self.var_nome.get().strip(),
            "password": self.var_password.get(),
            "window": {
                **self._draft.get("window", {}),
                "speed_px_per_sec": float(self.var_speed.get()),
                "opacity": float(self.var_opacity.get()),
            },
            "board": {
                "sector": self.var_sector.get().strip() or "SEFOC",
                "columnCount": len(columns),
                "columns": columns,
            },
        }
        cfg = normalize_config(payload)
        save_config(cfg)
        relogin = (
            cfg.get("api_base_url") != old_api
            or cfg.get("ponto") != old_ponto
            or cfg.get("password") != old_password
        )
        self.on_save(cfg, relogin)
        self._close()


def _row(parent, row: int, label: str, widget) -> None:
    ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=6, pady=4)
    widget.grid(row=row, column=1, sticky="ew", padx=6, pady=4)
    parent.columnconfigure(1, weight=1)

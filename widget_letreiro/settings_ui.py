"""Janela de ajustes do letreiro — visual alinhado ao painel/setor."""
from __future__ import annotations

import copy
import tkinter as tk
from tkinter import messagebox, ttk
from typing import Any, Callable, Optional

from api_client import LetreiroApiClient, LetreiroApiError
from board import INBOX_COLUMN_SOURCE, INBOX_DISPLAY_SITUACAO
from config_store import (
    PRODUCTION_API_BASE,
    normalize_config,
    restore_default_board,
    save_config,
)

MAX_COLUMNS = 6
COLUMN_ACCENTS = ("#b46d03", "#04618d", "#a30d0d", "#02461e", "#ff6b6b", "#8257e6")

BG = "#0f0f12"
CARD = "#1c1c21"
INPUT = "#121214"
BORDER = "#2e2e36"
TEXT = "#e8e8ee"
MUTED = "#9b9ba8"
ACCENT = "#8257e6"
ACCENT_HOVER = "#9b7ff0"
SUCCESS = "#04d361"
DANGER = "#ff6961"
FONT = "Segoe UI"
SAME_SECTOR = "Mesmo do painel"


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
        self._group_status_hosts: list[tk.Frame] = []
        self._layout_cols = 3

    def open(self, config: dict[str, Any] | None = None) -> None:
        if config is not None:
            self._draft = copy.deepcopy(config)
        if self._win and self._win.winfo_exists():
            self._close()
        self._win = tk.Toplevel(self.parent)
        self._win.title("Configurações do letreiro")
        self._win.configure(bg=BG)
        self._win.minsize(580, 560)
        self._win.attributes("-topmost", True)
        self._win.protocol("WM_DELETE_WINDOW", self._close)
        self._win.bind("<Escape>", lambda _e: self._close())
        self._win.bind_all("<MouseWheel>", self._on_mousewheel)
        self._win.bind_all("<Button-4>", lambda e: self._wheel_units(-1, e))
        self._win.bind_all("<Button-5>", lambda e: self._wheel_units(1, e))
        self._apply_style()
        self._build()
        self._center(880, 820)
        self._load_lookups()

    def _close(self) -> None:
        if self._win is not None:
            try:
                self._win.unbind_all("<MouseWheel>")
                self._win.unbind_all("<Button-4>")
                self._win.unbind_all("<Button-5>")
            except tk.TclError:
                pass
            self._win.destroy()
            self._win = None

    def _center(self, width: int, height: int) -> None:
        assert self._win is not None
        self._win.update_idletasks()
        sw = self._win.winfo_screenwidth()
        sh = self._win.winfo_screenheight()
        width = min(width, max(580, sw - 80))
        height = min(height, max(560, sh - 80))
        x = max(20, (sw - width) // 2)
        y = max(20, (sh - height) // 2)
        self._win.geometry(f"{width}x{height}+{x}+{y}")

    def _apply_style(self) -> None:
        assert self._win is not None
        style = ttk.Style(self._win)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(
            "Letreiro.TCombobox",
            fieldbackground=INPUT,
            background=CARD,
            foreground=TEXT,
            arrowcolor=TEXT,
            bordercolor=BORDER,
            lightcolor=BORDER,
            darkcolor=BORDER,
            padding=6,
        )
        style.map(
            "Letreiro.TCombobox",
            fieldbackground=[("readonly", INPUT), ("!disabled", INPUT)],
            foreground=[("readonly", TEXT), ("!disabled", TEXT)],
            background=[("readonly", CARD)],
            arrowcolor=[("readonly", TEXT)],
        )
        style.configure(
            "Letreiro.Horizontal.TScale",
            background=CARD,
            troughcolor=BORDER,
            bordercolor=CARD,
            lightcolor=ACCENT,
            darkcolor=ACCENT,
        )

    def _build(self) -> None:
        win = self._win
        assert win is not None

        header = tk.Frame(win, bg=CARD, highlightthickness=0)
        header.pack(fill="x")
        tk.Frame(header, bg=ACCENT, height=3).pack(fill="x")
        head_inner = tk.Frame(header, bg=CARD)
        head_inner.pack(fill="x", padx=24, pady=(16, 14))
        tk.Label(
            head_inner,
            text="Configurações do letreiro",
            bg=CARD,
            fg=TEXT,
            font=(FONT, 16, "bold"),
            anchor="w",
        ).pack(fill="x")
        tk.Label(
            head_inner,
            text="Mesmos grupos do painel/setor · cada OP aparece uma vez na faixa",
            bg=CARD,
            fg=MUTED,
            font=(FONT, 9),
            anchor="w",
        ).pack(fill="x", pady=(2, 0))

        footer = tk.Frame(win, bg=CARD)
        footer.pack(side="bottom", fill="x")
        tk.Frame(footer, bg=BORDER, height=1).pack(fill="x")
        foot_inner = tk.Frame(footer, bg=CARD)
        foot_inner.pack(fill="x", padx=20, pady=12)
        _btn(foot_inner, "Restaurar padrão", self._restore, "ghost").pack(side="left")
        _btn(foot_inner, "Salvar", self._save, "primary").pack(side="right")
        _btn(foot_inner, "Cancelar", self._close, "secondary").pack(side="right", padx=(0, 8))

        body_wrap = tk.Frame(win, bg=BG)
        body_wrap.pack(fill="both", expand=True)
        self._canvas = tk.Canvas(body_wrap, bg=BG, highlightthickness=0, bd=0)
        scroll = ttk.Scrollbar(body_wrap, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self._canvas.pack(side="left", fill="both", expand=True)
        self._inner = tk.Frame(self._canvas, bg=BG)
        self._inner_id = self._canvas.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>", self._on_inner_configure)
        self._canvas.bind("<Configure>", self._on_canvas_configure)

        pad = tk.Frame(self._inner, bg=BG)
        pad.pack(fill="both", expand=True, padx=24, pady=20)

        self._build_connection(pad)
        self._build_panel(pad)
        self._build_ticker(pad)

        groups_head = tk.Frame(pad, bg=BG)
        groups_head.pack(fill="x", pady=(8, 10))
        tk.Label(
            groups_head,
            text="Grupos da faixa",
            bg=BG,
            fg=TEXT,
            font=(FONT, 12, "bold"),
            anchor="w",
        ).pack(side="left")
        _btn(groups_head, "+ Adicionar grupo", self._add_group, "secondary").pack(side="right")
        self._groups_host = tk.Frame(pad, bg=BG)
        self._groups_host.pack(fill="x")
        self._rebuild_columns()

    def _on_inner_configure(self, _event=None) -> None:
        self._canvas.configure(scrollregion=self._canvas.bbox("all"))

    def _on_canvas_configure(self, event) -> None:
        self._canvas.itemconfigure(self._inner_id, width=event.width)
        cols = 1 if event.width < 640 else 2 if event.width < 860 else 3
        if cols != self._layout_cols:
            self._layout_cols = cols
            self._reflow_andamentos()

    def _event_in_settings(self, event) -> bool:
        if not self._win:
            return False
        try:
            widget = event.widget
            if isinstance(widget, str):
                return widget.startswith(str(self._win))
            return widget.winfo_toplevel() is self._win
        except tk.TclError:
            return False

    def _wheel_units(self, steps: int, event=None) -> None:
        if event is not None and not self._event_in_settings(event):
            return
        if self._win and hasattr(self, "_canvas"):
            self._canvas.yview_scroll(steps, "units")

    def _on_mousewheel(self, event) -> None:
        if not self._event_in_settings(event):
            return
        delta = int(-event.delta / 120) if event.delta else 0
        if delta:
            self._canvas.yview_scroll(delta, "units")

    def _card(self, parent: tk.Widget, title: str) -> tk.Frame:
        wrap = tk.Frame(parent, bg=BG)
        wrap.pack(fill="x", pady=(0, 14))
        card = tk.Frame(wrap, bg=CARD, highlightbackground=BORDER, highlightthickness=1, bd=0)
        card.pack(fill="x")
        inner = tk.Frame(card, bg=CARD)
        inner.pack(fill="x", padx=18, pady=16)
        tk.Label(inner, text=title, bg=CARD, fg=TEXT, font=(FONT, 11, "bold"), anchor="w").pack(
            fill="x", pady=(0, 12)
        )
        return inner

    def _labeled_entry(
        self,
        parent: tk.Widget,
        label: str,
        variable: tk.StringVar,
        *,
        show: str = "",
        hint: str = "",
    ) -> tk.Frame:
        box = tk.Frame(parent, bg=CARD)
        tk.Label(box, text=label, bg=CARD, fg=MUTED, font=(FONT, 8), anchor="w").pack(fill="x")
        entry = tk.Entry(
            box,
            textvariable=variable,
            bg=INPUT,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            highlightthickness=1,
            highlightbackground=BORDER,
            highlightcolor=ACCENT,
            font=(FONT, 10),
            show=show,
        )
        entry.pack(fill="x", ipady=7, pady=(4, 0))
        if hint:
            tk.Label(box, text=hint, bg=CARD, fg=MUTED, font=(FONT, 8), anchor="w").pack(
                fill="x", pady=(4, 0)
            )
        return box

    def _build_connection(self, parent: tk.Widget) -> None:
        card = self._card(parent, "Conexão")
        self.var_api = tk.StringVar(value=self._draft.get("api_base_url") or PRODUCTION_API_BASE)
        self.var_ponto = tk.StringVar(value=str(self._draft.get("ponto") or ""))
        self.var_nome = tk.StringVar(value=str(self._draft.get("nome") or ""))
        self.var_password = tk.StringVar(value=str(self._draft.get("password") or ""))
        self.var_ssl = tk.BooleanVar(value=bool(self._draft.get("ssl_verify")))

        self._labeled_entry(
            card,
            "API",
            self.var_api,
            hint="Produção: https://cgrafsysvm.redecamara.camara.gov.br/sagra/api",
        ).pack(fill="x", pady=(0, 10))

        grid = tk.Frame(card, bg=CARD)
        grid.pack(fill="x")
        grid.columnconfigure(0, weight=1)
        grid.columnconfigure(1, weight=1)
        self._labeled_entry(grid, "Ponto", self.var_ponto).grid(
            row=0, column=0, sticky="ew", padx=(0, 8), pady=(0, 10)
        )
        self._labeled_entry(grid, "Nome", self.var_nome).grid(
            row=0, column=1, sticky="ew", padx=(8, 0), pady=(0, 10)
        )
        self._labeled_entry(grid, "Senha (se o IP exigir)", self.var_password, show="•").grid(
            row=1, column=0, sticky="ew", padx=(0, 8)
        )
        ssl_box = tk.Frame(grid, bg=CARD)
        ssl_box.grid(row=1, column=1, sticky="sw", padx=(8, 0), pady=(18, 0))
        _check(ssl_box, "Verificar certificado SSL", self.var_ssl).pack(anchor="w")

    def _build_panel(self, parent: tk.Widget) -> None:
        card = self._card(parent, "Painel")
        grid = tk.Frame(card, bg=CARD)
        grid.pack(fill="x")
        grid.columnconfigure(0, weight=3)
        grid.columnconfigure(1, weight=1)
        self.var_sector = tk.StringVar(value=self._draft["board"].get("sector") or "SEFOC")
        setor_box = tk.Frame(grid, bg=CARD)
        setor_box.grid(row=0, column=0, sticky="ew", padx=(0, 10))
        tk.Label(setor_box, text="Setor monitorado", bg=CARD, fg=MUTED, font=(FONT, 8), anchor="w").pack(
            fill="x"
        )
        self.cmb_sector = ttk.Combobox(
            setor_box,
            textvariable=self.var_sector,
            state="readonly",
            style="Letreiro.TCombobox",
            font=(FONT, 10),
        )
        self.cmb_sector.pack(fill="x", pady=(4, 0), ipady=4)

        count_box = tk.Frame(grid, bg=CARD)
        count_box.grid(row=0, column=1, sticky="ew")
        tk.Label(count_box, text="Quantidade de grupos", bg=CARD, fg=MUTED, font=(FONT, 8), anchor="w").pack(
            fill="x"
        )
        stepper = tk.Frame(count_box, bg=INPUT, highlightbackground=BORDER, highlightthickness=1)
        stepper.pack(fill="x", pady=(4, 0))
        self.var_count = tk.IntVar(value=int(self._draft["board"].get("columnCount") or 1))
        _btn(stepper, "−", self._dec_groups, "ghost", compact=True).pack(side="left")
        self.lbl_count = tk.Label(
            stepper,
            textvariable=self.var_count,
            bg=INPUT,
            fg=TEXT,
            font=(FONT, 12, "bold"),
            width=3,
        )
        self.lbl_count.pack(side="left", expand=True)
        _btn(stepper, "+", self._inc_groups, "ghost", compact=True).pack(side="right")
        tk.Label(
            count_box,
            text="Mínimo 1 · máximo 6",
            bg=CARD,
            fg=MUTED,
            font=(FONT, 8),
            anchor="w",
        ).pack(fill="x", pady=(4, 0))

    def _build_ticker(self, parent: tk.Widget) -> None:
        card = self._card(parent, "Letreiro")
        self.var_speed = tk.DoubleVar(value=float(self._draft["window"].get("speed_px_per_sec") or 40))
        self.var_opacity = tk.DoubleVar(value=float(self._draft["window"].get("opacity") or 0.95))
        self.var_transparent = tk.BooleanVar(value=bool(self._draft["window"].get("transparent_bg")))
        self.lbl_speed = tk.Label(card, text="", bg=CARD, fg=TEXT, font=(FONT, 9, "bold"))
        self.lbl_opacity = tk.Label(card, text="", bg=CARD, fg=TEXT, font=(FONT, 9, "bold"))
        self._slider_row(card, "Velocidade do deslize", self.var_speed, 8, 120, self.lbl_speed)
        self._slider_row(card, "Opacidade dos cards", self.var_opacity, 0.5, 1.0, self.lbl_opacity)
        self.var_speed.trace_add("write", lambda *_: self._refresh_scale_labels())
        self.var_opacity.trace_add("write", lambda *_: self._refresh_scale_labels())
        self._refresh_scale_labels()
        _check(card, "Fundo transparente (mostra a barra de tarefas atrás)", self.var_transparent).pack(
            anchor="w", pady=(10, 0)
        )
        tk.Label(
            card,
            text="O deslize só ocorre quando os cards não cabem na barra.",
            bg=CARD,
            fg=MUTED,
            font=(FONT, 8),
            anchor="w",
        ).pack(fill="x", pady=(8, 0))

    def _slider_row(
        self,
        parent: tk.Widget,
        label: str,
        variable: tk.DoubleVar,
        lo: float,
        hi: float,
        value_lbl: tk.Label,
    ) -> None:
        row = tk.Frame(parent, bg=CARD)
        row.pack(fill="x", pady=(0, 8))
        head = tk.Frame(row, bg=CARD)
        head.pack(fill="x")
        tk.Label(head, text=label, bg=CARD, fg=MUTED, font=(FONT, 8), anchor="w").pack(side="left")
        value_lbl.pack(in_=head, side="right")
        ttk.Scale(
            row,
            from_=lo,
            to=hi,
            variable=variable,
            orient="horizontal",
            style="Letreiro.Horizontal.TScale",
        ).pack(fill="x", pady=(4, 0))

    def _refresh_scale_labels(self) -> None:
        try:
            self.lbl_speed.configure(text=f"{self.var_speed.get():.0f} px/s")
            self.lbl_opacity.configure(text=f"{self.var_opacity.get() * 100:.0f}%")
        except (tk.TclError, AttributeError):
            pass

    def _inc_groups(self) -> None:
        self._set_group_count(int(self.var_count.get()) + 1)

    def _dec_groups(self) -> None:
        self._set_group_count(int(self.var_count.get()) - 1)

    def _add_group(self) -> None:
        self._set_group_count(int(self.var_count.get()) + 1)

    def _remove_group(self, idx: int) -> None:
        cols = self._collect_columns_from_ui()
        if len(cols) <= 1:
            messagebox.showinfo("Letreiro", "É necessário pelo menos 1 grupo.", parent=self._win)
            return
        cols.pop(idx)
        self._draft["board"]["columns"] = cols
        self._draft["board"]["columnCount"] = len(cols)
        self.var_count.set(len(cols))
        self._rebuild_columns()

    def _set_group_count(self, count: int) -> None:
        count = max(1, min(MAX_COLUMNS, count))
        cols = self._collect_columns_from_ui() or copy.deepcopy(self._draft["board"]["columns"])
        while len(cols) < count:
            cols.append(
                {
                    "id": f"col_{len(cols)}",
                    "title": f"Grupo {len(cols) + 1}",
                    "statuses": [],
                }
            )
        cols = cols[:count]
        self._draft["board"]["columns"] = cols
        self._draft["board"]["columnCount"] = len(cols)
        self.var_count.set(len(cols))
        self._rebuild_columns()

    def _load_lookups(self) -> None:
        try:
            self.client.configure(self.var_api.get().strip(), bool(self.var_ssl.get()))
            ponto = self.var_ponto.get().strip()
            if ponto and not self.client.logged_in:
                self.client.login(ponto, self.var_nome.get().strip(), self.var_password.get())
            self._setores = self.client.fetch_setores()
            self._andamentos = self.client.fetch_andamentos()
        except LetreiroApiError as exc:
            messagebox.showwarning(
                "Letreiro",
                f"Não carregou listas da API:\n{exc}",
                parent=self._win,
            )
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

    def _rebuild_columns(self) -> None:
        if not hasattr(self, "_groups_host"):
            return
        for child in self._groups_host.winfo_children():
            child.destroy()
        self._column_vars = []
        self._group_status_hosts = []
        setores = self._setores or [self.var_sector.get() or "SEFOC"]
        andamentos = self._andamentos or []
        for idx, col in enumerate(self._draft["board"]["columns"]):
            self._build_group_card(idx, col, setores, andamentos)
        self._inner.update_idletasks()
        self._on_inner_configure()

    def _build_group_card(
        self,
        idx: int,
        col: dict[str, Any],
        setores: list[str],
        andamentos: list[str],
    ) -> None:
        accent = COLUMN_ACCENTS[idx % len(COLUMN_ACCENTS)]
        wrap = tk.Frame(self._groups_host, bg=BG)
        wrap.pack(fill="x", pady=(0, 12))
        card = tk.Frame(wrap, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        card.pack(fill="x")
        tk.Frame(card, bg=accent, width=4).pack(side="left", fill="y")
        inner = tk.Frame(card, bg=CARD)
        inner.pack(fill="x", padx=16, pady=14)

        vars_map: dict[str, Any] = {
            "id": col.get("id") or f"col_{idx}",
            "title": tk.StringVar(value=col.get("title") or f"Grupo {idx + 1}"),
            "sector": tk.StringVar(value=str(col.get("sector") or "")),
            "inbox": tk.BooleanVar(value=col.get("source") == INBOX_COLUMN_SOURCE),
            "hide": tk.BooleanVar(value=bool(col.get("hideWhenEmpty"))),
            "statuses": {},
            "status_widgets": [],
        }

        head = tk.Frame(inner, bg=CARD)
        head.pack(fill="x")
        tk.Label(
            head,
            text=f"Grupo {idx + 1}",
            bg=CARD,
            fg=accent,
            font=(FONT, 8, "bold"),
        ).pack(side="left")
        _btn(head, "Remover", lambda i=idx: self._remove_group(i), "danger", compact=True).pack(
            side="right"
        )

        fields = tk.Frame(inner, bg=CARD)
        fields.pack(fill="x", pady=(8, 8))
        fields.columnconfigure(0, weight=1)
        fields.columnconfigure(1, weight=1)
        title_box = tk.Frame(fields, bg=CARD)
        title_box.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        tk.Label(title_box, text="Título", bg=CARD, fg=MUTED, font=(FONT, 8), anchor="w").pack(fill="x")
        tk.Entry(
            title_box,
            textvariable=vars_map["title"],
            bg=INPUT,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            highlightthickness=1,
            highlightbackground=BORDER,
            highlightcolor=ACCENT,
            font=(FONT, 10),
        ).pack(fill="x", ipady=6, pady=(4, 0))

        sector_box = tk.Frame(fields, bg=CARD)
        sector_box.grid(row=0, column=1, sticky="ew")
        tk.Label(
            sector_box, text="Setor desta coluna", bg=CARD, fg=MUTED, font=(FONT, 8), anchor="w"
        ).pack(fill="x")
        display_sector = tk.StringVar(
            value=(vars_map["sector"].get().strip() or SAME_SECTOR)
        )
        vars_map["sector_display"] = display_sector
        cmb = ttk.Combobox(
            sector_box,
            textvariable=display_sector,
            values=[SAME_SECTOR, *setores],
            state="readonly",
            style="Letreiro.TCombobox",
            font=(FONT, 10),
        )
        cmb.pack(fill="x", pady=(4, 0), ipady=3)
        cmb.bind(
            "<<ComboboxSelected>>",
            lambda _e, vm=vars_map: vm["sector"].set(
                "" if vm["sector_display"].get() == SAME_SECTOR else vm["sector_display"].get()
            ),
        )

        flags = tk.Frame(inner, bg=CARD)
        flags.pack(fill="x", pady=(0, 10))
        _check(flags, "Fonte: caixa de entrada", vars_map["inbox"]).pack(side="left", padx=(0, 16))
        _check(flags, "Ocultar quando vazio", vars_map["hide"]).pack(side="left")

        tk.Label(
            inner,
            text="Andamentos deste grupo",
            bg=CARD,
            fg=MUTED,
            font=(FONT, 8),
            anchor="w",
        ).pack(fill="x", pady=(0, 6))
        status_host = tk.Frame(inner, bg=CARD)
        status_host.pack(fill="x")
        selected = set(col.get("statuses") or [])
        names = list(dict.fromkeys([*andamentos, *selected]))
        widgets: list[tk.Widget] = []
        for name in names:
            var = tk.BooleanVar(value=name in selected)
            vars_map["statuses"][name] = var
            chip = _status_chip(status_host, name, var)
            widgets.append(chip)
        vars_map["status_widgets"] = widgets
        self._group_status_hosts.append(status_host)
        self._column_vars.append(vars_map)
        self._place_status_chips(status_host, widgets)

    def _reflow_andamentos(self) -> None:
        for vars_map, host in zip(self._column_vars, self._group_status_hosts):
            if host.winfo_exists():
                self._place_status_chips(host, vars_map.get("status_widgets") or [])

    def _place_status_chips(self, host: tk.Frame, widgets: list[tk.Widget]) -> None:
        cols = max(1, self._layout_cols)
        for i, widget in enumerate(widgets):
            widget.grid_forget()
            widget.grid(
                row=i // cols,
                column=i % cols,
                sticky="ew",
                padx=(0, 8),
                pady=(0, 6),
            )
        for c in range(cols):
            host.columnconfigure(c, weight=1)

    def _collect_columns_from_ui(self) -> list[dict[str, Any]]:
        columns: list[dict[str, Any]] = []
        for idx, vars_map in enumerate(self._column_vars):
            col: dict[str, Any] = {
                "id": vars_map["id"],
                "title": vars_map["title"].get().strip() or f"Grupo {idx + 1}",
                "statuses": [name for name, var in vars_map["statuses"].items() if var.get()],
            }
            if vars_map["inbox"].get():
                col["source"] = INBOX_COLUMN_SOURCE
                if not col["title"] or col["title"].startswith("Grupo "):
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
            "Restaurar grupos e setor padrão (SEFOC, 4 grupos)?",
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
                "transparent_bg": bool(self.var_transparent.get()),
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


def _btn(
    parent: tk.Widget,
    text: str,
    command,
    variant: str = "secondary",
    *,
    compact: bool = False,
) -> tk.Button:
    palettes = {
        "primary": (ACCENT, ACCENT_HOVER, "#ffffff"),
        "secondary": ("#2a2a32", "#3a3a44", TEXT),
        "ghost": ("#1c1c21", "#2e2e36", MUTED),
        "danger": ("#3a1518", "#542026", DANGER),
    }
    bg, hover, fg = palettes.get(variant, palettes["secondary"])
    btn = tk.Button(
        parent,
        text=text,
        command=command,
        bg=bg,
        fg=fg,
        activebackground=hover,
        activeforeground=fg,
        relief="flat",
        bd=0,
        cursor="hand2",
        font=(FONT, 9, "bold" if variant == "primary" else "normal"),
        padx=10 if compact else 16,
        pady=4 if compact else 8,
        highlightthickness=0,
    )
    btn.bind("<Enter>", lambda _e, b=btn, c=hover: b.configure(bg=c))
    btn.bind("<Leave>", lambda _e, b=btn, c=bg: b.configure(bg=c))
    return btn


def _check(parent: tk.Widget, text: str, variable: tk.BooleanVar) -> tk.Checkbutton:
    return tk.Checkbutton(
        parent,
        text=text,
        variable=variable,
        bg=CARD,
        fg=TEXT,
        selectcolor=INPUT,
        activebackground=CARD,
        activeforeground=TEXT,
        highlightthickness=0,
        font=(FONT, 9),
        anchor="w",
    )


def _status_chip(parent: tk.Widget, name: str, variable: tk.BooleanVar) -> tk.Frame:
    chip = tk.Frame(parent, bg=INPUT, highlightbackground=BORDER, highlightthickness=1)
    tk.Checkbutton(
        chip,
        text=name,
        variable=variable,
        bg=INPUT,
        fg=TEXT,
        selectcolor=INPUT,
        activebackground=INPUT,
        activeforeground=TEXT,
        highlightthickness=0,
        font=(FONT, 8),
        anchor="w",
        wraplength=220,
        justify="left",
    ).pack(fill="x", padx=6, pady=3)
    return chip

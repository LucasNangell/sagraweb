#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Interface Gráfica de Releases - SAGRA Web (DEV)
Autor: Engenheiro DevOps Sênior

Esta interface permite:
- Visualizar todos os releases gravados (MySQL ou SQLite local).
- Ver detalhes do Git (branch, commit) e estatísticas de cada release.
- Visualizar a lista de arquivos afetados em cada release (added, modified, deleted).
- Iniciar novos backups (Full ou Incremental) com logs exibidos em tempo real.
- Restaurar arquivos de releases passados para a pasta original ou customizada.
"""

import datetime
import getpass
import json
import logging
import queue
import shutil
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from pathlib import Path

# Configuração de caminhos para importar módulos do projeto
import sys
if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).parent.resolve()
else:
    ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy" / "scripts"))
sys.path.insert(0, str(ROOT / "app" / "backend"))

# Importa o script de backup para reaproveitar lógica e conexões
try:
    import backup_incremental_release as backup_lib
except ImportError as exc:
    print(f"Erro: Não foi possível importar o backup_incremental_release: {exc}")
    sys.exit(1)

# =====================================================================
# HANDLER DE LOG PERSONALIZADO PARA ENVIAR LOGS À GUI
# =====================================================================
class GuiLogQueueHandler(logging.Handler):
    def __init__(self, log_queue: queue.Queue):
        super().__init__()
        self.log_queue = log_queue

    def emit(self, record):
        log_entry = self.format(record)
        self.log_queue.put(log_entry)

# =====================================================================
# CLASSE PRINCIPAL DA INTERFACE GRÁFICA
# =====================================================================
class BackupAppGui:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("SAGRA Web - Painel de Releases & Backups (DEV)")
        self.root.geometry("1180x680")
        self.root.configure(bg="#1c1c1c")
        
        # Centraliza a janela na tela
        self.root.update_idletasks()
        width = self.root.winfo_width()
        height = self.root.winfo_height()
        x = (self.root.winfo_screenwidth() // 2) - (width // 2)
        y = (self.root.winfo_screenheight() // 2) - (height // 2)
        self.root.geometry(f"+{x}+{y}")

        self.db = None
        self.log_queue = queue.Queue()
        self.backup_running = False
        self.selected_release_backup_path = None
        self.selected_release_id = None
        self.selected_release_name = None

        # Configurações do projeto e banco
        self.source_root = ROOT.resolve()
        self.mysql_config = None
        self.backup_root_val = None
        if backup_lib.HAS_CONFIG_MANAGER:
            self.mysql_config = backup_lib.config_manager.get_mysql_config()
            self.backup_root_val = backup_lib.config_manager.get("backup_root")
        
        self.backup_root = Path(self.backup_root_val).resolve() if self.backup_root_val else (self.source_root / "backups")
        self.releases_dir = self.backup_root / "releases"
        self.sqlite_db_path = self.backup_root / "releases.db"

        # Conecta ao banco de dados
        self.connect_db()

        # Configura tema escuro para TTK
        self.setup_styles()

        # Constrói o layout principal
        self.build_ui()

        # Agenda a checagem da fila de logs e carrega releases iniciais
        self.check_log_queue()
        self.refresh_releases_list()

    def connect_db(self):
        try:
            self.db = backup_lib.DatabaseAdapter(mysql_config=self.mysql_config, sqlite_path=self.sqlite_db_path)
            self.db.init_tables()
        except Exception as e:
            messagebox.showerror(
                "Erro de Banco de Dados",
                f"Não foi possível conectar ao banco de dados (MySQL ou SQLiteFallback): {e}"
            )

    def setup_styles(self):
        style = ttk.Style()
        style.theme_use("clam")
        
        # Estilo geral escuro para Treeview
        style.configure(
            "Treeview",
            background="#1e1e1e",
            foreground="#cccccc",
            fieldbackground="#1e1e1e",
            borderwidth=0,
            font=("Segoe UI", 10)
        )
        style.configure(
            "Treeview.Heading",
            background="#2d2d2d",
            foreground="#ffffff",
            font=("Segoe UI", 10, "bold"),
            borderwidth=1
        )
        style.map(
            "Treeview",
            background=[("selected", "#007acc")],
            foreground=[("selected", "#ffffff")]
        )
        
        # Estilo para Abas
        style.configure(
            "TNotebook",
            background="#1c1c1c",
            borderwidth=0
        )
        style.configure(
            "TNotebook.Tab",
            background="#2d2d2d",
            foreground="#cccccc",
            padding=[10, 4],
            font=("Segoe UI", 9)
        )
        style.map(
            "TNotebook.Tab",
            background=[("selected", "#1c1c1c")],
            foreground=[("selected", "#ffffff")]
        )

    def build_ui(self):
        # -------------------------------------------------------------
        # BARRA SUPERIOR (HEADER)
        # -------------------------------------------------------------
        header_frame = tk.Frame(self.root, bg="#252526", height=50)
        header_frame.pack(fill="x", side="top")
        header_frame.pack_propagate(False)

        title_lbl = tk.Label(
            header_frame,
            text=" SAGRA WEB — Gerenciador de Backups e Releases",
            font=("Segoe UI", 13, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        title_lbl.pack(side="left", padx=15, pady=10)

        # Botão Documentação
        doc_btn = tk.Button(
            header_frame,
            text="Documentação",
            command=self.show_docs,
            bg="#3e3e42",
            fg="#ffffff",
            activebackground="#2d2d30",
            activeforeground="#ffffff",
            bd=0,
            relief="flat",
            font=("Segoe UI", 9, "bold"),
            padx=12
        )
        doc_btn.pack(side="right", padx=15, pady=10)

        # Botão Atualizar
        refresh_btn = tk.Button(
            header_frame,
            text="Atualizar Lista",
            command=self.refresh_releases_list,
            bg="#007acc",
            fg="#ffffff",
            activebackground="#005999",
            activeforeground="#ffffff",
            bd=0,
            relief="flat",
            font=("Segoe UI", 9, "bold"),
            padx=12
        )
        refresh_btn.pack(side="right", padx=5, pady=10)

        # -------------------------------------------------------------
        # CONTEÚDO PRINCIPAL (SPLIT PANES)
        # -------------------------------------------------------------
        main_pane = tk.PanedWindow(self.root, orient="horizontal", bg="#1c1c1c", bd=0, sashwidth=5)
        main_pane.pack(fill="both", expand=True, padx=10, pady=10)

        # Painel Esquerdo (Lista de Releases)
        left_frame = tk.Frame(main_pane, bg="#252526")
        main_pane.add(left_frame, minsize=550)

        left_title = tk.Label(
            left_frame,
            text="Histórico de Releases",
            font=("Segoe UI", 11, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        left_title.pack(anchor="w", padx=10, pady=10)

        # Tabela de Releases
        tree_frame = tk.Frame(left_frame, bg="#252526")
        tree_frame.pack(fill="both", expand=True, padx=10, pady=5)

        self.release_tree = ttk.Treeview(
            tree_frame,
            columns=("id", "name", "type", "status", "date", "desc"),
            show="headings"
        )
        self.release_tree.heading("id", text="ID")
        self.release_tree.heading("name", text="Nome do Release")
        self.release_tree.heading("type", text="Tipo")
        self.release_tree.heading("status", text="Status")
        self.release_tree.heading("date", text="Data/Hora")
        self.release_tree.heading("desc", text="Descrição")

        self.release_tree.column("id", width=40, anchor="center")
        self.release_tree.column("name", width=140, anchor="w")
        self.release_tree.column("type", width=90, anchor="center")
        self.release_tree.column("status", width=80, anchor="center")
        self.release_tree.column("date", width=130, anchor="center")
        self.release_tree.column("desc", width=180, anchor="w")

        self.release_tree.pack(fill="both", expand=True, side="left")
        self.release_tree.bind("<<TreeviewSelect>>", self.on_release_select)

        tree_scroll = ttk.Scrollbar(tree_frame, orient="vertical", command=self.release_tree.yview)
        self.release_tree.configure(yscrollcommand=tree_scroll.set)
        tree_scroll.pack(fill="y", side="right")

        # Painel Direito (Detalhes & Arquivos)
        right_frame = tk.Frame(main_pane, bg="#252526")
        main_pane.add(right_frame, minsize=500)

        # Card de Detalhes (Superior Direito)
        details_title = tk.Label(
            right_frame,
            text="Detalhes da Release Selecionada",
            font=("Segoe UI", 11, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        details_title.pack(anchor="w", padx=10, pady=10)

        self.details_card = tk.Frame(right_frame, bg="#2d2d30", bd=1, relief="solid")
        self.details_card.pack(fill="x", padx=10, pady=5)

        self.git_branch_lbl = tk.Label(self.details_card, text="Branch Git:  -", font=("Segoe UI", 9), bg="#2d2d30", fg="#bbbbbb")
        self.git_branch_lbl.grid(row=0, column=0, sticky="w", padx=10, pady=3)
        self.git_commit_lbl = tk.Label(self.details_card, text="Commit Hash: -", font=("Segoe UI", 9), bg="#2d2d30", fg="#bbbbbb")
        self.git_commit_lbl.grid(row=1, column=0, sticky="w", padx=10, pady=3)
        self.created_by_lbl = tk.Label(self.details_card, text="Criado por:  -", font=("Segoe UI", 9), bg="#2d2d30", fg="#bbbbbb")
        self.created_by_lbl.grid(row=2, column=0, sticky="w", padx=10, pady=3)
        self.stats_lbl = tk.Label(self.details_card, text="Arquivos:    0 adicionados, 0 modificados, 0 removidos", font=("Segoe UI", 9), bg="#2d2d30", fg="#bbbbbb")
        self.stats_lbl.grid(row=3, column=0, sticky="w", padx=10, pady=3)

        # Tabela de Arquivos Alterados (Inferior Direito)
        files_title_frame = tk.Frame(right_frame, bg="#252526")
        files_title_frame.pack(fill="x", padx=10, pady=5)

        files_lbl = tk.Label(
            files_title_frame,
            text="Arquivos Alterados",
            font=("Segoe UI", 11, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        files_lbl.pack(side="left")

        # Botão Restaurar
        self.restore_btn = tk.Button(
            files_title_frame,
            text="Restaurar Arquivo Selecionado",
            command=self.restore_selected_file,
            state="disabled",
            bg="#00a267",
            fg="#ffffff",
            activebackground="#007f50",
            activeforeground="#ffffff",
            bd=0,
            relief="flat",
            font=("Segoe UI", 9, "bold"),
            padx=10
        )
        self.restore_btn.pack(side="right")

        # Botão Visualizar Documentos (MD)
        self.view_md_btn = tk.Button(
            files_title_frame,
            text="Visualizar Documentos (.md)",
            command=self.open_md_viewer_dialog,
            state="disabled",
            bg="#007acc",
            fg="#ffffff",
            activebackground="#005999",
            activeforeground="#ffffff",
            bd=0,
            relief="flat",
            font=("Segoe UI", 9, "bold"),
            padx=10
        )
        self.view_md_btn.pack(side="right", padx=(0, 10))

        files_frame = tk.Frame(right_frame, bg="#252526")
        files_frame.pack(fill="both", expand=True, padx=10, pady=5)

        self.files_tree = ttk.Treeview(
            files_frame,
            columns=("action", "size", "path"),
            show="headings"
        )
        self.files_tree.heading("action", text="Ação")
        self.files_tree.heading("size", text="Tamanho")
        self.files_tree.heading("path", text="Caminho Relativo")

        self.files_tree.column("action", width=80, anchor="center")
        self.files_tree.column("size", width=95, anchor="e")
        self.files_tree.column("path", width=300, anchor="w")

        self.files_tree.pack(fill="both", expand=True, side="left")
        self.files_tree.bind("<<TreeviewSelect>>", self.on_file_select)

        files_scroll = ttk.Scrollbar(files_frame, orient="vertical", command=self.files_tree.yview)
        self.files_tree.configure(yscrollcommand=files_scroll.set)
        files_scroll.pack(fill="y", side="right")

        # -------------------------------------------------------------
        # ÁREA DE BACKUP E CONSOLE DE LOGS (INFERIOR)
        # -------------------------------------------------------------
        bottom_frame = tk.Frame(self.root, bg="#252526", height=200)
        bottom_frame.pack(fill="x", side="bottom", padx=10, pady=(0, 10))
        bottom_frame.pack_propagate(False)

        # Formulário de Geração de Backup
        backup_form = tk.Frame(bottom_frame, bg="#252526")
        backup_form.pack(fill="y", side="left", padx=15, pady=10)

        form_title = tk.Label(
            backup_form,
            text="Geração de Release Manual",
            font=("Segoe UI", 10, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        form_title.pack(anchor="w", pady=(0, 5))

        desc_lbl = tk.Label(backup_form, text="Descrição da Release:", font=("Segoe UI", 9), bg="#252526", fg="#cccccc")
        desc_lbl.pack(anchor="w")
        self.desc_entry = tk.Entry(backup_form, width=32, bg="#1e1e1e", fg="#ffffff", insertbackground="#ffffff", bd=1, relief="solid", font=("Segoe UI", 9))
        self.desc_entry.pack(anchor="w", pady=3)

        type_lbl = tk.Label(backup_form, text="Tipo do Backup:", font=("Segoe UI", 9), bg="#252526", fg="#cccccc")
        type_lbl.pack(anchor="w", pady=(5, 0))

        self.backup_type_var = tk.StringVar(value="incremental")
        type_radio_frame = tk.Frame(backup_form, bg="#252526")
        type_radio_frame.pack(anchor="w")

        tk.Radiobutton(
            type_radio_frame, text="Incremental", variable=self.backup_type_var, value="incremental",
            bg="#252526", fg="#ffffff", selectcolor="#1e1e1e", font=("Segoe UI", 9)
        ).pack(side="left")
        tk.Radiobutton(
            type_radio_frame, text="Completo (Full)", variable=self.backup_type_var, value="full",
            bg="#252526", fg="#ffffff", selectcolor="#1e1e1e", font=("Segoe UI", 9)
        ).pack(side="left", padx=(10, 0))

        self.run_backup_btn = tk.Button(
            backup_form,
            text="Iniciar Backup do DEV",
            command=self.start_backup_process,
            bg="#007acc",
            fg="#ffffff",
            activebackground="#005999",
            activeforeground="#ffffff",
            bd=0,
            relief="flat",
            font=("Segoe UI", 10, "bold"),
            pady=6,
            cursor="hand2"
        )
        self.run_backup_btn.pack(fill="x", pady=12)

        # Console de Logs (Lado Direito)
        console_frame = tk.Frame(bottom_frame, bg="#252526")
        console_frame.pack(fill="both", expand=True, side="right", padx=10, pady=10)

        console_title = tk.Label(
            console_frame,
            text="Console de Logs de Execução",
            font=("Segoe UI", 10, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        console_title.pack(anchor="w")

        # Caixa de Texto de Logs
        self.console_text = tk.Text(
            console_frame,
            bg="#1e1e1e",
            fg="#00ff66",
            insertbackground="#ffffff",
            font=("Consolas", 8),
            bd=1,
            relief="solid",
            state="disabled"
        )
        self.console_text.pack(fill="both", expand=True, side="left", pady=5)

        console_scroll = ttk.Scrollbar(console_frame, orient="vertical", command=self.console_text.yview)
        self.console_text.configure(yscrollcommand=console_scroll.set)
        console_scroll.pack(fill="y", side="right", pady=5)

    # =====================================================================
    # LOGICA DE NAVEGAÇÃO E REFRESH
    # =====================================================================
    def refresh_releases_list(self):
        if not self.db:
            return
        
        # Limpa releases existentes na tabela
        for item in self.release_tree.get_children():
            self.release_tree.delete(item)

        # Consulta releases
        query = """
        SELECT id, release_name, backup_type, status, started_at, description 
        FROM tabReleases 
        ORDER BY id DESC
        """
        try:
            rows = self.db.execute_query(query)
            for r in rows:
                self.release_tree.insert(
                    "",
                    "end",
                    values=(
                        r["id"],
                        r["release_name"],
                        r["backup_type"].upper(),
                        r["status"].upper(),
                        r["started_at"],
                        r["description"] or ""
                    )
                )
            
            # Limpa cards e tabela de arquivos
            self.git_branch_lbl.config(text="Branch Git:  -")
            self.git_commit_lbl.config(text="Commit Hash: -")
            self.created_by_lbl.config(text="Criado por:  -")
            self.stats_lbl.config(text="Arquivos:    0 adicionados, 0 modificados, 0 removidos")
            
            self.selected_release_backup_path = None
            self.selected_release_id = None
            self.selected_release_name = None
            self.view_md_btn.config(state="disabled")
            
            for item in self.files_tree.get_children():
                self.files_tree.delete(item)
                
            self.restore_btn.config(state="disabled")
            
        except Exception as e:
            messagebox.showerror("Erro de Leitura", f"Falha ao carregar lista de releases: {e}")

    def on_release_select(self, event):
        selected = self.release_tree.selection()
        if not selected:
            return
        
        item_values = self.release_tree.item(selected[0], "values")
        release_id = item_values[0]
        self.selected_release_id = release_id
        self.selected_release_name = item_values[1]

        # Busca detalhes da release
        query_details = """
        SELECT git_branch, git_commit, created_by, total_added, total_modified, total_deleted, backup_path 
        FROM tabReleases 
        WHERE id = %s
        """
        try:
            details = self.db.execute_query(query_details, [int(release_id)])
            if details:
                d = details[0]
                self.git_branch_lbl.config(text=f"Branch Git:  {d.get('git_branch') or 'N/A'}")
                self.git_commit_lbl.config(text=f"Commit Hash: {d.get('git_commit') or 'N/A'}")
                self.created_by_lbl.config(text=f"Criado por:  {d.get('created_by') or 'N/A'}")
                self.stats_lbl.config(
                    text=f"Arquivos:    {d['total_added']} adicionados, {d['total_modified']} modificados, {d['total_deleted']} removidos"
                )
                self.selected_release_backup_path = d.get("backup_path")
                self.view_md_btn.config(state="normal")

            # Busca lista de arquivos
            for item in self.files_tree.get_children():
                self.files_tree.delete(item)

            query_files = """
            SELECT relative_path, action, size_bytes 
            FROM tabReleaseFiles 
            WHERE release_id = %s 
            ORDER BY relative_path
            """
            files = self.db.execute_query(query_files, [int(release_id)])
            for f in files:
                self.files_tree.insert(
                    "",
                    "end",
                    values=(
                        f["action"].upper(),
                        f"{f['size_bytes']:,} Bytes",
                        f["relative_path"]
                    )
                )
            
            self.restore_btn.config(state="disabled")

        except Exception as e:
            messagebox.showerror("Erro de Carregamento", f"Falha ao carregar arquivos da release: {e}")

    def on_file_select(self, event):
        selected = self.files_tree.selection()
        if selected:
            # Habilita o botão apenas se for selecionado um arquivo válido
            # Mas ignora se a ação for de deleção (deleted)
            values = self.files_tree.item(selected[0], "values")
            action = values[0]
            if action == "[DELETED]" or action == "DELETED":
                self.restore_btn.config(state="disabled")
            else:
                self.restore_btn.config(state="normal")
        else:
            self.restore_btn.config(state="disabled")

    # =====================================================================
    # LOGICA DE RESTAURAÇÃO
    # =====================================================================
    def restore_selected_file(self):
        selected_rel = self.release_tree.selection()
        selected_file = self.files_tree.selection()
        if not selected_rel or not selected_file:
            return

        rel_values = self.release_tree.item(selected_rel[0], "values")
        file_values = self.files_tree.item(selected_file[0], "values")

        release_id = int(rel_values[0])
        release_name = rel_values[1]
        action = file_values[0]
        relative_path = file_values[2]

        if action == "DELETED" or action == "[DELETED]":
            messagebox.showwarning("Impossível Restaurar", "O arquivo selecionado foi removido nesta versão.")
            return

        # Pergunta ao usuário se ele quer restaurar na pasta original ou escolher caminho alternativo
        ans = messagebox.askyesnocancel(
            "Destino de Restauração",
            f"Arquivo: {relative_path}\nRelease: #{release_id} - {release_name}\n\n"
            f"Deseja restaurar de volta no caminho original do projeto (DEV)?\n"
            f"[Sim] - Sobrescreve no caminho original.\n"
            f"[Não] - Permite selecionar uma pasta alternativa.\n"
            f"[Cancelar] - Cancela a operação."
        )

        if ans is None:
            return # Cancelado

        target_path = None
        force_overwrite = False

        if ans is True:
            # Restaurar no caminho original
            target_path = self.source_root / relative_path
            # Pergunta confirmação de sobrescrita se o arquivo existir
            if target_path.exists():
                confirm = messagebox.askyesno(
                    "Confirmar Sobrescrita",
                    f"ATENÇÃO: O arquivo já existe em:\n{target_path}\n\n"
                    f"Deseja mesmo sobrescrevê-lo com a versão do release?",
                    icon="warning"
                )
                if not confirm:
                    return
                force_overwrite = True
        else:
            # Restaurar em caminho customizado
            # Pede para escolher um diretório
            dest_dir = filedialog.askdirectory(title="Selecione a pasta de destino para restauração")
            if not dest_dir:
                return # Diálogo fechado
            dest_dir_path = Path(dest_dir)
            target_path = dest_dir_path / Path(relative_path).name
            if target_path.exists():
                confirm = messagebox.askyesno(
                    "Confirmar Sobrescrita",
                    f"O arquivo {target_path.name} já existe na pasta de destino.\n\nDeseja sobrescrever?"
                )
                if not confirm:
                    return
                force_overwrite = True

        # Executa restauração usando a lógica interna do script de backup
        try:
            status = backup_lib.handle_restore_file(
                db=self.db,
                rel_path=relative_path,
                release_ref=str(release_id),
                output_path=str(target_path),
                force=force_overwrite,
                source_root=self.source_root,
                backup_root=self.backup_root
            )
            if status == 0:
                messagebox.showinfo("Restauração Concluída", f"Arquivo restaurado com sucesso para:\n{target_path}")
            else:
                messagebox.showerror("Restauração Falhou", "Falha crítica na cópia do arquivo. Veja os detalhes no console.")
        except Exception as e:
            messagebox.showerror("Erro de Restauração", f"Ocorreu um erro ao restaurar o arquivo: {e}")

    # =====================================================================
    # LOGICA DE GERACAO DE BACKUPS EM BACKGROUND
    # =====================================================================
    def log_message(self, message: str):
        self.console_text.configure(state="normal")
        self.console_text.insert("end", message + "\n")
        self.console_text.see("end")
        self.console_text.configure(state="disabled")

    def check_log_queue(self):
        # Descarrega mensagens da fila de logs da thread de background para o Textbox da GUI
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.log_message(msg)
                self.log_queue.task_done()
        except queue.Empty:
            pass
        self.root.after(100, self.check_log_queue)

    def start_backup_process(self):
        if self.backup_running:
            return

        desc = self.desc_entry.get().strip()
        b_type = self.backup_type_var.get()
        is_full = (b_type == "full")

        # Pergunta de segurança para backup completo
        if is_full:
            confirm = messagebox.askyesno(
                "Confirmar Backup Completo",
                "Você selecionou um backup completo inicial (FULL).\n"
                "Isto varrerá e copiará todos os arquivos da pasta original do DEV.\n\n"
                "Deseja continuar?"
            )
            if not confirm:
                return

        self.backup_running = True
        self.run_backup_btn.config(state="disabled", text="Executando...")
        self.console_text.configure(state="normal")
        self.console_text.delete("1.0", "end")
        self.console_text.configure(state="disabled")

        # Spawna a thread de execução do backup
        t = threading.Thread(target=self.run_backup, args=(desc, is_full), daemon=True)
        t.start()

    def run_backup(self, desc: str, is_full: bool):
        # Salva o handler de log raiz antigo
        root_logger = logging.getLogger()
        old_level = root_logger.level
        old_handlers = list(root_logger.handlers)

        # Configura o logger para injetar logs na fila da GUI
        root_logger.setLevel(logging.INFO)
        for h in old_handlers:
            root_logger.removeHandler(h)

        gui_handler = GuiLogQueueHandler(self.log_queue)
        gui_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        root_logger.addHandler(gui_handler)

        started_at = datetime.datetime.now()
        timestamp_str = started_at.strftime("%Y%m%d_%H%M%S")
        release_name = f"gui_{timestamp_str}"

        # Patcheia sys.argv para chamar a função main do backup
        import sys
        old_argv = sys.argv
        sys.argv = ["backup_incremental_release.py", "--release-name", release_name, "--description", desc]
        if is_full:
            sys.argv.append("--force-full")

        exit_code = 1
        try:
            exit_code = backup_lib.main()
        except Exception as e:
            logging.critical(f"Erro inesperado na thread de backup: {e}", exc_info=True)
        finally:
            sys.argv = old_argv
            
            # Restaura handlers anteriores de log
            root_logger.removeHandler(gui_handler)
            root_logger.setLevel(old_level)
            for h in old_handlers:
                root_logger.addHandler(h)

            # Atualiza estados da GUI de volta na thread principal
            self.root.after(0, self.on_backup_complete, exit_code)

    def on_backup_complete(self, exit_code: int):
        self.backup_running = False
        self.run_backup_btn.config(state="normal", text="Iniciar Backup do DEV")
        self.desc_entry.delete(0, "end")
        
        if exit_code == 0:
            messagebox.showinfo("Backup Concluído", "O processo de release e backup incremental terminou com sucesso!")
        else:
            messagebox.showerror(
                "Falha no Backup",
                "Ocorreu um erro durante a execução do backup.\nConsulte as mensagens de logs para detalhes."
            )
        
        # Atualiza tabelas
        self.refresh_releases_list()

    def show_docs(self):
        # Mostra um popup curto explicativo sobre como restaurar
        docs_text = (
            "SAGRA Web - Painel de Releases & Backups (DEV)\n\n"
            "COMO UTILIZAR:\n"
            "1. Lista de Releases: Clique em qualquer release do painel esquerdo para ver os metadados do Git e os arquivos afetados no painel direito.\n\n"
            "2. Restaurar Arquivo:\n"
            "   - Selecione um arquivo modificado/adicionado no painel direito.\n"
            "   - Clique em 'Restaurar Arquivo Selecionado'.\n"
            "   - Escolha se deseja sobrescrever o arquivo original no DEV ou exportar para uma pasta alternativa.\n\n"
            "3. Gerar Release Manual:\n"
            "   - Insira uma descrição rápida para documentação do release.\n"
            "   - Escolha se deseja um backup incremental (apenas arquivos editados) ou completo.\n"
            "   - Clique em 'Iniciar Backup do DEV'.\n\n"
            "Nota: O banco de dados MySQL é prioritário. Se estiver offline, os dados serão salvos no SQLite em backups/releases.db."
        )
        messagebox.showinfo("Guia Prático de Ajuda", docs_text)

    def open_md_viewer_dialog(self):
        if not hasattr(self, 'selected_release_backup_path') or not self.selected_release_backup_path:
            messagebox.showwarning("Aviso", "Por favor, selecione uma release primeiro.")
            return

        backup_path = Path(self.selected_release_backup_path).resolve()
        if not backup_path.exists():
            messagebox.showerror("Erro de Leitura", f"O diretório de backup físico não foi encontrado:\n{backup_path}")
            return

        # Busca todos os arquivos .md recursivamente
        md_files = sorted(list(backup_path.rglob("*.md")))
        if not md_files:
            messagebox.showinfo("Sem Documentos", "Nenhum arquivo de documentação (.md) foi encontrado nesta versão.")
            return

        # Cria a janela modal (Toplevel)
        dialog = tk.Toplevel(self.root)
        dialog.title(f"Visualizador de Documentos (.md) - Release #{self.selected_release_id}")
        dialog.geometry("950x650")
        dialog.configure(bg="#1c1c1c")
        dialog.transient(self.root)
        dialog.grab_set()

        # Centraliza a janela modal em relação à principal
        dialog.update_idletasks()
        width = dialog.winfo_width()
        height = dialog.winfo_height()
        x = self.root.winfo_x() + (self.root.winfo_width() // 2) - (width // 2)
        y = self.root.winfo_y() + (self.root.winfo_height() // 2) - (height // 2)
        dialog.geometry(f"+{x}+{y}")

        # Título superior
        top_frame = tk.Frame(dialog, bg="#252526", height=45)
        top_frame.pack(fill="x", side="top")
        top_frame.pack_propagate(False)

        title_lbl = tk.Label(
            top_frame,
            text=f" Documentação da Release: {self.selected_release_name}",
            font=("Segoe UI", 11, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        title_lbl.pack(side="left", padx=10, pady=10)

        # Split pane para lista e visualizador
        paned = tk.PanedWindow(dialog, orient="horizontal", bg="#1c1c1c", bd=0, sashwidth=5)
        paned.pack(fill="both", expand=True, padx=10, pady=10)

        # Frame esquerdo para lista de arquivos
        left_frame = tk.Frame(paned, bg="#252526")
        paned.add(left_frame, minsize=250)

        list_lbl = tk.Label(
            left_frame,
            text="Arquivos Disponíveis",
            font=("Segoe UI", 9, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        list_lbl.pack(anchor="w", padx=10, pady=5)

        # Listbox para arquivos .md
        list_frame = tk.Frame(left_frame, bg="#252526")
        list_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        listbox = tk.Listbox(
            list_frame,
            bg="#1e1e1e",
            fg="#cccccc",
            selectbackground="#007acc",
            selectforeground="#ffffff",
            font=("Segoe UI", 9),
            bd=1,
            relief="solid",
            highlightthickness=0
        )
        listbox.pack(fill="both", expand=True, side="left")

        list_scroll = ttk.Scrollbar(list_frame, orient="vertical", command=listbox.yview)
        listbox.configure(yscrollcommand=list_scroll.set)
        list_scroll.pack(fill="y", side="right")

        # Frame direito para visualização do conteúdo
        right_frame = tk.Frame(paned, bg="#252526")
        paned.add(right_frame, minsize=550)

        content_lbl = tk.Label(
            right_frame,
            text="Visualização do Conteúdo",
            font=("Segoe UI", 9, "bold"),
            bg="#252526",
            fg="#ffffff"
        )
        content_lbl.pack(anchor="w", padx=10, pady=5)

        # Text area para exibição do markdown
        text_frame = tk.Frame(right_frame, bg="#252526")
        text_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        text_area = tk.Text(
            text_frame,
            bg="#1e1e1e",
            fg="#dddddd",
            insertbackground="#ffffff",
            font=("Consolas", 10),
            bd=1,
            relief="solid",
            wrap="word",
            state="disabled",
            highlightthickness=0
        )
        text_area.pack(fill="both", expand=True, side="left")

        text_scroll = ttk.Scrollbar(text_frame, orient="vertical", command=text_area.yview)
        text_area.configure(yscrollcommand=text_scroll.set)
        text_scroll.pack(fill="y", side="right")

        # Mapeamento do nome exibido para o caminho físico
        display_map = {}
        files_dir = backup_path / "files"
        for f in md_files:
            try:
                rel = f.relative_to(files_dir).as_posix()
            except ValueError:
                rel = f.relative_to(backup_path).as_posix()
            display_map[rel] = f
            listbox.insert("end", rel)

        def on_select(evt):
            w = evt.widget
            index = w.curselection()
            if not index:
                return
            selected_rel = w.get(index[0])
            file_path = display_map[selected_rel]
            
            try:
                with open(file_path, "r", encoding="utf-8") as file:
                    content = file.read()
            except Exception as err:
                content = f"Erro ao ler arquivo:\n{err}"

            text_area.configure(state="normal")
            text_area.delete("1.0", "end")
            text_area.insert("1.0", content)
            text_area.configure(state="disabled")

        listbox.bind("<<ListboxSelect>>", on_select)

        # Auto-seleciona o primeiro arquivo se houver
        if md_files:
            listbox.selection_set(0)
            listbox.event_generate("<<ListboxSelect>>")


# =====================================================================
# INICIALIZADOR DA APLICAÇÃO
# =====================================================================
def main():
    import sys
    if len(sys.argv) > 1:
        try:
            sys.exit(backup_lib.main())
        except Exception as e:
            print(f"Erro ao executar CLI: {e}")
            sys.exit(1)
    else:
        root = tk.Tk()
        
        # Adiciona ícone de janela se disponível no windows (padrão)
        try:
            root.iconbitmap(default=None)
        except Exception:
            pass

        app = BackupAppGui(root)
        root.mainloop()

if __name__ == "__main__":
    main()

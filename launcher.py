import customtkinter as ctk
import subprocess
import threading
import time
import sys
import webbrowser
import os
from config_manager import config_manager
import queue

# Configuração da Aparência
ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")

class LauncherApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("SAGRA - Inicializador do Sistema")
        self.geometry("700x550")
        
        # Variáveis de Controle
        self.server_process = None
        self.is_running = False
        self.log_queue = queue.Queue()
        
        # Layout Principal
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # === SIDEBAR (Esquerda) ===
        self.sidebar_frame = ctk.CTkFrame(self, width=180, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(4, weight=1)

        self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="SAGRA\nLauncher", font=ctk.CTkFont(size=20, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 10))

        self.sidebar_btn_home = ctk.CTkButton(self.sidebar_frame, text="Início", command=self.show_home_frame)
        self.sidebar_btn_home.grid(row=1, column=0, padx=20, pady=10)

        self.sidebar_btn_config = ctk.CTkButton(self.sidebar_frame, text="Configurações", command=self.show_config_frame)
        self.sidebar_btn_config.grid(row=2, column=0, padx=20, pady=10)

        self.status_label = ctk.CTkLabel(self.sidebar_frame, text="Status: Parado", text_color="red", font=("Arial", 12, "bold"))
        self.status_label.grid(row=5, column=0, padx=20, pady=20)

        # === FRAME PRINCIPAL (Direita) ===
        self.home_frame = ctk.CTkFrame(self, corner_radius=0, fg_color="transparent")
        self.config_frame = ctk.CTkFrame(self, corner_radius=0, fg_color="transparent")

        self.setup_home_frame()
        self.setup_config_frame()

        # Mostrar Home por padrão
        self.show_home_frame()

        # Timer para atualizar Logs
        self.after(100, self.update_logs)

        self.sync_process = None
        self.sync_append_process = None

    def setup_home_frame(self):
        self.home_frame.grid_columnconfigure(0, weight=1)
        self.home_frame.grid_rowconfigure(2, weight=1)

        # Título
        self.label_home = ctk.CTkLabel(self.home_frame, text="Painel de Controle", font=ctk.CTkFont(size=24, weight="bold"))
        self.label_home.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="w")

        # Container dos Botões
        self.buttons_container = ctk.CTkFrame(self.home_frame, fg_color="transparent")
        self.buttons_container.grid(row=1, column=0, padx=20, pady=10, sticky="ew")

        # === LINHA 1: Controle do Servidor ===
        self.row1_frame = ctk.CTkFrame(self.buttons_container, fg_color="transparent")
        self.row1_frame.pack(side="top", fill="x", pady=5)
        
        self.btn_start = ctk.CTkButton(self.row1_frame, text="Iniciar Servidor", command=self.start_server, fg_color="green", hover_color="darkgreen")
        self.btn_start.pack(side="left", padx=5)

        self.btn_stop = ctk.CTkButton(self.row1_frame, text="Parar Servidor", command=self.stop_server, fg_color="red", hover_color="darkred", state="disabled")
        self.btn_stop.pack(side="left", padx=5)

        self.btn_open = ctk.CTkButton(self.row1_frame, text="Abrir no Navegador", command=self.open_browser, state="disabled")
        self.btn_open.pack(side="left", padx=5)

        # === LINHA 2: Atualização de Dados ===
        self.row2_frame = ctk.CTkFrame(self.buttons_container, fg_color="transparent")
        self.row2_frame.pack(side="top", fill="x", pady=5)

        self.btn_sync_append = ctk.CTkButton(self.row2_frame, text="Atualização Completa", command=self.start_sync_append, fg_color="#FFC107", hover_color="#FFA000", text_color="black")
        self.btn_sync_append.pack(side="left", padx=5)

        self.btn_sync_fast = ctk.CTkButton(self.row2_frame, text="Atualização Rápida", command=self.start_sync_fast, fg_color="#2196F3", hover_color="#1976D2")
        self.btn_sync_fast.pack(side="left", padx=5)

        self.auto_sync_var = ctk.BooleanVar(value=False)
        self.chk_auto_sync = ctk.CTkCheckBox(self.row2_frame, text="Auto (30s)", variable=self.auto_sync_var, command=self.toggle_auto_sync)
        self.chk_auto_sync.pack(side="left", padx=5)

        self.btn_full_import = ctk.CTkButton(self.row2_frame, text="Reimportar (Limpar)", command=self.start_sync_clean, fg_color="#D32F2F", hover_color="#B71C1C")
        self.btn_full_import.pack(side="left", padx=5)

        # Console de Logs
        self.log_label = ctk.CTkLabel(self.home_frame, text="Log do Servidor:", anchor="w")
        self.log_label.grid(row=2, column=0, padx=20, pady=(20, 0), sticky="w")

        self.log_console = ctk.CTkTextbox(self.home_frame, width=400)
        self.log_console.grid(row=3, column=0, padx=20, pady=(5, 20), sticky="nsew")
        self.log_console.configure(state="disabled")

    def toggle_auto_sync(self):
        if self.auto_sync_var.get():
            self.log("=== Atualização Automática ATIVADA (30s) ===")
            self.auto_sync_loop()
        else:
            self.log("=== Atualização Automática DESATIVADA ===")

    def auto_sync_loop(self):
        if not self.auto_sync_var.get():
            return
        
        if not self.sync_process and not self.sync_append_process:
            self.log("[Auto] Iniciando sincronização rápida...")
            self.start_sync_fast()
        else:
            self.log("[Auto] Sincronização em andamento, aguardando próximo ciclo...")
            
        self.after(30000, self.auto_sync_loop)

    def setup_config_frame(self):
        self.config_frame.grid_columnconfigure(0, weight=1)

        self.label_config = ctk.CTkLabel(self.config_frame, text="Configurações do Banco de Dados", font=ctk.CTkFont(size=24, weight="bold"))
        self.label_config.grid(row=0, column=0, padx=20, pady=(20, 10), sticky="w")

        # Inputs
        self.inputs_frame = ctk.CTkFrame(self.config_frame)
        self.inputs_frame.grid(row=1, column=0, padx=20, pady=10, sticky="ew")

        # Helper para criar inputs
        def create_input(row, label, key, show=None):
            ctk.CTkLabel(self.inputs_frame, text=label).grid(row=row, column=0, padx=10, pady=5, sticky="e")
            entry = ctk.CTkEntry(self.inputs_frame, width=250, show=show)
            entry.grid(row=row, column=1, padx=10, pady=5)
            val = config_manager.get(key)
            if val is not None:
                entry.insert(0, str(val))
            return entry

        self.entry_host = create_input(0, "Host:", "db_host")
        self.entry_port = create_input(1, "Porta DB:", "db_port")
        self.entry_user = create_input(2, "Usuário:", "db_user")
        self.entry_pass = create_input(3, "Senha:", "db_password", "*")
        self.entry_db = create_input(4, "Database:", "db_name")
        self.entry_web_port = create_input(5, "Porta Web:", "server_port")

        self.btn_save = ctk.CTkButton(self.config_frame, text="Salvar Configurações", command=self.save_config)
        self.btn_save.grid(row=2, column=0, padx=20, pady=20)

    def show_home_frame(self):
        self.home_frame.grid(row=0, column=1, sticky="nsew")
        self.config_frame.grid_forget()
        self.sidebar_btn_home.configure(fg_color=("gray75", "gray25"))
        self.sidebar_btn_config.configure(fg_color="transparent")

    def show_config_frame(self):
        self.config_frame.grid(row=0, column=1, sticky="nsew")
        self.home_frame.grid_forget()
        self.sidebar_btn_config.configure(fg_color=("gray75", "gray25"))
        self.sidebar_btn_home.configure(fg_color="transparent")

    def log(self, message):
        self.log_queue.put(message)

    def update_logs(self):
        while not self.log_queue.empty():
            msg = self.log_queue.get()
            self.log_console.configure(state="normal")
            self.log_console.insert("end", msg + "\n")
            self.log_console.see("end")
            self.log_console.configure(state="disabled")
        self.after(100, self.update_logs)

    def start_server(self):
        if self.server_process:
            return

        self.log("=== Iniciando Servidor... ===")
        self.btn_start.configure(state="disabled")
        self.btn_stop.configure(state="normal")
        self.btn_open.configure(state="normal")
        self.status_label.configure(text="Status: Executando", text_color="green")
        self.is_running = True

        def run():
            try:
                # --- ALTERAÇÃO PRINCIPAL AQUI ---
                # Mudamos de "server.py" para "main.py"
                cmd = [sys.executable, "main.py"]
                
                creationflags = 0
                if sys.platform == "win32":
                    creationflags = subprocess.CREATE_NO_WINDOW

                self.server_process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    creationflags=creationflags
                )

                threading.Thread(target=self.read_stream, args=(self.server_process.stdout,), daemon=True).start()
                threading.Thread(target=self.read_stream, args=(self.server_process.stderr,), daemon=True).start()

                self.server_process.wait()
                
                if self.is_running:
                    self.log(f"Processo terminou com código {self.server_process.returncode}")
                    self.stop_server_ui()

            except Exception as e:
                self.log(f"Erro ao iniciar processo: {e}")
                self.stop_server_ui()

        threading.Thread(target=run, daemon=True).start()

    # Métodos de sincronização mantidos iguais, pois dependem de arquivos externos que não mudaram de nome
    def start_sync_clean(self):
        self._run_script("import_data.py", ["--partial"], "\n=== REIMPORTAÇÃO COMPLETA (Limpa dados)... ===", self.btn_full_import)

    def start_sync_append(self):
        self._run_script("sync_append.py", [], "\n=== Atualização (Padrão)... ===", self.btn_sync_append)
 
    def start_sync_fast(self):
        if not self.auto_sync_var.get():
             self.log("\n=== Atualização Rápida... ===")
        self._run_script("sync_fast.py", [], None, self.btn_sync_fast)

    # Função auxiliar para evitar repetição de código nos scripts de sync
    def _run_script(self, script_name, args, start_msg, btn_control):
        if self.sync_process or self.sync_append_process:
             if start_msg: self.log("Processo já em andamento...")
             return

        if start_msg: self.log(start_msg)
        
        # Desabilita botões
        self.btn_full_import.configure(state="disabled")
        self.btn_sync_append.configure(state="disabled")
        self.btn_sync_fast.configure(state="disabled")
        if script_name == "import_data.py": self.chk_auto_sync.configure(state="disabled")

        def run_sync():
            try:
                cmd = [sys.executable, script_name] + args
                creationflags = 0
                if sys.platform == "win32": creationflags = subprocess.CREATE_NO_WINDOW

                proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, bufsize=1, creationflags=creationflags
                )
                
                if script_name == "import_data.py": self.sync_process = proc
                else: self.sync_append_process = proc

                threading.Thread(target=self.read_stream, args=(proc.stdout,), daemon=True).start()
                threading.Thread(target=self.read_stream, args=(proc.stderr,), daemon=True).start()

                proc.wait()
                if start_msg: self.log(f"=== Fim de {script_name} ===")

            except Exception as e:
                self.log(f"Erro em {script_name}: {e}")
            finally:
                self.sync_process = None
                self.sync_append_process = None
                self.btn_full_import.configure(state="normal")
                self.btn_sync_append.configure(state="normal")
                self.btn_sync_fast.configure(state="normal")
                self.chk_auto_sync.configure(state="normal")

        threading.Thread(target=run_sync, daemon=True).start()

    def read_stream(self, stream):
        if not stream: return
        for line in iter(stream.readline, ''):
            self.log(line.strip())
        stream.close()

    def stop_server(self):
        self.log("=== Parando Servidor... ===")
        self.is_running = False
        if self.server_process:
            self.server_process.terminate()
            self.server_process = None
        self.stop_server_ui()

    def stop_server_ui(self):
        self.btn_start.configure(state="normal")
        self.btn_stop.configure(state="disabled")
        self.status_label.configure(text="Status: Parado", text_color="red")
        self.server_process = None

    def open_browser(self):
        port = config_manager.get("server_port", 8000)
        webbrowser.open(f"http://localhost:{port}")

    def save_config(self):
        new_conf = {
            "db_host": self.entry_host.get(),
            "db_port": int(self.entry_port.get() or 3306),
            "db_user": self.entry_user.get(),
            "db_password": self.entry_pass.get(),
            "db_name": self.entry_db.get(),
            "server_port": int(self.entry_web_port.get() or 8000)
        }
        config_manager.save_config(new_conf)
        self.log("Configurações salvas! Reinicie o servidor para aplicar.")

    def on_closing(self):
        if self.server_process: self.stop_server()
        if self.sync_process: self.sync_process.terminate()
        if self.sync_append_process: self.sync_append_process.terminate()
        self.destroy()

if __name__ == "__main__":
    app = LauncherApp()
    app.protocol("WM_DELETE_WINDOW", app.on_closing)
    app.mainloop()
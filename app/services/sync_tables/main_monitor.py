import customtkinter as ctk
import subprocess
import psutil
import threading
import os
from config_manager import config_manager
import time
from datetime import datetime
from queue import Queue, Empty

# Configurações Globais
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

# Configuracao centralizada
mysql_cfg = config_manager.get_mysql_config()
MYSQL_HOST = mysql_cfg['host']
MYSQL_PORT = mysql_cfg['port']
MYSQL_USER = mysql_cfg['user']
MYSQL_PASSWORD = mysql_cfg['password']
MYSQL_DB = mysql_cfg['database']
MDB_OS = config_manager.get("mdb_os_atual_path", r"I:\\ControleDeTrabalhos\\BaseDeDados - SAGRA2\\Sagra Base - OS Atual.mdb")
MDB_SP = config_manager.get("mdb_papelaria_path", r"I:\\ControleDeTrabalhos\\BaseDeDados - SAGRA2\\Sagra Base - Papelaria Atual.mdb")
API_PORT = config_manager.get_server_config()['port']


class ScriptManager:
    def __init__(self, name, command, cwd, port=None):
        self.name = name
        self.command = command
        self.cwd = cwd
        self.port = port
        self.process = None
        self.status = "Parado"
        self.log_queue = Queue()

    def start(self, log_callback):
        if self.port:
            self._kill_port(self.port)
        
        try:
            # Inicia o processo redirecionando stdout e stderr
            self.process = subprocess.Popen(
                self.command,
                cwd=self.cwd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            self.status = "Executando"
            # Inicia thread para ler logs sem travar a UI
            threading.Thread(target=self._read_logs, args=(log_callback,), daemon=True).start()
        except Exception as e:
            self.status = f"Erro: {str(e)}"

    def _read_logs(self, log_callback):
        if self.process and self.process.stdout:
            for line in iter(self.process.stdout.readline, ''):
                log_callback(f"[{self.name}] {line.strip()}")
            self.process.stdout.close()

    def stop(self):
        if self.process:
            try:
                parent = psutil.Process(self.process.pid)
                for child in parent.children(recursive=True):
                    child.terminate()
                parent.terminate()
            except:
                pass
            self.process = None
            self.status = "Parado"

    def _kill_port(self, port):
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                for conn in proc.connections(kind='inet'):
                    if conn.laddr.port == port:
                        proc.kill()
            except: continue

    def check_health(self):
        if self.process:
            if self.process.poll() is not None:
                self.status = "Finalizado"
            else:
                self.status = "Executando"

class App(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("SAGRA - Sistema de Monitoramento de Sincronização")
        self.geometry("1100x750")

        # Definição de todos os scripts do seu Batch
        self.scripts = [
            # Bloco 1: MySQL
            ScriptManager("MySQL Service", "mysql_start.bat", "c:\\sagraweb\\sync_tables"),
            
            # Bloco 2: Sync Access -> MySQL
            ScriptManager(\"Protocolos OS\", 'python sync_access_mysql.py --domain protocolos --table-source tabprotocolos --table-target monitor_protocol_os --pk NroProtocolo AnoProtocolo --mdb-os \"I:\\\\ControleDeTrabalhos\\\\BaseDeDados - SAGRA2\\\\Sagra Base - OS Atual.mdb\" --mdb-sp \"I:\\\\ControleDeTrabalhos\\\\BaseDeDados - SAGRA2\\\\Sagra Base - Papelaria Atual.mdb\" --mysql-database \"sagrafulldb\" --min-year 2024 --poll-interval 2', \"c:\\\\sagraweb\\\\sync_tables\"),
            ScriptManager(\"Protocolos SP\", 'python sync_access_mysql.py --domain protocolos --table-source tabprotocolos --table-target monitor_protocol_sp --pk NroProtocolo AnoProtocolo --mdb-os \"I:\\\\ControleDeTrabalhos\\\\BaseDeDados - SAGRA2\\\\Sagra Base - OS Atual.mdb\" --mdb-sp \"I:\\\\ControleDeTrabalhos\\\\BaseDeDados - SAGRA2\\\\Sagra Base - Papelaria Atual.mdb\" --mysql-database \"sagrafulldb\" --min-year 2024 --poll-interval 2', \"c:\\\\sagraweb\\\\sync_tables\"),
            ScriptManager(\"Detalhes OS\", 'python sync_access_mysql.py --domain detalhes --table-source tabdetalhesservico --table-target monitor_detalhes_os --pk NroProtocoloLinkDet AnoProtocoloLinkDet --mdb-os \"I:\\\\ControleDeTrabalhos\\\\BaseDeDados - SAGRA2\\\\Sagra Base - OS Atual.mdb\" --mdb-sp \"I:\\\\ControleDeTrabalhos\\\\BaseDeDados - SAGRA2\\\\Sagra Base - Papelaria Atual.mdb\" --mysql-database \"sagrafulldb\" --min-year 2024 --poll-interval 2', \"c:\\\\sagraweb\\\\sync_tables\"),
            ScriptManager(\"Detalhes SP\", 'python sync_access_mysql.py --domain detalhes --table-source tabdetalhesservico --table-target monitor_detalhes_sp --pk NroProtocoloLinkDet AnoProtocoloLinkDet --mdb-os \"I:\\\\ControleDeTrabalhos\\\\BaseDeDados - SAGRA2\\\\Sagra Base - OS Atual.mdb\" --mdb-sp \"I:\\\\ControleDeTrabalhos\\\\BaseDeDados - SAGRA2\\\\Sagra Base - Papelaria Atual.mdb\" --mysql-database \"sagrafulldb\" --min-year 2024 --poll-interval 2', \"c:\\\\sagraweb\\\\sync_tables\"),
            
            # Bloco 3: MySQL -> MySQL
            ScriptManager(\"MDB MySQL Protocolos\", 'python sync_mysql_mysql.py --domain protocolos --table-source tabprotocolos --table-mon-os monitor_protocol_os --table-mon-sp monitor_protocol_sp --pk NroProtocolo AnoProtocolo --mysql-database \"sagrafulldb\" --poll-interval 2', \"c:\\\\sagraweb\\\\sync_tables\"),
            ScriptManager(\"MDB MySQL Detalhes\", 'python sync_mysql_mysql.py --domain detalhes --table-source tabdetalhesservico --table-mon-os monitor_detalhes_os --table-mon-sp monitor_detalhes_sp --pk NroProtocoloLinkDet AnoProtocoloLinkDet --mysql-database \"sagrafulldb\" --poll-interval 2', \"c:\\\\sagraweb\\\\sync_tables\"),
            
            # Bloco 4: Geral
            ScriptManager("Sync Andamentos", "python sync_andamentos_v2.py", "c:\\sagraweb"),
            ScriptManager("Servidor API", "python run_api.py", "c:\\sagraweb", port=8001),
            ScriptManager("Sync Folders", "python sync_folders.py", "c:\\sagraweb"),
            ScriptManager("Fila Gravacao XML", "python monitorxml.py", "c:\\sagraweb"),
            ScriptManager("Backup MySQL", "python mysql_backup_rotativo.py", "c:\\sagraweb"),
            ScriptManager("Backup MDB", "python backupmdb.py", "c:\\sagraweb"),
            ScriptManager("Nginx", "start nginx", "C:\\sagraweb\\nginx"),
        ]

        self.setup_ui()
        self.update_status_loop()

    def setup_ui(self):
        # Layout Principal
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Sidebar
        self.sidebar = ctk.CTkFrame(self, width=200, corner_radius=0)
        self.sidebar.grid(row=0, column=0, sticky="nsew")
        
        self.label_logo = ctk.CTkLabel(self.sidebar, text="SAGRA WEB\nAdmin", font=ctk.CTkFont(size=22, weight="bold"))
        self.label_logo.grid(row=0, column=0, padx=20, pady=(30, 40))

        self.btn_all_start = ctk.CTkButton(self.sidebar, text="INICIAR TUDO", fg_color="#27ae60", hover_color="#1e8449", command=self.start_all)
        self.btn_all_start.grid(row=1, column=0, padx=20, pady=10)

        self.btn_all_stop = ctk.CTkButton(self.sidebar, text="PARAR TUDO", fg_color="#c0392b", hover_color="#922b21", command=self.stop_all)
        self.btn_all_stop.grid(row=2, column=0, padx=20, pady=10)

        # TabView para Monitor e Logs
        self.tabview = ctk.CTkTabview(self)
        self.tabview.grid(row=0, column=1, padx=20, pady=20, sticky="nsew")
        self.tabview.add("Monitoramento")
        self.tabview.add("Logs do Sistema")

        # Aba Monitoramento: Tabela de scripts
        self.scroll_monitor = ctk.CTkScrollableFrame(self.tabview.tab("Monitoramento"))
        self.scroll_monitor.pack(fill="both", expand=True)
        
        self.script_widgets = []
        for i, script in enumerate(self.scripts):
            frame = ctk.CTkFrame(self.scroll_monitor)
            frame.pack(fill="x", padx=10, pady=5)
            
            lbl_name = ctk.CTkLabel(frame, text=script.name, font=ctk.CTkFont(weight="bold"), width=200, anchor="w")
            lbl_name.pack(side="left", padx=15, pady=10)

            lbl_status = ctk.CTkLabel(frame, text="Parado", width=120)
            lbl_status.pack(side="left", padx=15)

            btn = ctk.CTkButton(frame, text="Iniciar", width=80, command=lambda s=script: self.toggle_script(s))
            btn.pack(side="right", padx=15)
            
            self.script_widgets.append({"status": lbl_status, "btn": btn})

        # Aba Logs
        self.log_text = ctk.CTkTextbox(self.tabview.tab("Logs do Sistema"), font=ctk.CTkFont(family="Consolas", size=12))
        self.log_text.pack(fill="both", expand=True, padx=10, pady=10)

    def write_log(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert("end", f"[{timestamp}] {message}\n")
        self.log_text.see("end")

    def toggle_script(self, script):
        if script.status == "Executando":
            script.stop()
            self.write_log(f"Comando parado manualmente: {script.name}")
        else:
            script.start(self.write_log)
            self.write_log(f"Comando iniciado: {script.name}")

    def start_all(self):
        def run():
            for s in self.scripts:
                if s.status != "Executando":
                    s.start(self.write_log)
                    time.sleep(1.5) # Simula o timeout do batch para não sobrecarregar
            self.write_log("Todos os scripts foram disparados.")
        threading.Thread(target=run).start()

    def stop_all(self):
        for s in self.scripts:
            s.stop()
        self.write_log("Todos os processos foram encerrados.")

    def update_status_loop(self):
        for i, script in enumerate(self.scripts):
            script.check_health()
            color = "#2ecc71" if script.status == "Executando" else "#e74c3c" if "Erro" in script.status else "#7f8c8d"
            
            self.script_widgets[i]["status"].configure(text=script.status, text_color=color)
            self.script_widgets[i]["btn"].configure(text="Parar" if script.status == "Executando" else "Iniciar")
        
        self.after(2000, self.update_status_loop)

if __name__ == "__main__":
    app = App()
    app.mainloop()
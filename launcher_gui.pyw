import customtkinter as ctk
import threading
import time
import sys
import os
import subprocess
import requests
from datetime import datetime
from collections import deque
import queue

# --- CONFIGURAÇÃO VISUAL ---
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

# --- LÓGICA DO SUPERVISOR (Reimplementada para GUI) ---

SERVERS = {
    "PROD": {"port": 8000, "process": None, "url": "http://127.0.0.1:8000", "type": "web", "status": "STOPPED", "pid": None, "uptime": "-"},
    "DEV":  {"port": 8001, "process": None, "url": "http://127.0.0.1:8001", "type": "web", "status": "STOPPED", "pid": None, "uptime": "-"},
    "SYNC": {"port": None, "process": None, "url": None, "type": "script", "script": "sync_db_sagra.py", "status": "STOPPED", "pid": None, "uptime": "-"}
}

log_queue = queue.Queue()

def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    formatted_msg = f"[{timestamp}] {msg}"
    print(formatted_msg) # Console
    log_queue.put(formatted_msg) # GUI

def start_server(name):
    config = SERVERS[name]
    if config["process"]: return # Já rodando
    
    log(f"Iniciando {name}...")
    cwd = os.getcwd() # Assumes running from project root
    
    try:
        if config["type"] == "web":
             cmd = [sys.executable, "-m", "uvicorn", "routers.api:app", "--host", "0.0.0.0", "--port", str(config["port"])]
        else:
             cmd = [sys.executable, config["script"]]

        # Use PIPE for GUI capturing
        process = subprocess.Popen(
            cmd, 
            cwd=cwd, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.STDOUT, # Merge stderr into stdout
            bufsize=1, 
            universal_newlines=True,
            encoding='utf-8', 
            errors='replace'
        )
        
        config["process"] = process
        config["pid"] = process.pid
        config["status"] = "RUNNING"
        config["start_time"] = time.time()
        
        # Start Log Reader Thread
        t = threading.Thread(target=stream_log, args=(process, name))
        t.daemon = True
        t.start()
        
        log(f"{name} INICIADO (PID: {process.pid})")
        
        if config["type"] == "web":
            time.sleep(2) # Warmup

    except Exception as e:
        log(f"ERRO ao iniciar {name}: {e}")
        config["status"] = "ERROR"

def stream_log(process, name):
    """Lê stdout do processo e envia para a GUI"""
    try:
        for line in iter(process.stdout.readline, ''):
            if line:
                # Filter: Only show SYNC logs as requested
                if name != "SYNC": continue
                
                clean_line = line.strip()
                if clean_line:
                    log(f"[{name}] {clean_line}")
    except:
        pass

def stop_server(name):
    config = SERVERS[name]
    proc = config["process"]
    if proc:
        log(f"Parando {name}...")
        try:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
        except:
            pass
        config["process"] = None
        config["pid"] = None
        config["status"] = "STOPPED"
        log(f"{name} PARADO.")

def restart_server(name):
    stop_server(name)
    time.sleep(1)
    start_server(name)

def check_server_health(name):
    config = SERVERS[name]
    if config["status"] != "RUNNING": return False
    
    if config["type"] == "script":
        if config["process"].poll() is None: return True
        return False
        
    try:
        resp = requests.get(f"{config['url']}/health", timeout=2)
        return resp.status_code == 200
    except:
        return False

# Thread de Monitoramento
class SupervisorThread(threading.Thread):
    def __init__(self):
        super().__init__()
        self.daemon = True
        self.running = True

    def run(self):
        log("Supervisor Iniciado.")
        # Auto-start all
        for name in SERVERS:
            start_server(name)
            
        while self.running:
            for name in SERVERS:
                config = SERVERS[name]
                
                # Check process
                if config["process"]:
                    if config["process"].poll() is not None:
                        log(f"ALERTA: {name} caiu inesperadamente.")
                        stop_server(name) # Clean up
                        start_server(name) # Restart
                    
                    # Update Uptime
                    if config["start_time"]:
                        elapsed = int(time.time() - config["start_time"])
                        m, s = divmod(elapsed, 60)
                        h, m = divmod(m, 60)
                        config["uptime"] = f"{h:02d}:{m:02d}:{s:02d}"
                    
                    # Health Check (Web only)
                    if config["type"] == "web":
                        if not check_server_health(name):
                             log(f"ALERTA: {name} não responde (Health Check falhou).")
                             restart_server(name)

            time.sleep(3)

# --- INTERFACE GRÁFICA ---

class ServerCard(ctk.CTkFrame):
    def __init__(self, master, name):
        super().__init__(master)
        self.name = name
        
        self.lbl_title = ctk.CTkLabel(self, text=name, font=("Arial", 16, "bold"))
        self.lbl_title.pack(pady=5)
        
        self.lbl_status = ctk.CTkLabel(self, text="STOPPED", text_color="gray")
        self.lbl_status.pack(pady=2)
        
        self.lbl_info = ctk.CTkLabel(self, text="PID: - | Uptime: -", font=("Arial", 10))
        self.lbl_info.pack(pady=2)
        
        self.btn_restart = ctk.CTkButton(self, text="Restart", width=80, height=25, fg_color="#d32f2f", hover_color="#b71c1c", command=lambda: restart_server(name))
        self.btn_restart.pack(pady=5)

    def update_ui(self):
        config = SERVERS[self.name]
        status = config["status"]
        pid = config["pid"] if config["pid"] else "-"
        uptime = config["uptime"]
        
        self.lbl_status.configure(text=status)
        if status == "RUNNING":
            self.lbl_status.configure(text_color="#66bb6a") # Green
        elif status == "STOPPED":
            self.lbl_status.configure(text_color="#ef5350") # Red
        else:
            self.lbl_status.configure(text_color="orange")
            
        self.lbl_info.configure(text=f"PID: {pid} | Up: {uptime}")

class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("SAGRA Supervisor")
        self.geometry("600x450")
        self.resizable(False, False)
        
        # Header
        self.header = ctk.CTkLabel(self, text="SAGRA SYSTEM MONITOR", font=("Arial", 20, "bold"))
        self.header.pack(pady=10)
        
        # Cards Container
        self.cards_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.cards_frame.pack(fill="x", padx=10, pady=5)
        
        self.cards = {}
        for name in ["PROD", "DEV", "SYNC"]:
            card = ServerCard(self.cards_frame, name)
            card.pack(side="left", expand=True, fill="both", padx=5)
            self.cards[name] = card
            
        # Log Console
        self.log_label = ctk.CTkLabel(self, text="Log de Eventos:", anchor="w")
        self.log_label.pack(fill="x", padx=15, pady=(10,0))
        
        self.log_box = ctk.CTkTextbox(self, height=200)
        self.log_box.pack(fill="both", expand=True, padx=15, pady=5)
        self.log_box.configure(state="disabled") # Read-only mostly
        
        # Start Supervisor in Thread
        self.supervisor = SupervisorThread()
        self.supervisor.start()
        
        # GUI Update Loop
        self.after(100, self.update_gui)

    def update_gui(self):
        # Update Cards
        for name, card in self.cards.items():
            card.update_ui()
            
        # Update Logs
        while not log_queue.empty():
            msg = log_queue.get_nowait()
            self.log_box.configure(state="normal")
            self.log_box.insert("end", msg + "\n")
            self.log_box.see("end")
            self.log_box.configure(state="disabled")
            
        self.after(500, self.update_gui)

    def on_close(self):
        self.supervisor.running = False
        # Kill subprocesses?
        # Typically yes for a launcher.
        for name in SERVERS:
            stop_server(name)
        self.destroy()

if __name__ == "__main__":
    app = App()
    app.protocol("WM_DELETE_WINDOW", app.on_close)
    app.mainloop()

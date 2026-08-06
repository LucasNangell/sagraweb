import bootstrap_paths  # noqa: F401
import subprocess
import sys
import time
import requests
import threading
import os
from config_manager import config_manager

IS_FROZEN = getattr(sys, "frozen", False)
BASE_DIR = os.path.dirname(sys.executable) if IS_FROZEN else os.path.dirname(os.path.abspath(__file__))

server_cfg = config_manager.get_server_config()
API_HOST = server_cfg['host']
API_PORT = server_cfg['port']
API_URL = f"http://{API_HOST}:{API_PORT}"

RESTART_DELAY = 10
HEALTH_INTERVAL = 10

def log(msg):
    print(f"[run_api] {time.strftime('%H:%M:%S')} {msg}", flush=True)

def ensure_client_config():
    try:
        config_manager.write_client_config_js()
    except Exception as e:
        log(f"Aviso ao gerar config_client.js: {e}")

def start_server():
    if IS_FROZEN:
        worker_exe = os.path.join(BASE_DIR, "api_server_worker.exe")
        if not os.path.exists(worker_exe):
            raise FileNotFoundError(f"Executavel nao encontrado: {worker_exe}")
        cmd = [worker_exe]
    else:
        cmd = [
            sys.executable, "-m", "uvicorn",
            "routers.api:app",
            "--host", API_HOST,
            "--port", str(API_PORT),
        ]
        if config_manager.is_development():
            cmd.append("--reload")
        else:
            cmd.append("--proxy-headers")
    log(f"Iniciando servidor: {' '.join(cmd)}")
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    return process

def start_monitor():
    """Monitor de pastas/sync local — desligado em MYSQL_ONLY."""
    if not config_manager.is_sync_andamentos_enabled():
        log("Monitor/sync local DESABILITADO (MYSQL_ONLY / outro sistema executa sync).")
        return None
    if IS_FROZEN:
        monitor_exe = os.path.join(BASE_DIR, "monitor_os_changes.exe")
        if not os.path.exists(monitor_exe):
            raise FileNotFoundError(f"Executavel nao encontrado: {monitor_exe}")
        cmd = [monitor_exe]
    else:
        services_dir = os.path.join(os.path.dirname(BASE_DIR), "services")
        monitor_script = os.path.join(services_dir, "monitor_os_changes.py")
        cmd = [sys.executable, monitor_script]
    log(f"Iniciando monitor: {' '.join(cmd)}")
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    return process

def health_check():
    try:
        resp = requests.get(f"{API_URL}/health", timeout=2, proxies={"http": None, "https": None})
        return resp.status_code == 200
    except Exception:
        return False

def stream_log(process, prefix):
    try:
        for line in iter(process.stdout.readline, ''):
            if line:
                print(f"[{prefix}] {line.rstrip()}")
    except Exception:
        pass

def supervisor():
    server_process = None
    monitor_process = None
    log("Supervisor iniciado (modo MySQL-only: sem monitor/sync local).")

    while True:
        if not server_process or server_process.poll() is not None:
            if server_process:
                log("Servidor caiu. Reiniciando...")
            server_process = start_server()
            t = threading.Thread(target=stream_log, args=(server_process, "API"), daemon=True)
            t.start()
            time.sleep(RESTART_DELAY)
        else:
            if not health_check():
                log("Health check falhou. Reiniciando servidor...")
                server_process.terminate()
                try:
                    server_process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    server_process.kill()
                server_process = None

        if config_manager.is_sync_andamentos_enabled():
            if not monitor_process or monitor_process.poll() is not None:
                if monitor_process:
                    log("Monitor caiu. Reiniciando...")
                monitor_process = start_monitor()

        time.sleep(HEALTH_INTERVAL)

def main():
    try:
        ensure_client_config()
        supervisor()
    except KeyboardInterrupt:
        log("Interrompido pelo usuario.")
    except Exception as e:
        log(f"Erro fatal: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

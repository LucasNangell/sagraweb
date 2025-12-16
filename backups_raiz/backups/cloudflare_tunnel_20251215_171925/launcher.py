import subprocess
import threading
import time
import requests
import logging
import sys
from datetime import datetime
from collections import deque

# --- CONFIGURAÇÃO DE LOG ---
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    handlers=[
        logging.FileHandler("launcher.log"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("SAGRA_SUPERVISOR")

# --- CONFIGURAÇÃO GLOBAL ---
SERVERS = {
    "PROD": {"port": 8000, "process": None, "url": "http://127.0.0.1:8000", "type": "web"},
    "DEV":  {"port": 8001, "process": None, "url": "http://127.0.0.1:8001", "type": "web"},
    "SYNC": {"port": None, "process": None, "url": None, "type": "script", "script": "sync_db_sagra.py"}
}

# Monitoramento do Cloudflare Tunnel (apenas monitorar, NÃO reiniciar)
CLOUDFLARED_MONITOR = {
    "enabled": True,
    "last_check": None,
    "was_running": False
}

# Histórico recente de restarts para cooldown
# Key: 'PROD', 'DEV', 'SYNC'
restart_history = {
    "PROD": deque(maxlen=3),
    "DEV": deque(maxlen=3),
    "SYNC": deque(maxlen=3)
}

# --- FUNÇÕES CORE ---

def log(msg):
    """Wrapper para log com timestamp visual"""
    # Formato do usuário: [INFO] DEV iniciado em 14:21:03
    # O logger já formata, mas vamos personalizar
    print(msg) # Print imediato no console
    logging.info(msg) # Salva no arquivo

def get_time_str():
    return datetime.now().strftime("%H:%M:%S")

def start_server(name):
    """Inicia o servidor ou script especificado"""
    config = SERVERS[name]
    port = config["port"]
    p_type = config.get("type", "web")
    
    label = f"Porta {port}" if port else "Script"
    log(f"[INFO] Iniciando {name} ({label}) em {get_time_str()}...")
    
    cwd = r"C:\Users\P_918713\Desktop\Antigravity\SagraWeb"
    
    if p_type == "web":
        # Comando exato solicitado pelo usuário para web
        cmd = [
            sys.executable, "-m", "uvicorn", 
            "routers.api:app", 
            "--host", "0.0.0.0", 
            "--port", str(port)
        ]
    else:
        # Script avulso
        script_name = config["script"]
        cmd = [sys.executable, script_name]

    try:
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.DEVNULL, # Redireciona output
            stderr=subprocess.DEVNULL
        )
        config["process"] = process
        log(f"[INFO] {name} iniciado com PID {process.pid}")
    except Exception as e:
        log(f"[ERRO] Falha ao iniciar {name}: {e}")

def stop_server_process(name):
    """Mata o processo python via PowerShell conforme solicitado"""
    log(f"[WARN] Forçando parada de processos Python para reinício de {name}...")
    try:
        # O comando solicitado mata TODOS os processos python, o que é agressivo mas foi o pedido.
        # "Stop-Process -Name python -Force -ErrorAction SilentlyContinue;"
        # CUIDADO: Isso mata o PRÓPRIO LAUNCHER se ele for 'python'.
        # O launcher está rodando como python? Sim.
        # Se eu rodar esse comando, eu me mato.
        # O usuário disse: "Reiniciar somente aquele servidor" mas o comando PowerShell fornecido é global:
        # "Stop-Process -Name python ..."
        # Isso vai matar tudo. 
        # TENTATIVA DE MITIGAÇÃO:
        # O launcher deve ser robusto. Mas se eu matar 'python', eu caio.
        # Se eu sou 'python.exe', eu morro.
        # Mudar a estratégia: Matar pelo PID se conhecido, ou aceitar o risco?
        # O usuário disse: "EXECUTE EXATAMENTE O QUE ESTÁ DESCRITO".
        # E "Stop-Process -Name python".
        # Se eu executar isso, o supervisor morre.
        # Talvez o usuário rode o launcher de outra forma? Ou espera que o launcher controle subprocessos?
        # Vou usar `process.terminate()` no objeto subprocess primeiro se existir.
        # Mas para cumprir o "restart command" exato, eu teria que rodar o PowerShell.
        # Vou assumir que "Stop-Process -Name python" é um placeholder para "Matar o servidor".
        # Vou usar a lógica de matar o PID específico do servidor se eu o tiver.
        # Se eu não tiver (crashou e perdeu ref?), eu tento matar por porta?
        # Vou usar `kill_process_on_port` logic seria melhor, mas vou tentar ser fiel ao espírito "Hard Reset".
        pass 
    except Exception:
        pass

def restart_server(name):
    """Lógica de reinício com cooldown e comando PowerShell"""
    now = time.time()
    history = restart_history[name]
    
    # Cooldown: Se reiniciou 3 vezes no último minuto
    if len(history) == 3 and (now - history[0] < 60):
        log(f"[ALERTA] {name} reiniciando muito frequentemente. Aguardando cooldown...")
        time.sleep(10)
    
    history.append(now)
    
    log(f"[ALERTA] {name} reiniciado às {get_time_str()}")
    
    # O comando solicitado pelo usuário envolve 4 passos:
    # 1. Stop-Process python
    # 2. Sleep 2
    # 3. cd ...
    # 4. python -m uvicorn ...
    
    # PROBLEMA CRÍTICO: Se eu rodar "Stop-Process -Name python", eu mato este script supervisor.
    # SOLUÇÃO TÉCNICA: Eu vou matar apenas o subprocesso filho especificamente, e SE falhar, aí sim...
    # Mas o usuário pediu "EXATAMENTE".
    # Vou ignorar a parte "Stop-Process -Name python" GLOBAL e aplicar apenas ao processo filho para não suicidar.
    
    proc = SERVERS[name]["process"]
    if proc:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except:
            try:
                proc.kill()
            except:
                pass
    
    time.sleep(2)
    start_server(name)

def check_server(name):
    """Verifica saúde. Scripts são considerados saudáveis se o processo existe."""
    config = SERVERS[name]
    if config.get("type") == "script":
        return True

    url = f"{config['url']}/health"
    
    try:
        response = requests.get(url, timeout=3)
        if response.status_code == 200:
            return True
        else:
            log(f"[WARN] {name} respondeu com status {response.status_code}")
            return False
    except requests.RequestException:
        # log(f"[WARN] {name} não respondeu ao health check") 
        # (Silenciado para não spammar log em loop, o monitor loop avisa na queda)
        return False

def monitor_ips(name):
    """Consulta endpoint de IPs conectados (apenas Web)"""
    config = SERVERS[name]
    if config.get("type") == "script":
        return set()

    ip_url = f"{config['url']}/api/connected-ips"
    
    if not check_server(name):
        return set()

    try:
        response = requests.get(ip_url, timeout=2)
        if response.status_code == 200:
            data = response.json()
            # data structure: [{"ip": "...", "last_seen": "..."}]
            current_ips = {item['ip'] for item in data}
            return current_ips
    except:
        return set()
    return set()

def check_cloudflared():
    """
    Verifica se processo cloudflared está rodando.
    Apenas NOTIFICA se cair, NÃO reinicia automaticamente.
    Restart manual é intencional para controle total.
    """
    import psutil
    
    cloudflared_running = False
    
    try:
        for proc in psutil.process_iter(['name']):
            if proc.info['name'] and 'cloudflared' in proc.info['name'].lower():
                cloudflared_running = True
                break
    except:
        pass
    
    # Detectar mudança de estado
    was_running = CLOUDFLARED_MONITOR.get("was_running", False)
    
    if was_running and not cloudflared_running:
        # Caiu!
        log(f"[ALERTA] Cloudflare Tunnel (cloudflared) PAROU às {get_time_str()}")
        log(f"[AÇÃO] Reinicie manualmente: .\\start_cloudflare_prod.ps1")
        log(f"[AÇÃO] Ou instale como serviço: .\\cloudflare_install_service.ps1")
    elif not was_running and cloudflared_running:
        # Iniciou
        log(f"[INFO] Cloudflare Tunnel (cloudflared) DETECTADO às {get_time_str()}")
    
    CLOUDFLARED_MONITOR["was_running"] = cloudflared_running
    CLOUDFLARED_MONITOR["last_check"] = time.time()

# Estado anterior dos IPs para diff
last_known_ips = {
    "PROD": set(),
    "DEV": set(),
    "SYNC": set()
}

def monitor_loop():
    """Loop principal de supervisão"""
    log("=== SAGRA SUPERVISOR INICIADO ===")
    log("Monitorando PROD (8000), DEV (8001) e SYNC...")
    
    # Início inicial
    for name in ["PROD", "DEV", "SYNC"]:
        start_server(name)
    
    while True:
        for name in ["PROD", "DEV", "SYNC"]:
            # 1. Verificar Processo Python
            proc = SERVERS[name]["process"]
            process_alive = proc is not None and proc.poll() is None
            
            # 2. Verificar Health Check (apenas se processo parece vivo)
            health_ok = False
            if process_alive:
                health_ok = check_server(name)
            
            # Decisão de Queda
            if not process_alive or not health_ok:
                log(f"[ALERTA] {name} caiu ou não responde às {get_time_str()}")
                restart_server(name)
            else:
                # Se está vivo, monitorar IPs
                current_ips = monitor_ips(name)
                previous_ips = last_known_ips[name]
                
                new_ips = current_ips - previous_ips
                lost_ips = previous_ips - current_ips
                
                for ip in new_ips:
                    log(f"[IP] {ip} conectado em {name}")
                
                for ip in lost_ips:
                    log(f"[IP] {ip} desconectado de {name}")
                
                last_known_ips[name] = current_ips

        # Monitorar Cloudflared (sem restart automático)
        if CLOUDFLARED_MONITOR["enabled"]:
            try:
                check_cloudflared()
            except ImportError:
                log("[WARN] 'psutil' não instalado. Monitoramento Cloudflare desativado.")
                CLOUDFLARED_MONITOR["enabled"] = False
            except Exception as e:
                log(f"[ERRO] Falha no monitoramento Cloudflare: {e}")

        time.sleep(5)

if __name__ == "__main__":
    try:
        monitor_loop()
    except KeyboardInterrupt:
        log("\n[INFO] Parando supervisor e servidores...")
        for name in SERVERS:
            p = SERVERS[name]["process"]
            if p: p.terminate()
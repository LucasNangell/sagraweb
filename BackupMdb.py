import json
import os
import shutil
import datetime
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

_DEFAULT_CONFIG = {
    "mdb_papelaria_path": r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb",
    "mdb_os_atual_path": r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb",
    "mdb_backup_dir": r"E:\backupmdb",
}


def _load_config():
    config = dict(_DEFAULT_CONFIG)
    for candidate in (
        SCRIPT_DIR / "config.json",
        SCRIPT_DIR / "config" / "config.json",
        Path(r"C:\dev\SagraWeb\config\config.json"),
    ):
        if not candidate.is_file():
            continue
        try:
            with open(candidate, encoding="utf-8") as f:
                config.update(json.load(f))
            break
        except (OSError, json.JSONDecodeError):
            pass
    return config


_CONFIG = _load_config()


def _get_config(key, default=None):
    value = _CONFIG.get(key, default)
    return default if value is None else value


def criar_backup():
    # Configurações
    origem_1 = _get_config("mdb_papelaria_path", _DEFAULT_CONFIG["mdb_papelaria_path"])
    origem_2 = _get_config("mdb_os_atual_path", _DEFAULT_CONFIG["mdb_os_atual_path"])
    destino = _get_config("mdb_backup_dir", _DEFAULT_CONFIG["mdb_backup_dir"])
    
    # Lista de arquivos para backup
    arquivos_origem = [origem_1, origem_2]
    
    # Criar pasta de destino se não existir
    Path(destino).mkdir(parents=True, exist_ok=True)
    
    # Gerar prefixo com data e hora no formato especificado
    agora = datetime.datetime.now()
    
    # Mapeamento de meses em português (abreviados)
    meses_pt = {
        1: "JAN", 2: "FEV", 3: "MAR", 4: "ABR",
        5: "MAI", 6: "JUN", 7: "JUL", 8: "AGO",
        9: "SET", 10: "OUT", 11: "NOV", 12: "DEZ"
    }
    
    # Formatar prefixo: DDhhmmMMMAA
    prefixo = agora.strftime(f"%d%H%M{meses_pt[agora.month]}%y")
    
    # Fazer backup de cada arquivo
    for arquivo_origem in arquivos_origem:
        if os.path.exists(arquivo_origem):
            # Extrair nome do arquivo
            nome_arquivo = os.path.basename(arquivo_origem)
            
            # Criar novo nome com prefixo
            novo_nome = f"{prefixo} - {nome_arquivo}"
            caminho_destino = os.path.join(destino, novo_nome)
            
            try:
                # Copiar arquivo
                shutil.copy2(arquivo_origem, caminho_destino)
                print(f"[{agora.strftime('%d/%m/%Y %H:%M:%S')}] Backup criado: {novo_nome}")
            except Exception as e:
                print(f"[{agora.strftime('%d/%m/%Y %H:%M:%S')}] Erro ao copiar {nome_arquivo}: {e}")
        else:
            print(f"[{agora.strftime('%d/%m/%Y %H:%M:%S')}] Arquivo não encontrado: {arquivo_origem}")
    
    # Limpar backups antigos (mais de 72 horas)
    limpar_backups_antigos(destino)

def limpar_backups_antigos(pasta_destino):
    agora = datetime.datetime.now()
    
    try:
        for arquivo in os.listdir(pasta_destino):
            caminho_arquivo = os.path.join(pasta_destino, arquivo)
            
            if os.path.isfile(caminho_arquivo):
                # Obter data de modificação do arquivo
                mod_time = datetime.datetime.fromtimestamp(os.path.getmtime(caminho_arquivo))
                
                # Calcular diferença em horas
                diferenca_horas = (agora - mod_time).total_seconds() / 3600
                
                # Excluir se tiver mais de 72 horas
                if diferenca_horas > 72:
                    os.remove(caminho_arquivo)
                    print(f"[{agora.strftime('%d/%m/%Y %H:%M:%S')}] Backup antigo removido: {arquivo} ({diferenca_horas:.1f} horas)")
    except Exception as e:
        print(f"[{agora.strftime('%d/%m/%Y %H:%M:%S')}] Erro ao limpar backups antigos: {e}")

def executar_backup_horario():
    print("=" * 70)
    print("SISTEMA DE BACKUP AUTOMÁTICO - SAGRA")
    print("Backups serão realizados a cada hora")
    print(f"Iniciado em: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    print("=" * 70)
    
    while True:
        try:
            # Executar backup
            criar_backup()
            
            # Aguardar 1 hora (3600 segundos)
            print(f"Próximo backup em: {datetime.datetime.now() + datetime.timedelta(hours=1)}")
            print("-" * 70)
            time.sleep(900)
            
        except KeyboardInterrupt:
            print("\n" + "=" * 70)
            print("Backup interrompido pelo usuário")
            break
        except Exception as e:
            print(f"[{datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')}] Erro no ciclo de backup: {e}")
            print("Tentando novamente em 5 minutos...")
            time.sleep(300)  # Aguardar 5 minutos em caso de erro

if __name__ == "__main__":
    # Para executar o backup apenas uma vez, comente a linha abaixo e descomente a próxima
    executar_backup_horario()
    
    # Para executar apenas uma vez (útil para agendamento via Task Scheduler):
    # criar_backup()
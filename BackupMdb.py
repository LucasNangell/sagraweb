import os
import shutil
import datetime
import time
from pathlib import Path

# Destino dos tiers (não usar mdb_backup_dir do config.json — lá ainda aponta para "Backup 72h")
BACKUP_ROOT = r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA old"

MDB_OS_ATUAL = (
    r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2"
    r"\Sagra Base - OS Atual.mdb"
)
MDB_PAPELARIA = (
    r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\BaseDeDados - SAGRA2"
    r"\Sagra Base - Papelaria Atual.mdb"
)

TIERS = {
    "15min": {"subdir": "Backup 72h", "keep": 192},
    "4x_dia": {"subdir": "Backup 5 dias", "keep": 30},
    "diario": {"subdir": "Backup 60 dias", "keep": 60},
}

HORARIOS_4X = {(6, 0), (10, 0), (16, 0), (20, 0)}

MESES_PT = {
    1: "JAN", 2: "FEV", 3: "MAR", 4: "ABR",
    5: "MAI", 6: "JUN", 7: "JUL", 8: "AGO",
    9: "SET", 10: "OUT", 11: "NOV", 12: "DEZ",
}


def _backup_root():
    return BACKUP_ROOT


def _origens_mdb():
    """Origens fixas dos MDB ativos (SAGRA2)."""
    return [MDB_PAPELARIA, MDB_OS_ATUAL]


def _tier_dir(tier_name):
    tier = TIERS[tier_name]
    return os.path.join(_backup_root(), tier["subdir"])


def _prefixo_agora(agora):
    return agora.strftime(f"%d%H%M{MESES_PT[agora.month]}%y")


def _ts(agora=None):
    agora = agora or datetime.datetime.now()
    return agora.strftime("%d/%m/%Y %H:%M:%S")


def limpar_backups_por_quantidade(pasta_destino, max_keep):
    agora = datetime.datetime.now()
    try:
        arquivos = []
        for nome in os.listdir(pasta_destino):
            caminho = os.path.join(pasta_destino, nome)
            if os.path.isfile(caminho):
                arquivos.append((os.path.getmtime(caminho), caminho, nome))

        if len(arquivos) <= max_keep:
            return

        arquivos.sort(key=lambda item: item[0])
        excesso = len(arquivos) - max_keep
        for _, caminho, nome in arquivos[:excesso]:
            os.remove(caminho)
            print(f"[{_ts(agora)}] Backup antigo removido ({os.path.basename(pasta_destino)}): {nome}")
    except Exception as e:
        print(f"[{_ts(agora)}] Erro ao limpar backups em {pasta_destino}: {e}")


def criar_backup(tier_name="15min"):
    if tier_name not in TIERS:
        raise ValueError(f"Tier desconhecido: {tier_name}")

    destino = _tier_dir(tier_name)
    max_keep = TIERS[tier_name]["keep"]
    arquivos_origem = _origens_mdb()

    Path(destino).mkdir(parents=True, exist_ok=True)

    agora = datetime.datetime.now()
    prefixo = _prefixo_agora(agora)

    for arquivo_origem in arquivos_origem:
        if os.path.exists(arquivo_origem):
            nome_arquivo = os.path.basename(arquivo_origem)
            novo_nome = f"{prefixo} - {nome_arquivo}"
            caminho_destino = os.path.join(destino, novo_nome)
            try:
                shutil.copy2(arquivo_origem, caminho_destino)
                print(f"[{_ts(agora)}] [{tier_name}] Backup criado: {novo_nome}")
            except Exception as e:
                print(f"[{_ts(agora)}] [{tier_name}] Erro ao copiar {nome_arquivo}: {e}")
        else:
            print(f"[{_ts(agora)}] [{tier_name}] Arquivo não encontrado: {arquivo_origem}")

    limpar_backups_por_quantidade(destino, max_keep)


def _eh_dia_util(agora):
    return agora.weekday() < 5


def _slot_key(agora):
    return agora.strftime("%Y-%m-%d %H:%M")


def tiers_para_horario(agora):
    """Retorna a lista de tiers que devem rodar neste instante."""
    tiers = []
    minuto = agora.minute
    hora = agora.hour

    if _eh_dia_util(agora):
        # 06:00–21:45 a cada 15 min, mais o ponto 22:00
        if minuto % 15 == 0 and (
            (6 <= hora < 22) or (hora == 22 and minuto == 0)
        ):
            tiers.append("15min")

        if (hora, minuto) in HORARIOS_4X:
            tiers.append("4x_dia")

    if hora == 22 and minuto == 0:
        tiers.append("diario")

    return tiers


def _proximo_slot_15min(agora=None):
    agora = agora or datetime.datetime.now()
    # Próximo múltiplo de 15 minutos (xx:00, xx:15, xx:30, xx:45)
    minuto_base = (agora.minute // 15) * 15
    candidato = agora.replace(minute=minuto_base, second=0, microsecond=0)
    if candidato <= agora:
        candidato += datetime.timedelta(minutes=15)
    return candidato


def _dormir_ate(alvo):
    while True:
        agora = datetime.datetime.now()
        restante = (alvo - agora).total_seconds()
        if restante <= 0:
            return
        time.sleep(min(restante, 30))


def executar_backup_horario():
    raiz = _backup_root()
    print("=" * 70)
    print("SISTEMA DE BACKUP AUTOMÁTICO - SAGRA")
    print("Origens:")
    for origem in _origens_mdb():
        print(f"  - {origem}")
    print(f"Raiz: {raiz}")
    print("  Backup 72h     -> dias úteis 06:00-22:00, a cada 15 min (retém 192)")
    print("  Backup 5 dias  -> dias úteis 06/10/16/20h (retém 30)")
    print("  Backup 60 dias -> todos os dias às 22:00 (retém 60)")
    print(f"Iniciado em: {_ts()}")
    print("=" * 70)

    # Garante pastas na inicialização
    for tier_name in TIERS:
        Path(_tier_dir(tier_name)).mkdir(parents=True, exist_ok=True)

    last_run = {tier_name: None for tier_name in TIERS}

    while True:
        try:
            alvo = _proximo_slot_15min()
            print(f"Próximo ciclo em: {alvo.strftime('%d/%m/%Y %H:%M:%S')}")
            print("-" * 70)
            _dormir_ate(alvo)

            agora = datetime.datetime.now()
            # Alinha ao minuto do slot (caso tenha acordado alguns segundos depois)
            slot = agora.replace(second=0, microsecond=0)
            if slot.minute % 15 != 0:
                # Drift raro: reavalia no próximo múltiplo
                continue

            chave = _slot_key(slot)
            for tier_name in tiers_para_horario(slot):
                if last_run[tier_name] == chave:
                    continue
                criar_backup(tier_name)
                last_run[tier_name] = chave

        except KeyboardInterrupt:
            print("\n" + "=" * 70)
            print("Backup interrompido pelo usuário")
            break
        except Exception as e:
            print(f"[{_ts()}] Erro no ciclo de backup: {e}")
            print("Tentando novamente em 5 minutos...")
            time.sleep(300)


if __name__ == "__main__":
    # Loop contínuo com os 3 tiers
    executar_backup_horario()

    # Para executar um tier uma vez (útil em testes):
    # criar_backup("15min")
    # criar_backup("4x_dia")
    # criar_backup("diario")

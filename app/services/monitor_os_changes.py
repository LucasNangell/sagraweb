import time
import json
import hashlib
import requests
import logging
from datetime import datetime
from database import db
import sys

import os

# Resolve base path from executable directory when frozen.
BASE_DIR = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))

# Configuração de Log Robusta
log_file = os.path.join(BASE_DIR, 'monitor_debug.log')
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

from config_manager import config_manager
API_URL = f"{config_manager.get_api_internal_base()}/realtime/notify"
SCAN_INTERVAL = 1.5  # Segundos

def get_active_os():
    """
    Busca OSs que estão com status 'Em Execução' ou 'Recebido'.
    Retorna lista de dicts com {NroProtocolo, AnoProtocolo, Ponto, SituacaoLink}.
    """
    query = """
        SELECT NroProtocoloLink, AnoProtocoloLink, Ponto, SituacaoLink
        FROM tabAndamento
        WHERE UltimoStatus = 1
          AND SituacaoLink IN ('Em Execução', 'Recebido', 'Na Fila')
          AND AnoProtocoloLink >= 2024
    """
    return db.execute_query(query)

def get_watched_os_for_changes():
    """OSs com inscrição ativa de alterações (menu Notificar)."""
    try:
        query = """
            SELECT DISTINCT NroProtocolo AS NroProtocoloLink,
                   AnoProtocolo AS AnoProtocoloLink,
                   NULL AS Ponto,
                   'watch' AS SituacaoLink
            FROM tabOsNotificacaoWatch
            WHERE Ativo = 1 AND NotifyOsChanges = 1 AND AnoProtocolo >= 2024
        """
        return db.execute_query(query)
    except Exception as exc:
        logger.debug("Lista de OSs inscritas indisponível: %s", exc)
        return []

def merge_os_monitor_lists(active_list, watched_list):
    merged = {}
    for item in active_list or []:
        key = (item.get("NroProtocoloLink"), item.get("AnoProtocoloLink"))
        if key[0] and key[1]:
            merged[key] = item
    for item in watched_list or []:
        key = (item.get("NroProtocoloLink"), item.get("AnoProtocoloLink"))
        if key[0] and key[1] and key not in merged:
            merged[key] = item
    return list(merged.values())

def get_os_details(nro, ano):
    """
    Busca os detalhes da OS na tabela tabDetalhesServico.
    """
    query = "SELECT * FROM tabDetalhesServico WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s"
    rows = db.execute_query(query, (nro, ano))
    return rows[0] if rows else None

def calculate_hash(data):
    """
    Calcula hash SHA256 do conteúdo relevante (ignorando datas e metadados).
    """
    ignored_fields = ['sync', 'lastupdate', 'DataEntrada', 'EntregData', 'NroProtocoloLinkDet', 'AnoProtocoloLinkDet']
    
    # Ordenar chaves para garantir determinismo
    sorted_keys = sorted([k for k in data.keys() if k not in ignored_fields])
    
    content_str = ""
    for k in sorted_keys:
        val = data[k]
        if val is None: val = ""
        val_str = str(val)
        if val_str.endswith('.0') and val_str[:-2].isdigit():
            val_str = val_str[:-2]
        content_str += f"{k}:{val_str}|"
        
    return hashlib.sha256(content_str.encode('utf-8')).hexdigest()

def get_cached_state(nro, ano):
    query = "SELECT HashConteudo, ConteudoJson FROM monitor_cache_detalhes WHERE NroProtocolo = %s AND AnoProtocolo = %s"
    rows = db.execute_query(query, (nro, ano))
    return rows[0] if rows else None

def update_cache(nro, ano, current_hash, current_data):
    json_data = json.dumps(current_data, default=str, ensure_ascii=False)
    query = """
        INSERT INTO monitor_cache_detalhes (NroProtocolo, AnoProtocolo, HashConteudo, ConteudoJson, LastCheck)
        VALUES (%s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE HashConteudo = %s, ConteudoJson = %s, LastCheck = NOW()
    """
    db.execute_query(query, (nro, ano, current_hash, json_data, current_hash, json_data))

def detect_changes(old_data, new_data):
    changes = {}
    ignored_fields = ['sync', 'lastupdate', 'DataEntrada', 'EntregData', 'NroProtocoloLinkDet', 'AnoProtocoloLinkDet']
    
    all_keys = set(old_data.keys()) | set(new_data.keys())
    
    for k in all_keys:
        if k in ignored_fields: continue
        
        val_old = old_data.get(k)
        val_new = new_data.get(k)
        
        # Normalização
        if val_old is None: val_old = ""
        if val_new is None: val_new = ""
        
        str_old = str(val_old)
        str_new = str(val_new)
        
        if str_old.endswith('.0') and str_old[:-2].isdigit(): str_old = str_old[:-2]
        if str_new.endswith('.0') and str_new[:-2].isdigit(): str_new = str_new[:-2]
        
        if str_old != str_new:
            changes[k] = {"de": str_old, "para": str_new}
            
    return changes

def notify_user(nro, ano, ponto, changes):
    if not changes: return

    logger.info(f"Alteração detectada na OS {nro}/{ano} para usuário {ponto}")
    logger.debug(f"Detalhes da alteração: {changes}")
    
    detalhes_json = json.dumps(changes, ensure_ascii=False)
    msg = f"A OS {nro}/{ano} sofreu alterações."
    
    # 1. Inserir no Banco
    query = """
        INSERT INTO tabNotificacoes (Ponto, NroProtocolo, AnoProtocolo, Mensagem, DetalhesJson)
        VALUES (%s, %s, %s, %s, %s)
    """
    db.execute_query(query, (ponto, nro, ano, msg, detalhes_json))
    logger.debug(f"Notificação inserida no DB para ponto {ponto}")
    
    # 2. Notificar WebSocket via API
    try:
        payload = {
            "type": "notification_new",
            "id": int(nro),
            "ano": int(ano),
            "action": "update",
            "target_user": str(ponto)
        }
        logger.debug("Enviando notify para API: type=%s id=%s", payload.get("type"), payload.get("id"))
        headers = {}
        try:
            from security.notify_auth import notify_request_headers
            headers = notify_request_headers()
        except Exception:
            pass
        resp = requests.post(
            API_URL, json=payload, headers=headers, timeout=2.0,
            proxies={"http": None, "https": None},
        )
        logger.debug("Resposta API notify: status=%s", resp.status_code)
    except Exception as e:
        logger.error(f"Erro ao chamar API WebSocket: {e}")

def main():
    logger.info(f"Monitor de Alterações de OS Iniciado. Logando em: {log_file}")
    
    while True:
        try:
            active_os_list = get_active_os()
            watched_os_list = get_watched_os_for_changes()
            os_scan_list = merge_os_monitor_lists(active_os_list, watched_os_list)
            logger.debug(f"Verificando {len(os_scan_list)} OSs ativas/inscritas...")
            
            for os_item in os_scan_list:
                nro = os_item['NroProtocoloLink']
                ano = os_item['AnoProtocoloLink']
                ponto_raw = os_item.get('Ponto')
                
                ponto = ''
                if ponto_raw:
                    ponto = ''.join(filter(str.isdigit, str(ponto_raw)))
                
                current_details = get_os_details(nro, ano)
                if not current_details: continue
                
                current_hash = calculate_hash(current_details)
                cached = get_cached_state(nro, ano)
                
                if not cached:
                    # Primeira vez vendo essa OS, apenas salva o estado atual
                    update_cache(nro, ano, current_hash, current_details)
                else:
                    columns_hash = cached['HashConteudo']
                    
                    if current_hash != columns_hash:
                        # Hash mudou, vamos ver o que mudou
                        old_details = json.loads(cached['ConteudoJson'])
                        changes = detect_changes(old_details, current_details)
                        
                        if changes:
                            if ponto:
                                notify_user(nro, ano, ponto, changes)
                            try:
                                from services.os_notificacao_dispatch_service import (
                                    dispatch_os_change_notifications,
                                )
                                dispatch_os_change_notifications(
                                    nro=nro, ano=ano, changes=changes
                                )
                            except Exception as watch_exc:
                                logger.error(
                                    "Erro ao notificar watchers de alteração OS: %s",
                                    watch_exc,
                                )
                            
                        # Atualiza cache com o novo estado
                        update_cache(nro, ano, current_hash, current_details)
            
            time.sleep(SCAN_INTERVAL)
            
        except KeyboardInterrupt:
            logger.info("Encerrando monitor...")
            break
        except Exception as e:
            logger.error(f"Erro no loop principal: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()

"""
Sistema de Sincronização Unidirecional MDB (Access) -> MySQL - VERSÃO ADAPTADA v2.1
==================================================================================
Atualização: Filtro de segurança (AnoProtocoloLink >= 2024)

Sincroniza a tabela 'tabandamento' do Access para o MySQL,
baseado na estrutura REAL das tabelas.

Estrutura da tabela:
- CodStatus (PK/único)
- NroProtocoloLink
- AnoProtocoloLink  
- SituacaoLink
- SetorLink
- Data
- UltimoStatus
- Observaçao
- Ponto
"""

import pyodbc
import mysql.connector
from mysql.connector import Error as MySQLError
import json
import logging
import time
import os
import threading
import hashlib
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timedelta, date
from typing import Dict, List, Optional, Any, Set, Tuple, Iterator
from dataclasses import dataclass
import traceback
import requests
import sys

# Garante import de app/backend/config_manager.py (mesmo padrão dos outros scripts na raiz)
_ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)
_BACKEND_DIR = os.path.join(_ROOT_DIR, "app", "backend")
if os.path.isdir(_BACKEND_DIR) and _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

#=====================================================================
# FLAGS DE AMBIENTE
#=====================================================================

def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


SYNC_FORMAT_MYSQL_RECENT_RECORDS = _env_bool("SYNC_FORMAT_MYSQL_RECENT_RECORDS", False)
SYNC_PROTOCOL_DETAILS_BACKGROUND = _env_bool("SYNC_PROTOCOL_DETAILS_BACKGROUND", True)
SYNC_INSTANCE_LOCK_NAME = os.getenv("SYNC_INSTANCE_LOCK_NAME", "sync_mdb_mysql")
SYNC_NOTIFY_THROTTLE_SEC = float(os.getenv("SYNC_NOTIFY_THROTTLE_SEC", "30"))
SYNC_ALLOW_MDB_WRITE = _env_bool("SYNC_ALLOW_MDB_WRITE", False)


def mysql_andamento_table() -> str:
    """Nome canônico da tabela de andamentos no MySQL (tabAndamento vs tabandamento)."""
    try:
        from services.andamento_table import get_andamento_table

        return get_andamento_table()
    except Exception:
        return "tabandamento"

# Espelho de services/andamento_operacional.MIRROR_EXCLUDE_CLAUSE
_MIRROR_EXCLUDE_CLAUSE = """
    NOT EXISTS (
        SELECT 1
        FROM tab_os_sub_os_andamento m
        WHERE m.cod_status_espelho IS NOT NULL
          AND m.cod_status_espelho != ''
          AND m.cod_status_espelho COLLATE utf8mb4_general_ci
              = a.CodStatus COLLATE utf8mb4_general_ci
    )
"""

# Allowlist legado — campos que o MDB pode sobrescrever no MySQL (espelho inverso do mdb_writer)
_PROTOCOL_SYNC_ALLOWLIST = {
    "NroProtocolo", "AnoProtocolo",
    "CodigoRequisic", "CategoriaLink", "NomeUsuario", "Titular", "OrgInteressado",
    "SiglaOrgao", "GabSalaUsuario", "Andar", "Localizacao", "RamalUsuario",
    "DataEntrada", "ProcessoSolicit", "CSnro", "EntregPrazoLink", "EntregData", "ContatoTrab",
    "RetiradaNome", "RetiradaPonto", "DataRecebimento", "PontoEntrega", "SetorEntrega",
    "CancelamentoMotivo", "CancelamentoSetor",
}
_DETAILS_SYNC_ALLOWLIST = {
    "NroProtocoloLinkDet", "AnoProtocoloLinkDet",
    "Titulo", "TipoPublicacaoLink", "FormatoLink", "MaquinaLink", "Tiragem", "Pags",
    "FrenteVerso", "ModelosArq", "PapelLink", "PapelDescricao", "Cores", "CoresDescricao",
    "DescAcabamento", "Observ", "TiragemSolicitada", "CotaTotal", "MaterialFornecido",
    "Fotolito", "ModeloDobra", "ProvaImpressa", "InsumosFornecidos",
    "ElemGrafBrasao", "ElemGrafTimbre", "ElemGrafArteGab", "ElemGrafAssinatura",
}
_MYSQL_ONLY_PROTECTED = {
    "email_pt_html", "email_pt_versao", "email_pt_data",
    "DataSincronizacao", "OrigemMDB", "HashRegistro", "ID", "id",
}

#===================================================================== 
# CONFIGURAÇÃO
#=====================================================================

@dataclass
class Config:
    mysql_host: str
    mysql_port: int
    mysql_user: str
    mysql_password: str
    mysql_database: str
    server_host: str
    server_port: int
    mdb_os_atual_path: str
    mdb_papelaria_path: str
    dias_monitoramento: int = 30
    intervalo_segundos: float = 0.2
    
    @classmethod
    def load(cls, filepath='config.json'):
        # [MODIFIED] Uses global config_manager
        from config_manager import config_manager
        mysql_cfg = config_manager.get_mysql_config()
        server_cfg = config_manager.get_server_config()
        paths = config_manager.get_mdb_paths()
        
        return cls(
            mysql_host=mysql_cfg['host'],
            mysql_port=mysql_cfg['port'],
            mysql_user=mysql_cfg['user'],
            mysql_password=mysql_cfg['password'],
            mysql_database=mysql_cfg['database'],
            server_host=server_cfg['host'],
            server_port=server_cfg['port'],
            mdb_os_atual_path=paths['os_atual'],
            mdb_papelaria_path=paths['papelaria'],
            dias_monitoramento=15, # Default logic kept
            intervalo_segundos=0.2
        )

#=====================================================================
# GERENCIADOR DE CONEXÕES
#=====================================================================

class ConnectionManager:
    def __init__(self, config: Config):
        self.config = config
        self.mysql_conn = None
        self.mdb_os_conn = None
        self.mdb_pap_conn = None
        self._mysql_lock = threading.RLock()

    def reset_mysql(self) -> None:
        """Fecha conexão corrompida (ex.: Unread result found)."""
        with self._mysql_lock:
            try:
                if self.mysql_conn:
                    self.mysql_conn.close()
            except Exception:
                pass
            self.mysql_conn = None

    def _connect_mysql(self):
        if not self.mysql_conn or not self.mysql_conn.is_connected():
            self.mysql_conn = mysql.connector.connect(
                host=self.config.mysql_host,
                port=self.config.mysql_port,
                user=self.config.mysql_user,
                password=self.config.mysql_password,
                database=self.config.mysql_database,
                charset='utf8mb4',
                autocommit=False,
            )
            try:
                cursor = self.mysql_conn.cursor(buffered=True)
                cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
                cursor.close()
            except Exception:
                pass
        return self.mysql_conn

    def get_mysql(self):
        """Conexão MySQL compartilhada — usar apenas na thread principal do sync."""
        return self._connect_mysql()

    @contextmanager
    def mysql_session(self, *, dictionary: bool = False) -> Iterator[Tuple[Any, Any]]:
        """Sessão MySQL exclusiva — evita Unread result found entre threads/operações."""
        with self._mysql_lock:
            conn = self._connect_mysql()
            cursor = conn.cursor(dictionary=dictionary, buffered=True)
            try:
                yield conn, cursor
                conn.commit()
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    self.reset_mysql()
                raise
            finally:
                try:
                    cursor.close()
                except Exception:
                    pass
    
    def get_mdb_os(self):
        if not self.mdb_os_conn:
            driver = '{Microsoft Access Driver (*.mdb, *.accdb)}'
            conn_str = f'DRIVER={driver};DBQ={self.config.mdb_os_atual_path};'
            self.mdb_os_conn = pyodbc.connect(conn_str, autocommit=False)
        return self.mdb_os_conn
    
    def get_mdb_pap(self):
        if not self.mdb_pap_conn:
            driver = '{Microsoft Access Driver (*.mdb, *.accdb)}'
            conn_str = f'DRIVER={driver};DBQ={self.config.mdb_papelaria_path};'
            self.mdb_pap_conn = pyodbc.connect(conn_str, autocommit=False)
        return self.mdb_pap_conn
    
    def get_mdb_by_nro(self, nro: int):
        """Retorna conexão MDB apropriada baseado em NroProtocoloLink"""
        return self.get_mdb_os() if nro < 5000 else self.get_mdb_pap()
    
    def get_mdb_name_by_nro(self, nro: int) -> str:
        return "OS_Atual" if nro < 5000 else "Papelaria"
    
    def close_all(self):
        for conn in [self.mysql_conn, self.mdb_os_conn, self.mdb_pap_conn]:
            try:
                if conn:
                    conn.close()
            except:
                pass


#=====================================================================
# LOGGER
#=====================================================================

class SyncLogger:
    def __init__(self, conn_mgr: ConnectionManager):
        self.conn_mgr = conn_mgr
        
        # Setup logger Python
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('sync_andamentos.log', encoding='utf-8'),
                logging.FileHandler('synlog.txt', encoding='utf-8'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
        # Criar tabelas de log
        self._create_log_tables()
        
        # Cache para throttling de logs de erro
        self._error_log_cache = {}  # {error_hash: timestamp}
        self._error_log_interval = 60  # 1 minuto entre logs idênticos

    def log_error_throttled(self, message: str):
        """Loga erro apenas se não foi logado recentemente"""
        import hashlib
        
        # Gerar hash da mensagem para identificar unicidade
        error_hash = hashlib.md5(message.encode('utf-8')).hexdigest()
        now = time.time()
        
        last_time = self._error_log_cache.get(error_hash, 0)
        
        if now - last_time > self._error_log_interval:
            self.logger.error(message)
            self._error_log_cache[error_hash] = now
    
    def _create_log_tables(self):
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            # Tabela de log
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS log_sync_andamentos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    tipo VARCHAR(20),
                    origem VARCHAR(50),
                    destino VARCHAR(50),
                    codstatus VARCHAR(50),
                    nro INT,
                    ano INT,
                    detalhes TEXT,
                    sucesso BOOLEAN DEFAULT TRUE,
                    erro TEXT,
                    INDEX idx_timestamp (timestamp),
                    INDEX idx_codstatus (codstatus)
                )
            """)
            
            # Tabela de backup
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS backup_andamentos (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp_backup DATETIME DEFAULT CURRENT_TIMESTAMP,
                    origem VARCHAR(50),
                    codstatus VARCHAR(50),
                    nro INT,
                    ano INT,
                    dados_json TEXT,
                    INDEX idx_codstatus (codstatus)
                )
            """)
            
            # Cache MDB
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cache_andamentos_mdb (
                    codstatus VARCHAR(50) PRIMARY KEY,
                    nro INT,
                    ano INT,
                    origem VARCHAR(50),
                    ultima_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # ===================================================================
            # TABELA DE EXCLUSÕES DEFINITIVAS
            # ===================================================================
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS deleted_andamentos (
                    codstatus VARCHAR(50) PRIMARY KEY,
                    nro INT,
                    ano INT,
                    origem VARCHAR(50) COMMENT 'OS_Atual ou Papelaria - origem da exclusão',
                    content_hash VARCHAR(64) COMMENT 'SHA256 do conteúdo do registro excluído',
                    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    motivo VARCHAR(255) DEFAULT 'Exclusão detectada no MDB',
                    INDEX idx_nro_ano (nro, ano),
                    INDEX idx_deleted_at (deleted_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            
            conn.commit()
            cursor.close()
            self.logger.info("[OK] Tabelas de log criadas/verificadas")
            self.logger.info("[OK] Tabela deleted_andamentos criada/verificada")
        except Exception as e:
            self.logger.error(f"[ERRO] Erro ao criar tabelas de log: {e}")
    
    def log(self, tipo: str, origem: str, destino: str, codstatus: str,
            nro: int = None, ano: int = None, detalhes: str = None,
            sucesso: bool = True, erro: str = None):
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO log_sync_andamentos
                (tipo, origem, destino, codstatus, nro, ano, detalhes, sucesso, erro)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (tipo, origem, destino, codstatus, nro, ano, detalhes, sucesso, erro))
            
            conn.commit()
            cursor.close()
            
            # Log no console apenas mudanças
            if tipo in ['INSERT', 'UPDATE', 'DELETE']:
                msg = f"[SYNC] {tipo}: {codstatus} | Protocolo {nro}/{ano} | {origem} -> {destino}"
                if not sucesso:
                    msg += f" | [ERRO] {erro}"
                self.logger.info(msg)

        except Exception as e:
            self.logger.error(f"[ERRO] Erro ao gravar log: {e}")

    def notify_api(self, nro: int, ano: int, action: str):
        """
        Envia notificação para a API disparar WebSocket.
        Fire-and-forget (não bloqueia nem quebra o sync se falhar).
        Materializada deve estar atualizada ANTES desta chamada.
        """
        if not nro or not ano:
            return

        cache_key = f"{nro}/{ano}:{action}"
        now = time.time()
        last = getattr(self, "_notify_throttle_cache", {}).get(cache_key, 0)
        if now - last < SYNC_NOTIFY_THROTTLE_SEC:
            return
        if not hasattr(self, "_notify_throttle_cache"):
            self._notify_throttle_cache = {}
        self._notify_throttle_cache[cache_key] = now

        try:
            from config_manager import config_manager
            api_base = config_manager.get_api_internal_base()
            url = f"{api_base}/realtime/notify"

            headers = {}
            notify_secret = os.getenv("SAGRA_NOTIFY_SECRET", "").strip()
            if notify_secret:
                headers["X-Sagra-Notify-Secret"] = notify_secret

            payload = {
                "type": "system_update",
                "id": nro,
                "ano": ano,
                "action": action,
                "origem": "sync_mdb",
            }
            requests.post(url, json=payload, headers=headers, timeout=0.2)
        except Exception as exc:
            self.log_error_throttled(
                f"[NOTIFY] API indisponível ({action}): {exc}"
            )


#=====================================================================
# BACKUP MANAGER
#=====================================================================

class BackupManager:
    def __init__(self, conn_mgr: ConnectionManager, logger: SyncLogger):
        self.conn_mgr = conn_mgr
        self.logger = logger
    
    def backup(self, origem: str, registro: Dict[str, Any]):
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            dados_json = json.dumps(registro, ensure_ascii=False, default=str)
            
            cursor.execute("""
                INSERT INTO backup_andamentos
                (origem, codstatus, nro, ano, dados_json)
                VALUES (%s, %s, %s, %s, %s)
            """, (
                origem,
                registro.get('CodStatus'),
                registro.get('NroProtocoloLink'),
                registro.get('AnoProtocoloLink'),
                dados_json
            ))
            
            conn.commit()
            cursor.close()
            
            self.logger.logger.info(f"[BACKUP] {registro.get('CodStatus')}")
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao fazer backup: {e}")


#=====================================================================
# SINCRONIZADOR
#=====================================================================

class AndamentosSynchronizer:
    def __init__(self, config: Config):
        self.config = config
        self.conn_mgr = ConnectionManager(config)
        self.logger = SyncLogger(self.conn_mgr)
        self.backup_mgr = BackupManager(self.conn_mgr, self.logger)
        
        # Cache para throttle de avisos de bloqueio (evita spam de logs)
        self._blocked_warnings_cache = {}  # {codstatus: ultimo_timestamp}
        self._blocked_warning_interval = 300  # 5 minutos entre avisos do mesmo CodStatus

        # Cache para throttling de erros de inserção em MDB (ex.: FK faltando em tabProtocolos)
        self._mdb_insert_error_cache = {}  # {codstatus: (ultimo_timestamp, ultima_msg)}
        self._mdb_insert_error_interval = 300  # 5 minutos entre avisos iguais do mesmo CodStatus
        
        self.running = False
        self._instance_lock_held = False
        self._cycle_lock = threading.Lock()
        self._cycle_stats = self._new_cycle_stats()
        self._last_cycle_stats: Dict[str, Any] = {}
    
    # ===================================================================
    # CONTROLE DE EXCLUSÕES DEFINITIVAS
    # ===================================================================
    
    def _calculate_content_hash(self, andamento: Dict) -> str:
        """
        Calcula hash SHA256 do conteúdo do registro (exceto CodStatus, NroProtocoloLink, AnoProtocoloLink).
        Isso permite distinguir ressurreição de novo registro legítimo.
        """
        content_fields = [
            str(andamento.get('SituacaoLink', '')),
            str(andamento.get('SetorLink', '')),
            str(andamento.get('Data', '')),
            str(andamento.get('UltimoStatus', '')),
            str(andamento.get('Observaçao', '')),
            str(andamento.get('Ponto', ''))
        ]
        
        content_str = '|'.join(content_fields)
        return hashlib.sha256(content_str.encode('utf-8')).hexdigest()
    
    def is_deleted(self, codstatus: str) -> bool:
        """Verifica se um CodStatus está na lista de exclusões definitivas"""
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT COUNT(*) FROM deleted_andamentos WHERE codstatus = %s
            """, (codstatus,))
            
            count = cursor.fetchone()[0]
            cursor.close()
            
            return count > 0
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao verificar exclusão: {e}")
            return False
    
    def is_resurrection(self, codstatus: str, andamento: Dict) -> bool:
        """
        Verifica se é uma RESSURREIÇÃO (mesmo conteúdo de registro excluído)
        ou um NOVO REGISTRO legítimo (conteúdo diferente).
        """
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor(dictionary=True)
            
            cursor.execute("""
                SELECT content_hash FROM deleted_andamentos WHERE codstatus = %s
            """, (codstatus,))
            
            result = cursor.fetchone()
            cursor.close()
            
            if not result:
                return False  # Não está excluído, permitir
            
            stored_hash = result['content_hash']
            current_hash = self._calculate_content_hash(andamento)
            
            # Se hash é diferente, é um NOVO registro legítimo
            if stored_hash != current_hash:
                self.logger.logger.info(
                    f"[NOVO REGISTRO] CodStatus {codstatus} estava excluído mas conteúdo é diferente. "
                    f"Permitindo inserção de novo registro legítimo."
                )
                # Remover da lista de exclusões pois é um registro novo
                self._remove_from_deleted(codstatus)
                return False  # NãO é ressurreição, permitir
            
            # Hash igual = ressurreição do registro excluído
            return True
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao verificar ressurreição: {e}")
            return False  # Em caso de erro, permitir (fail-safe)
    
    def _remove_from_deleted(self, codstatus: str):
        """Remove CodStatus da lista de exclusões (quando é um novo registro legítimo)"""
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            cursor.execute("DELETE FROM deleted_andamentos WHERE codstatus = %s", (codstatus,))
            conn.commit()
            cursor.close()
            
            self.logger.logger.info(f"[LIMPEZA] {codstatus} removido de deleted_andamentos (novo registro detectado)")
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao remover de deleted_andamentos: {e}")
    
    def mark_as_deleted(self, codstatus: str, nro: int, ano: int, origem: str, 
                       andamento: Dict = None, motivo: str = None):
        """Registra um CodStatus como excluído definitivamente COM hash do conteúdo"""
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            if motivo is None:
                motivo = f"Exclusão detectada no MDB ({origem})"
            
            content_hash = None
            if andamento:
                content_hash = self._calculate_content_hash(andamento)
            
            if content_hash:
                cursor.execute("""
                    INSERT INTO deleted_andamentos 
                    (codstatus, nro, ano, origem, content_hash, motivo)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        deleted_at = CURRENT_TIMESTAMP,
                        content_hash = VALUES(content_hash),
                        motivo = VALUES(motivo)
                """, (codstatus, nro, ano, origem, content_hash, motivo))
            else:
                cursor.execute("""
                    INSERT INTO deleted_andamentos 
                    (codstatus, nro, ano, origem, motivo)
                    VALUES (%s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        deleted_at = CURRENT_TIMESTAMP,
                        motivo = VALUES(motivo)
                """, (codstatus, nro, ano, origem, motivo))
            
            conn.commit()
            cursor.close()
            
            self.logger.logger.info(f"[EXCLUSÃO DEFINITIVA] {codstatus} marcado como excluído")
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao marcar exclusão: {e}")

    def remove_from_deleted(self, codstatus: str):
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()

            cursor.execute("DELETE FROM deleted_andamentos WHERE codstatus = %s", (codstatus,))

            conn.commit()
            cursor.close()

            self.logger.logger.info(
                f"[LIMPEZA] {codstatus} removido de deleted_andamentos após sincronizar exclusão"
            )
        except Exception as e:
            self.logger.logger.error(
                f"[ERRO] Erro ao remover {codstatus} de deleted_andamentos após exclusão: {e}"
            )
    
    def get_data_limite(self) -> datetime:
        return datetime.now() - timedelta(days=self.config.dias_monitoramento)

    @staticmethod
    def _new_cycle_stats() -> Dict[str, Any]:
        return {
            "inserts": 0,
            "updates": 0,
            "deletes": 0,
            "materialized_refreshes": 0,
            "filter_refreshes": 0,
            "notifications": 0,
            "protocol_updates": 0,
            "details_updates": 0,
        }

    def _reset_cycle_stats(self) -> None:
        self._cycle_stats = self._new_cycle_stats()

    # ===================================================================
    # PÓS-ALTERAÇÃO: materializada → filtros → WebSocket
    # ===================================================================

    def refresh_os_ultimo_andamento_operacional(self, nro: int, ano: int) -> None:
        """Recalcula tab_os_ultimo_andamento_operacional (espelho do backend)."""
        if not nro or not ano:
            return
        try:
            with self.conn_mgr.mysql_session(dictionary=True) as (conn, cursor):
                at = mysql_andamento_table()
                select_sql = f"""
                    SELECT
                        a.CodStatus AS cod_status,
                        a.SituacaoLink AS situacao,
                        a.SetorLink AS setor,
                        a.`Data` AS `data`,
                        a.`Observaçao` AS observacao,
                        a.Ponto AS ponto,
                        a.UltimoStatus AS ultimo_status
                    FROM {at} AS a
                    WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
                      AND a.UltimoStatus = 1
                      AND {_MIRROR_EXCLUDE_CLAUSE.strip()}
                    ORDER BY a.`Data` DESC, a.CodStatus DESC
                    LIMIT 1
                """
                cursor.execute(select_sql, (nro, ano))
                row = cursor.fetchone()

                if row is None:
                    cursor.execute(
                        "DELETE FROM tab_os_ultimo_andamento_operacional "
                        "WHERE nro_protocolo = %s AND ano_protocolo = %s",
                        (nro, ano),
                    )
                else:
                    cursor.execute(
                        """
                        INSERT INTO tab_os_ultimo_andamento_operacional (
                            nro_protocolo, ano_protocolo, cod_status, situacao, setor,
                            `data`, observacao, ponto, ultimo_status, atualizado_em
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
                        )
                        ON DUPLICATE KEY UPDATE
                            cod_status = VALUES(cod_status),
                            situacao = VALUES(situacao),
                            setor = VALUES(setor),
                            `data` = VALUES(`data`),
                            observacao = VALUES(observacao),
                            ponto = VALUES(ponto),
                            ultimo_status = VALUES(ultimo_status),
                            atualizado_em = NOW()
                        """,
                        (
                            nro, ano,
                            row.get("cod_status"),
                            row.get("situacao"),
                            row.get("setor"),
                            row.get("data"),
                            row.get("observacao"),
                            row.get("ponto"),
                            int(row.get("ultimo_status") or 0),
                        ),
                    )
            self._cycle_stats["materialized_refreshes"] += 1
        except Exception as e:
            if "Unread result found" in str(e):
                self.conn_mgr.reset_mysql()
            self.logger.logger.warning(
                f"[MAT] Falha ao atualizar materializada OS {nro}/{ano}: {e}"
            )

    @staticmethod
    def _normalize_filter_label(value: str) -> str:
        collapsed = " ".join((value or "").strip().split())
        if not collapsed:
            return ""
        decomposed = unicodedata.normalize("NFD", collapsed.casefold())
        return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")

    def refresh_os_filter_options_for_os(self, nro: int, ano: int) -> None:
        """Upsert incremental em tab_os_filter_* quando produto/solicitante mudam."""
        if not nro or not ano:
            return
        try:
            with self.conn_mgr.mysql_session(dictionary=True) as (conn, cursor):
                cursor.execute(
                    "SELECT NomeUsuario FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                    (nro, ano),
                )
                proto = cursor.fetchone()
                if proto and proto.get("NomeUsuario"):
                    solicitante = str(proto["NomeUsuario"]).strip()
                    if solicitante:
                        norm = self._normalize_filter_label(solicitante)
                        cursor.execute(
                            """
                            INSERT INTO tab_os_filter_solicitantes (
                                solicitante, solicitante_normalizado, total_os, ultima_os_ano, atualizado_em
                            ) VALUES (%s, %s, 1, %s, NOW())
                            ON DUPLICATE KEY UPDATE
                                solicitante = VALUES(solicitante),
                                total_os = total_os + 1,
                                ultima_os_ano = GREATEST(COALESCE(ultima_os_ano, 0), VALUES(ultima_os_ano)),
                                atualizado_em = NOW()
                            """,
                            (solicitante, norm, ano),
                        )

                cursor.execute(
                    """
                    SELECT TipoPublicacaoLink FROM tabDetalhesServico
                    WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
                    """,
                    (nro, ano),
                )
                det = cursor.fetchone()
                if det and det.get("TipoPublicacaoLink"):
                    produto = str(det["TipoPublicacaoLink"]).strip()
                    if produto:
                        norm = self._normalize_filter_label(produto)
                        cursor.execute(
                            """
                            INSERT INTO tab_os_filter_produtos (
                                produto, produto_normalizado, total_os, ultima_os_ano, atualizado_em
                            ) VALUES (%s, %s, 1, %s, NOW())
                            ON DUPLICATE KEY UPDATE
                                produto = VALUES(produto),
                                total_os = total_os + 1,
                                ultima_os_ano = GREATEST(COALESCE(ultima_os_ano, 0), VALUES(ultima_os_ano)),
                                atualizado_em = NOW()
                            """,
                            (produto, norm, ano),
                        )
            self._cycle_stats["filter_refreshes"] += 1
        except Exception as e:
            if "Unread result found" in str(e):
                self.conn_mgr.reset_mysql()
            self.logger.logger.debug(
                f"[FILTER] Opções auxiliares indisponíveis para {nro}/{ano}: {e}"
            )

    def after_os_changed(self, nro: int, ano: int, action: str, *, notify: bool = True) -> None:
        """
        Efeitos pós-mudança vinda do MDB:
        1. refresh materializada de último andamento;
        2. refresh opções auxiliares da OS;
        3. notify WebSocket (após consistência).
        """
        if not nro or not ano:
            return
        self.refresh_os_ultimo_andamento_operacional(nro, ano)
        self.refresh_os_filter_options_for_os(nro, ano)
        if notify:
            self.logger.notify_api(nro, ano, action)
            self._cycle_stats["notifications"] += 1

    def acquire_instance_lock(self) -> bool:
        """Lock in-process — evita ciclos concorrentes sem usar GET_LOCK no MySQL."""
        acquired = self._cycle_lock.acquire(blocking=False)
        self._instance_lock_held = acquired
        if acquired:
            self.logger.logger.debug(
                f"[LOCK] Ciclo adquirido (PID {os.getpid()})"
            )
        return acquired

    def release_instance_lock(self) -> None:
        if not self._instance_lock_held:
            return
        try:
            self._cycle_lock.release()
        except RuntimeError:
            pass
        self._instance_lock_held = False

    def _sync_allowed_columns(
        self, columns: List[str], allowlist: Set[str], pk_fields: List[str]
    ) -> List[str]:
        allowed = []
        for col in columns:
            if col in pk_fields:
                allowed.append(col)
            elif col in allowlist and col not in _MYSQL_ONLY_PROTECTED:
                allowed.append(col)
        return allowed
    
    def format_observacao(self, observacao: str, data: datetime) -> str:
        """Formata o campo Observacao conforme logica VBA do Access"""
        if not observacao or not data:
            return observacao
        
        obs = observacao.strip()
        if not obs:
            return observacao
        
        if not obs[0].isdigit():
            if "Entregue" not in obs:
                hora = data.strftime("%H")
                minuto = data.strftime("%M")
                return f"{hora}h{minuto}\r\n{obs}"
        else:
            if "\r" not in obs and "\n" not in obs:
                x = 5
                if len(obs) > x and obs[x-1].isdigit():
                    x = 6
                x = x - 1
                
                if len(obs) > 6:
                    return f"{obs[:x]}\r\n{obs[x:]}"
        
        return observacao
    
    def format_ponto(self, ponto: str) -> str:
        """Formata o campo Ponto adicionando ponto decimal se necessario"""
        if not ponto:
            return ponto
        
        ponto_str = str(ponto).strip()
        
        if "." not in ponto_str and len(ponto_str) > 3:
            return f"{ponto_str[:-3]}.{ponto_str[-3:]}"
        
        return ponto_str
    
    def apply_formatting_to_recent_records(self):
        """Aplica formatacao aos registros do mes atual em todos os bancos"""
        if not SYNC_FORMAT_MYSQL_RECENT_RECORDS:
            return
        try:
            data_limite = datetime.now() - timedelta(days=30)
            self._format_mysql_records(data_limite)
            # Desativado para manter sincronia estritamente unidirecional (sem escrita no MDB)
            # self._format_mdb_records(self.conn_mgr.get_mdb_os(), data_limite, "OS_Atual")
            # self._format_mdb_records(self.conn_mgr.get_mdb_pap(), data_limite, "Papelaria")
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao formatar registros recentes: {e}")
    
    def _format_mysql_records(self, data_limite: datetime):
        """Formata registros no MySQL"""
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor(dictionary=True)
            at = mysql_andamento_table()

            cursor.execute(f"""
                SELECT CodStatus, Observaçao, Ponto, Data
                FROM {at}
                WHERE Data > %s
                ORDER BY CodStatus DESC
            """, (data_limite,))
            
            registros = cursor.fetchall()
            
            for reg in registros:
                obs_original = reg['Observaçao']
                ponto_original = reg['Ponto']
                
                obs_formatado = self.format_observacao(obs_original, reg['Data'])
                ponto_formatado = self.format_ponto(ponto_original)
                
                if obs_formatado != obs_original or ponto_formatado != ponto_original:
                    cursor.execute(f"""
                        UPDATE {at}
                        SET Observaçao = %s, Ponto = %s
                        WHERE CodStatus = %s
                    """, (obs_formatado, ponto_formatado, reg['CodStatus']))
            
            conn.commit()
            cursor.close()
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao formatar MySQL: {e}")
    
    def _format_mdb_records(self, conn: pyodbc.Connection, data_limite: datetime, nome_banco: str):
        """Formata registros no MDB — desativado por padrão (sync MDB→MySQL only)."""
        if not SYNC_ALLOW_MDB_WRITE:
            self.logger.logger.debug(
                "[BLOQUEADO] _format_mdb_records ignorado (MDB somente leitura no sync)"
            )
            return
        try:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT CodStatus, Observaçao, Ponto, Data
                FROM tabandamento
                WHERE Data > ?
                ORDER BY CodStatus DESC
            """, (data_limite,))

            registros = cursor.fetchall()

            for reg in registros:
                obs_original = reg.Observaçao
                ponto_original = reg.Ponto
                data = reg.Data

                obs_formatado = self.format_observacao(obs_original, data)
                ponto_formatado = self.format_ponto(ponto_original)

                if obs_formatado != obs_original or ponto_formatado != ponto_original:
                    cursor.execute("""
                        UPDATE tabandamento
                        SET Observaçao = ?, Ponto = ?
                        WHERE CodStatus = ?
                    """, (obs_formatado, ponto_formatado, reg.CodStatus))

            conn.commit()
            cursor.close()

        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao formatar {nome_banco}: {e}")
    
    def read_mysql(self) -> List[Dict]:
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor(dictionary=True)
            
            data_limite = self.get_data_limite()
            at = mysql_andamento_table()

            # [ALTERADO] Adicionado filtro AnoProtocoloLink >= 2024
            cursor.execute(f"""
                SELECT 
                    CodStatus, NroProtocoloLink, AnoProtocoloLink,
                    SituacaoLink, SetorLink, Data, UltimoStatus,
                    Observaçao, Ponto
                FROM {at}
                WHERE Data >= %s 
                  AND CodStatus IS NOT NULL 
                  AND AnoProtocoloLink >= 2024
                ORDER BY CodStatus
            """, (data_limite,))
            
            result = cursor.fetchall()
            cursor.close()
            return result
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao ler MySQL: {e}")
            return []
    
    def read_mdb(self, conn: pyodbc.Connection) -> Optional[List[Dict]]:
        """
        Lê dados do MDB.
        Retorna:
        - List[Dict]: Dados lidos com sucesso
        - None: Erro na leitura (sinal para abortar sync)
        """
        try:
            cursor = conn.cursor()
            
            data_limite = self.get_data_limite()
            
            # [ALTERADO] Adicionado filtro AnoProtocoloLink >= 2024
            cursor.execute("""
                SELECT 
                    CodStatus, NroProtocoloLink, AnoProtocoloLink,
                    SituacaoLink, SetorLink, Data, UltimoStatus,
                    Observaçao, Ponto
                FROM tabandamento
                WHERE Data >= ? AND AnoProtocoloLink >= 2024
                ORDER BY CodStatus
            """, (data_limite,))
            
            columns = [col[0] for col in cursor.description]
            result = []
            row = cursor.fetchone()
            while row:
                r_dict = {}
                for i, col in enumerate(columns):
                    val = row[i]
                    if isinstance(val, str):
                        val = val.strip()
                    r_dict[col] = val
                result.append(r_dict)
                row = cursor.fetchone()
            
            cursor.close()
            return result
        except Exception as e:
            self.logger.logger.error(f"[ERRO CRÍTICO] Erro ao ler MDB: {e}")
            self.logger.logger.error("Abortando leitura para evitar inconsistências.")
            return None

    def verify_mdb_existence(self, codstatus: str, origem: str) -> bool:
        """
        Verifica se o registro REALMENTE existe no MDB, sem filtros de data.
        Retorna True se existe, False se não existe (exclusão confirmada).
        """
        try:
            conn = self.conn_mgr.get_mdb_os() if origem == 'OS_Atual' else self.conn_mgr.get_mdb_pap()
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM tabandamento WHERE CodStatus = ?", (codstatus,))
            row = cursor.fetchone()
            exists = row[0] > 0 if row else False
            cursor.close()
            return exists
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao verificar existência no MDB ({origem}): {e}")
            return True 

    def detect_and_register_deletions(self, mysql_codes: Set[str], mdb_all_codes: Set[str]) -> Set[str]:
        """
        Detecta registros que sumiram do MDB (comparando com cache) e registra exclusão.
        Retorna conjunto de CodStatus que devem ser excluídos do MySQL.
        """
        excluidos_confirmados = set()
        
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            # [ALTERADO] Adicionado WHERE ano >= 2024
            # Isso impede que o script detecte registros antigos (que foram filtrados na leitura)
            # como "excluídos", evitando que ele tente apagar o histórico anterior a 2024 do MySQL.
            cursor.execute("SELECT codstatus, nro, ano, origem FROM cache_andamentos_mdb WHERE ano >= 2024")
            cache = {row[0]: row for row in cursor.fetchall()}
            cursor.close()
            
            cache_codes = set(cache.keys())
            
            # Candidatos a exclusão (estavam no cache mas não vieram na leitura filtrada do MDB)
            candidatos_exclusao = cache_codes - mdb_all_codes
            
            if not candidatos_exclusao:
                return set()

            # Verificar cada candidato na base completa (sem filtro de data)
            for code in candidatos_exclusao:
                # row structure: (codstatus, nro, ano, origem)
                if code not in cache: continue
                _, nro, ano, origem = cache[code]
                
                # Verificação Real no MDB
                if not self.verify_mdb_existence(code, origem):
                    excluidos_confirmados.add(code)
                else:
                    pass

            # TRAVA DE SEGURANÇA: Se houver mais de 5 exclusões, abortar TUDO
            if len(excluidos_confirmados) > 5:
                self.logger.logger.critical(f"[SAFETY LOCK] Tentativa de excluir {len(excluidos_confirmados)} registros de uma vez. ABORTANDO para evitar perda de dados.")
                self.logger.logger.critical(f"Registros abortados: {list(excluidos_confirmados)}")
                return set()

            # Se passou pela trava, processar as exclusões confirmadas
            for code in excluidos_confirmados:
                if code not in cache: continue
                _, nro, ano, origem = cache[code]
                
                self.mark_as_deleted(code, nro, ano, origem, motivo='Exclusão confirmada no MDB')
                self.logger.logger.info(f"[DETECÇÃO] CodStatus {code} excluído do MDB {origem} (Verificado).")
                
            return excluidos_confirmados
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao detectar exclusões: {e}")
            return set()

    def update_cache(self, andamentos_os: List[Dict], andamentos_pap: List[Dict]):
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            cursor.execute("DELETE FROM cache_andamentos_mdb")
            
            for and_ in andamentos_os:
                cursor.execute("""
                    INSERT INTO cache_andamentos_mdb (codstatus, nro, ano, origem)
                    VALUES (%s, %s, %s, %s)
                """, (and_['CodStatus'], and_['NroProtocoloLink'], and_['AnoProtocoloLink'], 'OS_Atual'))
            
            for and_ in andamentos_pap:
                cursor.execute("""
                    INSERT INTO cache_andamentos_mdb (codstatus, nro, ano, origem)
                    VALUES (%s, %s, %s, %s)
                """, (and_['CodStatus'], and_['NroProtocoloLink'], and_['AnoProtocoloLink'], 'Papelaria'))
            
            conn.commit()
            cursor.close()
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao atualizar cache: {e}")

    # ===================================================================
    # SINCRONIZAÇÃO DE TABELAS RELACIONADAS (tabProtocolos e tabDetalhesServico)
    # ===================================================================
    
    def sync_os_data_from_mdb(self, nro: int, ano: int, origem: str) -> Tuple[bool, bool]:
        """
        Sincroniza tabProtocolos e tabDetalhesServico do MDB para MySQL (allowlist).
        Retorna (protocolo_alterado, detalhes_alterado).
        """
        protocol_changed = False
        details_changed = False
        try:
            mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
            mdb_cursor = mdb_conn.cursor()

            # 1. tabProtocolos
            mdb_cursor.execute(
                "SELECT * FROM tabProtocolos WHERE NroProtocolo = ? AND AnoProtocolo = ?",
                (nro, ano)
            )
            row = mdb_cursor.fetchone()
            if row:
                columns = [desc[0] for desc in mdb_cursor.description]
                data = dict(zip(columns, row))
                pk_cols = ["NroProtocolo", "AnoProtocolo"]
                sync_cols = self._sync_allowed_columns(columns, _PROTOCOL_SYNC_ALLOWLIST, pk_cols)
                set_cols = [col for col in sync_cols if col not in pk_cols]

                mysql_conn = self.conn_mgr.get_mysql()
                mysql_cursor = mysql_conn.cursor(dictionary=True)
                mysql_cursor.execute(
                    "SELECT * FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                    (nro, ano)
                )
                mysql_row = mysql_cursor.fetchone()
                if mysql_row:
                    if set_cols and self._records_differ_generic(
                        {k: data.get(k) for k in sync_cols},
                        {k: mysql_row.get(k) for k in sync_cols},
                        _MYSQL_ONLY_PROTECTED,
                    ):
                        set_clause = ", ".join([f"`{col}` = %s" for col in set_cols])
                        params = [data[col] for col in set_cols] + [nro, ano]
                        mysql_cursor.execute(
                            f"UPDATE tabProtocolos SET {set_clause} "
                            f"WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                            params
                        )
                        protocol_changed = True
                        self._cycle_stats["protocol_updates"] += 1
                        self.logger.logger.info(f"[SYNC_OS] tabProtocolos atualizado: OS {nro}/{ano}")
                else:
                    insert_cols = sync_cols
                    col_clause = ", ".join([f"`{c}`" for c in insert_cols])
                    val_clause = ", ".join(["%s"] * len(insert_cols))
                    params = [data[col] for col in insert_cols]
                    mysql_cursor.execute(
                        f"INSERT INTO tabProtocolos ({col_clause}) VALUES ({val_clause})",
                        params
                    )
                    protocol_changed = True
                    self._cycle_stats["protocol_updates"] += 1
                    self.logger.logger.info(f"[SYNC_OS] tabProtocolos inserido: OS {nro}/{ano} de {origem}")
                mysql_conn.commit()
                mysql_cursor.close()
            else:
                self.logger.logger.warning(f"[SYNC_OS] OS {nro}/{ano} não encontrada em tabProtocolos do {origem}")

            # 2. tabDetalhesServico
            mdb_cursor.execute(
                "SELECT * FROM tabDetalhesServico WHERE NroProtocoloLinkDet = ? AND AnoProtocoloLinkDet = ?",
                (nro, ano)
            )
            row = mdb_cursor.fetchone()
            if row:
                columns = [desc[0] for desc in mdb_cursor.description]
                data = dict(zip(columns, row))
                pk_cols = ["NroProtocoloLinkDet", "AnoProtocoloLinkDet"]
                sync_cols = self._sync_allowed_columns(columns, _DETAILS_SYNC_ALLOWLIST, pk_cols)
                set_cols = [col for col in sync_cols if col not in pk_cols]

                mysql_conn = self.conn_mgr.get_mysql()
                mysql_cursor = mysql_conn.cursor(dictionary=True)
                mysql_cursor.execute(
                    "SELECT * FROM tabDetalhesServico "
                    "WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
                    (nro, ano)
                )
                mysql_row = mysql_cursor.fetchone()
                if mysql_row:
                    if set_cols and self._records_differ_generic(
                        {k: data.get(k) for k in sync_cols},
                        {k: mysql_row.get(k) for k in sync_cols},
                        _MYSQL_ONLY_PROTECTED,
                    ):
                        set_clause = ", ".join([f"`{col}` = %s" for col in set_cols])
                        params = [data[col] for col in set_cols] + [nro, ano]
                        mysql_cursor.execute(
                            f"UPDATE tabDetalhesServico SET {set_clause} "
                            f"WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
                            params
                        )
                        details_changed = True
                        self._cycle_stats["details_updates"] += 1
                        self.logger.logger.info(f"[SYNC_OS] tabDetalhesServico atualizado: OS {nro}/{ano}")
                else:
                    insert_cols = sync_cols
                    col_clause = ", ".join([f"`{c}`" for c in insert_cols])
                    val_clause = ", ".join(["%s"] * len(insert_cols))
                    params = [data[col] for col in insert_cols]
                    mysql_cursor.execute(
                        f"INSERT INTO tabDetalhesServico ({col_clause}) VALUES ({val_clause})",
                        params
                    )
                    details_changed = True
                    self._cycle_stats["details_updates"] += 1
                    self.logger.logger.info(f"[SYNC_OS] tabDetalhesServico inserido: OS {nro}/{ano} de {origem}")
                mysql_conn.commit()
                mysql_cursor.close()
            else:
                self.logger.logger.warning(f"[SYNC_OS] Detalhes da OS {nro}/{ano} não encontrados no {origem}")

            mdb_cursor.close()

            # Efeitos (materializada/WS) ficam a cargo do chamador (perform_sync)

        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao sincronizar dados da OS {nro}/{ano}: {e}")

        return protocol_changed, details_changed

    def ensure_mysql_ultimo_status_from_mdb(self, nro: int, ano: int) -> bool:
        """
        Replica UltimoStatus do MDB apenas para CodStatus presentes no MDB.
        Andamentos só-MySQL (Web ainda não replicou no Access) não são alterados.
        """
        changed = False
        try:
            mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
            mdb_cur = mdb_conn.cursor()
            mdb_cur.execute(
                """
                SELECT CodStatus, UltimoStatus
                FROM tabandamento
                WHERE NroProtocoloLink = ? AND AnoProtocoloLink = ?
                ORDER BY CodStatus
                """,
                (nro, ano),
            )
            source_rows = mdb_cur.fetchall()
            mdb_cur.close()

            if not source_rows:
                return False

            mdb_cods = {row.CodStatus for row in source_rows}
            cods_true = {row.CodStatus for row in source_rows if getattr(row, "UltimoStatus", False)}

            conn = self.conn_mgr.get_mysql()
            cur = conn.cursor(dictionary=True)
            at = mysql_andamento_table()

            placeholders = ", ".join(["%s"] * len(mdb_cods))
            cur.execute(
                f"""
                SELECT CodStatus, UltimoStatus FROM {at}
                WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
                  AND CodStatus IN ({placeholders})
                """,
                (nro, ano, *tuple(mdb_cods)),
            )
            mysql_rows = {r["CodStatus"]: bool(r["UltimoStatus"]) for r in cur.fetchall()}

            to_false = [c for c in mdb_cods if c not in cods_true and mysql_rows.get(c) is True]
            to_true = [c for c in cods_true if mysql_rows.get(c) is not True]

            if to_false:
                ph = ", ".join(["%s"] * len(to_false))
                cur.execute(
                    f"UPDATE {at} SET UltimoStatus = FALSE WHERE CodStatus IN ({ph})",
                    tuple(to_false),
                )
                changed = True

            if to_true:
                ph = ", ".join(["%s"] * len(to_true))
                cur.execute(
                    f"UPDATE {at} SET UltimoStatus = TRUE WHERE CodStatus IN ({ph})",
                    tuple(to_true),
                )
                changed = True

            if changed:
                conn.commit()
            cur.close()
        except Exception as e:
            self.logger.logger.error(
                f"[ERRO] Erro ao replicar UltimoStatus do MDB para MySQL em {nro}/{ano}: {e}"
            )
        return changed
    
    def insert_mysql(self, andamento: Dict, origem: str) -> bool:
        """Insere registro no MySQL, mas apenas se NÃO estiver na lista de exclusões."""
        try:
            codstatus = andamento['CodStatus']
            nro = andamento['NroProtocoloLink']
            ano = andamento['AnoProtocoloLink']

            if self.is_resurrection(codstatus, andamento):
                current_time = time.time()
                last_warning = self._blocked_warnings_cache.get(codstatus, 0)

                if current_time - last_warning >= self._blocked_warning_interval:
                    self.logger.logger.warning(
                        f"[BLOQUEADO] CodStatus {codstatus} é RESSURREIÇÃO de registro excluído. "
                        f"Inserções bloqueadas continuamente (aviso a cada 5min)."
                    )
                    self._blocked_warnings_cache[codstatus] = current_time

                self.logger.log(
                    'INSERT_BLOCKED', origem, 'MySQL', codstatus,
                    nro, ano,
                    'Bloqueado: ressurreição de registro excluído'
                )
                return False

            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            at = mysql_andamento_table()

            # OTIMIZAÇÃO/CONCORRÊNCIA: Se o registro já existir (inserido por outra instância), aborta a inserção silenciosamente
            cursor.execute(f"SELECT COUNT(*) FROM {at} WHERE CodStatus = %s", (codstatus,))
            if cursor.fetchone()[0] > 0:
                cursor.close()
                self.logger.logger.info(f"[SYNC] CodStatus {codstatus} já existente no MySQL (ignorado insert).")
                return False

            # OTIMIZAÇÃO: Desmarca o UltimoStatus dos andamentos anteriores na mesma transação
            # garantindo que a marcação do novo seja simultânea e evitando 2 registros com UltimoStatus=TRUE
            if andamento.get('UltimoStatus'):
                cursor.execute(f"""
                    UPDATE {at}
                    SET UltimoStatus = FALSE 
                    WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
                """, (nro, ano))

            cursor.execute(f"""
                INSERT INTO {at}
                (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink,
                 SetorLink, Data, UltimoStatus, Observaçao, Ponto)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                andamento['CodStatus'], nro, ano,
                andamento['SituacaoLink'], andamento['SetorLink'], andamento['Data'],
                andamento['UltimoStatus'], andamento['Observaçao'],
                andamento['Ponto']
            ))
            
            conn.commit()
            cursor.close()
            
            self.logger.log(
                'INSERT', origem, 'MySQL', andamento['CodStatus'],
                nro, ano,
                'Novo andamento sincronizado'
            )
            return True
        except MySQLError as e:
            if 'conn' in locals() and conn:
                conn.rollback()
            if e.errno == 1062:  # Duplicate entry
                self.logger.logger.info(f"[SYNC] CodStatus {codstatus} já inserido por outra instância (ignorando duplicate entry).")
            else:
                self.logger.log(
                    'INSERT', origem, 'MySQL', andamento.get('CodStatus'),
                    andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                    sucesso=False, erro=str(e)
                )
            return False
        except Exception as e:
            if 'conn' in locals() and conn:
                conn.rollback()
            self.logger.log(
                'INSERT', origem, 'MySQL', andamento.get('CodStatus'),
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                sucesso=False, erro=str(e)
            )
            return False

    def insert_mdb(self, andamento: Dict, conn: pyodbc.Connection, destino: str):
        """Insere registro no MDB — desativado por padrão (sync MDB→MySQL only)."""
        if not SYNC_ALLOW_MDB_WRITE:
            self.logger.logger.warning(
                "[BLOQUEADO] insert_mdb desativado (MDB somente leitura no sync)"
            )
            return
        try:
            codstatus = andamento['CodStatus']
            if self.is_resurrection(codstatus, andamento):
                current_time = time.time()
                last_warning = self._blocked_warnings_cache.get(codstatus, 0)
                if current_time - last_warning >= self._blocked_warning_interval:
                    self.logger.logger.warning(
                        f"[BLOQUEADO] CodStatus {codstatus} é RESSURREIÇÃO de registro excluído. "
                        f"Inserções bloqueadas continuamente (aviso a cada 5min)."
                    )
                    self._blocked_warnings_cache[codstatus] = current_time
                self.logger.log(
                    'INSERT_BLOCKED', 'MySQL', destino, codstatus,
                    andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                    'Bloqueado: ressurreição de registro excluído'
                )
                return 

            cursor = conn.cursor()

            nro_logico = andamento.get('NroProtocoloLink')
            ano_logico = andamento.get('AnoProtocoloLink')
            cursor.execute(
                "SELECT NroProtocolo, AnoProtocolo FROM tabProtocolos WHERE NroProtocolo = ? AND AnoProtocolo = ?",
                (nro_logico, ano_logico)
            )
            protocolo = cursor.fetchone()
            if not protocolo:
                raise Exception(f"Protocolo {nro_logico}/{ano_logico} não encontrada em tabProtocolos do MDB {destino} (necessário para FK)")
            nro_fk, ano_fk = protocolo.NroProtocolo, protocolo.AnoProtocolo

            obs = andamento.get('Observaçao', '')
            if obs:
                obs = obs.replace('\n', '\r\n')

            # OTIMIZAÇÃO: Desmarca o UltimoStatus dos andamentos anteriores na mesma transação
            # garantindo que a marcação do novo seja simultânea e evitando 2 registros com UltimoStatus=TRUE
            if andamento.get('UltimoStatus'):
                cursor.execute("""
                    UPDATE tabandamento 
                    SET UltimoStatus = FALSE 
                    WHERE NroProtocoloLink = ? AND AnoProtocoloLink = ?
                """, (nro_fk, ano_fk))

            cursor.execute(
                """
                INSERT INTO tabandamento
                (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink,
                 SetorLink, Data, UltimoStatus, Observaçao, Ponto)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    andamento['CodStatus'], nro_fk, ano_fk,
                    andamento['SituacaoLink'], andamento['SetorLink'], andamento['Data'],
                    andamento['UltimoStatus'], obs, andamento['Ponto']
                )
            )

            conn.commit()
            cursor.close()

            self.logger.log(
                'INSERT', 'MySQL', destino, andamento['CodStatus'],
                nro_fk, ano_fk,
                'Novo andamento'
            )
        except Exception as e:
            conn.rollback()
            error_msg = str(e)
            codstatus_err = andamento.get('CodStatus')
            now = time.time()
            last_ts, last_msg = self._mdb_insert_error_cache.get(codstatus_err, (0, None))
            if (now - last_ts) >= self._mdb_insert_error_interval or last_msg != error_msg:
                self._mdb_insert_error_cache[codstatus_err] = (now, error_msg)
                self.logger.log(
                    'INSERT', 'MySQL', destino, codstatus_err,
                    andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                    sucesso=False, erro=error_msg
                )

    def _format_record_log(self, andamento: Dict) -> str:
        try:
            lines = []
            lines.append(f"  CodStatus: {andamento.get('CodStatus')}")
            lines.append(f"  Protocolo: {andamento.get('NroProtocoloLink')}/{andamento.get('AnoProtocoloLink')}")
            lines.append(f"  Situação: {andamento.get('SituacaoLink')}")
            lines.append(f"  Setor: {andamento.get('SetorLink')}")
            lines.append(f"  Data: {andamento.get('Data')}")
            lines.append(f"  UltimoStatus: {andamento.get('UltimoStatus')}")
            lines.append(f"  Ponto: {andamento.get('Ponto')}")
            
            obs = str(andamento.get('Observaçao', '')).replace('\n', ' ').replace('\r', '')
            if len(obs) > 100: obs = obs[:97] + "..."
            lines.append(f"  Observação: {obs}")
            
            return "\\n".join(lines)
        except:
            return str(andamento)

    def delete_mysql(self, codstatus: str, andamento: Dict) -> bool:
        """Remove andamento do MySQL E registra na tabela deleted_andamentos."""
        try:
            self.backup_mgr.backup('MySQL', andamento)
            
            record_details = self._format_record_log(andamento)
            self.logger.logger.info(f"--- DETALHES DO REGISTRO A SER EXCLUÍDO (MySQL) ---\\n{record_details}\\n-----------------------------------------------")

            nro = andamento.get('NroProtocoloLink')
            ano = andamento.get('AnoProtocoloLink')
            origem = 'MySQL'
            
            self.mark_as_deleted(
                codstatus, 
                nro, 
                ano, 
                origem, 
                andamento=andamento,  # Passa andamento para calcular hash
                motivo='Exclusão manual no MySQL ou detectada por sync'
            )
            
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            at = mysql_andamento_table()

            cursor.execute(f"DELETE FROM {at} WHERE CodStatus = %s", (codstatus,))

            cursor.execute("DELETE FROM deleted_andamentos WHERE codstatus = %s", (codstatus,))
            
            conn.commit()
            cursor.close()
            
            self.logger.log(
                'DELETE', 'MDB', 'MySQL', codstatus,
                nro, ano,
                'Exclusão propagada e removida de deleted_andamentos'
            )
            return True
        except Exception as e:
            conn.rollback()
            self.logger.log(
                'DELETE', 'MDB', 'MySQL', codstatus,
                sucesso=False, erro=str(e)
            )
            return False

    def delete_mdb(self, codstatus: str, andamento: Dict, mdb_conn, origem: str):
        """
        Remove andamento do MDB (Access).
        ⚠️ PROTEÇÃO ATIVADA: Exclusão desabilitada para preservar dados legados.
        """
        try:
            record_details = self._format_record_log(andamento)
            self.logger.logger.info(f"--- DETALHES DO REGISTRO QUE SERIA EXCLUÍDO ({origem}) ---\\n{record_details}\\n---------------------------------------------------------")

            self.logger.log(
                'DELETE_SKIPPED', 'MySQL', origem, codstatus,
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                'Exclusão MDB ignorada (Proteção de dados ativada)'
            )
            return

        except Exception as e:
            mdb_conn.rollback()
            self.logger.log(
                'DELETE', 'MySQL', origem, codstatus,
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                sucesso=False, erro=str(e)
            )
    
    def update_ultimo_status(self, nro: int, ano: int):
        """Garante que apenas o último CodStatus tem UltimoStatus=TRUE (MySQL; MDB só se SYNC_ALLOW_MDB_WRITE)."""
        try:
            at = mysql_andamento_table()
            # MySQL
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()

            cursor.execute(f"""
                UPDATE {at}
                SET UltimoStatus = FALSE 
                WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
            """, (nro, ano))

            cursor.execute(f"""
                UPDATE {at}
                SET UltimoStatus = TRUE 
                WHERE CodStatus = (
                    SELECT MAX(CodStatus) 
                    FROM (SELECT CodStatus FROM {at}
                          WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s) AS sub
                )
            """, (nro, ano))

            conn.commit()
            cursor.close()

            if not SYNC_ALLOW_MDB_WRITE:
                return

            # MDB correspondente (somente com flag explícita)
            mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
            cursor_mdb = mdb_conn.cursor()
            
            cursor_mdb.execute("""
                UPDATE tabandamento 
                SET UltimoStatus = FALSE 
                WHERE NroProtocoloLink = ? AND AnoProtocoloLink = ?
            """, (nro, ano))
            
            cursor_mdb.execute("""
                UPDATE tabandamento 
                SET UltimoStatus = TRUE 
                WHERE CodStatus = (
                    SELECT MAX(CodStatus) 
                    FROM tabandamento 
                    WHERE NroProtocoloLink = ? AND AnoProtocoloLink = ?
                )
            """, (nro, ano))
            
            mdb_conn.commit()
            cursor_mdb.close()
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao atualizar UltimoStatus para {nro}/{ano}: {e}")

    def update_mysql(self, andamento: Dict, origem: str) -> bool:
        """Atualiza registro no MySQL por detecção de alterações."""
        try:
            codstatus = andamento['CodStatus']
            nro = andamento['NroProtocoloLink']
            ano = andamento['AnoProtocoloLink']

            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            at = mysql_andamento_table()

            # Se o status do andamento atualizado for UltimoStatus, desmarca os outros
            if andamento.get('UltimoStatus'):
                cursor.execute(f"""
                    UPDATE {at}
                    SET UltimoStatus = FALSE 
                    WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s AND CodStatus != %s
                """, (nro, ano, codstatus))

            cursor.execute(f"""
                UPDATE {at}
                SET NroProtocoloLink = %s,
                    AnoProtocoloLink = %s,
                    SituacaoLink = %s,
                    SetorLink = %s,
                    Data = %s,
                    UltimoStatus = %s,
                    Observaçao = %s,
                    Ponto = %s
                WHERE CodStatus = %s
            """, (
                nro, ano,
                andamento['SituacaoLink'], andamento['SetorLink'], andamento['Data'],
                andamento['UltimoStatus'], andamento['Observaçao'],
                andamento['Ponto'], codstatus
            ))
            
            conn.commit()
            cursor.close()
            
            self.logger.log(
                'UPDATE', origem, 'MySQL', codstatus,
                nro, ano,
                'Andamento atualizado por alteração no MDB'
            )
            return True
        except Exception as e:
            conn.rollback()
            self.logger.log(
                'UPDATE', origem, 'MySQL', andamento.get('CodStatus'),
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                sucesso=False, erro=str(e)
            )
            return False

    def _andamentos_differ(self, mdb_rec: Dict, mysql_rec: Dict) -> bool:
        """Compara andamentos normalizando tipos, datas e formatação de observação/ponto."""
        # Formatar campos MDB antes de comparar para evitar loops de formatação
        mdb_obs = self.format_observacao(mdb_rec.get('Observaçao'), mdb_rec.get('Data'))
        mdb_ponto = self.format_ponto(mdb_rec.get('Ponto'))
        
        mysql_obs = mysql_rec.get('Observaçao')
        mysql_ponto = mysql_rec.get('Ponto')
        
        def normalize_str(val):
            if val is None:
                return ""
            return str(val).strip()

        if normalize_str(mdb_rec.get('SituacaoLink')) != normalize_str(mysql_rec.get('SituacaoLink')):
            return True
        if normalize_str(mdb_rec.get('SetorLink')) != normalize_str(mysql_rec.get('SetorLink')):
            return True
        
        def normalize_date(val):
            if not val:
                return ""
            if isinstance(val, str):
                return val.strip()
            return val.strftime("%Y-%m-%d %H:%M:%S")
            
        if normalize_date(mdb_rec.get('Data')) != normalize_date(mysql_rec.get('Data')):
            return True
            
        if bool(mdb_rec.get('UltimoStatus')) != bool(mysql_rec.get('UltimoStatus')):
            return True
            
        if normalize_str(mdb_obs) != normalize_str(mysql_obs):
            return True
            
        if normalize_str(mdb_ponto) != normalize_str(mysql_ponto):
            return True

        if int(mdb_rec.get('NroProtocoloLink') or 0) != int(mysql_rec.get('NroProtocoloLink') or 0):
            return True
            
        if int(mdb_rec.get('AnoProtocoloLink') or 0) != int(mysql_rec.get('AnoProtocoloLink') or 0):
            return True

        return False

    def _run_background_sync(self):
        """Thread de segundo plano para sincronizar tabProtocolos e tabDetalhesServico quando o MDB muda."""
        if not SYNC_PROTOCOL_DETAILS_BACKGROUND:
            self.logger.logger.info("[BG_SYNC] Desativado (SYNC_PROTOCOL_DETAILS_BACKGROUND=false).")
            return
        last_mtimes = {"OS_Atual": 0.0, "Papelaria": 0.0}
        self.logger.logger.info("[BG_SYNC] Thread de sincronização de Protocolos/Detalhes iniciado.")
        
        while self.running:
            try:
                # 1. Verificar OS_Atual.mdb
                os_path = self.config.mdb_os_atual_path
                os_mtime = os.path.getmtime(os_path) if os.path.exists(os_path) else 0.0
                if os_mtime != last_mtimes["OS_Atual"]:
                    self.logger.logger.info(
                        "[BG_SYNC] Alteração detectada no MDB OS_Atual. Iniciando sincronização..."
                    )
                    self._sync_os_and_details_for_db(is_os=True)
                    last_mtimes["OS_Atual"] = os_mtime

                # 2. Verificar Papelaria.mdb
                pap_path = self.config.mdb_papelaria_path
                pap_mtime = os.path.getmtime(pap_path) if os.path.exists(pap_path) else 0.0
                if pap_mtime != last_mtimes["Papelaria"]:
                    self.logger.logger.info(
                        "[BG_SYNC] Alteração detectada no MDB Papelaria. Iniciando sincronização..."
                    )
                    self._sync_os_and_details_for_db(is_os=False)
                    last_mtimes["Papelaria"] = pap_mtime
                    
            except Exception as e:
                self.logger.logger.error(f"[BG_SYNC] Erro no loop de segundo plano: {e}")
                self.logger.logger.error(traceback.format_exc())
            
            # Dorme em pequenos passos para poder parar de forma responsiva
            for _ in range(150): # 15 segundos total
                if not self.running:
                    break
                time.sleep(0.1)
                
        self.logger.logger.info("[BG_SYNC] Thread de segundo plano finalizado com sucesso.")

    def _sync_os_and_details_for_db(self, is_os: bool):
        """Gerencia conexões e delega a sincronização de tabelas de protocolo/detalhes."""
        mdb_conn = None
        mysql_conn = None
        db_name = "OS_Atual" if is_os else "Papelaria"
        
        try:
            driver = '{Microsoft Access Driver (*.mdb, *.accdb)}'
            mdb_path = self.config.mdb_os_atual_path if is_os else self.config.mdb_papelaria_path
            conn_str = f'DRIVER={driver};DBQ={mdb_path};'
            
            mdb_conn = pyodbc.connect(conn_str, autocommit=False)
            
            mysql_conn = mysql.connector.connect(
                host=self.config.mysql_host,
                port=self.config.mysql_port,
                user=self.config.mysql_user,
                password=self.config.mysql_password,
                database=self.config.mysql_database,
                charset='utf8mb4',
                autocommit=False
            )
            
            try:
                cur = mysql_conn.cursor()
                cur.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
                cur.close()
            except:
                pass
            
            # Sincronizar tabProtocolos
            self._sync_table_generic(
                mdb_conn, mysql_conn, is_os,
                table_name="tabProtocolos",
                pk_fields=["NroProtocolo", "AnoProtocolo"],
                year_field="AnoProtocolo",
                nro_field="NroProtocolo",
                ignore_fields={"email_pt_html", "email_pt_versao", "email_pt_data", "DataSincronizacao", "OrigemMDB", "HashRegistro", "ID", "id"}
            )
            
            # Sincronizar tabDetalhesServico
            self._sync_table_generic(
                mdb_conn, mysql_conn, is_os,
                table_name="tabDetalhesServico",
                pk_fields=["NroProtocoloLinkDet", "AnoProtocoloLinkDet"],
                year_field="AnoProtocoloLinkDet",
                nro_field="NroProtocoloLinkDet",
                ignore_fields={"DataSincronizacao", "OrigemMDB", "HashRegistro", "ID", "id"}
            )
            
        except Exception as e:
            self.logger.logger.error(f"[BG_SYNC] Erro ao sincronizar tabelas para {db_name}: {e}")
            self.logger.logger.error(traceback.format_exc())
        finally:
            if mdb_conn:
                try: mdb_conn.close()
                except: pass
            if mysql_conn:
                try: mysql_conn.close()
                except: pass

    def _sync_table_generic(self, mdb_conn, mysql_conn, is_os: bool,
                            table_name: str, pk_fields: List[str], year_field: str, nro_field: str,
                            ignore_fields: Set[str]):
        db_name = "OS_Atual" if is_os else "Papelaria"
        allowlist = (
            _PROTOCOL_SYNC_ALLOWLIST if table_name == "tabProtocolos" else _DETAILS_SYNC_ALLOWLIST
        )
        action = (
            "sync_protocol_update" if table_name == "tabProtocolos" else "sync_details_update"
        )

        # 1. Ler MDB
        mdb_cursor = mdb_conn.cursor()
        if is_os:
            mdb_cursor.execute(f"SELECT * FROM {table_name} WHERE {year_field} >= 2024 AND {nro_field} < 5000")
        else:
            mdb_cursor.execute(f"SELECT * FROM {table_name} WHERE {year_field} >= 2024 AND {nro_field} >= 5000")
        columns = [desc[0] for desc in mdb_cursor.description]
        sync_cols = self._sync_allowed_columns(columns, allowlist, pk_fields)
        mdb_rows = mdb_cursor.fetchall()

        mdb_records = []
        for row in mdb_rows:
            full = dict(zip(columns, row))
            mdb_records.append({k: full.get(k) for k in sync_cols})
        mdb_cursor.close()

        # 2. Ler MySQL
        mysql_cursor = mysql_conn.cursor(dictionary=True)
        if is_os:
            query = f"SELECT * FROM {table_name} WHERE {year_field} >= 2024 AND {nro_field} < 5000"
        else:
            query = f"SELECT * FROM {table_name} WHERE {year_field} >= 2024 AND {nro_field} >= 5000"
        mysql_cursor.execute(query)
        mysql_records = mysql_cursor.fetchall()
        mysql_cursor.close()

        def get_pk_val(rec, fields):
            return tuple(rec.get(f) for f in fields)

        mysql_map = {get_pk_val(r, pk_fields): r for r in mysql_records}

        inserts = []
        updates = []
        affected_os: Set[Tuple[int, int]] = set()

        for mdb_rec in mdb_records:
            pk = get_pk_val(mdb_rec, pk_fields)
            if pk not in mysql_map:
                inserts.append(mdb_rec)
            else:
                mysql_rec = mysql_map[pk]
                if self._records_differ_generic(mdb_rec, mysql_rec, ignore_fields | _MYSQL_ONLY_PROTECTED):
                    updates.append(mdb_rec)

        # Inserções no MySQL
        if inserts:
            mysql_cursor = mysql_conn.cursor()
            for mdb_rec in inserts:
                col_names = ", ".join([f"`{col}`" for col in sync_cols])
                placeholders = ", ".join(["%s"] * len(sync_cols))
                values = [mdb_rec[col] for col in sync_cols]

                query = f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders})"
                mysql_cursor.execute(query, values)

                pk_desc = "/".join(str(mdb_rec.get(f)) for f in pk_fields)
                self.logger.logger.info(f"[BG_SYNC] [INSERT] {table_name} | {pk_desc} inserido de {db_name}")
                nro_val = mdb_rec.get(pk_fields[0])
                ano_val = mdb_rec.get(pk_fields[1])
                if nro_val and ano_val:
                    affected_os.add((int(nro_val), int(ano_val)))
            mysql_conn.commit()
            mysql_cursor.close()

        # Atualizações no MySQL
        if updates:
            mysql_cursor = mysql_conn.cursor()
            for mdb_rec in updates:
                set_cols = [col for col in sync_cols if col not in pk_fields]
                set_clause = ", ".join([f"`{col}` = %s" for col in set_cols])

                values = [mdb_rec[col] for col in set_cols]
                for f in pk_fields:
                    values.append(mdb_rec[f])

                where_clause = " AND ".join([f"`{f}` = %s" for f in pk_fields])

                query = f"UPDATE {table_name} SET {set_clause} WHERE {where_clause}"
                mysql_cursor.execute(query, values)

                pk_desc = "/".join(str(mdb_rec.get(f)) for f in pk_fields)
                self.logger.logger.info(f"[BG_SYNC] [UPDATE] {table_name} | {pk_desc} atualizado no MySQL")
                nro_val = mdb_rec.get(pk_fields[0])
                ano_val = mdb_rec.get(pk_fields[1])
                if nro_val and ano_val:
                    affected_os.add((int(nro_val), int(ano_val)))
            mysql_conn.commit()
            mysql_cursor.close()

        if affected_os:
            self.logger.logger.info(
                f"[BG_SYNC] {table_name}: {len(affected_os)} OS(s) gravadas no MySQL "
                f"(sem notify individual — dados já replicados)"
            )

    def _records_differ_generic(self, mdb_rec: Dict, mysql_rec: Dict, ignore_fields: Set[str]) -> bool:
        """Compara registros genéricos normalizando datas, floats e booleanos."""
        keys = (set(mdb_rec.keys()) | set(mysql_rec.keys())) - ignore_fields
        for key in keys:
            val_mdb = mdb_rec.get(key)
            val_mysql = mysql_rec.get(key)
            
            if val_mdb is None and val_mysql is None:
                continue
                
            norm_mdb = self._normalize_value_generic(val_mdb)
            norm_mysql = self._normalize_value_generic(val_mysql)
            
            if norm_mdb != norm_mysql:
                return True
        return False

    def _normalize_value_generic(self, val) -> str:
        """Normaliza tipos para comparação em string sem falsos positivos."""
        if val is None:
            return ""
        if isinstance(val, bool):
            return "1" if val else "0"
        
        if isinstance(val, (datetime, date)):
            if isinstance(val, datetime):
                if val.hour == 0 and val.minute == 0 and val.second == 0:
                    return val.strftime("%Y-%m-%d")
                return val.strftime("%Y-%m-%d %H:%M:%S")
            return val.strftime("%Y-%m-%d")
        
        val_str = str(val).strip()
        
        # Compara float ex: 5.0 vs 5
        try:
            f_val = float(val_str)
            if f_val.is_integer():
                return str(int(f_val))
            return str(f_val)
        except ValueError:
            pass

        # Normaliza formato de data armazenada como string
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(val_str, fmt)
                if dt.hour == 0 and dt.minute == 0 and dt.second == 0:
                    return dt.strftime("%Y-%m-%d")
                return dt.strftime("%Y-%m-%d %H:%M:%S")
            except ValueError:
                pass
                
        return val_str

    def perform_sync(self):
        if not self.acquire_instance_lock():
            return

        t0 = time.perf_counter()
        self._reset_cycle_stats()
        try:
            # Ler todos os dados
            mysql_data = self.read_mysql()
            
            mdb_os_data = self.read_mdb(self.conn_mgr.get_mdb_os())
            if mdb_os_data is None:
                self.logger.logger.error("[ABORT] Falha na leitura do MDB OS_Atual. Ciclo de sincronização abortado.")
                return

            mdb_pap_data = self.read_mdb(self.conn_mgr.get_mdb_pap())
            if mdb_pap_data is None:
                self.logger.logger.error("[ABORT] Falha na leitura do MDB Papelaria. Ciclo de sincronização abortado.")
                return
            
            mysql_codes = {a['CodStatus'] for a in mysql_data}
            mdb_os_codes = {a['CodStatus'] for a in mdb_os_data}
            mdb_pap_codes = {a['CodStatus'] for a in mdb_pap_data}
            mdb_all_codes = mdb_os_codes | mdb_pap_codes
            
            # PASSO 1: DETECTAR E REGISTRAR EXCLUSÕES
            excluidos = self.detect_and_register_deletions(mysql_codes, mdb_all_codes)
            
            # Atualizar cache APÓS detectar exclusões
            self.update_cache(mdb_os_data, mdb_pap_data)
            
            # MDB → MySQL (novos)
            novos_no_mdb = mdb_all_codes - mysql_codes
            for code in novos_no_mdb:
                if self.is_deleted(code):
                    continue
                
                and_ = None
                origem = None
                
                for a in mdb_os_data:
                    if a['CodStatus'] == code:
                        and_ = a
                        origem = 'OS_Atual'
                        break
                
                if not and_:
                    for a in mdb_pap_data:
                        if a['CodStatus'] == code:
                            and_ = a
                            origem = 'Papelaria'
                            break
                
                if and_:
                    nro_os = and_['NroProtocoloLink']
                    ano_os = and_['AnoProtocoloLink']
                    self.sync_os_data_from_mdb(nro_os, ano_os, origem)

                    if self.insert_mysql(and_, origem):
                        self._cycle_stats["inserts"] += 1
                        self.ensure_mysql_ultimo_status_from_mdb(nro_os, ano_os)
                        self.after_os_changed(nro_os, ano_os, "sync_insert")
            
            # PASSO 2: DETECTAR E REPLICAR ALTERAÇÕES (UPDATES)
            comuns = mysql_codes & mdb_all_codes
            for code in comuns:
                mysql_rec = next((a for a in mysql_data if a['CodStatus'] == code), None)
                mdb_rec = None
                origem = None
                
                for a in mdb_os_data:
                    if a['CodStatus'] == code:
                        mdb_rec = a
                        origem = 'OS_Atual'
                        break
                
                if not mdb_rec:
                    for a in mdb_pap_data:
                        if a['CodStatus'] == code:
                            mdb_rec = a
                            origem = 'Papelaria'
                            break
                
                if mdb_rec and mysql_rec:
                    if self._andamentos_differ(mdb_rec, mysql_rec):
                        nro_os = mdb_rec['NroProtocoloLink']
                        ano_os = mdb_rec['AnoProtocoloLink']
                        self.sync_os_data_from_mdb(nro_os, ano_os, origem)

                        if self.update_mysql(mdb_rec, origem):
                            self._cycle_stats["updates"] += 1
                            self.ensure_mysql_ultimo_status_from_mdb(nro_os, ano_os)
                            self.after_os_changed(nro_os, ano_os, "sync_update")
            
            # MySQL → MDB (Desativado - Sincronização Unidirecional MDB -> MySQL apenas)
            # novos_no_mysql = mysql_codes - mdb_all_codes
            # for code in novos_no_mysql:
            #     if self.is_deleted(code):
            #         continue
            #         
            #     and_ = next((a for a in mysql_data if a['CodStatus'] == code), None)
            #     
            #     if and_:
            #         nro = and_['NroProtocoloLink']
            #         mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
            #         destino = self.conn_mgr.get_mdb_name_by_nro(nro)
            #         
            #         self.insert_mdb(and_, mdb_conn, destino)
            #         self.update_ultimo_status(nro, and_['AnoProtocoloLink'])
            
            # PASSO 3: EXECUTAR EXCLUSÕES NO MYSQL
            if excluidos:
                for code in excluidos:
                    and_ = next((a for a in mysql_data if a['CodStatus'] == code), None)
                    if and_:
                        nro_os = and_['NroProtocoloLink']
                        ano_os = and_['AnoProtocoloLink']
                        if self.delete_mysql(code, and_):
                            self._cycle_stats["deletes"] += 1
                            self.ensure_mysql_ultimo_status_from_mdb(nro_os, ano_os)
                            self.after_os_changed(nro_os, ano_os, "sync_delete")

            # Aplicar formatacao aos registros recentes (a cada 10 ciclos)
            if not hasattr(self, '_format_counter'):
                self._format_counter = 0
            
            self._format_counter += 1
            if self._format_counter >= 10:
                self.apply_formatting_to_recent_records()
                self._format_counter = 0
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro no ciclo de sincronizacao: {e}")
            self.logger.logger.error(traceback.format_exc())
            try:
                self.conn_mgr.get_mysql().rollback()
            except:
                pass
        finally:
            elapsed = time.perf_counter() - t0
            self._last_cycle_stats = {**self._cycle_stats, "elapsed_sec": round(elapsed, 3)}
            stats = self._last_cycle_stats
            if any(stats.get(k, 0) for k in ("inserts", "updates", "deletes", "notifications")):
                self.logger.logger.info(
                    "[PERF] ciclo=%.3fs ins=%s upd=%s del=%s mat=%s filt=%s notify=%s proto=%s det=%s",
                    stats["elapsed_sec"],
                    stats["inserts"], stats["updates"], stats["deletes"],
                    stats["materialized_refreshes"], stats["filter_refreshes"],
                    stats["notifications"], stats["protocol_updates"], stats["details_updates"],
                )
            self.release_instance_lock()

    def run_continuous(self):
        self.logger.logger.info("="*70)
        self.logger.logger.info("[INICIO] SINCRONIZACAO UNIDIRECIONAL (MDB -> MySQL) INICIADA")
        self.logger.logger.info(f"[INFO] Monitorando ultimos {self.config.dias_monitoramento} dias")
        self.logger.logger.info(f"[INFO] Filtro de Ano: APENAS REGISTROS >= 2024")
        self.logger.logger.info(f"[INFO] Intervalo: {self.config.intervalo_segundos}s")
        self.logger.logger.info(f"[INFO] PID: {os.getpid()}")
        self.logger.logger.info(
            f"[INFO] Flags: FORMAT_MYSQL={SYNC_FORMAT_MYSQL_RECENT_RECORDS} "
            f"BG_PROTOCOL={SYNC_PROTOCOL_DETAILS_BACKGROUND} LOCK={SYNC_INSTANCE_LOCK_NAME}"
        )
        self.logger.logger.info("="*70)
        
        try:
            self.running = True
            self._bg_thread = threading.Thread(target=self._run_background_sync, daemon=True)
            self._bg_thread.start()
            while self.running:
                inicio = time.time()
                
                self.perform_sync()
                
                tempo_decorrido = time.time() - inicio
                if tempo_decorrido < self.config.intervalo_segundos:
                    sleep_time = self.config.intervalo_segundos - tempo_decorrido
                    for _ in range(int(sleep_time * 10)):
                        if not self.running:
                            break
                        time.sleep(0.1)
                
        except KeyboardInterrupt:
            self.logger.logger.info("\n[AVISO] Interrupcao pelo usuario")
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro fatal: {e}")
            self.logger.logger.error(traceback.format_exc())
            raise
        finally:
            self.running = False
            self.release_instance_lock()
            if hasattr(self, '_bg_thread') and self._bg_thread.is_alive():
                self.logger.logger.info("Aguardando finalização do thread de segundo plano...")
                self._bg_thread.join(timeout=5.0)
            self.conn_mgr.close_all()
            self.logger.logger.info("[FIM] Conexoes fechadas")
    
    def stop(self):
        self.logger.logger.info("Solicitando parada da sincronização...")
        self.running = False


#=====================================================================
# MAIN
#=====================================================================

def main():
    print("="*70)
    print(" Sistema de Sincronizacao Unidirecional Access (MDB) -> MySQL")
    print(" Tabela: tabandamento | Versao Adaptada v2.1 (Ano >= 2024)")
    print("="*70)

    try:
        config = Config.load()
        sync = AndamentosSynchronizer(config)
        sync.run_continuous()
    except KeyboardInterrupt:
        print("\n[AVISO] Interrupcao pelo usuario")
    except Exception:
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
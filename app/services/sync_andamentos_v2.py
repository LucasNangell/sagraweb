"""
Sistema de Sincronização Bidirecional MySQL ↔ Access (MDB) - VERSÃO ADAPTADA v2.1
==================================================================================
Atualização: Filtro de segurança (AnoProtocoloLink >= 2024)

Sincroniza a tabela 'tabandamento' entre MySQL e dois bancos Access,
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
from logging.handlers import RotatingFileHandler
import time
import sys
from pathlib import Path
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set
from dataclasses import dataclass
import traceback
import requests
import sys

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
        backend_dir = Path(__file__).resolve().parents[1] / "backend"
        if str(backend_dir) not in sys.path:
            sys.path.insert(0, str(backend_dir))
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
            dias_monitoramento=30, # Default logic kept
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
    
    def get_mysql(self):
        if not self.mysql_conn or not self.mysql_conn.is_connected():
            self.mysql_conn = mysql.connector.connect(
                host=self.config.mysql_host,
                port=self.config.mysql_port,
                user=self.config.mysql_user,
                password=self.config.mysql_password,
                database=self.config.mysql_database,
                charset='utf8mb4',
                autocommit=False
            )
            
            # [FIX] Evitar erro 1412 (Table definition has changed) ao acessar tabelas que sofrem TRUNCATE
            try:
                cursor = self.mysql_conn.cursor()
                cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
                cursor.close()
            except Exception as e_iso:
                logging.getLogger(__name__).warning(
                    "Não foi possível definir READ COMMITTED na sessão MySQL: %s", e_iso
                )
        return self.mysql_conn
    
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
            except Exception as e_close:
                logging.getLogger(__name__).warning("Erro ao fechar conexão: %s", e_close)


#=====================================================================
# LOGGER
#=====================================================================

_LOG_MAX_BYTES = 10 * 1024 * 1024
_LOG_BACKUP_COUNT = 5


def _setup_sync_file_logger(name: str, filename: str) -> logging.Logger:
    project_root = Path(__file__).resolve().parents[2]
    log_dir = project_root / "logs" / "sync"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / filename

    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

    if not any(
        isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", "") == str(log_path)
        for h in logger.handlers
    ):
        handler = RotatingFileHandler(
            log_path,
            maxBytes=_LOG_MAX_BYTES,
            backupCount=_LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    if not any(isinstance(h, logging.StreamHandler) for h in logger.handlers):
        console = logging.StreamHandler()
        console.setFormatter(formatter)
        logger.addHandler(console)

    return logger


class SyncLogger:
    def __init__(self, conn_mgr: ConnectionManager):
        self.conn_mgr = conn_mgr

        self.logger = _setup_sync_file_logger("sagra.sync.andamentos", "sync_andamentos.log")
        _setup_sync_file_logger("sagra.sync.synlog", "synlog.txt")
        
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
            if tipo in ['INSERT', 'DELETE']:
                msg = f"[SYNC] {tipo}: {codstatus} | Protocolo {nro}/{ano} | {origem} -> {destino}"
                if not sucesso:
                    msg += f" | [ERRO] {erro}"
                if not sucesso:
                    msg += f" | [ERRO] {erro}"
                self.logger.info(msg)
                
                # [NOVO] Notificar API WebSocket
                if sucesso:
                    self.notify_api(nro, ano, f"sync_{tipo.lower()}")
                
        except Exception as e:
            self.logger.error(f"[ERRO] Erro ao gravar log: {e}")

    def notify_api(self, nro: int, ano: int, action: str):
        """
        Envia notificação para a API disparar WebSocket.
        Fire-and-forget (não bloqueia nem quebra o sync se falhar).
        """
        if not nro or not ano:
            return

        try:
            # Tenta notificar a API local
            from config_manager import config_manager
            api_base = config_manager.get_api_internal_base()
            url = f"{api_base}/realtime/notify"
            # Se for IP da rede (ex 10.1.1.73), usa ele mesmo
            
            import requests # Import local para garantir
            payload = {
                "type": "system_update",
                "id": nro,
                "ano": ano,
                "action": action,
                "origem": "sync_bot"
            }
            headers = {}
            try:
                from security.notify_auth import notify_request_headers
                headers = notify_request_headers()
            except Exception:
                pass
            # Timeout curto para não segurar o sync
            requests.post(url, json=payload, headers=headers, timeout=0.5)
            # self.logger.info(f"[NOTIFY] Enviado update para {nro}/{ano}")
        except Exception:
            # Silencia erro de conexão para não poluir log, 
            # já que a API pode estar reiniciando ou fora.
            pass


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
        try:
            data_limite = datetime.now() - timedelta(days=30)
            self._format_mysql_records(data_limite)
            self._format_mdb_records(self.conn_mgr.get_mdb_os(), data_limite, "OS_Atual")
            self._format_mdb_records(self.conn_mgr.get_mdb_pap(), data_limite, "Papelaria")
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao formatar registros recentes: {e}")
    
    def _format_mysql_records(self, data_limite: datetime):
        """Formata registros no MySQL"""
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor(dictionary=True)
            
            cursor.execute("""
                SELECT CodStatus, Observaçao, Ponto, Data
                FROM tabandamento
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
                    cursor.execute("""
                        UPDATE tabandamento
                        SET Observaçao = %s, Ponto = %s
                        WHERE CodStatus = %s
                    """, (obs_formatado, ponto_formatado, reg['CodStatus']))
            
            conn.commit()
            cursor.close()
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao formatar MySQL: {e}")
    
    def _format_mdb_records(self, conn: pyodbc.Connection, data_limite: datetime, nome_banco: str):
        """Formata registros no MDB"""
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
            
            # [ALTERADO] Adicionado filtro AnoProtocoloLink >= 2024
            cursor.execute("""
                SELECT 
                    CodStatus, NroProtocoloLink, AnoProtocoloLink,
                    SituacaoLink, SetorLink, Data, UltimoStatus,
                    Observaçao, Ponto
                FROM tabandamento
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
    
    def sync_os_data_from_mdb(self, nro: int, ano: int, origem: str):
        """Sincroniza dados da OS (tabProtocolos e tabDetalhesServico) do MDB para MySQL."""
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
                set_cols = [col for col in columns if col not in pk_cols]

                mysql_conn = self.conn_mgr.get_mysql()
                mysql_cursor = mysql_conn.cursor()
                mysql_cursor.execute(
                    "SELECT COUNT(*) FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                    (nro, ano)
                )
                exists = mysql_cursor.fetchone()[0] > 0
                if exists:
                    set_clause = ", ".join([f"{col} = %s" for col in set_cols])
                    params = [data[col] for col in set_cols] + [data["NroProtocolo"], data["AnoProtocolo"]]
                    mysql_cursor.execute(
                        f"UPDATE tabProtocolos SET {set_clause} WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                        params
                    )
                    self.logger.logger.info(f"[SYNC_OS] tabProtocolos atualizado: OS {nro}/{ano}")
                else:
                    col_clause = ", ".join(columns)
                    val_clause = ", ".join(["%s"] * len(columns))
                    params = [data[col] for col in columns]
                    mysql_cursor.execute(
                        f"INSERT INTO tabProtocolos ({col_clause}) VALUES ({val_clause})",
                        params
                    )
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
                set_cols = [col for col in columns if col not in pk_cols]

                mysql_conn = self.conn_mgr.get_mysql()
                mysql_cursor = mysql_conn.cursor()
                mysql_cursor.execute(
                    "SELECT COUNT(*) FROM tabDetalhesServico WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
                    (nro, ano)
                )
                exists = mysql_cursor.fetchone()[0] > 0
                if exists:
                    set_clause = ", ".join([f"{col} = %s" for col in set_cols])
                    params = [data[col] for col in set_cols] + [data["NroProtocoloLinkDet"], data["AnoProtocoloLinkDet"]]
                    mysql_cursor.execute(
                        f"UPDATE tabDetalhesServico SET {set_clause} WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
                        params
                    )
                    self.logger.logger.info(f"[SYNC_OS] tabDetalhesServico atualizado: OS {nro}/{ano}")
                else:
                    col_clause = ", ".join(columns)
                    val_clause = ", ".join(["%s"] * len(columns))
                    params = [data[col] for col in columns]
                    mysql_cursor.execute(
                        f"INSERT INTO tabDetalhesServico ({col_clause}) VALUES ({val_clause})",
                        params
                    )
                    self.logger.logger.info(f"[SYNC_OS] tabDetalhesServico inserido: OS {nro}/{ano} de {origem}")
                mysql_conn.commit()
                mysql_cursor.close()
            else:
                self.logger.logger.warning(f"[SYNC_OS] Detalhes da OS {nro}/{ano} não encontrados no {origem}")

            mdb_cursor.close()
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao sincronizar dados da OS {nro}/{ano}: {e}")

    def ensure_mysql_ultimo_status_from_mdb(self, nro: int, ano: int):
        """
        Autoridade MySQL: recalcula UltimoStatus operacional e espelha no MDB.
        Não copia flags do Access (evita promover penúltimo na corrida Web→MDB).
        """
        try:
            promoted = self._recalc_mysql_ultimo_status_operacional(nro, ano)
            self._push_ultimo_status_to_mdb(nro, ano, promoted)
            return promoted
        except Exception as e:
            self.logger.logger.error(
                f"[ERRO] Erro ao alinhar UltimoStatus MySQL+MDB em {nro}/{ano}: {e}"
            )
            return None

    def _recalc_mysql_ultimo_status_operacional(self, nro: int, ano: int):
        """Promove o último operacional no MySQL (exclui espelhos quando possível)."""
        try:
            from services.andamento_operacional import recalc_ultimo_status_operacional

            conn = self.conn_mgr.get_mysql()
            cur = conn.cursor(dictionary=True)
            try:
                promoted = recalc_ultimo_status_operacional(cur, nro, ano)
                conn.commit()
                return promoted
            except Exception:
                conn.rollback()
                raise
            finally:
                cur.close()
        except ImportError:
            pass

        conn = self.conn_mgr.get_mysql()
        cur = conn.cursor(dictionary=True)
        try:
            cur.execute(
                """
                UPDATE tabandamento SET UltimoStatus = FALSE
                WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
                """,
                (nro, ano),
            )
            cur.execute(
                """
                SELECT a.CodStatus
                FROM tabandamento a
                WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
                  AND NOT EXISTS (
                      SELECT 1 FROM tab_os_sub_os_andamento m
                      WHERE m.cod_status_espelho IS NOT NULL
                        AND m.cod_status_espelho != ''
                        AND m.cod_status_espelho COLLATE utf8mb4_general_ci
                            = a.CodStatus COLLATE utf8mb4_general_ci
                  )
                ORDER BY a.`Data` DESC,
                         CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED) DESC,
                         a.CodStatus DESC
                LIMIT 1
                """,
                (nro, ano),
            )
            row = cur.fetchone()
            promoted = row.get("CodStatus") if row else None
            if promoted:
                cur.execute(
                    "UPDATE tabandamento SET UltimoStatus = TRUE WHERE CodStatus = %s",
                    (promoted,),
                )
            conn.commit()
            return str(promoted) if promoted else None
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()

    def _push_ultimo_status_to_mdb(self, nro: int, ano: int, promoted):
        """Impõe no Access o mesmo CodStatus canônico do MySQL."""
        try:
            from routers.mdb_writer import push_os_ultimo_status_to_mdb

            push_os_ultimo_status_to_mdb(nro, ano, promoted_cod=promoted)
            return
        except Exception as exc:
            self.logger.logger.warning(
                "[ULTIMO] push via mdb_writer falhou OS %s/%s: %s — fallback local",
                nro,
                ano,
                exc,
            )

        mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
        cur = mdb_conn.cursor()
        try:
            cur.execute(
                """
                UPDATE tabandamento SET UltimoStatus = ?
                WHERE NroProtocoloLink = ? AND AnoProtocoloLink = ?
                """,
                (False, nro, ano),
            )
            if promoted:
                cur.execute(
                    "UPDATE tabandamento SET UltimoStatus = ? WHERE CodStatus = ?",
                    (True, promoted),
                )
            mdb_conn.commit()
        except Exception:
            mdb_conn.rollback()
            raise
        finally:
            cur.close()

    
    def insert_mysql(self, andamento: Dict, origem: str):
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
                return 

            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            # UltimoStatus NÃO vem do MDB — insert com 0; ensure_* redefine o canônico.
            cursor.execute("""
                INSERT INTO tabandamento
                (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink,
                 SetorLink, Data, UltimoStatus, Observaçao, Ponto)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                andamento['CodStatus'], nro, ano,
                andamento['SituacaoLink'], andamento['SetorLink'], andamento['Data'],
                False, andamento['Observaçao'],
                andamento['Ponto']
            ))
            
            conn.commit()
            cursor.close()
            
            self.logger.log(
                'INSERT', origem, 'MySQL', andamento['CodStatus'],
                nro, ano,
                'Novo andamento sincronizado'
            )
        except Exception as e:
            conn.rollback()
            self.logger.log(
                'INSERT', origem, 'MySQL', andamento.get('CodStatus'),
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                sucesso=False, erro=str(e)
            )
    
    def insert_mdb(self, andamento: Dict, conn: pyodbc.Connection, destino: str):
        """Insere registro no MDB, mas apenas se NÃO estiver na lista de exclusões."""
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

    def delete_mysql(self, codstatus: str, andamento: Dict):
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
            
            cursor.execute("DELETE FROM tabandamento WHERE CodStatus = %s", (codstatus,))

            cursor.execute("DELETE FROM deleted_andamentos WHERE codstatus = %s", (codstatus,))
            
            conn.commit()
            cursor.close()
            
            self.logger.log(
                'DELETE', 'MDB', 'MySQL', codstatus,
                nro, ano,
                'Exclusão propagada e removida de deleted_andamentos'
            )
        except Exception as e:
            conn.rollback()
            self.logger.log(
                'DELETE', 'MDB', 'MySQL', codstatus,
                sucesso=False, erro=str(e)
            )
    
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
        """Alinha UltimoStatus no MySQL e no MDB (mesma regra do ensure_*)."""
        self.ensure_mysql_ultimo_status_from_mdb(nro, ano)

    def perform_sync(self):
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
                    self.sync_os_data_from_mdb(and_['NroProtocoloLink'], and_['AnoProtocoloLink'], origem)

                    self.insert_mysql(and_, origem)
                    self.ensure_mysql_ultimo_status_from_mdb(and_['NroProtocoloLink'], and_['AnoProtocoloLink'])
            
            # MySQL → MDB (novos)
            novos_no_mysql = mysql_codes - mdb_all_codes
            for code in novos_no_mysql:
                if self.is_deleted(code):
                    continue
                    
                and_ = next((a for a in mysql_data if a['CodStatus'] == code), None)
                
                if and_:
                    nro = and_['NroProtocoloLink']
                    mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
                    destino = self.conn_mgr.get_mdb_name_by_nro(nro)
                    
                    self.insert_mdb(and_, mdb_conn, destino)
                    self.update_ultimo_status(nro, and_['AnoProtocoloLink'])
            
            # PASSO 3: EXECUTAR EXCLUSÕES NO MYSQL
            if excluidos:
                for code in excluidos:
                    and_ = next((a for a in mysql_data if a['CodStatus'] == code), None)
                    if and_:
                        self.delete_mysql(code, and_)
                        self.ensure_mysql_ultimo_status_from_mdb(
                            and_['NroProtocoloLink'],
                            and_['AnoProtocoloLink']
                        )
            
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
    
    def run_continuous(self):
        self.logger.logger.info("="*70)
        self.logger.logger.info("[INICIO] SINCRONIZACAO BIDIRECIONAL INICIADA")
        self.logger.logger.info(f"[INFO] Monitorando ultimos {self.config.dias_monitoramento} dias")
        self.logger.logger.info(f"[INFO] Filtro de Ano: APENAS REGISTROS >= 2024")
        self.logger.logger.info(f"[INFO] Intervalo: {self.config.intervalo_segundos}s")
        self.logger.logger.info("="*70)
        
        try:
            self.running = True
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
    print(" Sistema de Sincronizacao Bidirecional MySQL <-> Access (MDB)")
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
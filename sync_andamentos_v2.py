"""
Sistema de Sincronização Bidirecional MySQL ↔ Access (MDB) - VERSÃO ADAPTADA
==============================================================================

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
import time
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import traceback

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
    mdb_os_atual_path: str
    mdb_papelaria_path: str
    dias_monitoramento: int = 30
    intervalo_segundos: float = 2.0
    
    @classmethod
    def load(cls, filepath='config.json'):
        with open(filepath, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        return cls(
            mysql_host=cfg.get('db_host', 'localhost'),
            mysql_port=cfg.get('db_port', 3306),
            mysql_user=cfg.get('db_user', 'root'),
            mysql_password=cfg.get('db_password', ''),
            mysql_database=cfg.get('db_name', 'sagrafulldb'),
            mdb_os_atual_path=cfg.get('mdb_os_atual_path'),
            mdb_papelaria_path=cfg.get('mdb_papelaria_path'),
            dias_monitoramento=cfg.get('dias_monitoramento', 30),
            intervalo_segundos=cfg.get('intervalo_verificacao_segundos', 2.0)
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
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
        # Criar tabelas de log
        self._create_log_tables()
    
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
            # Esta tabela registra todos os CodStatus que foram excluídos
            # e NUNCA devem ser reinseridos automaticamente
            # 
            # IMPORTANTE: content_hash permite distinguir:
            # - Ressurreição (mesmo hash) → BLOQUEAR
            # - Novo registro legítimo (hash diferente) → PERMITIR
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
                self.logger.info(msg)
                
        except Exception as e:
            self.logger.error(f"[ERRO] Erro ao gravar log: {e}")


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
    
    # ===================================================================
    # CONTROLE DE EXCLUSÕES DEFINITIVAS
    # ===================================================================
    
    def _calculate_content_hash(self, andamento: Dict) -> str:
        """
        Calcula hash SHA256 do conteúdo do registro (exceto CodStatus, NroProtocoloLink, AnoProtocoloLink).
        Isso permite distinguir ressurreição de novo registro legítimo.
        """
        # Campos que identificam o conteúdo do andamento
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
        
        Retorna:
        - True: É ressurreição (BLOQUEAR)
        - False: É novo registro ou não está excluído (PERMITIR)
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
            
            # Calcular hash se andamento foi fornecido
            content_hash = None
            if andamento:
                content_hash = self._calculate_content_hash(andamento)
            
            # Inserir ou atualizar registro de exclusão
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
                # Fallback sem hash (para compatibilidade)
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
    
    def detect_and_register_deletions(self, mysql_codes: set, mdb_all_codes: set):
        """
        Detecta exclusões comparando:
        - O que existe no MySQL
        - O que existia no cache (estava no MDB anteriormente)
        - O que existe no MDB atual
        
        Se um CodStatus:
        - Está no MySQL
        - Estava no cache (estava no MDB antes)
        - NÃO está mais no MDB atual
        
        Então foi EXCLUÍDO do MDB e deve ser:
        1. Registrado em deleted_andamentos
        2. Excluído do MySQL
        
        IMPORTANTE: Aplica-se APENAS a tabandamento, não a tabProtocolos ou tabDetalhesServico.
        """
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                conn = self.conn_mgr.get_mysql()
                cursor = conn.cursor(dictionary=True)
                
                # Buscar cache completo
                cursor.execute("SELECT codstatus, nro, ano, origem FROM cache_andamentos_mdb")
                cache = {row['codstatus']: row for row in cursor.fetchall()}
                cache_codes = set(cache.keys())
                
                # Registros que estão no MySQL E estavam no cache MAS não estão mais no MDB
                # Isso significa: foram excluídos do MDB
                excluidos_no_mdb = (mysql_codes & cache_codes) - mdb_all_codes
                
                for codstatus in excluidos_no_mdb:
                    cache_entry = cache[codstatus]
                    
                    # Buscar dados completos do registro no MySQL para calcular hash
                    cursor.execute("""
                        SELECT * FROM tabandamento WHERE CodStatus = %s
                    """, (codstatus,))
                    andamento_data = cursor.fetchone()
                    
                    # Marcar como excluído definitivamente COM hash
                    self.mark_as_deleted(
                        codstatus, 
                        cache_entry['nro'], 
                        cache_entry['ano'], 
                        cache_entry['origem'],
                        andamento_data,  # Passar dados para calcular hash
                        f"Excluído do {cache_entry['origem']}"
                    )
                    
                    self.logger.logger.info(
                        f"[DETECÇÃO] CodStatus {codstatus} foi excluído do MDB "
                        f"(Protocolo {cache_entry['nro']}/{cache_entry['ano']} - {cache_entry['origem']})"
                    )
                
                cursor.close()
                return excluidos_no_mdb
                
            except Exception as e:
                error_msg = str(e)
                if "Table definition has changed" in error_msg and retry_count < max_retries - 1:
                    retry_count += 1
                    self.logger.logger.warning(
                        f"[RETRY] Erro de transação (tentativa {retry_count}/{max_retries}): {error_msg}"
                    )
                    time.sleep(0.5)  # Aguardar antes de tentar novamente
                    continue
                else:
                    self.logger.logger.error(f"[ERRO] Erro ao detectar exclusões: {e}")
                    return set()
        
        return set()
    
    def get_data_limite(self) -> datetime:
        return datetime.now() - timedelta(days=self.config.dias_monitoramento)
    
    def format_observacao(self, observacao: str, data: datetime) -> str:
        """Formata o campo Observacao conforme logica VBA do Access"""
        if not observacao or not data:
            return observacao
        
        obs = observacao.strip()
        if not obs:
            return observacao
        
        # Se primeiro caractere nao e numerico
        if not obs[0].isdigit():
            # Se nao contem "Entregue"
            if "Entregue" not in obs:
                # Adicionar hora no inicio
                hora = data.strftime("%H")
                minuto = data.strftime("%M")
                return f"{hora}h{minuto}\r\n{obs}"
        else:
            # Se primeiro caractere e numerico e nao tem quebra de linha
            if "\r" not in obs and "\n" not in obs:
                # Determinar posicao do corte (5 ou 6 caracteres)
                x = 5
                if len(obs) > x and obs[x-1].isdigit():
                    x = 6
                x = x - 1
                
                # Se tem mais de 6 caracteres, adicionar quebra
                if len(obs) > 6:
                    return f"{obs[:x]}\r\n{obs[x:]}"
        
        return observacao
    
    def format_ponto(self, ponto: str) -> str:
        """Formata o campo Ponto adicionando ponto decimal se necessario"""
        if not ponto:
            return ponto
        
        ponto_str = str(ponto).strip()
        
        # Se nao tem ponto e tem mais de 3 caracteres
        if "." not in ponto_str and len(ponto_str) > 3:
            # Inserir ponto 3 caracteres antes do final
            return f"{ponto_str[:-3]}.{ponto_str[-3:]}"
        
        return ponto_str
    
    def apply_formatting_to_recent_records(self):
        """Aplica formatacao aos registros do mes atual em todos os bancos"""
        try:
            # Data limite: mes anterior (30 dias atras)
            data_limite = datetime.now() - timedelta(days=30)
            
            # Formatar MySQL
            self._format_mysql_records(data_limite)
            
            # Formatar MDB OS Atual
            self._format_mdb_records(self.conn_mgr.get_mdb_os(), data_limite, "OS_Atual")
            
            # Formatar MDB Papelaria
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
                
                # Atualizar se houver mudanca
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
                
                # Atualizar se houver mudanca
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
            
            cursor.execute("""
                SELECT 
                    CodStatus, NroProtocoloLink, AnoProtocoloLink,
                    SituacaoLink, SetorLink, Data, UltimoStatus,
                    Observaçao, Ponto
                FROM tabandamento
                WHERE Data >= %s AND CodStatus IS NOT NULL
                ORDER BY CodStatus
            """, (data_limite,))
            
            result = cursor.fetchall()
            cursor.close()
            return result
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao ler MySQL: {e}")
            return []
    
    def read_mdb(self, conn: pyodbc.Connection) -> List[Dict]:
        try:
            cursor = conn.cursor()
            
            data_limite = self.get_data_limite()
            
            cursor.execute("""
                SELECT 
                    CodStatus, NroProtocoloLink, AnoProtocoloLink,
                    SituacaoLink, SetorLink, Data, UltimoStatus,
                    Observaçao, Ponto
                FROM tabandamento
                WHERE Data >= ?
                ORDER BY CodStatus
            """, (data_limite,))
            
            columns = [col[0] for col in cursor.description]
            result = []
            for row in cursor.fetchall():
                result.append(dict(zip(columns, row)))
            
            cursor.close()
            return result
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao ler MDB: {e}")
            return []
    
    def update_cache(self, andamentos_os: List[Dict], andamentos_pap: List[Dict]):
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            cursor.execute("TRUNCATE TABLE cache_andamentos_mdb")
            
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
        """
        Sincroniza dados da OS (tabProtocolos e tabDetalhesServico) do MDB para MySQL.
        Chamado quando um novo andamento é detectado para garantir que os dados da OS existam.
        """
        try:
            # Obter conexão MDB apropriada
            mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
            mdb_cursor = mdb_conn.cursor()
            
            # ===== 1. SINCRONIZAR tabProtocolos =====
            mdb_cursor.execute("""
                SELECT NroProtocolo, AnoProtocolo, NomeUsuario, EntregData, EntregPrazoLink
                FROM tabProtocolos
                WHERE NroProtocolo = ? AND AnoProtocolo = ?
            """, (nro, ano))
            
            protocolo = mdb_cursor.fetchone()
            
            if protocolo:
                mysql_conn = self.conn_mgr.get_mysql()
                mysql_cursor = mysql_conn.cursor()
                
                # Verificar se já existe no MySQL
                mysql_cursor.execute("""
                    SELECT COUNT(*) FROM tabProtocolos 
                    WHERE NroProtocolo = %s AND AnoProtocolo = %s
                """, (nro, ano))
                
                exists = mysql_cursor.fetchone()[0] > 0
                
                if exists:
                    # UPDATE
                    mysql_cursor.execute("""
                        UPDATE tabProtocolos 
                        SET NomeUsuario = %s, EntregData = %s, EntregPrazoLink = %s
                        WHERE NroProtocolo = %s AND AnoProtocolo = %s
                    """, (protocolo.NomeUsuario, protocolo.EntregData, protocolo.EntregPrazoLink, nro, ano))
                    self.logger.logger.info(f"[SYNC_OS] tabProtocolos atualizado: OS {nro}/{ano}")
                else:
                    # INSERT
                    mysql_cursor.execute("""
                        INSERT INTO tabProtocolos 
                        (NroProtocolo, AnoProtocolo, NomeUsuario, EntregData, EntregPrazoLink)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (nro, ano, protocolo.NomeUsuario, protocolo.EntregData, protocolo.EntregPrazoLink))
                    self.logger.logger.info(f"[SYNC_OS] tabProtocolos inserido: OS {nro}/{ano} de {origem}")
                
                mysql_conn.commit()
                mysql_cursor.close()
            else:
                self.logger.logger.warning(f"[SYNC_OS] OS {nro}/{ano} não encontrada em tabProtocolos do {origem}")
            
            # ===== 2. SINCRONIZAR tabDetalhesServico =====
            mdb_cursor.execute("""
                SELECT NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo, TipoPublicacaoLink, Tiragem
                FROM tabDetalhesServico
                WHERE NroProtocoloLinkDet = ? AND AnoProtocoloLinkDet = ?
            """, (nro, ano))
            
            detalhes = mdb_cursor.fetchone()
            
            if detalhes:
                mysql_conn = self.conn_mgr.get_mysql()
                mysql_cursor = mysql_conn.cursor()
                
                # Verificar se já existe no MySQL
                mysql_cursor.execute("""
                    SELECT COUNT(*) FROM tabDetalhesServico 
                    WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
                """, (nro, ano))
                
                exists = mysql_cursor.fetchone()[0] > 0
                
                if exists:
                    # UPDATE
                    mysql_cursor.execute("""
                        UPDATE tabDetalhesServico 
                        SET Titulo = %s, TipoPublicacaoLink = %s, Tiragem = %s
                        WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
                    """, (detalhes.Titulo, detalhes.TipoPublicacaoLink, detalhes.Tiragem, nro, ano))
                    self.logger.logger.info(f"[SYNC_OS] tabDetalhesServico atualizado: OS {nro}/{ano}")
                else:
                    # INSERT
                    mysql_cursor.execute("""
                        INSERT INTO tabDetalhesServico 
                        (NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo, TipoPublicacaoLink, Tiragem)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (nro, ano, detalhes.Titulo, detalhes.TipoPublicacaoLink, detalhes.Tiragem))
                    self.logger.logger.info(f"[SYNC_OS] tabDetalhesServico inserido: OS {nro}/{ano} de {origem}")
                
                mysql_conn.commit()
                mysql_cursor.close()
            else:
                self.logger.logger.warning(f"[SYNC_OS] Detalhes da OS {nro}/{ano} não encontrados no {origem}")
            
            mdb_cursor.close()
            
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao sincronizar dados da OS {nro}/{ano}: {e}")
    
    def insert_mysql(self, andamento: Dict, origem: str):
        """
        Insere registro no MySQL, mas apenas se NÃO estiver na lista de exclusões.
        BLOQUEIO DE REINSERÇÃO: Registros excluídos nunca voltam.
        
        IMPORTANTE: Também sincroniza dados da OS (tabProtocolos e tabDetalhesServico)
        quando um novo andamento é inserido.
        """
        try:
            codstatus = andamento['CodStatus']
            nro = andamento['NroProtocoloLink']
            ano = andamento['AnoProtocoloLink']
            
            # ===================================================================
            # VERIFICAÇÃO CRÍTICA: Bloquear RESSURREIÇÃO de registros excluídos
            # MAS permitir NOVOS registros legítimos (mesmo CodStatus, conteúdo diferente)
            # ===================================================================
            if self.is_resurrection(codstatus, andamento):
                # Throttle de avisos: só logar a cada 5 minutos para o mesmo CodStatus
                current_time = time.time()
                last_warning = self._blocked_warnings_cache.get(codstatus, 0)
                
                if current_time - last_warning >= self._blocked_warning_interval:
                    self.logger.logger.warning(
                        f"[BLOQUEADO] CodStatus {codstatus} é RESSURREIÇÃO de registro excluído. "
                        f"Inserções bloqueadas continuamente (aviso a cada 5min)."
                    )
                    self._blocked_warnings_cache[codstatus] = current_time
                
                # Log detalhado sempre (para estatísticas)
                self.logger.log(
                    'INSERT_BLOCKED', origem, 'MySQL', codstatus,
                    nro, ano,
                    'Bloqueado: ressurreição de registro excluído'
                )
                return  # NÃO INSERIR
            
            # ===================================================================
            # PASSO 1: Sincronizar dados da OS (tabProtocolos e tabDetalhesServico)
            # Isso garante que quando um novo andamento aparece, os dados da OS
            # também estejam disponíveis no MySQL para a API
            # ===================================================================
            self.sync_os_data_from_mdb(nro, ano, origem)
            
            # ===================================================================
            # PASSO 2: Inserir o andamento
            # ===================================================================
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO tabandamento
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
                f'Novo andamento + Dados da OS sincronizados de {origem}'
            )
        except Exception as e:
            conn.rollback()
            self.logger.log(
                'INSERT', origem, 'MySQL', andamento.get('CodStatus'),
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                sucesso=False, erro=str(e)
            )
    
    def insert_mdb(self, andamento: Dict, conn: pyodbc.Connection, destino: str):
        """
        Insere registro no MDB, mas apenas se NÃO estiver na lista de exclusões.
        BLOQUEIO DE REINSERÇÃO: Registros excluídos nunca voltam.
        """
        try:
            codstatus = andamento['CodStatus']
            
            # ===================================================================
            # VERIFICAÇÃO CRÍTICA: Bloquear RESSURREIÇÃO de registros excluídos
            # MAS permitir NOVOS registros legítimos (mesmo CodStatus, conteúdo diferente)
            # ===================================================================
            if self.is_resurrection(codstatus, andamento):
                # Throttle de avisos: só logar a cada 5 minutos para o mesmo CodStatus
                current_time = time.time()
                last_warning = self._blocked_warnings_cache.get(codstatus, 0)
                
                if current_time - last_warning >= self._blocked_warning_interval:
                    self.logger.logger.warning(
                        f"[BLOQUEADO] CodStatus {codstatus} é RESSURREIÇÃO de registro excluído. "
                        f"Inserções bloqueadas continuamente (aviso a cada 5min)."
                    )
                    self._blocked_warnings_cache[codstatus] = current_time
                
                # Log detalhado sempre (para estatísticas)
                self.logger.log(
                    'INSERT_BLOCKED', 'MySQL', destino, codstatus,
                    andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                    'Bloqueado: ressurreição de registro excluído'
                )
                return  # NÃO INSERIR
            
            cursor = conn.cursor()
            
            # Preservar quebras de linha
            obs = andamento.get('Observaçao', '')
            if obs:
                obs = obs.replace('\n', '\r\n')
            
            cursor.execute("""
                INSERT INTO tabandamento
                (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink,
                 SetorLink, Data, UltimoStatus, Observaçao, Ponto)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                andamento['CodStatus'], andamento['NroProtocoloLink'],
                andamento['AnoProtocoloLink'], andamento['SituacaoLink'],
                andamento['SetorLink'], andamento['Data'],
                andamento['UltimoStatus'], obs, andamento['Ponto']
            ))
            
            conn.commit()
            cursor.close()
            
            self.logger.log(
                'INSERT', 'MySQL', destino, andamento['CodStatus'],
                andamento['NroProtocoloLink'], andamento['AnoProtocoloLink'],
                'Novo andamento'
            )
        except Exception as e:
            conn.rollback()
            self.logger.log(
                'INSERT', 'MySQL', destino, andamento.get('CodStatus'),
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                sucesso=False, erro=str(e)
            )
    
    def delete_mysql(self, codstatus: str, andamento: Dict):
        """
        Remove andamento do MySQL E registra na tabela deleted_andamentos.
        
        IMPORTANTE: Registra o hash do conteúdo para prevenir ressurreição.
        Isso garante que exclusões manuais no MySQL também sejam respeitadas.
        """
        try:
            # Backup primeiro
            self.backup_mgr.backup('MySQL', andamento)
            
            # ===================================================================
            # CORREÇÃO: Registrar exclusão ANTES de deletar
            # Isso garante que mesmo exclusões manuais no MySQL sejam respeitadas
            # ===================================================================
            nro = andamento.get('NroProtocoloLink')
            ano = andamento.get('AnoProtocoloLink')
            origem = 'MySQL'  # Origem da exclusão
            
            # Marcar como excluído com hash (previne ressurreição)
            self.mark_as_deleted(
                codstatus, 
                nro, 
                ano, 
                origem, 
                andamento=andamento,  # Passa andamento para calcular hash
                motivo='Exclusão manual no MySQL ou detectada por sync'
            )
            
            # Agora sim, deletar do MySQL
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            cursor.execute("DELETE FROM tabandamento WHERE CodStatus = %s", (codstatus,))
            
            conn.commit()
            cursor.close()
            
            self.logger.log(
                'DELETE', 'MDB', 'MySQL', codstatus,
                nro, ano,
                'Exclusão detectada e registrada em deleted_andamentos'
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
        NÃO registra em deleted_andamentos pois isso já foi feito antes.
        """
        try:
            cursor = mdb_conn.cursor()
            
            cursor.execute("""
                DELETE FROM tabandamento WHERE CodStatus = ?
            """, (codstatus,))
            
            mdb_conn.commit()
            cursor.close()
            
            self.logger.log(
                'DELETE', 'MySQL', origem, codstatus,
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                f'Excluído do {origem} para sincronizar com MySQL'
            )
        except Exception as e:
            mdb_conn.rollback()
            self.logger.log(
                'DELETE', 'MySQL', origem, codstatus,
                andamento.get('NroProtocoloLink'), andamento.get('AnoProtocoloLink'),
                sucesso=False, erro=str(e)
            )
    
    def update_ultimo_status(self, nro: int, ano: int):
        """Garante que apenas o último CodStatus tem UltimoStatus=TRUE"""
        try:
            # MySQL
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE tabandamento 
                SET UltimoStatus = FALSE 
                WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
            """, (nro, ano))
            
            cursor.execute("""
                UPDATE tabandamento 
                SET UltimoStatus = TRUE 
                WHERE CodStatus = (
                    SELECT MAX(CodStatus) 
                    FROM (SELECT CodStatus FROM tabandamento 
                          WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s) AS sub
                )
            """, (nro, ano))
            
            conn.commit()
            cursor.close()
            
            # MDB correspondente
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
    
    def perform_sync(self):
        try:
            # Ler todos os dados
            mysql_data = self.read_mysql()
            mdb_os_data = self.read_mdb(self.conn_mgr.get_mdb_os())
            mdb_pap_data = self.read_mdb(self.conn_mgr.get_mdb_pap())
            
            # Criar sets de CodStatus
            mysql_codes = {a['CodStatus'] for a in mysql_data}
            mdb_os_codes = {a['CodStatus'] for a in mdb_os_data}
            mdb_pap_codes = {a['CodStatus'] for a in mdb_pap_data}
            mdb_all_codes = mdb_os_codes | mdb_pap_codes
            
            # ===================================================================
            # PASSO 1: DETECTAR E REGISTRAR EXCLUSÕES
            # Antes de qualquer operação, detectar o que foi excluído do MDB
            # comparando com o cache (estado anterior)
            # ===================================================================
            excluidos = self.detect_and_register_deletions(mysql_codes, mdb_all_codes)
            
            # Atualizar cache APÓS detectar exclusões
            self.update_cache(mdb_os_data, mdb_pap_data)
            
            # MDB → MySQL (novos)
            novos_no_mdb = mdb_all_codes - mysql_codes
            for code in novos_no_mdb:
                # ===================================================================
                # CORREÇÃO: Verificar se o código está na lista de exclusões
                # ANTES de tentar reinserir no MySQL.
                # Isso evita ressurreição de registros excluídos no MySQL.
                # ===================================================================
                if self.is_deleted(code):
                    # Log throttled (já implementado em insert_mysql via is_resurrection)
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
                    self.insert_mysql(and_, origem)
                    self.update_ultimo_status(and_['NroProtocoloLink'], and_['AnoProtocoloLink'])
            
            # MySQL → MDB (novos)
            # Inserir no MDB apenas registros que não estão na lista de exclusões
            novos_no_mysql = mysql_codes - mdb_all_codes
            for code in novos_no_mysql:
                # Pular se está na lista de excluídos
                if self.is_deleted(code):
                    continue
                    
                and_ = next((a for a in mysql_data if a['CodStatus'] == code), None)
                
                if and_:
                    nro = and_['NroProtocoloLink']
                    mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
                    destino = self.conn_mgr.get_mdb_name_by_nro(nro)
                    
                    self.insert_mdb(and_, mdb_conn, destino)
                    self.update_ultimo_status(nro, and_['AnoProtocoloLink'])
            
            # ===================================================================
            # PASSO 3: EXECUTAR EXCLUSÕES NO MYSQL
            # Registros que foram detectados como excluídos devem ser removidos
            # do MySQL para manter consistência
            # ===================================================================
            if excluidos:
                for code in excluidos:
                    and_ = next((a for a in mysql_data if a['CodStatus'] == code), None)
                    if and_:
                        self.delete_mysql(code, and_)
                        self.update_ultimo_status(and_['NroProtocoloLink'], and_['AnoProtocoloLink'])
            
            # ===================================================================
            # PASSO 3.5: REPLICAR EXCLUSÕES DO MYSQL PARA O MDB
            # Se um registro foi excluído do MySQL (via frontend), replicar no MDB
            # ===================================================================
            for code in list(mdb_all_codes):
                if self.is_deleted(code) and code in mdb_all_codes:
                    # Buscar andamento no MDB para excluir
                    and_mdb = None
                    for a in mdb_os_data:
                        if a['CodStatus'] == code:
                            and_mdb = a
                            mdb_conn = self.conn_mgr.get_mdb_os()
                            origem = 'OS_Atual'
                            break
                    
                    if not and_mdb:
                        for a in mdb_pap_data:
                            if a['CodStatus'] == code:
                                and_mdb = a
                                mdb_conn = self.conn_mgr.get_mdb_pap()
                                origem = 'Papelaria'
                                break
                    
                    if and_mdb:
                        self.delete_mdb(code, and_mdb, mdb_conn, origem)
            
            # ===================================================================
            # PASSO 4: DETECTAR EXCLUSÕES MANUAIS NO MYSQL
            # DESABILITADO: A detecção via cache já faz isso de forma mais eficiente
            # Ver: detect_and_register_deletions() que usa cache_andamentos_mdb
            # ===================================================================
            
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
    
    def run_continuous(self):
        self.logger.logger.info("="*70)
        self.logger.logger.info("[INICIO] SINCRONIZACAO BIDIRECIONAL INICIADA")
        self.logger.logger.info(f"[INFO] Monitorando ultimos {self.config.dias_monitoramento} dias")
        self.logger.logger.info(f"[INFO] Intervalo: {self.config.intervalo_segundos}s")
        self.logger.logger.info("="*70)
        
        try:
            while True:
                inicio = time.time()
                
                self.perform_sync()
                
                tempo_decorrido = time.time() - inicio
                if tempo_decorrido < self.config.intervalo_segundos:
                    time.sleep(self.config.intervalo_segundos - tempo_decorrido)
                
        except KeyboardInterrupt:
            self.logger.logger.info("\n[AVISO] Interrupcao pelo usuario")
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro fatal: {e}")
            self.logger.logger.error(traceback.format_exc())
        finally:
            self.conn_mgr.close_all()
            self.logger.logger.info("[FIM] Conexoes fechadas")


#=====================================================================
# MAIN
#=====================================================================

def main():
    print("="*70)
    print(" Sistema de Sincronizacao Bidirecional MySQL <-> Access (MDB)")
    print(" Tabela: tabandamento | Versao Adaptada v2.0")
    print("="*70)
    
    config = Config.load()
    sync = AndamentosSynchronizer(config)
    sync.run_continuous()


if __name__ == "__main__":
    main()

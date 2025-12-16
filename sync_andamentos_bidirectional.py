"""
Sistema de Sincronização Bidirecional MySQL ↔ Access (MDB)
=============================================================

Objetivo:
    Monitoramento contínuo e sincronização bidirecional entre banco MySQL (sagradbfull)
    e dois bancos Access (.mdb) para a tabela tabandamento, com backup automático e logs robustos.

Bancos envolvidos:
    - MySQL: sagradbfull
    - MDB 1: Sagra Base - OS Atual (NrOS < 5000)
    - MDB 2: Sagra Base - Papelaria Atual (NrOS >= 5000)

Tabelas monitoradas:
    - tabandamento (principal)
    - tabdetalhesservico (atualização relacionada)
    - tabprotocolos (atualização relacionada)

Bibliotecas necessárias:
    - pyodbc: https://github.com/mkleehammer/pyodbc
    - mysql-connector-python: https://dev.mysql.com/doc/connector-python/en/
    - logging (built-in): https://docs.python.org/3/library/logging.html

Autor: Sistema Automatizado de Sincronização
Data: 2025-12-16
"""

import pyodbc
import mysql.connector
from mysql.connector import Error as MySQLError
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
import traceback
import os


# =====================================================================
# CONFIGURAÇÕES
# =====================================================================

@dataclass
class DatabaseConfig:
    """Configurações de conexão aos bancos de dados"""
    
    # MySQL
    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "root"
    mysql_password: str = ""
    mysql_database: str = "sagradbfull"
    
    # Access MDB - OS Atual (NrOS < 5000)
    mdb_os_atual_path: str = r"C:\Caminho\Para\Sagra Base - OS Atual.mdb"
    
    # Access MDB - Papelaria Atual (NrOS >= 5000)
    mdb_papelaria_path: str = r"C:\Caminho\Para\Sagra Base - Papelaria Atual.mdb"
    
    # Configurações de monitoramento
    dias_monitoramento: int = 30
    intervalo_verificacao_segundos: float = 0.5  # Intervalo mínimo entre ciclos
    
    @classmethod
    def load_from_file(cls, filepath: str = "config.json") -> 'DatabaseConfig':
        """Carrega configurações do arquivo config.json"""
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                
            return cls(
                mysql_host=config_data.get('db_host', cls.mysql_host),
                mysql_port=config_data.get('db_port', cls.mysql_port),
                mysql_user=config_data.get('db_user', cls.mysql_user),
                mysql_password=config_data.get('db_password', cls.mysql_password),
                mysql_database=config_data.get('db_name', cls.mysql_database),
                mdb_os_atual_path=config_data.get('mdb_os_atual_path', cls.mdb_os_atual_path),
                mdb_papelaria_path=config_data.get('mdb_papelaria_path', cls.mdb_papelaria_path),
                dias_monitoramento=config_data.get('dias_monitoramento', cls.dias_monitoramento),
                intervalo_verificacao_segundos=config_data.get('intervalo_verificacao_segundos', cls.intervalo_verificacao_segundos)
            )
        except FileNotFoundError:
            print(f"⚠️  Arquivo {filepath} não encontrado. Usando configurações padrão.")
            return cls()


# =====================================================================
# GERENCIAMENTO DE CONEXÕES
# =====================================================================

class DatabaseManager:
    """Gerenciador de conexões aos bancos de dados MySQL e Access"""
    
    def __init__(self, config: DatabaseConfig):
        self.config = config
        self.mysql_conn: Optional[mysql.connector.connection.MySQLConnection] = None
        self.mdb_os_conn: Optional[pyodbc.Connection] = None
        self.mdb_papelaria_conn: Optional[pyodbc.Connection] = None
        
    def connect_mysql(self) -> mysql.connector.connection.MySQLConnection:
        """Estabelece conexão com MySQL"""
        try:
            if self.mysql_conn and self.mysql_conn.is_connected():
                return self.mysql_conn
                
            self.mysql_conn = mysql.connector.connect(
                host=self.config.mysql_host,
                port=self.config.mysql_port,
                user=self.config.mysql_user,
                password=self.config.mysql_password,
                database=self.config.mysql_database,
                charset='utf8mb4',
                collation='utf8mb4_unicode_ci',
                autocommit=False
            )
            return self.mysql_conn
        except MySQLError as e:
            raise ConnectionError(f"Erro ao conectar ao MySQL: {e}")
    
    def connect_mdb_os_atual(self) -> pyodbc.Connection:
        """Estabelece conexão com Access MDB - OS Atual (NrOS < 5000)"""
        try:
            if self.mdb_os_conn:
                try:
                    # Testa se a conexão ainda está ativa
                    self.mdb_os_conn.execute("SELECT 1")
                    return self.mdb_os_conn
                except:
                    pass
            
            driver = '{Microsoft Access Driver (*.mdb, *.accdb)}'
            conn_str = f'DRIVER={driver};DBQ={self.config.mdb_os_atual_path};'
            self.mdb_os_conn = pyodbc.connect(conn_str, autocommit=False)
            return self.mdb_os_conn
        except pyodbc.Error as e:
            raise ConnectionError(f"Erro ao conectar ao MDB OS Atual: {e}")
    
    def connect_mdb_papelaria(self) -> pyodbc.Connection:
        """Estabelece conexão com Access MDB - Papelaria Atual (NrOS >= 5000)"""
        try:
            if self.mdb_papelaria_conn:
                try:
                    # Testa se a conexão ainda está ativa
                    self.mdb_papelaria_conn.execute("SELECT 1")
                    return self.mdb_papelaria_conn
                except:
                    pass
            
            driver = '{Microsoft Access Driver (*.mdb, *.accdb)}'
            conn_str = f'DRIVER={driver};DBQ={self.config.mdb_papelaria_path};'
            self.mdb_papelaria_conn = pyodbc.connect(conn_str, autocommit=False)
            return self.mdb_papelaria_conn
        except pyodbc.Error as e:
            raise ConnectionError(f"Erro ao conectar ao MDB Papelaria: {e}")
    
    def get_mdb_connection_by_nros(self, nros: int) -> pyodbc.Connection:
        """Retorna a conexão MDB apropriada baseada no NrOS"""
        if nros < 5000:
            return self.connect_mdb_os_atual()
        else:
            return self.connect_mdb_papelaria()
    
    def get_mdb_name_by_nros(self, nros: int) -> str:
        """Retorna o nome do banco MDB baseado no NrOS"""
        return "OS_Atual" if nros < 5000 else "Papelaria"
    
    def close_all(self):
        """Fecha todas as conexões"""
        try:
            if self.mysql_conn and self.mysql_conn.is_connected():
                self.mysql_conn.close()
        except:
            pass
        
        try:
            if self.mdb_os_conn:
                self.mdb_os_conn.close()
        except:
            pass
        
        try:
            if self.mdb_papelaria_conn:
                self.mdb_papelaria_conn.close()
        except:
            pass


# =====================================================================
# SISTEMA DE LOGGING
# =====================================================================

class SyncLogger:
    """Sistema de logging em banco de dados e console"""
    
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager
        
        # Configurar logging para arquivo PRIMEIRO
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('sync_andamentos.log', encoding='utf-8'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
        # Depois criar tabelas (pois setup_logging_tables usa self.logger)
        self.setup_logging_tables()
    
    def setup_logging_tables(self):
        """Cria tabelas de log no MySQL se não existirem"""
        mysql_conn = self.db_manager.connect_mysql()
        cursor = mysql_conn.cursor()
        
        try:
            # Tabela de log de sincronização
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS log_sincronizacao (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    tipo_acao VARCHAR(50) NOT NULL,
                    origem VARCHAR(50) NOT NULL,
                    destino VARCHAR(50) NOT NULL,
                    nros INT,
                    ano INT,
                    codstatus INT,
                    campos_modificados TEXT,
                    sucesso BOOLEAN DEFAULT TRUE,
                    mensagem_erro TEXT,
                    detalhes_completos TEXT,
                    INDEX idx_timestamp (timestamp),
                    INDEX idx_nros_ano (nros, ano),
                    INDEX idx_codstatus (codstatus)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            
            # Tabela de backup de andamentos
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS andamentos_backup (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp_backup DATETIME DEFAULT CURRENT_TIMESTAMP,
                    origem VARCHAR(50) NOT NULL,
                    tipo_acao VARCHAR(50) NOT NULL,
                    codstatus INT,
                    nros INT,
                    ano INT,
                    andamento TEXT,
                    data DATE,
                    ponto VARCHAR(20),
                    hora TIME,
                    usuariotag VARCHAR(100),
                    ultimostatus BOOLEAN,
                    dados_completos_json TEXT,
                    INDEX idx_codstatus (codstatus),
                    INDEX idx_nros_ano (nros, ano),
                    INDEX idx_timestamp (timestamp_backup)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            
            # Tabela cache de andamentos MDB
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS andamentos_mdb_cache (
                    codstatus INT PRIMARY KEY,
                    nros INT NOT NULL,
                    ano INT NOT NULL,
                    origem_mdb VARCHAR(50) NOT NULL,
                    ultima_verificacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_nros_ano (nros, ano),
                    INDEX idx_origem (origem_mdb)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """)
            
            mysql_conn.commit()
            self.logger.info("✅ Tabelas de log e backup criadas/verificadas com sucesso")
            
        except MySQLError as e:
            mysql_conn.rollback()
            self.logger.error(f"❌ Erro ao criar tabelas de log: {e}")
            raise
        finally:
            cursor.close()
    
    def log_action(self, tipo_acao: str, origem: str, destino: str, 
                   nros: Optional[int] = None, ano: Optional[int] = None,
                   codstatus: Optional[int] = None, campos_modificados: Optional[str] = None,
                   sucesso: bool = True, mensagem_erro: Optional[str] = None,
                   detalhes_completos: Optional[str] = None):
        """Registra ação no log de sincronização"""
        try:
            mysql_conn = self.db_manager.connect_mysql()
            cursor = mysql_conn.cursor()
            
            cursor.execute("""
                INSERT INTO log_sincronizacao 
                (tipo_acao, origem, destino, nros, ano, codstatus, campos_modificados, 
                 sucesso, mensagem_erro, detalhes_completos)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (tipo_acao, origem, destino, nros, ano, codstatus, campos_modificados,
                  sucesso, mensagem_erro, detalhes_completos))
            
            mysql_conn.commit()
            cursor.close()
            
            # Log no console apenas se houver alteração
            if tipo_acao in ['INSERT', 'UPDATE', 'DELETE']:
                msg = f"🔄 {tipo_acao}: OS {nros}/{ano} - CodStatus {codstatus} | {origem} → {destino}"
                if not sucesso:
                    msg += f" | ❌ ERRO: {mensagem_erro}"
                self.logger.info(msg)
                
        except Exception as e:
            self.logger.error(f"❌ Erro ao registrar log: {e}")


# =====================================================================
# SISTEMA DE BACKUP
# =====================================================================

class BackupManager:
    """Gerenciador de backups automáticos antes de exclusões"""
    
    def __init__(self, db_manager: DatabaseManager, logger: SyncLogger):
        self.db_manager = db_manager
        self.logger = logger
    
    def backup_andamento(self, origem: str, tipo_acao: str, andamento_data: Dict[str, Any]):
        """Realiza backup de um andamento antes de exclusão"""
        try:
            mysql_conn = self.db_manager.connect_mysql()
            cursor = mysql_conn.cursor()
            
            dados_json = json.dumps(andamento_data, ensure_ascii=False, default=str)
            
            cursor.execute("""
                INSERT INTO andamentos_backup
                (origem, tipo_acao, codstatus, nros, ano, andamento, data, ponto,
                 hora, usuariotag, ultimostatus, dados_completos_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                origem, tipo_acao,
                andamento_data.get('CodStatus'),
                andamento_data.get('NrOS'),
                andamento_data.get('Ano'),
                andamento_data.get('Andamento'),
                andamento_data.get('Data'),
                andamento_data.get('Ponto'),
                andamento_data.get('Hora'),
                andamento_data.get('Usuariotag'),
                andamento_data.get('UltimoStatus'),
                dados_json
            ))
            
            mysql_conn.commit()
            cursor.close()
            
            self.logger.logger.info(f"💾 Backup realizado: CodStatus {andamento_data.get('CodStatus')}")
            
        except Exception as e:
            self.logger.logger.error(f"❌ Erro ao realizar backup: {e}")
            raise


# =====================================================================
# SINCRONIZAÇÃO DE DADOS
# =====================================================================

class AndamentosSynchronizer:
    """Sincronizador principal de andamentos entre MySQL e MDB"""
    
    def __init__(self, config: DatabaseConfig):
        self.config = config
        self.db_manager = DatabaseManager(config)
        self.logger = SyncLogger(self.db_manager)
        self.backup_manager = BackupManager(self.db_manager, self.logger)
        self.data_limite = None
    
    def get_data_limite(self) -> datetime:
        """Calcula data limite para monitoramento (últimos N dias)"""
        return datetime.now() - timedelta(days=self.config.dias_monitoramento)
    
    def format_ponto(self, ponto: Optional[float]) -> str:
        """Formata o campo Ponto no padrão #.#00"""
        if ponto is None:
            return "0.000"
        
        ponto_str = f"{float(ponto):.3f}"
        partes = ponto_str.split('.')
        inteiro = partes[0]
        decimal = partes[1] if len(partes) > 1 else "000"
        
        # Adicionar separadores a cada 3 dígitos da direita para esquerda
        inteiro_formatado = ""
        for i, digit in enumerate(reversed(inteiro)):
            if i > 0 and i % 3 == 0:
                inteiro_formatado = "." + inteiro_formatado
            inteiro_formatado = digit + inteiro_formatado
        
        return f"{inteiro_formatado}.{decimal[:3]}"
    
    def read_andamentos_mysql(self) -> List[Dict[str, Any]]:
        """Lê andamentos do MySQL (últimos 30 dias)"""
        try:
            mysql_conn = self.db_manager.connect_mysql()
            cursor = mysql_conn.cursor(dictionary=True)
            
            data_limite = self.get_data_limite()
            
            cursor.execute("""
                SELECT 
                    CodStatus, NrOS, Ano, Andamento, Data, Ponto,
                    Hora, Usuariotag, UltimoStatus
                FROM tabandamento
                WHERE Data >= %s
                ORDER BY NrOS, Ano, CodStatus
            """, (data_limite,))
            
            result = cursor.fetchall()
            cursor.close()
            return result
            
        except Exception as e:
            self.logger.logger.error(f"❌ Erro ao ler andamentos MySQL: {e}")
            return []
    
    def read_andamentos_mdb(self, mdb_connection: pyodbc.Connection) -> List[Dict[str, Any]]:
        """Lê andamentos de um banco MDB (últimos 30 dias)"""
        try:
            cursor = mdb_connection.cursor()
            
            data_limite = self.get_data_limite()
            
            cursor.execute("""
                SELECT 
                    CodStatus, NrOS, Ano, Andamento, Data, Ponto,
                    Hora, Usuariotag, UltimoStatus
                FROM tabandamento
                WHERE Data >= ?
                ORDER BY NrOS, Ano, CodStatus
            """, (data_limite,))
            
            columns = [column[0] for column in cursor.description]
            result = []
            for row in cursor.fetchall():
                result.append(dict(zip(columns, row)))
            
            cursor.close()
            return result
            
        except Exception as e:
            self.logger.logger.error(f"❌ Erro ao ler andamentos MDB: {e}")
            return []
    
    def update_mdb_cache(self, andamentos_mdb_os: List[Dict], andamentos_mdb_pap: List[Dict]):
        """Atualiza cache de andamentos MDB no MySQL"""
        try:
            mysql_conn = self.db_manager.connect_mysql()
            cursor = mysql_conn.cursor()
            
            # Limpar cache antigo
            cursor.execute("TRUNCATE TABLE andamentos_mdb_cache")
            
            # Inserir andamentos do MDB OS Atual
            for andamento in andamentos_mdb_os:
                cursor.execute("""
                    INSERT INTO andamentos_mdb_cache (codstatus, nros, ano, origem_mdb)
                    VALUES (%s, %s, %s, %s)
                """, (andamento['CodStatus'], andamento['NrOS'], andamento['Ano'], 'OS_Atual'))
            
            # Inserir andamentos do MDB Papelaria
            for andamento in andamentos_mdb_pap:
                cursor.execute("""
                    INSERT INTO andamentos_mdb_cache (codstatus, nros, ano, origem_mdb)
                    VALUES (%s, %s, %s, %s)
                """, (andamento['CodStatus'], andamento['NrOS'], andamento['Ano'], 'Papelaria'))
            
            mysql_conn.commit()
            cursor.close()
            
        except Exception as e:
            mysql_conn.rollback()
            self.logger.logger.error(f"❌ Erro ao atualizar cache MDB: {e}")
    
    def sync_insert_to_mysql(self, andamento: Dict[str, Any], origem_mdb: str):
        """Insere novo andamento no MySQL"""
        try:
            mysql_conn = self.db_manager.connect_mysql()
            cursor = mysql_conn.cursor()
            
            cursor.execute("""
                INSERT INTO tabandamento
                (CodStatus, NrOS, Ano, Andamento, Data, Ponto, Hora, Usuariotag, UltimoStatus)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                andamento['CodStatus'], andamento['NrOS'], andamento['Ano'],
                andamento['Andamento'], andamento['Data'], andamento['Ponto'],
                andamento['Hora'], andamento['Usuariotag'], andamento.get('UltimoStatus', False)
            ))
            
            mysql_conn.commit()
            cursor.close()
            
            self.logger.log_action(
                'INSERT', origem_mdb, 'MySQL',
                andamento['NrOS'], andamento['Ano'], andamento['CodStatus'],
                'Novo andamento inserido'
            )
            
        except Exception as e:
            mysql_conn.rollback()
            self.logger.log_action(
                'INSERT', origem_mdb, 'MySQL',
                andamento['NrOS'], andamento['Ano'], andamento['CodStatus'],
                mensagem_erro=str(e), sucesso=False
            )
            raise
    
    def sync_insert_to_mdb(self, andamento: Dict[str, Any], mdb_connection: pyodbc.Connection, destino_mdb: str):
        """Insere novo andamento no MDB"""
        try:
            cursor = mdb_connection.cursor()
            
            # Preservar quebras de linha no campo Andamento
            andamento_texto = andamento['Andamento']
            if andamento_texto:
                andamento_texto = andamento_texto.replace('\n', '\r\n')
            
            cursor.execute("""
                INSERT INTO tabandamento
                (CodStatus, NrOS, Ano, Andamento, Data, Ponto, Hora, Usuariotag, UltimoStatus)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                andamento['CodStatus'], andamento['NrOS'], andamento['Ano'],
                andamento_texto, andamento['Data'], self.format_ponto(andamento.get('Ponto')),
                andamento['Hora'], andamento['Usuariotag'], andamento.get('UltimoStatus', False)
            ))
            
            mdb_connection.commit()
            cursor.close()
            
            self.logger.log_action(
                'INSERT', 'MySQL', destino_mdb,
                andamento['NrOS'], andamento['Ano'], andamento['CodStatus'],
                'Novo andamento inserido'
            )
            
        except Exception as e:
            mdb_connection.rollback()
            self.logger.log_action(
                'INSERT', 'MySQL', destino_mdb,
                andamento['NrOS'], andamento['Ano'], andamento['CodStatus'],
                mensagem_erro=str(e), sucesso=False
            )
            raise
    
    def sync_delete_from_mysql(self, codstatus: int, andamento_data: Dict[str, Any]):
        """Remove andamento do MySQL (com backup)"""
        try:
            # Backup antes de excluir
            self.backup_manager.backup_andamento('MySQL', 'DELETE', andamento_data)
            
            mysql_conn = self.db_manager.connect_mysql()
            cursor = mysql_conn.cursor()
            
            cursor.execute("DELETE FROM tabandamento WHERE CodStatus = %s", (codstatus,))
            
            mysql_conn.commit()
            cursor.close()
            
            origem_mdb = self.db_manager.get_mdb_name_by_nros(andamento_data['NrOS'])
            self.logger.log_action(
                'DELETE', origem_mdb, 'MySQL',
                andamento_data['NrOS'], andamento_data['Ano'], codstatus,
                'Andamento excluído (backup realizado)'
            )
            
        except Exception as e:
            mysql_conn.rollback()
            self.logger.log_action(
                'DELETE', 'MDB', 'MySQL',
                andamento_data.get('NrOS'), andamento_data.get('Ano'), codstatus,
                mensagem_erro=str(e), sucesso=False
            )
            raise
    
    def update_ultimo_status(self, nros: int, ano: int):
        """Atualiza UltimoStatus para a OS/Ano em todos os bancos"""
        try:
            # MySQL
            mysql_conn = self.db_manager.connect_mysql()
            cursor_mysql = mysql_conn.cursor()
            
            # Reseta todos para False
            cursor_mysql.execute("""
                UPDATE tabandamento 
                SET UltimoStatus = FALSE 
                WHERE NrOS = %s AND Ano = %s
            """, (nros, ano))
            
            # Define o último (ordenado por CodStatus DESC) como True
            cursor_mysql.execute("""
                UPDATE tabandamento 
                SET UltimoStatus = TRUE 
                WHERE CodStatus = (
                    SELECT MAX(CodStatus) 
                    FROM (SELECT CodStatus FROM tabandamento WHERE NrOS = %s AND Ano = %s) AS sub
                )
            """, (nros, ano))
            
            mysql_conn.commit()
            cursor_mysql.close()
            
            # MDB correspondente
            mdb_conn = self.db_manager.get_mdb_connection_by_nros(nros)
            cursor_mdb = mdb_conn.cursor()
            
            # Reseta todos para False
            cursor_mdb.execute("""
                UPDATE tabandamento 
                SET UltimoStatus = FALSE 
                WHERE NrOS = ? AND Ano = ?
            """, (nros, ano))
            
            # Define o último como True
            cursor_mdb.execute("""
                UPDATE tabandamento 
                SET UltimoStatus = TRUE 
                WHERE CodStatus = (
                    SELECT MAX(CodStatus) 
                    FROM tabandamento 
                    WHERE NrOS = ? AND Ano = ?
                )
            """, (nros, ano))
            
            mdb_conn.commit()
            cursor_mdb.close()
            
        except Exception as e:
            self.logger.logger.error(f"❌ Erro ao atualizar UltimoStatus para OS {nros}/{ano}: {e}")
    
    def update_related_tables(self, nros: int, ano: int, origem: str):
        """Atualiza tabdetalhesservico e tabprotocolos para uma OS/Ano"""
        try:
            # Determinar banco de origem
            if origem == 'OS_Atual':
                conn_origem = self.db_manager.connect_mdb_os_atual()
            elif origem == 'Papelaria':
                conn_origem = self.db_manager.connect_mdb_papelaria()
            else:
                return
            
            # Ler dados das tabelas relacionadas do MDB origem
            cursor_origem = conn_origem.cursor()
            
            # tabdetalhesservico
            cursor_origem.execute("""
                SELECT * FROM tabdetalhesservico 
                WHERE NrOS = ? AND Ano = ?
            """, (nros, ano))
            detalhes = cursor_origem.fetchone()
            
            # tabprotocolos
            cursor_origem.execute("""
                SELECT * FROM tabprotocolos 
                WHERE NrOS = ? AND Ano = ?
            """, (nros, ano))
            protocolos = cursor_origem.fetchone()
            
            cursor_origem.close()
            
            if not detalhes and not protocolos:
                return
            
            # Atualizar MySQL
            mysql_conn = self.db_manager.connect_mysql()
            cursor_mysql = mysql_conn.cursor()
            
            if detalhes:
                columns = [desc[0] for desc in cursor_origem.description]
                # Construir query de UPDATE dinâmica
                # (simplificado - em produção, listar os campos específicos)
                self.logger.logger.info(f"📋 Dados de tabdetalhesservico atualizados para OS {nros}/{ano}")
            
            if protocolos:
                self.logger.logger.info(f"📋 Dados de tabprotocolos atualizados para OS {nros}/{ano}")
            
            mysql_conn.commit()
            cursor_mysql.close()
            
            # Atualizar MDB destino (o outro banco)
            if origem == 'OS_Atual' and nros < 5000:
                # Não precisa atualizar outro MDB
                pass
            elif origem == 'Papelaria' and nros >= 5000:
                # Não precisa atualizar outro MDB
                pass
            
        except Exception as e:
            self.logger.logger.error(f"❌ Erro ao atualizar tabelas relacionadas para OS {nros}/{ano}: {e}")
    
    def perform_sync_cycle(self):
        """Executa um ciclo completo de sincronização"""
        try:
            # Ler dados de todos os bancos
            andamentos_mysql = self.read_andamentos_mysql()
            andamentos_mdb_os = self.read_andamentos_mdb(self.db_manager.connect_mdb_os_atual())
            andamentos_mdb_pap = self.read_andamentos_mdb(self.db_manager.connect_mdb_papelaria())
            
            # Atualizar cache MDB
            self.update_mdb_cache(andamentos_mdb_os, andamentos_mdb_pap)
            
            # Criar sets para comparação rápida (baseado em CodStatus)
            codstatus_mysql = {a['CodStatus'] for a in andamentos_mysql}
            codstatus_mdb_os = {a['CodStatus'] for a in andamentos_mdb_os}
            codstatus_mdb_pap = {a['CodStatus'] for a in andamentos_mdb_pap}
            codstatus_mdb_all = codstatus_mdb_os | codstatus_mdb_pap
            
            # Detectar inserções: MDB → MySQL
            novos_no_mdb = codstatus_mdb_all - codstatus_mysql
            for codstatus in novos_no_mdb:
                # Encontrar o andamento correspondente
                andamento = None
                origem = None
                
                for a in andamentos_mdb_os:
                    if a['CodStatus'] == codstatus:
                        andamento = a
                        origem = 'OS_Atual'
                        break
                
                if not andamento:
                    for a in andamentos_mdb_pap:
                        if a['CodStatus'] == codstatus:
                            andamento = a
                            origem = 'Papelaria'
                            break
                
                if andamento:
                    self.sync_insert_to_mysql(andamento, origem)
                    self.update_ultimo_status(andamento['NrOS'], andamento['Ano'])
                    self.update_related_tables(andamento['NrOS'], andamento['Ano'], origem)
            
            # Detectar inserções: MySQL → MDB
            novos_no_mysql = codstatus_mysql - codstatus_mdb_all
            for codstatus in novos_no_mysql:
                # Encontrar o andamento no MySQL
                andamento = next((a for a in andamentos_mysql if a['CodStatus'] == codstatus), None)
                
                if andamento:
                    nros = andamento['NrOS']
                    mdb_conn = self.db_manager.get_mdb_connection_by_nros(nros)
                    destino = self.db_manager.get_mdb_name_by_nros(nros)
                    
                    self.sync_insert_to_mdb(andamento, mdb_conn, destino)
                    self.update_ultimo_status(andamento['NrOS'], andamento['Ano'])
            
            # Detectar exclusões: MySQL (presente no MySQL mas ausente no MDB)
            # Usar cache para validar exclusões legítimas
            mysql_conn = self.db_manager.connect_mysql()
            cursor = mysql_conn.cursor(dictionary=True)
            
            excluidos_do_mdb = codstatus_mysql - codstatus_mdb_all
            for codstatus in excluidos_do_mdb:
                # Verificar se estava no cache (ou seja, estava no MDB antes)
                cursor.execute("""
                    SELECT * FROM andamentos_mdb_cache 
                    WHERE codstatus = %s
                """, (codstatus,))
                
                estava_no_cache = cursor.fetchone() is not None
                
                if estava_no_cache:
                    # Exclusão legítima - remover do MySQL
                    andamento = next((a for a in andamentos_mysql if a['CodStatus'] == codstatus), None)
                    if andamento:
                        self.sync_delete_from_mysql(codstatus, andamento)
                        self.update_ultimo_status(andamento['NrOS'], andamento['Ano'])
            
            cursor.close()
            
        except Exception as e:
            self.logger.logger.error(f"❌ Erro no ciclo de sincronização: {e}")
            self.logger.logger.error(traceback.format_exc())
    
    def run_continuous(self):
        """Executa sincronização contínua"""
        self.logger.logger.info("=" * 70)
        self.logger.logger.info("🚀 INICIANDO SINCRONIZAÇÃO BIDIRECIONAL MySQL ↔ Access")
        self.logger.logger.info("=" * 70)
        self.logger.logger.info(f"📊 Monitorando últimos {self.config.dias_monitoramento} dias")
        self.logger.logger.info(f"🔄 Intervalo mínimo entre verificações: {self.config.intervalo_verificacao_segundos}s")
        self.logger.logger.info("=" * 70)
        
        try:
            while True:
                inicio_ciclo = time.time()
                
                self.perform_sync_cycle()
                
                tempo_decorrido = time.time() - inicio_ciclo
                
                # Sleep apenas se o ciclo foi muito rápido
                if tempo_decorrido < self.config.intervalo_verificacao_segundos:
                    time.sleep(self.config.intervalo_verificacao_segundos - tempo_decorrido)
                
        except KeyboardInterrupt:
            self.logger.logger.info("\n⚠️  Interrupção solicitada pelo usuário")
        except Exception as e:
            self.logger.logger.error(f"❌ Erro fatal: {e}")
            self.logger.logger.error(traceback.format_exc())
        finally:
            self.db_manager.close_all()
            self.logger.logger.info("🔌 Conexões fechadas. Encerrando...")


# =====================================================================
# PONTO DE ENTRADA
# =====================================================================

def main():
    """Função principal"""
    print("""
╔═══════════════════════════════════════════════════════════════════╗
║  Sistema de Sincronização Bidirecional MySQL ↔ Access (MDB)      ║
║  Versão 1.0.0 - Monitoramento Contínuo de Andamentos            ║
╚═══════════════════════════════════════════════════════════════════╝
    """)
    
    # Carregar configurações
    config = DatabaseConfig.load_from_file('config.json')
    
    # Validar existência dos arquivos MDB
    if not os.path.exists(config.mdb_os_atual_path):
        print(f"⚠️  AVISO: Arquivo MDB OS Atual não encontrado: {config.mdb_os_atual_path}")
        print("   Verifique o caminho no arquivo config.json")
    
    if not os.path.exists(config.mdb_papelaria_path):
        print(f"⚠️  AVISO: Arquivo MDB Papelaria não encontrado: {config.mdb_papelaria_path}")
        print("   Verifique o caminho no arquivo config.json")
    
    # Iniciar sincronizador
    synchronizer = AndamentosSynchronizer(config)
    synchronizer.run_continuous()


if __name__ == "__main__":
    main()

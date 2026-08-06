#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backup Incremental de Releases - SAGRA Web (DEV)
Autor: Engenheiro DevOps Sênior

Este script realiza backups incrementais dos arquivos do servidor DEV.
- Primeira execução: gera um backup completo.
- Execuções seguintes: identifica arquivos novos, modificados e removidos.
- Copia apenas novos/modificados, registrando os removidos.
- Grava dados detalhados na tabela MySQL (tabReleases e tabReleaseFiles) ou SQLite fallback.
- Salva manifestos completos de estado e resumos no filesystem.
"""

from __future__ import annotations

import argparse
import datetime
import getpass
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Configuração de caminhos para importar módulos do projeto
import sys
if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).parent.resolve()
else:
    ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app" / "backend"))

# Tenta carregar o gerenciador de configurações do projeto
try:
    from config_manager import config_manager
    HAS_CONFIG_MANAGER = hasattr(config_manager, "get_mysql_config")
except ImportError:
    HAS_CONFIG_MANAGER = False

# =====================================================================
# CONFIGURAÇÕES E EXCLUSÕES PADRÃO
# =====================================================================
DEFAULT_EXCLUDE_DIRS = {
    ".git", "node_modules", "venv", ".venv", "__pycache__",
    ".pytest_cache", ".cache", ".vite", "dist", "build",
    "releases", "current", "shared", "deploy/release", "deploy/backups",
    "deploy/_wheels_temp", "logs", "storage", "storage_client_uploads",
    "storage_test", "modelos", "recovery_temp", "temp", "cache",
    "generated", "email_images", "portfolio-imports", "backups",
}

DEFAULT_EXCLUDE_FILES = {
    "*.pyc", "*.pyo", "*.log", ".env", ".env.local", ".env.production",
    "Thumbs.db", ".DS_Store", "desktop.ini"
}

# SQL de Criação de Tabelas no MySQL
MYSQL_CREATE_RELEASES = """
CREATE TABLE IF NOT EXISTS `tabReleases` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `release_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `backup_type` VARCHAR(50) NOT NULL,
  `source_root` VARCHAR(512) NOT NULL,
  `backup_path` VARCHAR(512) NOT NULL,
  `manifest_path` VARCHAR(512) NOT NULL,
  `status` VARCHAR(50) NOT NULL,
  `started_at` DATETIME NOT NULL,
  `finished_at` DATETIME NULL,
  `duration_seconds` INT NULL,
  `total_files_scanned` INT NOT NULL,
  `total_added` INT NOT NULL,
  `total_modified` INT NOT NULL,
  `total_deleted` INT NOT NULL,
  `total_unchanged` INT NOT NULL,
  `created_by` VARCHAR(100) NULL,
  `git_branch` VARCHAR(100) NULL,
  `git_commit` VARCHAR(100) NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_releases_name` (`release_name`),
  KEY `idx_releases_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
"""

MYSQL_CREATE_RELEASE_FILES = """
CREATE TABLE IF NOT EXISTS `tabReleaseFiles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `release_id` INT NOT NULL,
  `relative_path` VARCHAR(1024) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `size_bytes` BIGINT NOT NULL,
  `mtime` DATETIME NULL,
  `sha256_before` VARCHAR(64) NULL,
  `sha256_after` VARCHAR(64) NULL,
  `backup_file_path` VARCHAR(1024) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_release_files_release_id` FOREIGN KEY (`release_id`) REFERENCES `tabReleases` (`id`) ON DELETE CASCADE,
  KEY `idx_release_files_release_id` (`release_id`),
  KEY `idx_release_files_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
"""

# SQL de Criação de Tabelas no SQLite Fallback
SQLITE_CREATE_RELEASES = """
CREATE TABLE IF NOT EXISTS tabReleases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_name TEXT NOT NULL,
  description TEXT,
  backup_type TEXT NOT NULL,
  source_root TEXT NOT NULL,
  backup_path TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_seconds INTEGER,
  total_files_scanned INTEGER NOT NULL,
  total_added INTEGER NOT NULL,
  total_modified INTEGER NOT NULL,
  total_deleted INTEGER NOT NULL,
  total_unchanged INTEGER NOT NULL,
  created_by TEXT,
  git_branch TEXT,
  git_commit TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

SQLITE_CREATE_RELEASE_FILES = """
CREATE TABLE IF NOT EXISTS tabReleaseFiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL,
  relative_path TEXT NOT NULL,
  action TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime TEXT,
  sha256_before TEXT,
  sha256_after TEXT,
  backup_file_path TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (release_id) REFERENCES tabReleases (id) ON DELETE CASCADE
);
"""

# =====================================================================
# CLASSE ADAPTADORA DO BANCO DE DADOS (MYSQL / SQLITE)
# =====================================================================
class DatabaseAdapter:
    def __init__(self, mysql_config: dict | None = None, sqlite_path: Path | None = None):
        self.db_type = "sqlite"
        self.connection = None
        self.sqlite_path = sqlite_path or Path("deploy/releases.db")

        # Tenta conectar ao MySQL se fornecido
        if mysql_config:
            try:
                import pymysql
                import pymysql.cursors
                self.connection = pymysql.connect(
                    host=mysql_config.get("host", "127.0.0.1"),
                    port=int(mysql_config.get("port", 3306)),
                    user=mysql_config.get("user", "root"),
                    password=mysql_config.get("password", ""),
                    database=mysql_config.get("database", "sagrafulldb"),
                    charset="utf8mb4",
                    cursorclass=pymysql.cursors.DictCursor,
                    autocommit=False
                )
                self.db_type = "mysql"
                logging.info("Conectado ao banco de dados principal (MySQL) com sucesso.")
            except Exception as e:
                logging.warning(
                    f"Não foi possível conectar ao MySQL ({mysql_config.get('host')}): {e}. "
                    f"Usando fallback SQLite local."
                )

        # Fallback para SQLite
        if not self.connection:
            import sqlite3
            self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
            self.connection = sqlite3.connect(str(self.sqlite_path))
            self.connection.row_factory = sqlite3.Row
            self.db_type = "sqlite"
            try:
                self.connection.execute("PRAGMA foreign_keys = ON;")
            except Exception:
                pass
            logging.info(f"Conectado ao SQLite local em: {self.sqlite_path}")

    def init_tables(self):
        cursor = self.connection.cursor()
        try:
            if self.db_type == "mysql":
                cursor.execute(MYSQL_CREATE_RELEASES)
                cursor.execute(MYSQL_CREATE_RELEASE_FILES)
            else:
                cursor.execute(SQLITE_CREATE_RELEASES)
                cursor.execute(SQLITE_CREATE_RELEASE_FILES)
                # Índices no SQLite
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_sqlite_releases_name ON tabReleases (release_name);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_sqlite_releases_created ON tabReleases (created_at);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_sqlite_relfiles_release_id ON tabReleaseFiles (release_id);")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_sqlite_relfiles_action ON tabReleaseFiles (action);")
            self.connection.commit()
        except Exception as e:
            self.connection.rollback()
            logging.error(f"Erro ao inicializar tabelas no banco de dados ({self.db_type}): {e}")
            raise
        finally:
            cursor.close()

    def execute_query(self, query: str, params: list | None = None) -> list:
        cursor = self.connection.cursor()
        try:
            if self.db_type == "sqlite":
                query = query.replace("%s", "?")
            cursor.execute(query, params or [])
            rows = cursor.fetchall()
            if self.db_type == "sqlite" and rows:
                return [dict(r) for r in rows]
            return list(rows) if rows else []
        except Exception as e:
            logging.error(f"Erro ao executar query no {self.db_type}: {e}. Query: {query}")
            raise
        finally:
            cursor.close()

    def execute_insert(self, query: str, params: list | None = None) -> int:
        cursor = self.connection.cursor()
        try:
            if self.db_type == "sqlite":
                query = query.replace("%s", "?")
            cursor.execute(query, params or [])
            last_id = cursor.lastrowid
            return last_id
        except Exception as e:
            logging.error(f"Erro ao executar insert no {self.db_type}: {e}. Query: {query}")
            raise
        finally:
            cursor.close()

    def execute_many(self, query: str, params_list: list[list]):
        if not params_list:
            return
        cursor = self.connection.cursor()
        try:
            if self.db_type == "sqlite":
                query = query.replace("%s", "?")
            cursor.executemany(query, params_list)
        except Exception as e:
            logging.error(f"Erro ao executar executemany no {self.db_type}: {e}. Query: {query}")
            raise
        finally:
            cursor.close()

    def commit(self):
        try:
            self.connection.commit()
        except Exception as e:
            logging.error(f"Erro ao efetuar commit no banco: {e}")
            raise

    def rollback(self):
        try:
            self.connection.rollback()
        except Exception as e:
            logging.warning(f"Erro ao efetuar rollback no banco: {e}")

    def close(self):
        if self.connection:
            try:
                self.connection.close()
            except Exception:
                pass

# =====================================================================
# FUNÇÕES AUXILIARES DE CAMINHO, HASH E GIT
# =====================================================================
def get_git_info(source_dir: Path) -> tuple[str | None, str | None]:
    """Tenta recuperar a branch e hash do commit atual caso o diretório use Git."""
    try:
        # Pega a branch
        branch_proc = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(source_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
        branch = branch_proc.stdout.strip()

        # Pega o commit hash
        commit_proc = subprocess.run(
            ["git", "log", "-1", "--format=%H"],
            cwd=str(source_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
        commit = commit_proc.stdout.strip()
        return branch, commit
    except Exception:
        # Se falhar (não for repositório git ou git ausente), retorna None de forma segura
        return None, None

def calculate_sha256(file_path: Path) -> str:
    """Calcula o hash SHA-256 de um arquivo de forma eficiente em blocos de 64KB."""
    sha256_hash = hashlib.sha256()
    # Adiciona suporte a caminhos longos no Windows (prepended with \\?\) se necessário
    resolved_path = file_path.resolve()
    path_str = str(resolved_path)
    if os.name == "nt" and len(path_str) > 240 and not path_str.startswith("\\\\?\\"):
        path_str = "\\\\?\\" + path_str

    with open(path_str, "rb") as f:
        for byte_block in iter(lambda: f.read(65536), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def is_excluded(path: Path, source_root: Path, exclude_dirs: set[str], exclude_files: set[str], backup_root: Path) -> bool:
    """Valida se o arquivo ou diretório deve ser excluído da cópia e monitoramento."""
    try:
        rel_path = path.relative_to(source_root)
    except ValueError:
        return True

    # Ignora o próprio diretório de backup se estiver dentro da raiz
    try:
        resolved_path = path.resolve()
        resolved_backup = backup_root.resolve()
        if resolved_path == resolved_backup or resolved_backup in resolved_path.parents:
            return True
    except Exception:
        pass

    # Valida exclusão de diretórios pai (caminho acumulado ou segmento isolado, ex.: node_modules)
    path_parts = rel_path.parts
    for i in range(len(path_parts)):
        parent_posix = Path(*path_parts[: i + 1]).as_posix().lower()
        if parent_posix in exclude_dirs:
            return True
        segment = path_parts[i].lower()
        if segment in exclude_dirs:
            return True

    # Se for arquivo, valida exclusão de padrões de arquivos
    if path.is_file():
        name = path.name.lower()
        import fnmatch
        for pat in exclude_files:
            if fnmatch.fnmatch(name, pat.lower()):
                return True

    return False

def get_next_backup_index(releases_dir: Path) -> int:
    """Varre o diretório de releases e retorna o próximo índice sequencial (ex.: 000003 -> retorna 3)."""
    if not releases_dir.exists():
        return 1
    max_idx = 0
    for entry in os.listdir(releases_dir):
        entry_path = releases_dir / entry
        if entry_path.is_dir():
            match = re.match(r"^(\d{6})_(full|incremental)_", entry)
            if match:
                idx = int(match.group(1))
                if idx > max_idx:
                    max_idx = idx
    return max_idx + 1

def find_last_manifest(releases_dir: Path, last_index: int) -> Path | None:
    """Localiza o arquivo manifest.json do último backup válido (pelo índice)."""
    if last_index <= 0 or not releases_dir.exists():
        return None
    
    # Busca a pasta que inicia com o prefixo index formatado como 6 dígitos
    prefix = f"{last_index:06d}_"
    for entry in os.listdir(releases_dir):
        if entry.startswith(prefix):
            manifest_file = releases_dir / entry / "manifest.json"
            if manifest_file.exists():
                return manifest_file
    return None

# =====================================================================
# FUNÇÕES DE LISTAGEM E RESTAURAÇÃO DE BACKUPS
# =====================================================================
def handle_list(db: DatabaseAdapter) -> int:
    logging.info("Carregando lista de releases do histórico...")
    query = """
    SELECT id, release_name, backup_type, status, started_at, total_added, total_modified, total_deleted, description 
    FROM tabReleases 
    ORDER BY id DESC
    """
    try:
        rows = db.execute_query(query)
        if not rows:
            print("\nNenhum release registrado no banco de dados.")
            return 0
        
        print("\n" + "=" * 120)
        print(f"{'ID':<6} | {'Nome do Release':<30} | {'Tipo':<12} | {'Status':<10} | {'Iniciado em':<20} | {'Add/Mod/Del':<12} | {'Descrição'}")
        print("=" * 120)
        for r in rows:
            desc = r.get("description") or ""
            if len(desc) > 30:
                desc = desc[:27] + "..."
            counts = f"{r.get('total_added', 0)}/{r.get('total_modified', 0)}/{r.get('total_deleted', 0)}"
            started_at_str = str(r['started_at'])
            print(f"{r['id']:<6} | {r['release_name']:<30} | {r['backup_type']:<12} | {r['status']:<10} | {started_at_str:<20} | {counts:<12} | {desc}")
        print("=" * 120 + "\n")
        return 0
    except Exception as e:
        logging.error(f"Erro ao listar releases: {e}")
        return 1

def handle_list_files(db: DatabaseAdapter, release_ref: str) -> int:
    logging.info(f"Carregando arquivos da release '{release_ref}'...")
    is_numeric = release_ref.isdigit()
    if is_numeric:
        query_release = "SELECT id, release_name, backup_type, started_at, description FROM tabReleases WHERE id = %s"
        params = [int(release_ref)]
    else:
        query_release = "SELECT id, release_name, backup_type, started_at, description FROM tabReleases WHERE release_name = %s"
        params = [release_ref]
        
    try:
        release_rows = db.execute_query(query_release, params)
        if not release_rows:
            logging.error(f"Release '{release_ref}' não encontrada no banco de dados.")
            return 1
        
        release = release_rows[0]
        release_id = release["id"]
        
        print("\n" + "=" * 90)
        print(f"Release:      #{release_id} - {release['release_name']}")
        print(f"Tipo:         {release['backup_type'].upper()}")
        print(f"Data:         {release['started_at']}")
        print(f"Descrição:    {release.get('description') or ''}")
        print("=" * 90)
        
        query_files = """
        SELECT relative_path, action, size_bytes 
        FROM tabReleaseFiles 
        WHERE release_id = %s 
        ORDER BY relative_path
        """
        file_rows = db.execute_query(query_files, [release_id])
        if not file_rows:
            print("Nenhum arquivo alterado/registrado neste release.")
        else:
            print(f"{'Ação':<10} | {'Tamanho (Bytes)':<15} | {'Caminho do Arquivo'}")
            print("-" * 90)
            for f in file_rows:
                action_str = f"[{f['action'].upper()}]"
                print(f"{action_str:<10} | {f['size_bytes']:<15} | {f['relative_path']}")
        print("=" * 90 + "\n")
        return 0
    except Exception as e:
        logging.error(f"Erro ao listar arquivos da release: {e}")
        return 1

def handle_restore_file(db: DatabaseAdapter, rel_path: str, release_ref: str | None, output_path: str | None, force: bool, source_root: Path, backup_root: Path) -> int:
    # Normaliza o caminho relativo usando forward slashes
    rel_path_normalized = Path(rel_path).as_posix()
    
    # 1. Resolve o ID do release alvo
    target_release_id = None
    if release_ref:
        is_numeric = release_ref.isdigit()
        if is_numeric:
            query = "SELECT id, release_name FROM tabReleases WHERE id = %s"
            params = [int(release_ref)]
        else:
            query = "SELECT id, release_name FROM tabReleases WHERE release_name = %s"
            params = [release_ref]
        rows = db.execute_query(query, params)
        if not rows:
            logging.error(f"Release especificada '{release_ref}' não foi encontrada.")
            return 1
        target_release_id = rows[0]["id"]
        release_name = rows[0]["release_name"]
    else:
        # Se omitido, busca o último release com sucesso
        query = "SELECT id, release_name FROM tabReleases WHERE status = 'success' ORDER BY id DESC LIMIT 1"
        rows = db.execute_query(query)
        if not rows:
            logging.error("Nenhum release com sucesso encontrado para restaurar.")
            return 1
        target_release_id = rows[0]["id"]
        release_name = rows[0]["release_name"]
        
    logging.info(f"Buscando histórico do arquivo '{rel_path_normalized}' na release #{target_release_id} ({release_name})...")
    
    # 2. Busca a última modificação do arquivo no ou antes do release alvo
    query_history = """
    SELECT release_id, action, backup_file_path, size_bytes 
    FROM tabReleaseFiles 
    WHERE relative_path = %s AND release_id <= %s 
    ORDER BY release_id DESC LIMIT 1
    """
    history_rows = db.execute_query(query_history, [rel_path_normalized, target_release_id])
    if not history_rows:
        logging.error(f"Arquivo '{rel_path_normalized}' não encontrado no histórico de backups até o release #{target_release_id}.")
        return 1
        
    file_state = history_rows[0]
    action = file_state["action"]
    
    if action == "deleted":
        logging.error(f"O arquivo '{rel_path_normalized}' foi deletado no release #{file_state['release_id']}. Não é possível restaurar.")
        return 1
        
    backup_file_rel = file_state["backup_file_path"]
    if not backup_file_rel:
        logging.error(f"Registro de backup físico ausente para o arquivo '{rel_path_normalized}' no release #{file_state['release_id']}.")
        return 1
        
    physical_backup_path = backup_root / backup_file_rel
    if not physical_backup_path.exists():
        logging.error(f"Arquivo de backup físico não encontrado no disco: {physical_backup_path}")
        return 1
        
    # 3. Determina caminho de destino
    dest_path = None
    if output_path:
        out_p = Path(output_path)
        if out_p.is_dir():
            dest_path = out_p / Path(rel_path_normalized).name
        else:
            dest_path = out_p
    else:
        dest_path = source_root / rel_path_normalized
        
    dest_path = dest_path.resolve()
    
    # 4. Validação de sobrescrita
    if dest_path.exists():
        if not force:
            logging.error(
                f"O arquivo de destino já existe em: {dest_path}\n"
                f"Para evitar perda de dados, a restauração foi cancelada.\n"
                f"Use a opção '--force' ou defina um caminho alternativo com '--output <caminho>'."
            )
            return 1
        else:
            logging.warning(f"Forçando sobrescrita de arquivo existente: {dest_path}")
            
    # 5. Executa a restauração
    try:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(physical_backup_path), str(dest_path))
        logging.info(
            f"Sucesso! Arquivo restaurado a partir do release #{file_state['release_id']}.\n"
            f"Origem do backup: {physical_backup_path}\n"
            f"Destino restaurado: {dest_path}"
        )
        return 0
    except Exception as e:
        logging.error(f"Falha crítica ao copiar arquivo restaurado para {dest_path}: {e}")
        return 1

# =====================================================================
# PROGRAMA PRINCIPAL
# =====================================================================
def main() -> int:
    parser = argparse.ArgumentParser(description="Backup incremental e auditoria de releases do SAGRA Web (DEV).")
    parser.add_argument("--source-root", type=str, default=None, help="Pasta de origem (DEV). Padrão: raiz do projeto.")
    parser.add_argument("--backup-root", type=str, default=None, help="Pasta de destino dos backups.")
    parser.add_argument("--release-name", type=str, default=None, help="Nome identificador do release.")
    parser.add_argument("--description", type=str, default="", help="Descrição amigável do release.")
    parser.add_argument("--dry-run", action="store_true", help="Simula o backup sem gravar em disco ou no banco.")
    parser.add_argument("--force-full", action="store_true", help="Força a geração de um backup completo inicial.")
    parser.add_argument("--config", type=str, default=None, help="Arquivo de configuração JSON opcional.")
    parser.add_argument("--include", type=str, help="Caminhos/padrões adicionais de inclusão (separados por vírgula).")
    parser.add_argument("--exclude", type=str, help="Padrões adicionais de exclusão (separados por vírgula).")
    parser.add_argument("--verbose", action="store_true", help="Ativa logs detalhados.")
    
    # Novos argumentos para gerenciamento e restauração
    parser.add_argument("--list", action="store_true", help="Lista todos os releases gravados.")
    parser.add_argument("--list-files", type=str, default=None, help="Lista os arquivos alterados em um release específico (ID ou nome).")
    parser.add_argument("--restore-file", type=str, default=None, help="Caminho relativo do arquivo a ser restaurado.")
    parser.add_argument("--release-id", type=str, default=None, help="ID ou nome do release para restaurar (se omitido, usa a última).")
    parser.add_argument("--output", type=str, default=None, help="Caminho alternativo de saída para a restauração.")
    parser.add_argument("--force", action="store_true", help="Ignora confirmações e sobrescreve arquivos existentes.")
    args = parser.parse_args()

    # Define o nível do logger e configura o root logger explicitamente
    log_level = logging.DEBUG if args.verbose else logging.INFO
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # Remove handlers anteriores instalados pelas importações para evitar duplicados ou filtros
    for h in list(root_logger.handlers):
        root_logger.removeHandler(h)
        
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    root_logger.addHandler(console_handler)

    started_at = datetime.datetime.now()
    started_at_str = started_at.strftime("%Y-%m-%d %H:%M:%S")
    timestamp_str = started_at.strftime("%Y%m%d_%H%M%S")

    # 1. Carrega caminhos base e validações
    source_root = Path(args.source_root).resolve() if args.source_root else ROOT.resolve()
    
    # Define caminhos e defaults usando config_manager se disponível
    mysql_config = None
    backup_root_val = None
    if HAS_CONFIG_MANAGER:
        mysql_config = config_manager.get_mysql_config()
        backup_root_val = config_manager.get("backup_root")
        logging.debug("Configurações carregadas do config_manager com sucesso.")

    # Prioriza parâmetros de CLI sobre config.json
    backup_root = Path(args.backup_root).resolve() if args.backup_root else (
        Path(backup_root_val).resolve() if backup_root_val else (source_root / "backups")
    )

    releases_dir = backup_root / "releases"
    sqlite_db_path = backup_root / "releases.db"

    # Inicializa conexão de banco de dados antecipadamente se necessário
    db = None
    if not args.dry_run or args.list or args.list_files or args.restore_file:
        try:
            db = DatabaseAdapter(mysql_config=mysql_config, sqlite_path=sqlite_db_path)
            db.init_tables()
        except Exception as e:
            logging.error(f"Erro ao inicializar banco de dados: {e}")
            if not args.dry_run and not (args.list or args.list_files or args.restore_file):
                return 1

    # Rotacionamento de comandos (Listing e Restore)
    if args.list:
        if not db:
            logging.error("Banco de dados não conectado. Não é possível listar.")
            return 1
        return handle_list(db)

    if args.list_files:
        if not db:
            logging.error("Banco de dados não conectado. Não é possível listar arquivos.")
            return 1
        return handle_list_files(db, args.list_files)

    if args.restore_file:
        if not db:
            logging.error("Banco de dados não conectado. Não é possível restaurar.")
            return 1
        return handle_restore_file(
            db=db,
            rel_path=args.restore_file,
            release_ref=args.release_id,
            output_path=args.output,
            force=args.force,
            source_root=source_root,
            backup_root=backup_root
        )

    # Carrega arquivo de configuração opcional se passado
    exclude_dirs = set(DEFAULT_EXCLUDE_DIRS)
    exclude_files = set(DEFAULT_EXCLUDE_FILES)
    if args.config:
        cfg_path = Path(args.config)
        if cfg_path.exists():
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg_data = json.load(f)
                    if "exclude_dirs" in cfg_data:
                        exclude_dirs.update(cfg_data["exclude_dirs"])
                    if "exclude_files" in cfg_data:
                        exclude_files.update(cfg_data["exclude_files"])
                logging.info(f"Configurações customizadas carregadas de {cfg_path}")
            except Exception as e:
                logging.error(f"Falha ao carregar arquivo de config {cfg_path}: {e}")
                return 1

    # Adiciona inclusões/exclusões avulsas via CLI
    if args.exclude:
        for p in args.exclude.split(","):
            p_strip = p.strip().lower()
            if p_strip:
                if "/" in p_strip or "\\" in p_strip:
                    exclude_dirs.add(p_strip.replace("\\", "/"))
                else:
                    exclude_files.add(p_strip)

    # Valida caminhos de origem
    if not source_root.exists() or not source_root.is_dir():
        logging.error(f"Pasta de origem inválida ou inexistente: {source_root}")
        return 1

    # Define o nome da release se não fornecido
    release_name = args.release_name if args.release_name else f"release_{timestamp_str}"
    logging.info(f"Iniciando processo de backup. Release: {release_name}")
    logging.info(f"Origem (DEV): {source_root}")
    logging.info(f"Destino (Backup): {backup_root}")

    # Cria pastas de backup se não estiver em modo dry-run
    if not args.dry_run:
        backup_root.mkdir(parents=True, exist_ok=True)
        releases_dir.mkdir(parents=True, exist_ok=True)
        
        # Cria arquivo de log local persistente na pasta de backups
        file_handler = logging.FileHandler(backup_root / "backup_incremental.log", encoding="utf-8")
        file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logging.getLogger().addHandler(file_handler)

    # 2. Define índice e tipo do backup
    next_idx = get_next_backup_index(releases_dir)
    is_full = args.force_full or (next_idx == 1)
    backup_type = "full" if is_full else "incremental"
    backup_folder_name = f"{next_idx:06d}_{backup_type}_{release_name}_{timestamp_str}"
    target_backup_dir = releases_dir / backup_folder_name
    
    logging.info(f"Tipo de Backup: {backup_type.upper()} | Índice Sequencial: {next_idx:06d}")
    if args.dry_run:
        logging.info("=== MODO SIMULAÇÃO (DRY RUN) ATIVO ===")

    # 3. Carrega o manifesto anterior se for incremental
    previous_manifest = {}
    if not is_full:
        last_manifest_path = find_last_manifest(releases_dir, next_idx - 1)
        if last_manifest_path:
            try:
                with open(last_manifest_path, "r", encoding="utf-8") as f:
                    previous_manifest = json.load(f)
                logging.info(f"Manifesto anterior carregado com sucesso: {last_manifest_path}")
            except Exception as e:
                logging.warning(
                    f"Falha ao carregar manifesto anterior ({last_manifest_path}): {e}. "
                    f"Forçando backup completo por segurança."
                )
                is_full = True
                backup_type = "full"
                backup_folder_name = f"{next_idx:06d}_full_{release_name}_{timestamp_str}"
                target_backup_dir = releases_dir / backup_folder_name
        else:
            logging.warning(f"Manifesto do backup anterior #{next_idx-1} não encontrado. Forçando backup completo.")
            is_full = True
            backup_type = "full"
            backup_folder_name = f"{next_idx:06d}_full_{release_name}_{timestamp_str}"
            target_backup_dir = releases_dir / backup_folder_name

    # 4. Escaneamento recursivo da origem
    logging.info("Escaneando arquivos da pasta origem...")
    current_manifest = {}
    total_files_scanned = 0

    # Normaliza lista de exclusão com caminhos em minúsculo
    exclude_dirs_normalized = {d.lower() for d in exclude_dirs}

    # Varredura
    for root_dir, dirs, files in os.walk(str(source_root)):
        root_path = Path(root_dir)
        
        # Ignora caminhos inteiros de diretórios excluídos para acelerar a busca
        # Modificando a lista dirs em-lugar faz com que o os.walk não entre neles
        for d in list(dirs):
            d_path = root_path / d
            if is_excluded(d_path, source_root, exclude_dirs_normalized, exclude_files, backup_root):
                logging.debug(f"Diretório ignorado na varredura: {d_path}")
                dirs.remove(d)

        for f in files:
            file_path = root_path / f
            total_files_scanned += 1

            if is_excluded(file_path, source_root, exclude_dirs_normalized, exclude_files, backup_root):
                logging.debug(f"Arquivo ignorado: {file_path}")
                continue

            try:
                rel_path = file_path.relative_to(source_root).as_posix()
                stat = file_path.stat()
                size = stat.st_size
                mtime = stat.st_mtime
                mtime_dt = datetime.datetime.fromtimestamp(mtime)
                mtime_str = mtime_dt.strftime("%Y-%m-%d %H:%M:%S")

                # Otimização: se o arquivo já existia no manifesto anterior com mesmo tamanho e mtime, reaproveita o hash
                prev_info = previous_manifest.get(rel_path)
                if prev_info and prev_info.get("size") == size and prev_info.get("mtime") == mtime_str:
                    sha256 = prev_info["sha256"]
                else:
                    sha256 = calculate_sha256(file_path)

                current_manifest[rel_path] = {
                    "size": size,
                    "mtime": mtime_str,
                    "sha256": sha256
                }
            except Exception as e:
                logging.error(f"Erro ao processar arquivo {file_path}: {e}")
                if not args.verbose:
                    logging.error("Finalizando execução. Use --verbose para mais detalhes.")
                return 1

    logging.info(f"Escaneamento concluído. Total de arquivos analisados no DEV: {total_files_scanned}")
    logging.info(f"Arquivos válidos monitorados pelo manifesto: {len(current_manifest)}")

    # 5. Comparação e detecção de alterações
    added_files = []
    modified_files = []
    deleted_files = []
    unchanged_files = []

    # Detecta arquivos novos e modificados
    for rel_path, info in current_manifest.items():
        if rel_path not in previous_manifest:
            added_files.append(rel_path)
        else:
            prev_info = previous_manifest[rel_path]
            if prev_info["sha256"] != info["sha256"]:
                modified_files.append(rel_path)
            else:
                unchanged_files.append(rel_path)

    # Detecta arquivos removidos (estavam no manifesto anterior mas não no atual)
    for rel_path in previous_manifest:
        if rel_path not in current_manifest:
            deleted_files.append(rel_path)

    logging.info(f"Resumo das alterações detectadas:")
    logging.info(f"  - Novos: {len(added_files)}")
    logging.info(f"  - Modificados: {len(modified_files)}")
    logging.info(f"  - Removidos: {len(deleted_files)}")
    logging.info(f"  - Não alterados: {len(unchanged_files)}")

    # Lista de arquivos que realmente serão copiados
    copy_list = added_files + modified_files

    # Se for incremental e não houver alterações, loga e decide se continua
    if not is_full and not copy_list and not deleted_files:
        logging.info("Nenhuma alteração foi detectada nos arquivos desde o último release.")

    # 6. Executa a cópia física (se não for dry-run)
    files_dir = target_backup_dir / "files"
    if not args.dry_run:
        target_backup_dir.mkdir(parents=True, exist_ok=True)
        files_dir.mkdir(parents=True, exist_ok=True)

        logging.info(f"Copiando arquivos alterados para {files_dir}...")
        copied_count = 0
        for rel_path in copy_list:
            src_file = source_root / rel_path
            dest_file = files_dir / rel_path
            
            # Garante que as pastas pai existam no destino
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            
            try:
                shutil.copy2(str(src_file), str(dest_file))
                copied_count += 1
                logging.debug(f"Arquivo copiado: {rel_path}")
            except Exception as e:
                logging.error(f"Falha ao copiar arquivo {rel_path} para o backup: {e}")
                # Remove pasta de backup parcial se falhar
                try:
                    shutil.rmtree(str(target_backup_dir))
                except Exception:
                    pass
                return 1
        logging.info(f"Cópia concluída. {copied_count} arquivo(s) copiado(s) com sucesso.")

    # 7. Gravação de registros no banco de dados e arquivos
    db = None
    git_branch, git_commit = get_git_info(source_root)
    duration_seconds = int((datetime.datetime.now() - started_at).total_seconds())
    finished_at = datetime.datetime.now()
    finished_at_str = finished_at.strftime("%Y-%m-%d %H:%M:%S")

    # Caminhos relativos dos arquivos salvos na pasta de backups
    manifest_rel_path = (target_backup_dir / "manifest.json").relative_to(backup_root).as_posix()
    summary_rel_path = (target_backup_dir / "release_summary.json").relative_to(backup_root).as_posix()
    
    # Prepara JSON do resumo
    release_summary = {
        "release_name": release_name,
        "description": args.description,
        "backup_type": backup_type,
        "source_root": source_root.as_posix(),
        "backup_path": target_backup_dir.as_posix(),
        "manifest_path": manifest_rel_path,
        "status": "success",
        "started_at": started_at_str,
        "finished_at": finished_at_str,
        "duration_seconds": duration_seconds,
        "total_files_scanned": total_files_scanned,
        "total_added": len(added_files),
        "total_modified": len(modified_files),
        "total_deleted": len(deleted_files),
        "total_unchanged": len(unchanged_files),
        "created_by": getpass.getuser(),
        "git_branch": git_branch,
        "git_commit": git_commit
    }

    if not args.dry_run:
        # Salva manifesto atual em arquivo
        with open(target_backup_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(current_manifest, f, indent=2, ensure_ascii=False)

        # Salva arquivo de arquivos alterados (changed_files.json) se for incremental
        if not is_full:
            changed_info = {
                "added": added_files,
                "modified": modified_files,
                "deleted": deleted_files
            }
            with open(target_backup_dir / "changed_files.json", "w", encoding="utf-8") as f:
                json.dump(changed_info, f, indent=2, ensure_ascii=False)

        # Salva resumo da execução no filesystem
        with open(target_backup_dir / "release_summary.json", "w", encoding="utf-8") as f:
            json.dump(release_summary, f, indent=2, ensure_ascii=False)

        # Tenta gravar no banco de dados (MySQL ou SQLite Fallback)
        try:
            db = DatabaseAdapter(mysql_config=mysql_config, sqlite_path=sqlite_db_path)
            db.init_tables()

            # Insere registro de release
            insert_release_sql = """
            INSERT INTO tabReleases (
                release_name, description, backup_type, source_root, backup_path,
                manifest_path, status, started_at, finished_at, duration_seconds,
                total_files_scanned, total_added, total_modified, total_deleted, total_unchanged,
                created_by, git_branch, git_commit
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s
            )
            """
            release_id = db.execute_insert(insert_release_sql, [
                release_summary["release_name"],
                release_summary["description"],
                release_summary["backup_type"],
                release_summary["source_root"],
                release_summary["backup_path"],
                release_summary["manifest_path"],
                release_summary["status"],
                release_summary["started_at"],
                release_summary["finished_at"],
                release_summary["duration_seconds"],
                release_summary["total_files_scanned"],
                release_summary["total_added"],
                release_summary["total_modified"],
                release_summary["total_deleted"],
                release_summary["total_unchanged"],
                release_summary["created_by"],
                release_summary["git_branch"],
                release_summary["git_commit"]
            ])

            # Prepara lista de arquivos detalhados
            files_params = []
            
            # Query de inserção dos arquivos
            insert_file_sql = """
            INSERT INTO tabReleaseFiles (
                release_id, relative_path, action, size_bytes, mtime,
                sha256_before, sha256_after, backup_file_path
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s
            )
            """

            # Registra novos
            for rel_path in added_files:
                info = current_manifest[rel_path]
                backup_file = (files_dir / rel_path).relative_to(backup_root).as_posix()
                files_params.append([
                    release_id, rel_path, "added", info["size"], info["mtime"],
                    None, info["sha256"], backup_file
                ])

            # Registra modificados
            for rel_path in modified_files:
                info = current_manifest[rel_path]
                prev_info = previous_manifest[rel_path]
                backup_file = (files_dir / rel_path).relative_to(backup_root).as_posix()
                files_params.append([
                    release_id, rel_path, "modified", info["size"], info["mtime"],
                    prev_info["sha256"], info["sha256"], backup_file
                ])

            # Registra removidos
            for rel_path in deleted_files:
                prev_info = previous_manifest[rel_path]
                files_params.append([
                    release_id, rel_path, "deleted", prev_info.get("size", 0), None,
                    prev_info["sha256"], None, None
                ])

            # Salva arquivos alterados em lote
            db.execute_many(insert_file_sql, files_params)
            db.commit()
            logging.info(f"Registros salvos com sucesso no banco de dados ({db.db_type}).")

        except Exception as e:
            if db:
                db.rollback()
            logging.error(f"Erro ao salvar registros no banco de dados: {e}")
            # Em caso de erro sério no banco, o script gera o log de falha no console e encerra
            return 1
        finally:
            if db:
                db.close()

    logging.info("=== Processo de Backup Finalizado com Sucesso ===")
    logging.info(f"Tempo total decorrido: {duration_seconds} segundos.")
    logging.info(f"Caminho do Backup: {target_backup_dir}")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logging.warning("Processo de backup cancelado pelo usuário.")
        sys.exit(130)
    except Exception as exc:
        logging.critical(f"Erro fatal não tratado: {exc}", exc_info=True)
        sys.exit(1)

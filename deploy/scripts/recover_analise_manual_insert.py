"""
Lê dados no MariaDB temporário (backup .ibd) e grava no MySQL 9.7 com INSERT manual.
Não usa IMPORT TABLESPACE nem LOAD no MySQL de produção.
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app" / "backend"))

from config_manager import config_manager  # noqa: E402

BACKUP_DIR = Path(r"\\cgrafsysvm\S\BackupsMySQL\data_bckp\sagrafulldb")
MYSQL_BIN = Path(r"C:\xampp\mysql\bin")
DATADIR = Path(r"C:\dev\SagraWeb\deploy\recovery_temp\datadir3307")
MARIA_PORT = 3307
READ_DB = "sagra_read_manual"

TABLES = [
    {
        "maria": "tabanalises",
        "mysql": "tabAnalises",
        "ddl": """
CREATE TABLE `tabanalises` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `OS` int NOT NULL,
  `Ano` int NOT NULL,
  `Versao` varchar(50) DEFAULT NULL,
  `Componente` varchar(100) DEFAULT NULL,
  `Usuario` varchar(100) DEFAULT NULL,
  `DataCriacao` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `RelatorioHTML` longtext,
  `RelatorioEmail` longtext,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
""",
        "columns": [
            "ID", "OS", "Ano", "Versao", "Componente", "Usuario",
            "DataCriacao", "RelatorioHTML", "RelatorioEmail",
        ],
    },
    {
        "maria": "tabanaliseitens",
        "mysql": "tabAnaliseItens",
        "ddl": """
CREATE TABLE `tabanaliseitens` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `ID_Analise` int NOT NULL,
  `ID_ProblemaPadrao` int DEFAULT NULL,
  `Obs` text,
  `HTML_Snapshot` longtext,
  `Componente` varchar(255) DEFAULT NULL,
  `Desconsiderado` tinyint(1) DEFAULT 0,
  `ClienteNome` varchar(150) DEFAULT NULL,
  `ClientePonto` varchar(20) DEFAULT NULL,
  `DataDesconsiderado` datetime DEFAULT NULL,
  `Resolver` tinyint(1) DEFAULT 0,
  `DataResolver` datetime DEFAULT NULL,
  `ResolucaoObrigatoria` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
""",
        "columns": [
            "ID", "ID_Analise", "ID_ProblemaPadrao", "Obs", "HTML_Snapshot",
            "Componente", "Desconsiderado", "ClienteNome", "ClientePonto",
            "DataDesconsiderado", "Resolver", "DataResolver", "ResolucaoObrigatoria",
        ],
    },
    {
        "maria": "tabclienttokens",
        "mysql": "tabClientTokens",
        "ddl": """
CREATE TABLE `tabclienttokens` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `ID_Analise` int NOT NULL,
  `NroProtocolo` int NOT NULL,
  `AnoProtocolo` int NOT NULL,
  `Token` varchar(64) NOT NULL,
  `DataCriacao` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `DataExpiracao` datetime DEFAULT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
""",
        "columns": [
            "ID", "ID_Analise", "NroProtocolo", "AnoProtocolo",
            "Token", "DataCriacao", "DataExpiracao",
        ],
    },
    {
        "maria": "tabproblemaspadrao",
        "mysql": "tabProblemasPadrao",
        "ddl": """
CREATE TABLE `tabproblemaspadrao` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `TituloPT` varchar(255) NOT NULL,
  `ProbTecHTML` longtext,
  `Categoria` varchar(100) DEFAULT 'Geral',
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
""",
        "columns": ["ID", "TituloPT", "ProbTecHTML", "Categoria"],
    },
]


def run_sql(port: int, sql: str) -> None:
    proc = subprocess.run(
        [
            str(MYSQL_BIN / "mysql.exe"),
            "--host=127.0.0.1",
            f"--port={port}",
            "-uroot",
            "-e",
            sql,
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout)


def wait_mariadb() -> None:
    for _ in range(40):
        try:
            run_sql(MARIA_PORT, "SELECT 1")
            return
        except Exception:
            time.sleep(1)
    raise TimeoutError("MariaDB não respondeu na porta 3307")


def ensure_mariadb_running() -> subprocess.Popen | None:
    try:
        run_sql(MARIA_PORT, "SELECT 1")
        print("MariaDB temporário já está ativo.")
        return None
    except Exception:
        pass

    if not DATADIR.exists():
        subprocess.run(
            [str(MYSQL_BIN / "mysql_install_db.exe"), f"--datadir={DATADIR}"],
            check=True,
        )

    print("Iniciando MariaDB temporário (somente leitura do backup)...")
    proc = subprocess.Popen(
        [
            str(MYSQL_BIN / "mysqld.exe"),
            f"--datadir={DATADIR}",
            f"--port={MARIA_PORT}",
            "--skip-grant-tables",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    wait_mariadb()
    return proc


def attach_ibd_for_read(table: str, ddl: str) -> int:
    """Monta .ibd do backup no MariaDB temporário para permitir SELECT."""
    ibd_src = BACKUP_DIR / f"{table}.ibd"
    ibd_dst = DATADIR / READ_DB / f"{table}.ibd"

    run_sql(MARIA_PORT, f"USE `{READ_DB}`; DROP TABLE IF EXISTS `{table}`")
    run_sql(MARIA_PORT, f"USE `{READ_DB}`; {ddl.strip()}")
    run_sql(MARIA_PORT, f"USE `{READ_DB}`; ALTER TABLE `{table}` DISCARD TABLESPACE")
    ibd_dst.write_bytes(ibd_src.read_bytes())
    run_sql(MARIA_PORT, f"USE `{READ_DB}`; ALTER TABLE `{table}` IMPORT TABLESPACE")

    with pymysql.connect(
        host="127.0.0.1",
        port=MARIA_PORT,
        user="root",
        database=READ_DB,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    ) as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) AS c FROM `{table}`")
        return int(cur.fetchone()["c"])


def read_rows(table: str, columns: list[str]) -> list[tuple]:
    col_sql = ", ".join(f"`{c}`" for c in columns)
    with pymysql.connect(
        host="127.0.0.1",
        port=MARIA_PORT,
        user="root",
        database=READ_DB,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    ) as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT {col_sql} FROM `{table}`")
        rows = cur.fetchall()
    return [tuple(r[c] for c in columns) for r in rows]


def manual_insert_mysql(table: str, columns: list[str], rows: list[tuple]) -> int:
    if not rows:
        return 0
    col_sql = ", ".join(f"`{c}`" for c in columns)
    ph = ", ".join(["%s"] * len(columns))
    insert_sql = f"INSERT INTO `{table}` ({col_sql}) VALUES ({ph})"

    cfg = config_manager.get_mysql_config()
    with pymysql.connect(
        host=cfg["host"],
        port=int(cfg["port"]),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        autocommit=False,
    ) as conn:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM `{table}`")
        for row in rows:
            cur.execute(insert_sql, row)
        conn.commit()
    return len(rows)


def main() -> int:
    mariadb_proc = None
    try:
        run_sql(MARIA_PORT, "SELECT 1")
    except Exception:
        mariadb_proc = ensure_mariadb_running()

    try:
        run_sql(MARIA_PORT, f"DROP DATABASE IF EXISTS `{READ_DB}`")
        run_sql(
            MARIA_PORT,
            f"CREATE DATABASE `{READ_DB}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci",
        )

        cfg = config_manager.get_mysql_config()
        with pymysql.connect(
            host=cfg["host"],
            port=int(cfg["port"]),
            user=cfg["user"],
            password=cfg["password"],
            database=cfg["database"],
            charset="utf8mb4",
        ) as conn:
            cur = conn.cursor()
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            conn.commit()

        total = 0
        print("Lendo MariaDB -> gravando INSERT manual no MySQL...")
        for spec in TABLES:
            n_read = attach_ibd_for_read(spec["maria"], spec["ddl"])
            rows = read_rows(spec["maria"], spec["columns"])
            n_written = manual_insert_mysql(spec["mysql"], spec["columns"], rows)
            total += n_written
            print(
                f"  {spec['mysql']}: lidas={len(rows)} (ibd~{n_read}) "
                f"inseridas_manual={n_written}"
            )

        with pymysql.connect(
            host=cfg["host"],
            port=int(cfg["port"]),
            user=cfg["user"],
            password=cfg["password"],
            database=cfg["database"],
            charset="utf8mb4",
        ) as conn:
            cur = conn.cursor()
            cur.execute("SET FOREIGN_KEY_CHECKS=1")
            conn.commit()

        print(f"Concluído: {total} linhas gravadas manualmente no MySQL.")
        return 0
    except Exception as exc:
        print(f"ERRO: {exc}")
        return 2
    finally:
        if mariadb_proc and mariadb_proc.poll() is None:
            mariadb_proc.terminate()


if __name__ == "__main__":
    raise SystemExit(main())

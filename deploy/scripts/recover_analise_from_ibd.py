"""
Recover analise tables from physical .ibd backup (MariaDB 10.4) via local XAMPP,
then import rows into production MySQL 9.7.

Requires:
  - XAMPP MariaDB 10.4 at C:\\xampp\\mysql
  - Network access to backup share and production DB (config/.env)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app" / "backend"))

from config_manager import config_manager  # noqa: E402

BACKUP_DIR = Path(r"\\cgrafsysvm\S\BackupsMySQL\data_bckp\sagrafulldb")
XAMPP_MYSQL = Path(r"C:\xampp\mysql\bin\mysql.exe")
LOCAL = {
    "host": "127.0.0.1",
    "port": int(__import__("os").environ.get("RECOVER_MYSQL_PORT", "3307")),
    "user": "root",
    "password": "",
    "charset": "utf8mb4",
}
RECOVER_DB = "sagra_recover_ibd"

TABLES_ORDER = [
    "tabanalises",
    "tabanaliseitens",
    "tabclienttokens",
    "tabproblemaspadrao",
]

DDL = {
    "tabanalises": """
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
    "tabanaliseitens": """
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
  PRIMARY KEY (`ID`),
  KEY `ID_Analise` (`ID_Analise`),
  CONSTRAINT `tabanaliseitens_ibfk_1` FOREIGN KEY (`ID_Analise`) REFERENCES `tabanalises` (`ID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
""",
    "tabclienttokens": """
CREATE TABLE `tabclienttokens` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `ID_Analise` int NOT NULL,
  `NroProtocolo` int NOT NULL,
  `AnoProtocolo` int NOT NULL,
  `Token` varchar(64) NOT NULL,
  `DataCriacao` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `DataExpiracao` datetime DEFAULT NULL,
  PRIMARY KEY (`ID`),
  UNIQUE KEY `unique_token` (`Token`),
  KEY `ID_Analise` (`ID_Analise`),
  CONSTRAINT `tabclienttokens_ibfk_1` FOREIGN KEY (`ID_Analise`) REFERENCES `tabanalises` (`ID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
""",
    "tabproblemaspadrao": """
CREATE TABLE `tabproblemaspadrao` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `TituloPT` varchar(255) NOT NULL,
  `ProbTecHTML` longtext,
  `Categoria` varchar(100) DEFAULT 'Geral',
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
""",
}


def run_local_sql(sql: str) -> None:
    cmd = [
        str(XAMPP_MYSQL),
        f"--host={LOCAL['host']}",
        f"--port={LOCAL['port']}",
        f"-u{LOCAL['user']}",
        "-e",
        sql,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout)


def local_conn():
    return pymysql.connect(
        host=LOCAL["host"],
        port=LOCAL["port"],
        user=LOCAL["user"],
        password=LOCAL["password"],
        charset=LOCAL["charset"],
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


def prod_conn():
    cfg = config_manager.get_mysql_config()
    return pymysql.connect(
        host=cfg["host"],
        port=int(cfg["port"]),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


def xampp_datadir_table(table: str) -> Path:
    datadir = Path(
        __import__("os").environ.get(
            "RECOVER_DATADIR",
            r"C:\dev\SagraWeb\deploy\recovery_temp\datadir3307",
        )
    )
    return datadir / RECOVER_DB / f"{table}.ibd"


def import_tablespace(table: str) -> int:
    src_ibd = BACKUP_DIR / f"{table}.ibd"
    if not src_ibd.exists():
        raise FileNotFoundError(src_ibd)

    with local_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"USE `{RECOVER_DB}`")
        cur.execute(f"ALTER TABLE `{table}` DISCARD TABLESPACE")
        cur.close()

    dest = xampp_datadir_table(table)
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = src_ibd.read_bytes()
    dest.write_bytes(data)

    with local_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"USE `{RECOVER_DB}`")
        cur.execute(f"ALTER TABLE `{table}` IMPORT TABLESPACE")
        cur.execute(f"SELECT COUNT(*) AS c FROM `{table}`")
        count = cur.fetchone()["c"]
        cur.close()
    return int(count)


def copy_rows(table: str, columns: list[str]) -> int:
    col_sql = ", ".join(f"`{c}`" for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))

    with local_conn() as src, prod_conn() as dst:
        s_cur = src.cursor()
        d_cur = dst.cursor()
        s_cur.execute(f"USE `{RECOVER_DB}`")
        s_cur.execute(f"SELECT {col_sql} FROM `{table}`")
        rows = s_cur.fetchall()
        if not rows:
            return 0

        prod_table = {
            "tabanalises": "tabAnalises",
            "tabanaliseitens": "tabAnaliseItens",
            "tabclienttokens": "tabClientTokens",
            "tabproblemaspadrao": "tabProblemasPadrao",
        }[table]

        d_cur.execute(f"DELETE FROM `{prod_table}`")
        d_cur.executemany(
            f"INSERT INTO `{prod_table}` ({col_sql}) VALUES ({placeholders})",
            [tuple(row[c] for c in columns) for row in rows],
        )
        dst.commit()
        return len(rows)


def main() -> int:
    if not XAMPP_MYSQL.exists():
        print("XAMPP MariaDB não encontrado em C:\\xampp\\mysql")
        return 1
    if not BACKUP_DIR.exists():
        print(f"Backup não acessível: {BACKUP_DIR}")
        return 1

    print("1) Preparando banco temporário no XAMPP...")
    run_local_sql(f"DROP DATABASE IF EXISTS `{RECOVER_DB}`")
    run_local_sql(f"CREATE DATABASE `{RECOVER_DB}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci")

    # DDL sem FK para importar tablespaces; FKs adicionadas depois.
    ddl_no_fk = {
        "tabanalises": DDL["tabanalises"],
        "tabanaliseitens": """
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
        "tabclienttokens": """
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
        "tabproblemaspadrao": DDL["tabproblemaspadrao"],
    }

    print("2) Criando tabelas e importando tablespaces dos .ibd...")
    counts: dict[str, int] = {}
    for table in TABLES_ORDER:
        print(f"   CREATE + IMPORT {table}")
        run_local_sql(f"USE `{RECOVER_DB}`; {ddl_no_fk[table].strip()}")
        try:
            n = import_tablespace(table)
            counts[table] = n
            print(f"   {table}: {n} linhas")
        except Exception as exc:
            print(f"   ERRO em {table}: {exc}")
            return 2

    print("3) Copiando para produção (MySQL 9.7)...")
    column_map = {
        "tabanalises": [
            "ID",
            "OS",
            "Ano",
            "Versao",
            "Componente",
            "Usuario",
            "DataCriacao",
            "RelatorioHTML",
            "RelatorioEmail",
        ],
        "tabanaliseitens": [
            "ID",
            "ID_Analise",
            "ID_ProblemaPadrao",
            "Obs",
            "HTML_Snapshot",
            "Componente",
            "Desconsiderado",
            "ClienteNome",
            "ClientePonto",
            "DataDesconsiderado",
            "Resolver",
            "DataResolver",
            "ResolucaoObrigatoria",
        ],
        "tabclienttokens": [
            "ID",
            "ID_Analise",
            "NroProtocolo",
            "AnoProtocolo",
            "Token",
            "DataCriacao",
            "DataExpiracao",
        ],
        "tabproblemaspadrao": ["ID", "TituloPT", "ProbTecHTML", "Categoria"],
    }

    # Disable FK checks on production during load
    with prod_conn() as conn:
        cur = conn.cursor()
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        conn.commit()

    imported_total = 0
    for table in TABLES_ORDER:
        n = copy_rows(table, column_map[table])
        imported_total += n
        print(f"   -> {table}: {n} linhas inseridas em produção")

    with prod_conn() as conn:
        cur = conn.cursor()
        cur.execute("SET FOREIGN_KEY_CHECKS=1")
        conn.commit()

    print(f"Concluído. Total importado: {imported_total} linhas.")
    print("4) Limpando banco temporário...")
    run_local_sql(f"DROP DATABASE IF EXISTS `{RECOVER_DB}`")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

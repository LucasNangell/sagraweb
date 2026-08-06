"""
Garante tabelas MySQL do módulo Credenciais DEPOL.
"""
from __future__ import annotations

import logging
from pathlib import Path

from database import db

logger = logging.getLogger(__name__)

_schema_ready = False

_SQL_FILES = (
    "create_credenciais_depol.sql",
    "create_credenciais_depol_modelos.sql",
)

# Fallback embutido — não depende de deploy/sql no disco (release/cwd).
_EMBEDDED_DDL = (
    """
    CREATE TABLE IF NOT EXISTS tabCredenciaisDepolPedidos (
        ID BIGINT AUTO_INCREMENT PRIMARY KEY,
        Titulo VARCHAR(200) NULL,
        Observacao TEXT NULL,
        Status VARCHAR(32) NOT NULL DEFAULT 'aberto',
        CriadoPor VARCHAR(32) NOT NULL,
        CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        AnoProtocolo INT NULL,
        NroProtocolo INT NULL,
        VinculadoPor VARCHAR(32) NULL,
        VinculadoEm DATETIME NULL,
        JobID BIGINT NULL,
        INDEX idx_cred_depol_status (Status),
        INDEX idx_cred_depol_os (AnoProtocolo, NroProtocolo),
        INDEX idx_cred_depol_criado (CriadoEm)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS tabCredenciaisDepolItens (
        ID BIGINT AUTO_INCREMENT PRIMARY KEY,
        PedidoID BIGINT NOT NULL,
        Ordem INT NOT NULL DEFAULT 1,
        ModeloArquivo VARCHAR(255) NOT NULL,
        Linha1 VARCHAR(255) NOT NULL,
        Linha2 VARCHAR(255) NULL,
        Linha3 VARCHAR(255) NULL,
        INDEX idx_cred_depol_itens_pedido (PedidoID),
        CONSTRAINT fk_cred_depol_itens_pedido
            FOREIGN KEY (PedidoID) REFERENCES tabCredenciaisDepolPedidos(ID)
            ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS tabCredenciaisDepolModelos (
        ID BIGINT AUTO_INCREMENT PRIMARY KEY,
        ArquivoJpg VARCHAR(255) NOT NULL,
        NomeExibicao VARCHAR(200) NULL,
        Ativo TINYINT(1) NOT NULL DEFAULT 1,
        Ordem INT NOT NULL DEFAULT 0,
        LayoutJson JSON NOT NULL,
        AtualizadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_cred_depol_modelo_jpg (ArquivoJpg),
        INDEX idx_cred_depol_modelo_ativo (Ativo, Ordem)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
)

_REQUIRED_TABLES = (
    "tabCredenciaisDepolPedidos",
    "tabCredenciaisDepolItens",
    "tabCredenciaisDepolModelos",
)


def _sql_dirs() -> list[Path]:
    dirs: list[Path] = []
    try:
        from config_manager import PROJECT_ROOT

        dirs.append(Path(PROJECT_ROOT) / "deploy" / "sql")
    except Exception:
        pass
    # app/backend/credenciais_depol_schema.py → raiz do repo / release
    here = Path(__file__).resolve()
    dirs.append(here.parents[2] / "deploy" / "sql")
    # release layout: .../app/backend → .../sql
    if len(here.parents) >= 3:
        dirs.append(here.parents[2] / "sql")
        dirs.append(here.parents[3] / "deploy" / "sql")
    # dedupe preservando ordem
    seen: set[str] = set()
    out: list[Path] = []
    for d in dirs:
        key = str(d.resolve()) if d.exists() else str(d)
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


def _run_sql_script(raw: str) -> None:
    for stmt in raw.split(";"):
        s = stmt.strip()
        if s:
            db.execute_query(s)


def _table_exists(name: str) -> bool:
    rows = db.execute_query(
        """
        SELECT COUNT(*) AS cnt
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %(name)s
        """,
        {"name": name},
    )
    return bool(rows and int(rows[0].get("cnt") or 0) > 0)


def ensure_credenciais_depol_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return

    applied_from_file = False
    for sql_dir in _sql_dirs():
        for name in _SQL_FILES:
            sql_path = sql_dir / name
            if not sql_path.is_file():
                continue
            try:
                _run_sql_script(sql_path.read_text(encoding="utf-8"))
                applied_from_file = True
                logger.info("SQL Credenciais DEPOL aplicado: %s", sql_path)
            except Exception as exc:
                logger.warning("Falha ao aplicar %s: %s", sql_path, exc)

    # Sempre aplica DDL embutido (IF NOT EXISTS) — cobre pasta SQL ausente no host.
    for ddl in _EMBEDDED_DDL:
        try:
            db.execute_query(ddl)
        except Exception as exc:
            logger.warning("Falha no DDL embutido Credenciais DEPOL: %s", exc)

    missing = [t for t in _REQUIRED_TABLES if not _table_exists(t)]
    if missing:
        _schema_ready = False
        raise RuntimeError(
            "Tabelas Credenciais DEPOL ausentes após ensure: "
            + ", ".join(missing)
            + (" (SQL em disco aplicado)" if applied_from_file else " (só DDL embutido)")
        )

    _schema_ready = True
    logger.info(
        "Tabelas tabCredenciaisDepolPedidos/Itens/Modelos verificadas/criadas"
    )


def reset_credenciais_depol_schema_cache() -> None:
    """Útil em testes."""
    global _schema_ready
    _schema_ready = False

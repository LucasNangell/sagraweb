"""Schema do catálogo administrável de listas do sistema (setores, produtos, etc.)."""
from __future__ import annotations

import logging

from database import db

logger = logging.getLogger(__name__)

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS tabSystemCatalog (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Categoria VARCHAR(32) NOT NULL,
    Rotulo VARCHAR(255) NOT NULL,
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    Ordem INT NOT NULL DEFAULT 50,
    Origem VARCHAR(16) NOT NULL DEFAULT 'catalog',
    CriadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    AtualizadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    AtualizadoPorPonto VARCHAR(32) NULL,
    UNIQUE KEY uq_system_catalog_cat_rotulo (Categoria, Rotulo),
    KEY idx_system_catalog_categoria (Categoria),
    KEY idx_system_catalog_ativo (Categoria, Ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CREATE_VARIACAO_SQL = """
CREATE TABLE IF NOT EXISTS tabSystemCatalogVariacao (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    CatalogID INT NOT NULL,
    Rotulo VARCHAR(255) NOT NULL,
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    Ordem INT NOT NULL DEFAULT 50,
    CriadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    AtualizadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    AtualizadoPorPonto VARCHAR(32) NULL,
    UNIQUE KEY uq_catalog_variacao (CatalogID, Rotulo),
    KEY idx_variacao_catalog_id (CatalogID),
    CONSTRAINT fk_variacao_catalog FOREIGN KEY (CatalogID)
        REFERENCES tabSystemCatalog(ID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

# Rótulos iniciais da categoria acabamento (preparação; sem uso operacional ainda).
_ACABAMENTO_SEED: tuple[tuple[str, int], ...] = (
    ("Dobra", 10),
    ("Refile", 20),
    ("Laminação", 30),
    ("Costura", 40),
    ("Wire-O", 50),
    ("Espiral", 60),
    ("Verniz", 70),
    ("Faca", 80),
    ("Grampo", 90),
)

# Variações seed para Laminação (exemplo canônico do pedido).
_LAMINACAO_VARIACOES_SEED: tuple[tuple[str, int], ...] = (
    ("Fosca", 10),
    ("Brilho", 20),
)


def _seed_acabamento_catalog() -> None:
    for rotulo, ordem in _ACABAMENTO_SEED:
        db.execute_query(
            """
            INSERT IGNORE INTO tabSystemCatalog (Categoria, Rotulo, Ativo, Ordem, Origem)
            VALUES (%s, %s, 1, %s, 'catalog')
            """,
            ("acabamento", rotulo, ordem),
        )


def _seed_laminacao_variacoes() -> None:
    rows = db.execute_query(
        "SELECT ID FROM tabSystemCatalog WHERE Categoria = %s AND Rotulo = %s LIMIT 1",
        ("acabamento", "Laminação"),
    )
    if not rows:
        return
    catalog_id = rows[0]["ID"]
    for rotulo, ordem in _LAMINACAO_VARIACOES_SEED:
        db.execute_query(
            """
            INSERT IGNORE INTO tabSystemCatalogVariacao (CatalogID, Rotulo, Ativo, Ordem)
            VALUES (%s, %s, 1, %s)
            """,
            (catalog_id, rotulo, ordem),
        )


def ensure_system_catalog_schema() -> None:
    db.execute_query(_CREATE_SQL)
    db.execute_query(_CREATE_VARIACAO_SQL)
    _seed_acabamento_catalog()
    _seed_laminacao_variacoes()
    logger.info("Tabelas tabSystemCatalog / tabSystemCatalogVariacao verificadas/criadas")

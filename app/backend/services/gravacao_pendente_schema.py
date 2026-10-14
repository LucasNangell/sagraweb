"""Schema MySQL para Gravação Pendente."""
from __future__ import annotations

import logging

from database import db

logger = logging.getLogger(__name__)

_PENDENTE_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_gravacao_pendente (
  Id INT NOT NULL AUTO_INCREMENT,
  OsAno INT NOT NULL,
  OsNro INT NOT NULL,
  CodStatus VARCHAR(32) NOT NULL,
  Origem VARCHAR(32) NOT NULL DEFAULT 'andamento',
  Componente VARCHAR(16) NOT NULL DEFAULT 'todos',
  LancadoPorPonto VARCHAR(32) NOT NULL,
  LancadoPorNome VARCHAR(128) DEFAULT NULL,
  Cliente VARCHAR(255) DEFAULT NULL,
  Status VARCHAR(16) NOT NULL DEFAULT 'ativa',
  EnviadaEm DATETIME DEFAULT NULL,
  EnviadaPorPonto VARCHAR(32) DEFAULT NULL,
  JuntadaGrupoId CHAR(36) DEFAULT NULL,
  Observacao TEXT DEFAULT NULL,
  CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  KEY idx_gp_os (OsAno, OsNro),
  KEY idx_gp_status (Status),
  KEY idx_gp_cod_status (CodStatus),
  KEY idx_gp_juntada (JuntadaGrupoId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_ARQUIVO_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_gravacao_pendente_arquivo (
  Id INT NOT NULL AUTO_INCREMENT,
  GravacaoPendenteId INT NOT NULL,
  AbsolutePath VARCHAR(1024) NOT NULL,
  NomeArquivo VARCHAR(255) NOT NULL,
  TamanhoBytes BIGINT DEFAULT NULL,
  Ordem INT NOT NULL DEFAULT 0,
  PRIMARY KEY (Id),
  KEY idx_gp_arq_sessao (GravacaoPendenteId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_CHAPA_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_gravacao_pendente_chapa (
  Id INT NOT NULL AUTO_INCREMENT,
  GravacaoPendenteId INT NOT NULL,
  Maquina VARCHAR(128) NOT NULL,
  QuantidadeChapas INT NOT NULL DEFAULT 0,
  PRIMARY KEY (Id),
  KEY idx_gp_chapa_sessao (GravacaoPendenteId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_CONFIG_SQL = """
CREATE TABLE IF NOT EXISTS tab_gravacao_pendente_config (
  Id TINYINT NOT NULL PRIMARY KEY,
  CotaInicialChapas INT NOT NULL DEFAULT 0,
  AtualizadoEm DATETIME DEFAULT NULL,
  AtualizadoPorPonto VARCHAR(32) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_MAQUINA_CONFIG_SQL = """
CREATE TABLE IF NOT EXISTS tab_gravacao_pendente_maquina_config (
  Maquina VARCHAR(32) NOT NULL,
  CotaChapas INT NOT NULL DEFAULT 0,
  PrecoChapa DECIMAL(12,4) NOT NULL DEFAULT 0,
  AtualizadoEm DATETIME DEFAULT NULL,
  AtualizadoPorPonto VARCHAR(32) DEFAULT NULL,
  PRIMARY KEY (Maquina)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_FORNECEDOR_COTA_SQL = """
CREATE TABLE IF NOT EXISTS tab_gravacao_pendente_fornecedor_cota (
  FornecedorPonto VARCHAR(32) NOT NULL,
  Maquina VARCHAR(32) NOT NULL,
  CotaChapas INT NOT NULL DEFAULT 0,
  PrecoChapa DECIMAL(12,4) NOT NULL DEFAULT 0,
  AtualizadoEm DATETIME DEFAULT NULL,
  AtualizadoPorPonto VARCHAR(32) DEFAULT NULL,
  PRIMARY KEY (FornecedorPonto, Maquina)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_FORNECEDOR_COTA_V2_SQL = """
CREATE TABLE IF NOT EXISTS tab_gravacao_pendente_fornecedor_cota_v2 (
  FornecedorPonto VARCHAR(32) NOT NULL,
  Maquina VARCHAR(32) NOT NULL,
  CotaChapas INT NOT NULL DEFAULT 0,
  PrecoChapa DECIMAL(12,4) NOT NULL DEFAULT 0,
  AtualizadoEm DATETIME DEFAULT NULL,
  AtualizadoPorPonto VARCHAR(32) DEFAULT NULL,
  PRIMARY KEY (FornecedorPonto, Maquina)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_ALLOWED_MAQUINAS = ("Komori", "SM74", "PM52")

_COTA_AJUSTE_LOG_SQL = """
CREATE TABLE IF NOT EXISTS tab_gravacao_pendente_cota_ajuste_log (
  Id INT NOT NULL AUTO_INCREMENT,
  ValorAnterior INT DEFAULT NULL,
  ValorNovo INT DEFAULT NULL,
  Delta INT DEFAULT NULL,
  Modo VARCHAR(16) DEFAULT NULL,
  Observacao TEXT DEFAULT NULL,
  LancadoPorPonto VARCHAR(32) DEFAULT NULL,
  CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

# Bump CONTROL_LIST_EPOCH to force a one-time wipe of the controle list cutoff.
CONTROL_LIST_EPOCH = 1

_CONFIG_MIGRATIONS = (
    (
        "tab_gravacao_pendente_config",
        "ControleListDesde",
        "ALTER TABLE tab_gravacao_pendente_config ADD COLUMN ControleListDesde DATETIME DEFAULT NULL",
    ),
    (
        "tab_gravacao_pendente_config",
        "ControleListEpoch",
        "ALTER TABLE tab_gravacao_pendente_config ADD COLUMN ControleListEpoch INT NOT NULL DEFAULT 0",
    ),
)

_FORNECEDOR_COTA_MIGRATIONS = (
    (
        "tab_gravacao_pendente_fornecedor_cota",
        "PrecoChapa",
        "ALTER TABLE tab_gravacao_pendente_fornecedor_cota "
        "ADD COLUMN PrecoChapa DECIMAL(12,4) NOT NULL DEFAULT 0",
    ),
)

_PENDENTE_MIGRATIONS = (
    (
        "tab_os_gravacao_pendente",
        "Origem",
        "ALTER TABLE tab_os_gravacao_pendente "
        "ADD COLUMN Origem VARCHAR(32) NOT NULL DEFAULT 'andamento' AFTER CodStatus",
    ),
    (
        "tab_os_gravacao_pendente",
        "Componente",
        "ALTER TABLE tab_os_gravacao_pendente "
        "ADD COLUMN Componente VARCHAR(16) NOT NULL DEFAULT 'todos' AFTER Origem",
    ),
    (
        "tab_os_gravacao_pendente",
        "Cliente",
        "ALTER TABLE tab_os_gravacao_pendente ADD COLUMN Cliente VARCHAR(255) DEFAULT NULL",
    ),
    (
        "tab_os_gravacao_pendente",
        "JuntadaGrupoId",
        "ALTER TABLE tab_os_gravacao_pendente ADD COLUMN JuntadaGrupoId CHAR(36) DEFAULT NULL",
    ),
    (
        "tab_os_gravacao_pendente",
        "Observacao",
        "ALTER TABLE tab_os_gravacao_pendente ADD COLUMN Observacao TEXT DEFAULT NULL",
    ),
    (
        "tab_os_gravacao_pendente",
        "DesmembradaDeId",
        "ALTER TABLE tab_os_gravacao_pendente ADD COLUMN DesmembradaDeId INT DEFAULT NULL",
    ),
)

_ARQUIVO_MIGRATIONS = (
    (
        "tab_os_gravacao_pendente_arquivo",
        "Maquina",
        "ALTER TABLE tab_os_gravacao_pendente_arquivo ADD COLUMN Maquina VARCHAR(128) DEFAULT NULL",
    ),
)

_EXTERNA_MIGRATIONS = (
    (
        "tab_os_gravacao_externa",
        "Componente",
        "ALTER TABLE tab_os_gravacao_externa "
        "ADD COLUMN Componente VARCHAR(16) NOT NULL DEFAULT 'todos' AFTER CodStatus",
    ),
    (
        "tab_os_gravacao_externa",
        "OrigemPendenteId",
        "ALTER TABLE tab_os_gravacao_externa ADD COLUMN OrigemPendenteId INT DEFAULT NULL",
    ),
    (
        "tab_os_gravacao_externa",
        "JuntadaGrupoId",
        "ALTER TABLE tab_os_gravacao_externa ADD COLUMN JuntadaGrupoId CHAR(36) DEFAULT NULL",
    ),
    (
        "tab_os_gravacao_externa",
        "Observacao",
        "ALTER TABLE tab_os_gravacao_externa ADD COLUMN Observacao TEXT DEFAULT NULL",
    ),
    (
        "tab_os_gravacao_externa_arquivo",
        "AbsolutePath",
        "ALTER TABLE tab_os_gravacao_externa_arquivo ADD COLUMN AbsolutePath VARCHAR(1024) DEFAULT NULL",
    ),
    (
        "tab_os_gravacao_externa_arquivo",
        "Maquina",
        "ALTER TABLE tab_os_gravacao_externa_arquivo ADD COLUMN Maquina VARCHAR(128) DEFAULT NULL",
    ),
)


def _column_exists(table: str, column: str) -> bool:
    rows = db.execute_query(
        """
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        LIMIT 1
        """,
        (table, column),
    )
    return bool(rows)


def _apply_column_migrations(migrations: tuple[tuple[str, str, str], ...]) -> None:
    for table, column, ddl in migrations:
        if not _column_exists(table, column):
            db.execute_query(ddl)
            logger.info("Coluna %s.%s adicionada", table, column)


def _table_exists(table: str) -> bool:
    rows = db.execute_query(
        """
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
        LIMIT 1
        """,
        (table,),
    )
    return bool(rows)


def _index_exists(table: str, index_name: str) -> bool:
    rows = db.execute_query(
        """
        SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        LIMIT 1
        """,
        (table, index_name),
    )
    return bool(rows)


def _migrate_fornecedor_cota_to_maquina_pk() -> None:
    """Garante PK (FornecedorPonto, Maquina); migra legado sem coluna Maquina."""
    if not _table_exists("tab_gravacao_pendente_fornecedor_cota"):
        db.execute_query(_FORNECEDOR_COTA_SQL)
        return

    if _column_exists("tab_gravacao_pendente_fornecedor_cota", "Maquina"):
        return

    logger.info("Migrando tab_gravacao_pendente_fornecedor_cota para PK com Maquina")
    db.execute_query(_FORNECEDOR_COTA_V2_SQL)
    db.execute_query(
        """
        INSERT INTO tab_gravacao_pendente_fornecedor_cota_v2
            (FornecedorPonto, Maquina, CotaChapas, PrecoChapa, AtualizadoEm, AtualizadoPorPonto)
        SELECT FornecedorPonto, 'Komori', CotaChapas, 0, AtualizadoEm, AtualizadoPorPonto
        FROM tab_gravacao_pendente_fornecedor_cota
        """
    )
    db.execute_query("DROP TABLE tab_gravacao_pendente_fornecedor_cota")
    db.execute_query(
        "RENAME TABLE tab_gravacao_pendente_fornecedor_cota_v2 "
        "TO tab_gravacao_pendente_fornecedor_cota"
    )


def _seed_fornecedor_cota_maquinas() -> None:
    """Garante linhas 0 para cada fornecedor × máquina."""
    if not _column_exists("tab_gravacao_pendente_fornecedor_cota", "Maquina"):
        return
    from routers.andamento_helpers import format_ponto
    from services.os_vinculo_grupo_service import _clean_ponto

    has_preco = _column_exists("tab_gravacao_pendente_fornecedor_cota", "PrecoChapa")
    fornecedores = db.execute_query(
        """
        SELECT Ponto FROM tabUsuarios
        WHERE Fornecedor = 1 AND COALESCE(AuthAtivo, 1) = 1
        """
    )
    for row in fornecedores or []:
        ponto = format_ponto(_clean_ponto(str(row.get("Ponto") or "")))
        if not ponto:
            continue
        for maquina in _ALLOWED_MAQUINAS:
            if has_preco:
                db.execute_query(
                    """
                    INSERT IGNORE INTO tab_gravacao_pendente_fornecedor_cota
                        (FornecedorPonto, Maquina, CotaChapas, PrecoChapa)
                    VALUES (%s, %s, 0, 0)
                    """,
                    (ponto, maquina),
                )
            else:
                db.execute_query(
                    """
                    INSERT IGNORE INTO tab_gravacao_pendente_fornecedor_cota
                        (FornecedorPonto, Maquina, CotaChapas)
                    VALUES (%s, %s, 0)
                    """,
                    (ponto, maquina),
                )


def _seed_fornecedor_preco_from_maquina() -> None:
    """Copia PrecoChapa de maquina_config para linhas fornecedor×máquina ainda em 0."""
    if not _column_exists("tab_gravacao_pendente_fornecedor_cota", "PrecoChapa"):
        return
    if not _column_exists("tab_gravacao_pendente_maquina_config", "PrecoChapa"):
        return
    db.execute_query(
        """
        UPDATE tab_gravacao_pendente_fornecedor_cota fc
        INNER JOIN tab_gravacao_pendente_maquina_config mc
            ON mc.Maquina = fc.Maquina
        SET fc.PrecoChapa = mc.PrecoChapa
        WHERE COALESCE(fc.PrecoChapa, 0) = 0
          AND COALESCE(mc.PrecoChapa, 0) > 0
        """
    )


def _dedupe_fornecedor_cota_ponto_formats() -> None:
    """Remove duplicatas ponto formatado vs só-dígitos (evita soma 2× no banner)."""
    if not _column_exists("tab_gravacao_pendente_fornecedor_cota", "Maquina"):
        return
    from collections import defaultdict

    from routers.andamento_helpers import format_ponto
    from services.os_vinculo_grupo_service import _clean_ponto

    rows = db.execute_query(
        """
        SELECT FornecedorPonto, Maquina, CotaChapas,
               COALESCE(PrecoChapa, 0) AS PrecoChapa,
               AtualizadoEm, AtualizadoPorPonto
        FROM tab_gravacao_pendente_fornecedor_cota
        """
    )
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows or []:
        raw = str(row.get("FornecedorPonto") or "").strip()
        key = _clean_ponto(raw)
        maquina = str(row.get("Maquina") or "").strip()
        if not key or not maquina:
            continue
        groups[(key, maquina)].append(
            {
                "raw": raw,
                "cota": int(row.get("CotaChapas") or 0),
                "preco": float(row.get("PrecoChapa") or 0),
                "atualizado_em": row.get("AtualizadoEm"),
                "atualizado_por": row.get("AtualizadoPorPonto"),
            }
        )

    has_preco = _column_exists("tab_gravacao_pendente_fornecedor_cota", "PrecoChapa")
    for (key, maquina), group in groups.items():
        fmt = format_ponto(key)
        needs_fix = len(group) > 1 or any(g["raw"] != fmt for g in group)
        if not needs_fix:
            continue
        max_cota = max(g["cota"] for g in group)
        max_preco = max(g["preco"] for g in group)
        # Carrega metadados da linha canônica se existir; senão da primeira.
        meta = next((g for g in group if g["raw"] == fmt), group[0])
        if has_preco:
            db.execute_query(
                """
                INSERT INTO tab_gravacao_pendente_fornecedor_cota
                    (FornecedorPonto, Maquina, CotaChapas, PrecoChapa,
                     AtualizadoEm, AtualizadoPorPonto)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    CotaChapas = GREATEST(CotaChapas, VALUES(CotaChapas)),
                    PrecoChapa = GREATEST(PrecoChapa, VALUES(PrecoChapa))
                """,
                (
                    fmt,
                    maquina,
                    max_cota,
                    max_preco,
                    meta["atualizado_em"],
                    meta["atualizado_por"],
                ),
            )
        else:
            db.execute_query(
                """
                INSERT INTO tab_gravacao_pendente_fornecedor_cota
                    (FornecedorPonto, Maquina, CotaChapas, AtualizadoEm, AtualizadoPorPonto)
                VALUES (%s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    CotaChapas = GREATEST(CotaChapas, VALUES(CotaChapas))
                """,
                (
                    fmt,
                    maquina,
                    max_cota,
                    meta["atualizado_em"],
                    meta["atualizado_por"],
                ),
            )
        for g in group:
            if g["raw"] == fmt:
                continue
            db.execute_query(
                """
                DELETE FROM tab_gravacao_pendente_fornecedor_cota
                WHERE FornecedorPonto = %s AND Maquina = %s
                """,
                (g["raw"], maquina),
            )
        logger.info(
            "Deduplicado fornecedor_cota %s/%s → %s (cota=%s)",
            key,
            maquina,
            fmt,
            max_cota,
        )


def ensure_gravacao_pendente_schema() -> None:
    try:
        db.execute_query(_PENDENTE_SQL)
        db.execute_query(_ARQUIVO_SQL)
        db.execute_query(_CHAPA_SQL)
        db.execute_query(_CONFIG_SQL)
        db.execute_query(_MAQUINA_CONFIG_SQL)
        _migrate_fornecedor_cota_to_maquina_pk()
        db.execute_query(_FORNECEDOR_COTA_SQL)
        db.execute_query(_COTA_AJUSTE_LOG_SQL)
        db.execute_query(
            """
            INSERT IGNORE INTO tab_gravacao_pendente_config (Id, CotaInicialChapas)
            VALUES (1, 0)
            """
        )
        db.execute_query(
            """
            INSERT IGNORE INTO tab_gravacao_pendente_maquina_config
              (Maquina, CotaChapas, PrecoChapa)
            VALUES
              ('Komori', 0, 0),
              ('SM74', 0, 0),
              ('PM52', 0, 0)
            """
        )
        _apply_column_migrations(_CONFIG_MIGRATIONS)
        _apply_column_migrations(_FORNECEDOR_COTA_MIGRATIONS)
        _apply_column_migrations(_PENDENTE_MIGRATIONS)
        _apply_column_migrations(_ARQUIVO_MIGRATIONS)
        _apply_column_migrations(_EXTERNA_MIGRATIONS)
        if _column_exists("tab_os_gravacao_pendente", "JuntadaGrupoId"):
            if not _index_exists("tab_os_gravacao_pendente", "idx_gp_juntada"):
                try:
                    db.execute_query(
                        "ALTER TABLE tab_os_gravacao_pendente ADD INDEX idx_gp_juntada (JuntadaGrupoId)"
                    )
                    logger.info("Índice idx_gp_juntada adicionado")
                except Exception as exc:
                    logger.warning("Índice idx_gp_juntada ignorado: %s", exc)
        if _column_exists("tab_os_gravacao_pendente", "DesmembradaDeId"):
            if not _index_exists("tab_os_gravacao_pendente", "idx_gp_desmembrada"):
                try:
                    db.execute_query(
                        "ALTER TABLE tab_os_gravacao_pendente "
                        "ADD INDEX idx_gp_desmembrada (DesmembradaDeId)"
                    )
                    logger.info("Índice idx_gp_desmembrada adicionado")
                except Exception as exc:
                    logger.warning("Índice idx_gp_desmembrada ignorado: %s", exc)
        if _column_exists("tab_os_gravacao_externa", "JuntadaGrupoId"):
            if not _index_exists("tab_os_gravacao_externa", "idx_ge_juntada"):
                try:
                    db.execute_query(
                        "ALTER TABLE tab_os_gravacao_externa ADD INDEX idx_ge_juntada (JuntadaGrupoId)"
                    )
                    logger.info("Índice idx_ge_juntada adicionado")
                except Exception as exc:
                    logger.warning("Índice idx_ge_juntada ignorado: %s", exc)
        # Zera a lista de controle uma vez por epoch (só novos registros após o cutoff).
        db.execute_query(
            """
            UPDATE tab_gravacao_pendente_config
            SET ControleListDesde = NOW(),
                ControleListEpoch = %s
            WHERE Id = 1
              AND (
                ControleListDesde IS NULL
                OR COALESCE(ControleListEpoch, 0) < %s
              )
            """,
            (CONTROL_LIST_EPOCH, CONTROL_LIST_EPOCH),
        )
        # Backfill Cliente = Solicitante (NomeUsuario) da página inicial.
        if _column_exists("tab_os_gravacao_pendente", "Cliente"):
            db.execute_query(
                """
                UPDATE tab_os_gravacao_pendente gp
                INNER JOIN tabProtocolos p
                    ON p.NroProtocolo = gp.OsNro
                   AND p.AnoProtocolo = gp.OsAno
                SET gp.Cliente = NULLIF(TRIM(p.NomeUsuario), '')
                WHERE gp.Cliente IS NULL OR TRIM(gp.Cliente) = ''
                """
            )
        _seed_fornecedor_cota_maquinas()
        _seed_fornecedor_preco_from_maquina()
        _dedupe_fornecedor_cota_ponto_formats()
        db.execute_query(
            """
            INSERT IGNORE INTO tabSystemCatalog (Categoria, Rotulo, Ativo, Ordem, Origem)
            VALUES ('situacao', 'Gravação Pendente', 1, 49, 'catalog')
            """
        )
        logger.info("Schema Gravação Pendente verificado")
    except Exception as exc:
        logger.error("Falha ao garantir schema Gravação Pendente: %s", exc)
        raise

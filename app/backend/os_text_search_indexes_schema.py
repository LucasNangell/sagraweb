"""
Índices FULLTEXT idempotentes para filtros textuais da lista de OSs.
"""
from __future__ import annotations

import logging
import os

from database import Database

logger = logging.getLogger(__name__)

FT_INDEX_DETALHES_TITULO = "ft_detalhes_titulo"
FT_INDEX_DETALHES_PRODUTO = "ft_detalhes_produto"
FT_INDEX_PROTOCOLOS_SOLICITANTE = "ft_protocolos_solicitante"

_FULLTEXT_INDEXES = (
    (
        FT_INDEX_DETALHES_TITULO,
        "tabDetalhesServico",
        "(`Titulo`)",
    ),
    (
        FT_INDEX_DETALHES_PRODUTO,
        "tabDetalhesServico",
        "(`TipoPublicacaoLink`)",
    ),
    (
        FT_INDEX_PROTOCOLOS_SOLICITANTE,
        "tabProtocolos",
        "(`NomeUsuario`)",
    ),
)

_fulltext_ready_cache: bool | None = None


def auto_create_fulltext_indexes_enabled() -> bool:
    raw = os.environ.get("SAGRA_AUTO_CREATE_FULLTEXT_INDEXES", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _index_exists(cursor, table_name: str, index_name: str) -> bool:
    cursor.execute(
        """
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        LIMIT 1
        """,
        (table_name, index_name),
    )
    return cursor.fetchone() is not None


def ensure_os_text_search_indexes() -> None:
    """
    Cria índices FULLTEXT se habilitado e ainda não existirem.
    Em tabelas grandes, preferir SQL manual em janela de manutenção.
    """
    global _fulltext_ready_cache

    if not auto_create_fulltext_indexes_enabled():
        logger.warning(
            "SAGRA_AUTO_CREATE_FULLTEXT_INDEXES=false — índices FULLTEXT não serão "
            "criados no startup. Aplique deploy/sql/create_os_text_search_indexes.sql "
            "manualmente para acelerar filtros textuais."
        )
        _fulltext_ready_cache = None
        return

    db = Database()
    try:
        with db.cursor() as cursor:
            for index_name, table_name, columns in _FULLTEXT_INDEXES:
                if _index_exists(cursor, table_name, index_name):
                    continue
                try:
                    cursor.execute(
                        f"CREATE FULLTEXT INDEX {index_name} ON {table_name} {columns}"
                    )
                    logger.info(
                        "Índice FULLTEXT %s criado em %s (pode demorar em bases grandes)",
                        index_name,
                        table_name,
                    )
                except Exception as exc:
                    err = str(exc)
                    if "Duplicate key name" in err or "1061" in err:
                        continue
                    logger.error(
                        "Falha ao criar FULLTEXT %s em %s: %s",
                        index_name,
                        table_name,
                        exc,
                    )
        _fulltext_ready_cache = None
        logger.info("Índices FULLTEXT de busca textual verificados")
    except Exception as exc:
        logger.error("Erro ao garantir índices FULLTEXT: %s", exc)
        raise


def fulltext_text_search_indexes_ready(*, force_refresh: bool = False) -> bool:
    """True se os três índices FULLTEXT necessários existem."""
    global _fulltext_ready_cache
    if not force_refresh and _fulltext_ready_cache is not None:
        return _fulltext_ready_cache

    db = Database()
    try:
        with db.cursor() as cursor:
            ready = all(
                _index_exists(cursor, table_name, index_name)
                for index_name, table_name, _ in _FULLTEXT_INDEXES
            )
        _fulltext_ready_cache = ready
        return ready
    except Exception as exc:
        logger.warning("Não foi possível verificar índices FULLTEXT: %s", exc)
        _fulltext_ready_cache = False
        return False


def invalidate_fulltext_ready_cache() -> None:
    global _fulltext_ready_cache
    _fulltext_ready_cache = None

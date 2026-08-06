"""
Índices idempotentes para acelerar GET /api/os/search (tabProtocolos + materializada).
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_SEARCH_INDEXES = (
    (
        "idx_andamento_os_operacional",
        "tabAndamento",
        "(NroProtocoloLink, AnoProtocoloLink, UltimoStatus, `Data`, CodStatus)",
    ),
    (
        "idx_protocolos_search_sort",
        "tabProtocolos",
        "(EntregData, AnoProtocolo, NroProtocolo)",
    ),
    (
        "idx_protocolos_ano_nro",
        "tabProtocolos",
        "(AnoProtocolo, NroProtocolo)",
    ),
    (
        "idx_protocolos_sort_date",
        "tabProtocolos",
        "(EntregData, DataEntrada, AnoProtocolo, NroProtocolo)",
    ),
    (
        "idx_detalhes_os_link",
        "tabDetalhesServico",
        "(AnoProtocoloLinkDet, NroProtocoloLinkDet)",
    ),
    (
        "idx_detalhes_produto_os",
        "tabDetalhesServico",
        "(TipoPublicacaoLink, AnoProtocoloLinkDet, NroProtocoloLinkDet)",
    ),
    (
        "idx_protocolos_solicitante",
        "tabProtocolos",
        "(NomeUsuario(64))",
    ),
    (
        "idx_sub_os_andamento_filtro",
        "tab_os_sub_os_andamento",
        "(ultimo_status, setor, situacao, sub_os_id)",
    ),
    (
        "idx_sub_os_os_ativo",
        "tab_os_sub_os",
        "(nro_protocolo, ano_protocolo, ativo)",
    ),
)


def ensure_os_search_indexes() -> None:
    """Cria índices de busca se ainda não existirem (seguro em startup)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            for index_name, table_name, columns in _SEARCH_INDEXES:
                try:
                    cursor.execute(
                        f"CREATE INDEX {index_name} ON {table_name} {columns}"
                    )
                    logger.info("Índice %s criado em %s", index_name, table_name)
                except Exception as exc:
                    err = str(exc)
                    if (
                        "Duplicate key name" in err
                        or "already exists" in err
                        or "1061" in err
                    ):
                        continue
                    logger.debug("Índice %s (%s): %s", index_name, table_name, exc)
        logger.info("Índices de busca OS verificados")
    except Exception as exc:
        logger.error("Erro ao garantir índices de busca OS: %s", exc)
        raise

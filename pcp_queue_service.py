import logging
from typing import List, Tuple
from database import db

logger = logging.getLogger(__name__)

_table_ready = False

def ensure_pcp_table():
    """Guarantee auxiliary PCP ordering table exists."""
    global _table_ready
    if _table_ready:
        return

    create_sql = """
    CREATE TABLE IF NOT EXISTS tab_pcp_fila (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setor VARCHAR(64) NOT NULL,
        nro_os INT NOT NULL,
        ano INT NOT NULL,
        ordem INT NOT NULL,
        ultima_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_setor_os (setor, nro_os, ano),
        INDEX idx_setor_ordem (setor, ordem)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """
    db.execute_query(create_sql)
    _table_ready = True
    logger.info("Tabela tab_pcp_fila verificada/criada para controle de fila PCP")

def validate_os_in_setor(setor: str, pairs: List[Tuple[int, int]], allowed_situacoes=None, base_setor: str = None):
    """Return set of (nr_os, ano) that are currently active in given setor.

    `allowed_situacoes` lets us scope virtual setores (ex.: "Gravação").
    `base_setor` allows mapping a virtual setor to a real one (ex.: SEFOC).
    """
    if not pairs:
        return set()

    ensure_pcp_table()
    target_setor = base_setor or setor
    placeholders = ", ".join(["(%s, %s)"] * len(pairs))
    flat_values: List[int] = []
    for nr_os, ano in pairs:
        flat_values.extend([nr_os, ano])

    situacao_filter = ""
    situacao_params: List[str] = []
    if allowed_situacoes:
        situacao_placeholders = ", ".join(["%s"] * len(allowed_situacoes))
        situacao_filter = f" AND a.SituacaoLink IN ({situacao_placeholders})"
        situacao_params = list(allowed_situacoes)

    query = f"""
    SELECT p.NroProtocolo AS nr_os, p.AnoProtocolo AS ano
    FROM tabProtocolos AS p
    JOIN tabAndamento AS a
        ON (p.NroProtocolo = a.NroProtocoloLink AND p.AnoProtocolo = a.AnoProtocoloLink)
    WHERE a.UltimoStatus = 1
      AND a.SetorLink = %s
      AND a.SituacaoLink NOT IN ('Entregue', 'Cancelada', 'Cancelado')
      {situacao_filter}
      AND (p.NroProtocolo, p.AnoProtocolo) IN ({placeholders})
    """
    params = [target_setor] + situacao_params + flat_values
    rows = db.execute_query(query, params)
    return {(row.get('nr_os'), row.get('ano')) for row in rows}

def persist_order(setor: str, pairs: List[Tuple[int, int]]):
    """Replace the order for a setor with provided pairs inside a transaction."""
    ensure_pcp_table()

    def _txn(cursor):
        cursor.execute("DELETE FROM tab_pcp_fila WHERE setor = %s", (setor,))
        for idx, (nr_os, ano) in enumerate(pairs, start=1):
            cursor.execute(
                """
                INSERT INTO tab_pcp_fila (setor, nro_os, ano, ordem, ultima_atualizacao)
                VALUES (%s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE ordem = VALUES(ordem), ultima_atualizacao = VALUES(ultima_atualizacao)
                """,
                (setor, nr_os, ano, idx),
            )

    db.execute_transaction([_txn])

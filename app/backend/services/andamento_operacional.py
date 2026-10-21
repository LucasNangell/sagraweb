"""
Recálculo de UltimoStatus da OS principal — exclui andamentos espelho de Sub OS.
Identificação robusta via tab_os_sub_os_andamento.cod_status_espelho.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from database import db

logger = logging.getLogger(__name__)

# tabAndamento.CodStatus usa utf8mb4_general_ci (legado); tabelas Sub OS usam unicode_ci.
_COD_STATUS_COLLATE = "utf8mb4_general_ci"

# Exclui espelhos sem NOT IN (evita mix de collation e NULLs).
MIRROR_EXCLUDE_CLAUSE = f"""
    NOT EXISTS (
        SELECT 1
        FROM tab_os_sub_os_andamento m
        WHERE m.cod_status_espelho IS NOT NULL
          AND m.cod_status_espelho != ''
          AND m.cod_status_espelho COLLATE {_COD_STATUS_COLLATE}
              = a.CodStatus COLLATE {_COD_STATUS_COLLATE}
    )
"""

# Maior CodStatus operacional (sufixo numérico); Data só como desempate.
ULTIMO_ORDER_BY_SQL = (
    "ORDER BY CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED) DESC, "
    "a.CodStatus DESC, "
    "a.`Data` DESC"
)


def mirror_exclude_clause_for(alias: str) -> str:
    return MIRROR_EXCLUDE_CLAUSE.replace("a.", f"{alias}.")


def ultimo_order_by_for(alias: str) -> str:
    return ULTIMO_ORDER_BY_SQL.replace("a.", f"{alias}.")


def ultimo_operacional_cod_subquery(nro_expr: str, ano_expr: str) -> str:
    """Subquery do CodStatus do último andamento operacional (mesma regra do recalc)."""
    mirror = mirror_exclude_clause_for("a2")
    order = ultimo_order_by_for("a2")
    return f"""(
        SELECT a2.CodStatus
        FROM tabAndamento a2
        WHERE a2.NroProtocoloLink = {nro_expr}
          AND a2.AnoProtocoloLink = {ano_expr}
          AND {mirror}
        {order}
        LIMIT 1
    )"""


def get_mirror_cod_statuses_for_os(nro: int, ano: int) -> List[str]:
    """Lista CodStatus espelho vinculados à OS (para exclusão no MDB)."""
    rows = db.execute_query(
        """
        SELECT DISTINCT a.cod_status_espelho AS cod
        FROM tab_os_sub_os_andamento a
        INNER JOIN tab_os_sub_os s ON s.id = a.sub_os_id
        WHERE s.nro_protocolo = %s AND s.ano_protocolo = %s
          AND a.cod_status_espelho IS NOT NULL AND a.cod_status_espelho != ''
        """,
        (nro, ano),
    )
    return [str(r["cod"]).strip() for r in (rows or []) if r.get("cod")]


def get_ultimo_operacional_cod_mysql(nro: int, ano: int) -> Optional[str]:
    """CodStatus com UltimoStatus=1 operacional no MySQL (exclui espelhos)."""
    rows = db.execute_query(
        f"""
        SELECT a.CodStatus
        FROM tabAndamento a
        WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
          AND a.UltimoStatus = 1
          AND {MIRROR_EXCLUDE_CLAUSE}
        {ULTIMO_ORDER_BY_SQL}
        LIMIT 1
        """,
        (nro, ano),
    )
    if not rows:
        return None
    cod = rows[0].get("CodStatus")
    return str(cod) if cod else None


def next_cod_status_for_os(cursor, nro: int, ano: int) -> str:
    """Próximo CodStatus (NRO/ANO-XX), evitando reutilizar códigos ainda referenciados
    em sessões de Gravação Pendente/Externa (mesmo após DELETE do andamento)."""
    base_prefix = f"{nro:05d}{ano}-"
    like_pattern = f"{base_prefix}%"
    max_seq = 0

    def _bump_from_cod(cod: object) -> None:
        nonlocal max_seq
        if not cod:
            return
        try:
            suffix = str(cod).split("-")[-1]
            max_seq = max(max_seq, int(suffix))
        except ValueError:
            return

    cursor.execute(
        "SELECT CodStatus FROM tabAndamento WHERE CodStatus LIKE %s",
        (like_pattern,),
    )
    for row in cursor.fetchall() or []:
        if isinstance(row, dict):
            _bump_from_cod(row.get("CodStatus"))
        else:
            _bump_from_cod(row[0] if row else None)

    for table in ("tab_os_gravacao_pendente", "tab_os_gravacao_externa"):
        try:
            cursor.execute(
                f"""
                SELECT CodStatus
                FROM {table}
                WHERE OsNro = %s AND OsAno = %s AND CodStatus LIKE %s
                """,
                (nro, ano, like_pattern),
            )
            for srow in cursor.fetchall() or []:
                if isinstance(srow, dict):
                    _bump_from_cod(srow.get("CodStatus"))
                else:
                    _bump_from_cod(srow[0] if srow else None)
        except Exception:
            # Tabela pode não existir em ambientes antigos de teste.
            pass

    try:
        cursor.execute(
            """
            SELECT codstatus
            FROM deleted_andamentos
            WHERE (nro = %s AND ano = %s) OR codstatus LIKE %s
            """,
            (nro, ano, like_pattern),
        )
        for drow in cursor.fetchall() or []:
            if isinstance(drow, dict):
                _bump_from_cod(drow.get("codstatus") or drow.get("CodStatus"))
            else:
                _bump_from_cod(drow[0] if drow else None)
    except Exception:
        pass

    return f"{base_prefix}{max_seq + 1:02d}"


def insert_andamento_as_ultimo(
    cursor,
    *,
    cod_status: str,
    nro: int,
    ano: int,
    situacao: str,
    setor: str,
    obs: str,
    ponto: str,
) -> str:
    """
    Insere andamento como único UltimoStatus=1 da OS (padrão POST /os/.../history).
    Zera todos os UltimoStatus da OS, depois INSERT já com UltimoStatus=1.
    """
    cursor.execute(
        """
        UPDATE tabAndamento SET UltimoStatus = 0
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        """,
        (nro, ano),
    )
    cursor.execute(
        """
        INSERT INTO tabAndamento
            (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink,
             `Data`, UltimoStatus, `Observaçao`, Ponto)
        VALUES (%s, %s, %s, %s, %s, NOW(), 1, %s, %s)
        """,
        (cod_status, nro, ano, situacao, setor, obs, ponto),
    )
    return str(cod_status)


def select_expected_ultimo_cod(cursor, nro: int, ano: int) -> Optional[str]:
    """CodStatus operacional canônico (maior sufixo), sem alterar flags."""
    cursor.execute(
        f"""
        SELECT a.CodStatus
        FROM tabAndamento a
        WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
          AND {MIRROR_EXCLUDE_CLAUSE}
        {ULTIMO_ORDER_BY_SQL}
        LIMIT 1
        """,
        (nro, ano),
    )
    row = cursor.fetchone()
    if not row:
        return None
    cod = row.get("CodStatus") if isinstance(row, dict) else row[0]
    return str(cod) if cod else None


def assert_or_fix_unico_ultimo_status(cursor, nro: int, ano: int) -> Optional[str]:
    """
    Garante exatamente um UltimoStatus=1 por OS, no maior CodStatus operacional.
    Se já estiver correto, não regrava. Caso contrário, heal via recalc.
    """
    expected = select_expected_ultimo_cod(cursor, nro, ano)
    cursor.execute(
        """
        SELECT CodStatus
        FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
          AND UltimoStatus = 1
        """,
        (nro, ano),
    )
    marked = []
    for row in cursor.fetchall() or []:
        cod = row.get("CodStatus") if isinstance(row, dict) else row[0]
        if cod:
            marked.append(str(cod))

    if expected is None:
        if not marked:
            return None
        logger.warning(
            "[ULTIMO_HEAL] OS %s/%s sem andamento operacional mas flags=%s — zerando",
            nro,
            ano,
            marked,
        )
        cursor.execute(
            """
            UPDATE tabAndamento SET UltimoStatus = 0
            WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
            """,
            (nro, ano),
        )
        return None

    if len(marked) == 1 and marked[0] == expected:
        return expected

    logger.warning(
        "[ULTIMO_HEAL] OS %s/%s invariante quebrado (marked=%s expected=%s) — corrigindo",
        nro,
        ano,
        marked,
        expected,
    )
    return recalc_ultimo_status_operacional(cursor, nro, ano)


def recalc_ultimo_status_operacional(cursor, nro: int, ano: int) -> Optional[str]:
    """
    Promove o andamento operacional de maior CodStatus a UltimoStatus=1.
    Nunca promove espelhos de Sub OS (cod_status_espelho).
    Retorna CodStatus promovido ou None.
    """
    cursor.execute(
        """
        UPDATE tabAndamento SET UltimoStatus = 0
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        """,
        (nro, ano),
    )

    cod = select_expected_ultimo_cod(cursor, nro, ano)
    if not cod:
        return None

    cursor.execute(
        "UPDATE tabAndamento SET UltimoStatus = 1 WHERE CodStatus = %s",
        (cod,),
    )

    # Qualquer alteração em tabAndamento deve atualizar a materializada.
    try:
        from services.os_andamento_post_change_service import after_andamento_changed

        after_andamento_changed(
            nro,
            ano,
            "recalc_ultimo_status",
            source="recalc_ultimo_status_operacional",
            notify=False,
            cursor=cursor,
        )
    except Exception as exc:
        logger.warning(
            "Falha ao atualizar materializada operacional OS %s/%s: %s",
            nro,
            ano,
            exc,
        )

    return str(cod)


def align_ultimo_status_mysql_then_mdb(
    nro: int,
    ano: int,
    *,
    cursor=None,
    push_mdb: bool = True,
) -> Optional[str]:
    """
    Recalcula UltimoStatus no MySQL e espelha o flag canônico no MDB.
    Se `cursor` for passado, usa a transação aberta (sem commit próprio).
    """
    if cursor is not None:
        promoted = recalc_ultimo_status_operacional(cursor, nro, ano)
    else:

        def _txn(cur):
            return recalc_ultimo_status_operacional(cur, nro, ano)

        promoted = db.execute_transaction([_txn])[0]

    if push_mdb:
        try:
            from routers.mdb_writer import push_os_ultimo_status_to_mdb

            push_os_ultimo_status_to_mdb(nro, ano, promoted_cod=promoted)
        except Exception as exc:
            logger.warning(
                "Falha ao espelhar UltimoStatus no MDB OS %s/%s (promovido=%s): %s",
                nro,
                ano,
                promoted,
                exc,
            )

    return promoted

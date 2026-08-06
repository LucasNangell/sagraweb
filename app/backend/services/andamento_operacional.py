"""
Recálculo de UltimoStatus da OS principal — exclui andamentos espelho de Sub OS.
Identificação robusta via tab_os_sub_os_andamento.cod_status_espelho.
"""
from __future__ import annotations

from typing import List, Optional

from database import db

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


def mirror_exclude_clause_for(alias: str) -> str:
    return MIRROR_EXCLUDE_CLAUSE.replace("a.", f"{alias}.")


def ultimo_operacional_cod_subquery(nro_expr: str, ano_expr: str) -> str:
    """Subquery do CodStatus do último andamento operacional (mesma regra do recalc)."""
    mirror = mirror_exclude_clause_for("a2")
    return f"""(
        SELECT a2.CodStatus
        FROM tabAndamento a2
        WHERE a2.NroProtocoloLink = {nro_expr}
          AND a2.AnoProtocoloLink = {ano_expr}
          AND {mirror}
        ORDER BY a2.`Data` DESC, a2.CodStatus DESC
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
        "SELECT MAX(CodStatus) AS max_cod FROM tabAndamento WHERE CodStatus LIKE %s",
        (like_pattern,),
    )
    row = cursor.fetchone() or {}
    _bump_from_cod(row.get("max_cod") if isinstance(row, dict) else None)

    for table in ("tab_os_gravacao_pendente", "tab_os_gravacao_externa"):
        try:
            cursor.execute(
                f"""
                SELECT MAX(CodStatus) AS max_cod
                FROM {table}
                WHERE OsNro = %s AND OsAno = %s AND CodStatus LIKE %s
                """,
                (nro, ano, like_pattern),
            )
            srow = cursor.fetchone() or {}
            _bump_from_cod(srow.get("max_cod") if isinstance(srow, dict) else None)
        except Exception:
            # Tabela pode não existir em ambientes antigos de teste.
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
    Demote prévio de UltimoStatus=1, depois INSERT já com UltimoStatus=1.
    """
    cursor.execute(
        """
        UPDATE tabAndamento SET UltimoStatus = 0
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s AND UltimoStatus = 1
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


def recalc_ultimo_status_operacional(cursor, nro: int, ano: int) -> Optional[str]:
    """
    Promove o andamento operacional mais recente a UltimoStatus=1.
    Nunca promove espelhos de Sub OS (cod_status_espelho).
    Retorna CodStatus promovido ou None.
    """
    cursor.execute(
        """
        UPDATE tabAndamento SET UltimoStatus = 0
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s AND UltimoStatus = 1
        """,
        (nro, ano),
    )

    cursor.execute(
        f"""
        SELECT a.CodStatus
        FROM tabAndamento a
        WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
          AND {MIRROR_EXCLUDE_CLAUSE}
        ORDER BY a.`Data` DESC, a.CodStatus DESC
        LIMIT 1
        """,
        (nro, ano),
    )
    row = cursor.fetchone()
    if not row:
        return None

    cod = row.get("CodStatus") if isinstance(row, dict) else row[0]
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
        import logging

        logging.getLogger(__name__).warning(
            "Falha ao atualizar materializada operacional OS %s/%s: %s",
            nro,
            ano,
            exc,
        )

    return str(cod)

"""
Reordenação de andamentos da OS principal.

Mantém o conjunto de CodStatus (slots A→Z) e reescreve o conteúdo de cada slot
conforme a nova ordem lógica. Remapeia FKs que acompanham o andamento lógico.
"""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, MutableMapping, Sequence, Tuple


def build_reorder_mapping(
    slots: Sequence[str],
    ordered_cod_statuses: Sequence[str],
) -> Dict[str, str]:
    """
    Mapeia CodStatus lógico antigo → slot final.

    `slots` = códigos atuais ordenados A→Z (posições fixas).
    `ordered_cod_statuses` = mesma multiset na ordem visual desejada.
    Conteúdo de ordered[i] passa a ocupar slots[i].
    """
    if len(slots) != len(ordered_cod_statuses):
        raise ValueError(
            "ordered_cod_statuses deve ter a mesma quantidade de andamentos da OS"
        )
    slot_set = set(slots)
    ordered_set = set(ordered_cod_statuses)
    if slot_set != ordered_set:
        raise ValueError(
            "ordered_cod_statuses deve ser permutação exata dos CodStatus atuais"
        )
    if len(slots) != len(slot_set):
        raise ValueError("CodStatus duplicado na lista atual")
    return {ordered_cod_statuses[i]: slots[i] for i in range(len(slots))}


def mapping_changed(mapping: Mapping[str, str]) -> bool:
    return any(old != new for old, new in mapping.items())


def _remap_fk_column(
    cursor,
    *,
    table: str,
    column: str,
    mapping: Mapping[str, str],
    where_extra_sql: str = "",
    where_extra_params: Sequence[Any] = (),
) -> None:
    """Remapeia coluna FK com códigos temporários para evitar colisões em ciclos."""
    changed = [(old, new) for old, new in mapping.items() if old != new]
    if not changed:
        return

    temps: List[Tuple[str, str, str]] = []
    for idx, (old, new) in enumerate(changed):
        temp = f"#R{idx:04d}"
        temps.append((old, temp, new))

    for old, temp, _new in temps:
        cursor.execute(
            f"""
            UPDATE {table}
            SET `{column}` = %s
            WHERE `{column}` = %s
            {where_extra_sql}
            """,
            (temp, old, *where_extra_params),
        )

    for _old, temp, new in temps:
        cursor.execute(
            f"""
            UPDATE {table}
            SET `{column}` = %s
            WHERE `{column}` = %s
            {where_extra_sql}
            """,
            (new, temp, *where_extra_params),
        )


def _table_exists(cursor, table: str) -> bool:
    cursor.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = %s
        LIMIT 1
        """,
        (table,),
    )
    return cursor.fetchone() is not None


def remap_andamento_foreign_keys(
    cursor,
    mapping: Mapping[str, str],
    *,
    nro: int,
    ano: int,
) -> None:
    """Atualiza referências a CodStatus que devem seguir o andamento lógico."""
    if not mapping_changed(mapping):
        return

    if _table_exists(cursor, "tab_os_sub_os_andamento"):
        _remap_fk_column(
            cursor,
            table="tab_os_sub_os_andamento",
            column="cod_status_espelho",
            mapping=mapping,
        )
        _remap_fk_column(
            cursor,
            table="tab_os_sub_os_andamento",
            column="source_cod_status",
            mapping=mapping,
        )

    if _table_exists(cursor, "tab_os_gravacao_pendente"):
        _remap_fk_column(
            cursor,
            table="tab_os_gravacao_pendente",
            column="CodStatus",
            mapping=mapping,
            where_extra_sql="AND OsNro = %s AND OsAno = %s",
            where_extra_params=(nro, ano),
        )

    if _table_exists(cursor, "tab_os_gravacao_externa"):
        _remap_fk_column(
            cursor,
            table="tab_os_gravacao_externa",
            column="CodStatus",
            mapping=mapping,
            where_extra_sql="AND OsNro = %s AND OsAno = %s",
            where_extra_params=(nro, ano),
        )

    if _table_exists(cursor, "tabEmailAutoSendClaim"):
        _remap_fk_column(
            cursor,
            table="tabEmailAutoSendClaim",
            column="CodStatus",
            mapping=mapping,
            where_extra_sql="AND NroProtocolo = %s AND AnoProtocolo = %s",
            where_extra_params=(nro, ano),
        )


def load_os_andamento_slots(cursor, nro: int, ano: int) -> List[MutableMapping[str, Any]]:
    cursor.execute(
        """
        SELECT CodStatus, SituacaoLink, SetorLink, `Data`, `Observaçao`, Ponto, UltimoStatus
        FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        ORDER BY CodStatus
        """,
        (nro, ano),
    )
    rows = cursor.fetchall() or []
    result: List[MutableMapping[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            result.append(dict(row))
        else:
            result.append(
                {
                    "CodStatus": row[0],
                    "SituacaoLink": row[1],
                    "SetorLink": row[2],
                    "Data": row[3],
                    "Observaçao": row[4],
                    "Ponto": row[5],
                    "UltimoStatus": row[6],
                }
            )
    return result


def apply_andamento_reorder(
    cursor,
    nro: int,
    ano: int,
    ordered_cod_statuses: Sequence[str],
) -> Dict[str, str]:
    """
    Aplica a reordenação na transação aberta.
    Retorna mapping old_cod → new_cod (slot final).
    """
    rows = load_os_andamento_slots(cursor, nro, ano)
    if not rows:
        raise ValueError("OS sem andamentos para reordenar")

    slots = [str(r["CodStatus"]) for r in rows]
    ordered = [str(c).strip() for c in ordered_cod_statuses]
    mapping = build_reorder_mapping(slots, ordered)

    if not mapping_changed(mapping):
        return mapping

    by_cod = {str(r["CodStatus"]): r for r in rows}
    for i, slot in enumerate(slots):
        source = by_cod[ordered[i]]
        cursor.execute(
            """
            UPDATE tabAndamento
            SET SituacaoLink = %s,
                SetorLink = %s,
                `Data` = %s,
                `Observaçao` = %s,
                Ponto = %s
            WHERE CodStatus = %s
              AND NroProtocoloLink = %s
              AND AnoProtocoloLink = %s
            """,
            (
                source.get("SituacaoLink"),
                source.get("SetorLink"),
                source.get("Data"),
                source.get("Observaçao"),
                source.get("Ponto"),
                slot,
                nro,
                ano,
            ),
        )

    remap_andamento_foreign_keys(cursor, mapping, nro=nro, ano=ano)

    from services.andamento_operacional import recalc_ultimo_status_operacional

    # Também atualiza materializada via after_andamento_changed interno.
    recalc_ultimo_status_operacional(cursor, nro, ano)

    return mapping

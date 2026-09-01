"""
Regras de negócio para grupos de OSs vinculadas com andamento/setor sincronizado.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from database import db
from routers.andamento_helpers import format_ponto

logger = logging.getLogger(__name__)


def _clean_ponto(value: str | None) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def _lookup_usuario_nome(ponto: str | None) -> str | None:
    clean = _clean_ponto(ponto)
    if not clean:
        return None
    try:
        rows = db.execute_query(
            "SELECT Nome FROM tabUsuarios WHERE Ponto = %s LIMIT 1",
            (int(clean),),
        )
    except (TypeError, ValueError):
        rows = None
    if not rows:
        rows = db.execute_query(
            """
            SELECT Nome FROM tabUsuarios
            WHERE REPLACE(REPLACE(CAST(Ponto AS CHAR), '.', ''), '-', '') = %s
            LIMIT 1
            """,
            (clean,),
        ) or []
    nome = (rows[0].get("Nome") or "").strip() if rows else ""
    return nome or None


def _resolve_usuario_label(ponto: str | None) -> str:
    """Retorna 'Nome (ponto)' ou só o ponto formatado."""
    clean = _clean_ponto(ponto)
    if not clean:
        return "usuário"
    ponto_fmt = format_ponto(clean)
    nome = _lookup_usuario_nome(ponto)
    if nome:
        return f"{nome} ({ponto_fmt})"
    return ponto_fmt


def _normalize_text(value: str | None) -> str:
    return (value or "").strip()


def _situacao_matches(a: str, b: str) -> bool:
    return _normalize_text(a).casefold() == _normalize_text(b).casefold()


def _setor_matches(a: str, b: str) -> bool:
    return _normalize_text(a).casefold() == _normalize_text(b).casefold()


def _row_os_pair(row: dict[str, Any]) -> tuple[tuple[int, int], tuple[int, int]]:
    principal = (int(row["principal_num"]), int(row["principal_ano"]))
    vinculada = (int(row["vinc_num"]), int(row["vinc_ano"]))
    return principal, vinculada


def _fetch_vinculo_rows_for_os(nro: int, ano: int) -> list[dict[str, Any]]:
    return db.execute_query(
        """
        SELECT os_principal_numero AS principal_num, os_principal_ano AS principal_ano,
               os_vinculada_numero AS vinc_num, os_vinculada_ano AS vinc_ano,
               grupo_id
        FROM tabOSVinculadas
        WHERE (os_principal_numero = %s AND os_principal_ano = %s)
           OR (os_vinculada_numero = %s AND os_vinculada_ano = %s)
        """,
        (nro, ano, nro, ano),
    ) or []


def get_connected_os_members(nro: int, ano: int) -> list[dict[str, int]]:
    """Retorna todas as OSs do componente conexo de vínculos (inclui a OS informada)."""
    rows = db.execute_query(
        """
        SELECT os_principal_numero AS principal_num, os_principal_ano AS principal_ano,
               os_vinculada_numero AS vinc_num, os_vinculada_ano AS vinc_ano
        FROM tabOSVinculadas
        """
    ) or []

    graph: dict[tuple[int, int], set[tuple[int, int]]] = {}
    for row in rows:
        a, b = _row_os_pair(row)
        graph.setdefault(a, set()).add(b)
        graph.setdefault(b, set()).add(a)

    start = (nro, ano)
    if start not in graph:
        return [{"numero": nro, "ano": ano}]

    visited: set[tuple[int, int]] = set()
    stack = [start]
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        for neighbor in graph.get(node, ()):
            if neighbor not in visited:
                stack.append(neighbor)

    return [
        {"numero": num, "ano": yr}
        for num, yr in sorted(visited)
    ]


def get_grupo_id_for_os(nro: int, ano: int) -> Optional[int]:
    rows = _fetch_vinculo_rows_for_os(nro, ano)
    for row in rows:
        grupo_id = row.get("grupo_id")
        if grupo_id is not None:
            return int(grupo_id)
    return None


def _pair_key(situacao: str, setor: str) -> tuple[str, str]:
    return (_normalize_text(situacao).casefold(), _normalize_text(setor).casefold())


def normalize_andamentos_input(
    andamentos: list[Any] | None = None,
    situacao: str | None = None,
    setor: str | None = None,
) -> list[dict[str, str]]:
    """Normaliza e deduplica pares andamento+setor (atalho legado: situacao/setor)."""
    source: list[Any] = list(andamentos or [])
    if not source and _normalize_text(situacao) and _normalize_text(setor):
        source = [{"situacao": situacao, "setor": setor}]

    pairs: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in source:
        if not isinstance(item, dict):
            continue
        sit = _normalize_text(item.get("situacao"))
        st = _normalize_text(item.get("setor"))
        if not sit or not st:
            continue
        key = _pair_key(sit, st)
        if key in seen:
            continue
        seen.add(key)
        pairs.append({"situacao": sit, "setor": st})
    return pairs


def union_andamentos(*lists: list[dict[str, str]] | None) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for group in lists:
        for item in group or []:
            sit = _normalize_text(item.get("situacao"))
            st = _normalize_text(item.get("setor"))
            if not sit or not st:
                continue
            key = _pair_key(sit, st)
            if key in seen:
                continue
            seen.add(key)
            merged.append({"situacao": sit, "setor": st})
    return merged


def andamento_matches_any(
    situacao: str,
    setor: str,
    andamentos: list[dict[str, str]] | None,
) -> dict[str, str] | None:
    for pair in andamentos or []:
        if _situacao_matches(situacao, pair.get("situacao") or "") and _setor_matches(
            setor, pair.get("setor") or ""
        ):
            return {"situacao": pair["situacao"], "setor": pair["setor"]}
    return None


def _fetch_all(sql: str, params: tuple[Any, ...], *, cursor=None) -> list[dict[str, Any]]:
    if cursor is not None:
        cursor.execute(sql, params)
        return list(cursor.fetchall() or [])
    return db.execute_query(sql, params) or []


def list_grupo_andamentos(grupo_id: int, *, cursor=None) -> list[dict[str, str]]:
    rows = _fetch_all(
        """
        SELECT situacao, setor
        FROM tabOSVinculoGrupoAndamentos
        WHERE grupo_id = %s
        ORDER BY id
        """,
        (grupo_id,),
        cursor=cursor,
    )
    return [
        {
            "situacao": _normalize_text(row.get("situacao")),
            "setor": _normalize_text(row.get("setor")),
        }
        for row in rows
        if _normalize_text(row.get("situacao")) and _normalize_text(row.get("setor"))
    ]


def _andamentos_with_fallback(
    grupo_id: int,
    parent_situacao: str | None = None,
    parent_setor: str | None = None,
    *,
    cursor=None,
) -> list[dict[str, str]]:
    andamentos = list_grupo_andamentos(grupo_id, cursor=cursor)
    if andamentos:
        return andamentos
    return normalize_andamentos_input(situacao=parent_situacao, setor=parent_setor)


def _sync_parent_pair(grupo_id: int, pares: list[dict[str, str]], *, cursor=None) -> None:
    first = pares[0]
    sql = """
        UPDATE tabOSVinculoGrupos
        SET situacao = %s, setor = %s
        WHERE id = %s
    """
    params = (first["situacao"], first["setor"], grupo_id)
    if cursor is not None:
        cursor.execute(sql, params)
        return
    db.execute_query(sql, params)


def _insert_andamento_rows(
    grupo_id: int,
    pares: list[dict[str, str]],
    *,
    cursor=None,
) -> None:
    sql = """
        INSERT INTO tabOSVinculoGrupoAndamentos (grupo_id, situacao, setor)
        VALUES (%s, %s, %s)
    """
    for pair in pares:
        params = (grupo_id, pair["situacao"], pair["setor"])
        if cursor is not None:
            cursor.execute(sql, params)
        else:
            db.execute_query(sql, params)


def replace_grupo_andamentos(
    grupo_id: int,
    andamentos: list[Any] | None,
    *,
    situacao: str | None = None,
    setor: str | None = None,
    cursor=None,
) -> list[dict[str, str]]:
    """Substitui a lista de pares do grupo. Exige pelo menos um par."""
    pares = normalize_andamentos_input(andamentos, situacao, setor)
    if not pares:
        raise ValueError("Informe ao menos um andamento e setor para o grupo.")

    delete_sql = "DELETE FROM tabOSVinculoGrupoAndamentos WHERE grupo_id = %s"
    if cursor is not None:
        cursor.execute(delete_sql, (grupo_id,))
    else:
        db.execute_query(delete_sql, (grupo_id,))

    _insert_andamento_rows(grupo_id, pares, cursor=cursor)
    _sync_parent_pair(grupo_id, pares, cursor=cursor)
    return pares


def get_grupo_config(grupo_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT id, situacao, setor, criado_por_ponto, criado_em
        FROM tabOSVinculoGrupos
        WHERE id = %s
        """,
        (grupo_id,),
    )
    if not rows:
        return None
    config = dict(rows[0])
    andamentos = _andamentos_with_fallback(
        grupo_id,
        config.get("situacao"),
        config.get("setor"),
    )
    config["andamentos"] = andamentos
    if andamentos:
        config["situacao"] = andamentos[0]["situacao"]
        config["setor"] = andamentos[0]["setor"]
    return config


def get_grupo_config_for_os(nro: int, ano: int) -> Optional[dict[str, Any]]:
    grupo_id = get_grupo_id_for_os(nro, ano)
    if grupo_id is None:
        return None
    config = get_grupo_config(grupo_id)
    if not config:
        return None
    config["membros"] = get_connected_os_members(nro, ano)
    return config


def create_grupo(
    situacao: str | None = None,
    setor: str | None = None,
    criado_por_ponto: str | None = None,
    *,
    andamentos: list[Any] | None = None,
    cursor=None,
) -> int:
    pares = normalize_andamentos_input(andamentos, situacao, setor)
    if not pares:
        raise ValueError("Situação e setor são obrigatórios para o grupo.")

    first = pares[0]
    ponto_fmt = format_ponto(_clean_ponto(criado_por_ponto)) if criado_por_ponto else None
    sql = """
        INSERT INTO tabOSVinculoGrupos (situacao, setor, criado_por_ponto)
        VALUES (%s, %s, %s)
    """
    params = (first["situacao"], first["setor"], ponto_fmt)
    if cursor is not None:
        cursor.execute(sql, params)
        grupo_id = int(cursor.lastrowid)
    else:
        db.execute_query(sql, params)
        row = db.execute_query("SELECT LAST_INSERT_ID() AS id")
        grupo_id = int(row[0]["id"])

    _insert_andamento_rows(grupo_id, pares, cursor=cursor)
    return grupo_id


def assign_grupo_to_component(nro: int, ano: int, grupo_id: int, *, cursor) -> None:
    membros = get_connected_os_members(nro, ano)
    keys = {(m["numero"], m["ano"]) for m in membros}
    for num, yr in keys:
        cursor.execute(
            """
            UPDATE tabOSVinculadas
            SET grupo_id = %s
            WHERE (
                (os_principal_numero = %s AND os_principal_ano = %s)
                OR (os_vinculada_numero = %s AND os_vinculada_ano = %s)
            )
            """,
            (grupo_id, num, yr, num, yr),
        )


def resolve_grupo_for_new_vinculo(
    nro_a: int,
    ano_a: int,
    nro_b: int,
    ano_b: int,
    situacao: str | None,
    setor: str | None,
    criado_por_ponto: str | None,
    *,
    andamentos: list[Any] | None = None,
    cursor,
) -> int:
    """Define grupo_id ao criar vínculo entre duas OSs."""
    pares = normalize_andamentos_input(andamentos, situacao, setor)
    grupo_a = get_grupo_id_for_os(nro_a, ano_a)
    grupo_b = get_grupo_id_for_os(nro_b, ano_b)

    if grupo_a and grupo_b and grupo_a != grupo_b:
        keep_parent = _fetch_all(
            "SELECT situacao, setor FROM tabOSVinculoGrupos WHERE id = %s",
            (grupo_a,),
            cursor=cursor,
        )
        drop_parent = _fetch_all(
            "SELECT situacao, setor FROM tabOSVinculoGrupos WHERE id = %s",
            (grupo_b,),
            cursor=cursor,
        )
        keep_sit = keep_parent[0].get("situacao") if keep_parent else None
        keep_st = keep_parent[0].get("setor") if keep_parent else None
        drop_sit = drop_parent[0].get("situacao") if drop_parent else None
        drop_st = drop_parent[0].get("setor") if drop_parent else None
        keep_rows = _andamentos_with_fallback(
            grupo_a, keep_sit, keep_st, cursor=cursor
        )
        drop_rows = _andamentos_with_fallback(
            grupo_b, drop_sit, drop_st, cursor=cursor
        )
        merged = union_andamentos(keep_rows, drop_rows, pares)
        cursor.execute(
            "UPDATE tabOSVinculadas SET grupo_id = %s WHERE grupo_id = %s",
            (grupo_a, grupo_b),
        )
        cursor.execute(
            "DELETE FROM tabOSVinculoGrupoAndamentos WHERE grupo_id = %s",
            (grupo_b,),
        )
        cursor.execute("DELETE FROM tabOSVinculoGrupos WHERE id = %s", (grupo_b,))
        if merged:
            replace_grupo_andamentos(grupo_a, merged, cursor=cursor)
        grupo_id = grupo_a
    elif grupo_a:
        grupo_id = grupo_a
    elif grupo_b:
        grupo_id = grupo_b
    else:
        if not pares:
            raise ValueError(
                "Informe andamento e setor para definir o comportamento do grupo."
            )
        grupo_id = create_grupo(
            criado_por_ponto=criado_por_ponto,
            andamentos=pares,
            cursor=cursor,
        )

    return grupo_id


def check_replicacao_andamento(
    nro: int,
    ano: int,
    situacao: str,
    setor: str,
) -> dict[str, Any]:
    """Verifica se o andamento exige confirmação de replicação ao grupo."""
    others = [
        m for m in get_connected_os_members(nro, ano)
        if not (m["numero"] == nro and m["ano"] == ano)
    ]
    if not others:
        return {"requires_confirmation": False, "membros": [], "andamentos": []}

    grupo_id = get_grupo_id_for_os(nro, ano)
    if grupo_id is not None:
        config = get_grupo_config(grupo_id)
        if not config:
            return {"requires_confirmation": False, "membros": others, "andamentos": []}
        andamentos = config.get("andamentos") or []
        matched = andamento_matches_any(situacao, setor, andamentos)
        if not matched:
            return {
                "requires_confirmation": False,
                "membros": others,
                "andamentos": andamentos,
            }
        membros = get_connected_os_members(nro, ano)
        return {
            "requires_confirmation": True,
            "legacy": False,
            "grupo_id": grupo_id,
            "situacao_grupo": matched["situacao"],
            "setor_grupo": matched["setor"],
            "criado_por_ponto": config.get("criado_por_ponto"),
            "membros": membros,
            "andamentos": andamentos,
        }

    lower = _normalize_text(situacao).casefold()
    if lower.startswith("saída p") or lower.startswith("saida p"):
        return {
            "requires_confirmation": True,
            "legacy": True,
            "grupo_id": None,
            "situacao_grupo": situacao,
            "setor_grupo": setor,
            "criado_por_ponto": None,
            "membros": get_connected_os_members(nro, ano),
            "andamentos": [{"situacao": situacao, "setor": setor}],
        }

    return {"requires_confirmation": False, "membros": others, "andamentos": []}


def notify_grupo_creator_divergencia(
    *,
    grupo_id: int | None,
    os_nro: int,
    os_ano: int,
    usuario_ponto: str | None,
    situacao: str,
    setor: str,
) -> None:
    """Notifica imediatamente o criador do vínculo quando andamento é só em uma OS."""
    if grupo_id is None:
        grupo_id = get_grupo_id_for_os(os_nro, os_ano)
    if grupo_id is None:
        return

    config = get_grupo_config(grupo_id)
    if not config:
        return

    creator = config.get("criado_por_ponto")
    if not creator:
        return

    actor = _resolve_usuario_label(usuario_ponto)
    actor_nome = _lookup_usuario_nome(usuario_ponto)
    actor_ponto = (
        format_ponto(_clean_ponto(usuario_ponto)) if _clean_ponto(usuario_ponto) else None
    )
    if _clean_ponto(creator) and _clean_ponto(usuario_ponto):
        if _clean_ponto(creator) == _clean_ponto(usuario_ponto):
            return

    membros = get_connected_os_members(os_nro, os_ano)
    outros = [
        f"{m['numero']}/{m['ano']}"
        for m in membros
        if not (m["numero"] == os_nro and m["ano"] == os_ano)
    ]
    grupo_label = ", ".join(outros) if outros else "—"
    msg = (
        f'O usuário {actor} aplicou o andamento "{_normalize_text(situacao)}" '
        f"({_normalize_text(setor)}) apenas na OS {os_nro}/{os_ano}, "
        f"sem replicar ao grupo ({grupo_label})."
    )
    detalhes = json.dumps(
        {
            "tipo": "vinculo_grupo_divergencia",
            "grupo_id": grupo_id,
            "usuario": actor,
            "usuario_ponto": actor_ponto,
            "usuario_nome": actor_nome,
            "situacao": _normalize_text(situacao),
            "setor": _normalize_text(setor),
            "membros": membros,
        },
        ensure_ascii=False,
    )

    from services.notification_push_service import (
        insert_user_notification,
        push_user_notification,
    )

    notification_id = insert_user_notification(
        ponto=str(creator),
        nro=os_nro,
        ano=os_ano,
        mensagem=msg,
        detalhes_json=detalhes,
    )
    if notification_id is None:
        return

    push_user_notification(
        target_ponto=str(creator),
        mensagem=msg,
        nro=os_nro,
        ano=os_ano,
        notification_id=notification_id,
        action="vinculo_grupo_divergencia",
    )

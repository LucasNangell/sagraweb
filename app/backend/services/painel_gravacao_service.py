"""Board e lançamento do painel /painel/gravacao."""
from __future__ import annotations

import logging
from typing import Any, Iterable, Optional

from fastapi import HTTPException

from database import db
from routers.andamento_helpers import format_andamento_obs, format_ponto
from services.gravacao_componente import normalize_stored_gravacao_componente
from services.gravacao_externa_service import _notify_andamento_mdb
from services.gravacao_pendente_service import SITUACAO_GRAVACAO_PENDENTE
from services.os_vinculo_grupo_service import _clean_ponto, _lookup_usuario_nome

logger = logging.getLogger(__name__)

COLUMN_GRAV_PENDENTE = "grav_pendente"
COLUMN_SAIDA = "saida_grav_ext"
COLUMN_RECEBIDO = "recebido_grav_ext"
COLUMN_CONCLUIDA = "grav_concluida"

COLUMN_TITLES = {
    COLUMN_GRAV_PENDENTE: "Grav. Pendente",
    COLUMN_SAIDA: "Saída p/ Grav. Ext.",
    COLUMN_RECEBIDO: "Recebido Grav. Ext.",
    COLUMN_CONCLUIDA: "Grav. Concluída",
}

EXTERNA_STATUS_TO_COLUMN = {
    "pendente": COLUMN_SAIDA,
    "iniciada": COLUMN_RECEBIDO,
    "concluida": COLUMN_CONCLUIDA,
}

COLUMN_TO_EXTERNA_STATUS = {
    COLUMN_SAIDA: "pendente",
    COLUMN_RECEBIDO: "iniciada",
    COLUMN_CONCLUIDA: "concluida",
}

SETOR_PAINEL_GRAVACAO = "Gravação"


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return str(value)


def _int_or_none(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def compute_remaining_chapas(
    original: list[dict[str, Any]],
    received: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Restante por máquina = origem − soma recebida (nunca negativo)."""
    received_by: dict[str, int] = {}
    for row in received or []:
        maquina = str(row.get("maquina") or "").strip()
        if not maquina:
            continue
        received_by[maquina] = received_by.get(maquina, 0) + int(
            row.get("quantidade") or 0
        )
    out: list[dict[str, Any]] = []
    for ch in original or []:
        maquina = str(ch.get("maquina") or "").strip()
        qty = int(ch.get("quantidade") or ch.get("quantidade_chapas") or 0)
        restante = max(0, qty - received_by.get(maquina, 0))
        out.append(
            {
                "maquina": maquina,
                "quantidade": qty,
                "quantidade_restante": restante,
            }
        )
    return out


def session_has_remaining(chapas: list[dict[str, Any]]) -> bool:
    """Sessão concluída permanece no board se ainda há chapas ou se a origem não informou."""
    if not chapas:
        return True
    return any(int(ch.get("quantidade_restante") or 0) > 0 for ch in chapas)


def fornecedor_label(ponto: Any, nome: Any) -> str:
    nome_s = str(nome or "").strip()
    if nome_s:
        return nome_s
    return str(ponto or "").strip()


def _os_key(nr_os: int, ano: int) -> str:
    return f"{ano}-{nr_os}"


def _empty_columns() -> dict[str, list[dict[str, Any]]]:
    return {
        COLUMN_GRAV_PENDENTE: [],
        COLUMN_SAIDA: [],
        COLUMN_RECEBIDO: [],
        COLUMN_CONCLUIDA: [],
    }


def _membro_key(nr_os: int, ano: int) -> tuple[int, int]:
    return (nr_os, ano)


def resolve_painel_gravacao_targets(nr_os: int, ano: int) -> list[tuple[int, int]]:
    """OS lançada + irmãs da juntada ativa, se houver."""
    from services.gravacao_pendente_service import resolve_juntada_grupo_for_os

    anchor = (int(nr_os), int(ano))
    juntada = resolve_juntada_grupo_for_os(nr_os, ano)
    if not juntada:
        return [anchor]
    seen: set[tuple[int, int]] = set()
    out: list[tuple[int, int]] = []
    for member in juntada.get("membros") or []:
        try:
            key = (int(member["nr_os"]), int(member["ano"]))
        except (TypeError, ValueError, KeyError):
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    if anchor not in seen:
        out.insert(0, anchor)
    return out or [anchor]


def group_sessions_into_cards(
    sessions: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Um card por OS; juntadas viram um único card com membros[]."""
    cards: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for session in sessions:
        try:
            nr_os = int(session["nr_os"])
            ano = int(session["ano"])
        except (TypeError, ValueError, KeyError):
            continue
        gid = str(session.get("juntada_grupo_id") or "").strip()
        key = f"j:{gid}" if gid else _os_key(nr_os, ano)
        card = cards.get(key)
        if card is None:
            card = {
                "nr_os": nr_os,
                "ano": ano,
                "situacao": session.get("situacao"),
                "setor": session.get("setor"),
                "last_update": session.get("last_update"),
                "prioridade": session.get("prioridade"),
                "juntada_grupo_id": gid or None,
                "membros": [{"nr_os": nr_os, "ano": ano}],
                "sessions": [],
            }
            cards[key] = card
            order.append(key)
        elif not any(
            int(m["nr_os"]) == nr_os and int(m["ano"]) == ano for m in card["membros"]
        ):
            card["membros"].append({"nr_os": nr_os, "ano": ano})
            if _membro_key(nr_os, ano) < _membro_key(int(card["nr_os"]), int(card["ano"])):
                card["nr_os"] = nr_os
                card["ano"] = ano
        card["sessions"].append(session)
        last_update = session.get("last_update")
        if last_update and (
            not card.get("last_update") or str(last_update) > str(card["last_update"])
        ):
            card["last_update"] = last_update
            card["situacao"] = session.get("situacao") or card.get("situacao")
            card["setor"] = session.get("setor") or card.get("setor")
    for key in order:
        cards[key]["membros"] = sorted(
            cards[key]["membros"],
            key=lambda m: (int(m["nr_os"]), int(m["ano"])),
        )
    return [cards[k] for k in order]


def _usuario_join() -> str:
    return """
        LEFT JOIN tabUsuarios uf
            ON uf.Ponto = NULLIF(
                CAST(
                    REPLACE(REPLACE(IFNULL(ge.FornecedorPonto, ''), '.', ''), '-', '')
                    AS UNSIGNED
                ),
                0
            )
    """


def _fetch_chapas_by_pendente_ids(
    ids: list[int],
) -> dict[int, list[dict[str, Any]]]:
    if not ids:
        return {}
    mapping: dict[int, list[dict[str, Any]]] = {}
    chunk_size = 400
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i : i + chunk_size]
        placeholders = ", ".join(["%s"] * len(chunk))
        rows = db.execute_query(
            f"""
            SELECT GravacaoPendenteId, Maquina, QuantidadeChapas
            FROM tab_os_gravacao_pendente_chapa
            WHERE GravacaoPendenteId IN ({placeholders})
            ORDER BY Id
            """,
            tuple(chunk),
        )
        for row in rows or []:
            pid = _int_or_none(row.get("GravacaoPendenteId"))
            if pid is None:
                continue
            mapping.setdefault(pid, []).append(
                {
                    "maquina": str(row.get("Maquina") or "").strip(),
                    "quantidade": int(row.get("QuantidadeChapas") or 0),
                    "quantidade_restante": int(row.get("QuantidadeChapas") or 0),
                }
            )
    return mapping


def _fetch_received_by_session_ids(
    ids: list[int],
) -> dict[int, list[dict[str, Any]]]:
    if not ids:
        return {}
    mapping: dict[int, list[dict[str, Any]]] = {}
    chunk_size = 400
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i : i + chunk_size]
        placeholders = ", ".join(["%s"] * len(chunk))
        try:
            rows = db.execute_query(
                f"""
                SELECT GravacaoExternaId, Maquina, SUM(Quantidade) AS quantidade
                FROM tab_os_gravacao_externa_entrega_chapa
                WHERE GravacaoExternaId IN ({placeholders})
                GROUP BY GravacaoExternaId, Maquina
                """,
                tuple(chunk),
            )
        except Exception:
            logger.exception("Falha ao ler tab_os_gravacao_externa_entrega_chapa")
            return {}
        for row in rows or []:
            sid = _int_or_none(row.get("GravacaoExternaId"))
            if sid is None:
                continue
            mapping.setdefault(sid, []).append(
                {
                    "maquina": str(row.get("Maquina") or "").strip(),
                    "quantidade": int(row.get("quantidade") or 0),
                }
            )
    return mapping


def _list_grav_pendente_cards() -> list[dict[str, Any]]:
    from services.andamento_operacional import ultimo_operacional_cod_subquery

    ultimo_cod = ultimo_operacional_cod_subquery("gp.OsNro", "gp.OsAno")
    session_rows = db.execute_query(
        f"""
        SELECT
            gp.Id AS gravacao_pendente_id,
            gp.OsNro AS nr_os,
            gp.OsAno AS ano,
            gp.JuntadaGrupoId AS juntada_grupo_id,
            a.SituacaoLink AS situacao,
            a.SetorLink AS setor,
            a.`Data` AS last_update,
            gp.Componente AS componente
        FROM tab_os_gravacao_pendente gp
        INNER JOIN tabProtocolos p
            ON p.NroProtocolo = gp.OsNro AND p.AnoProtocolo = gp.OsAno
        LEFT JOIN tabAndamento a
            ON a.NroProtocoloLink = gp.OsNro
           AND a.AnoProtocoloLink = gp.OsAno
           AND a.CodStatus = {ultimo_cod}
        WHERE gp.Status = 'ativa'
        ORDER BY gp.CriadoEm DESC, gp.Id DESC
        """
    )
    seen: set[tuple[int, int]] = set()
    sessions: list[dict[str, Any]] = []
    pendente_ids: list[int] = []
    for row in session_rows or []:
        nr_os = _int_or_none(row.get("nr_os"))
        ano = _int_or_none(row.get("ano"))
        pid = _int_or_none(row.get("gravacao_pendente_id"))
        if nr_os is None or ano is None:
            continue
        seen.add((nr_os, ano))
        if pid is not None:
            pendente_ids.append(pid)
        sessions.append(
            {
                "nr_os": nr_os,
                "ano": ano,
                "situacao": row.get("situacao"),
                "setor": row.get("setor"),
                "last_update": _iso(row.get("last_update")),
                "gravacao_pendente_id": pid,
                "juntada_grupo_id": str(row.get("juntada_grupo_id") or "").strip() or None,
                "componente": normalize_stored_gravacao_componente(row.get("componente")),
                "chapas_por_maquina": [],
            }
        )

    ultimo_os = ultimo_operacional_cod_subquery("p.NroProtocolo", "p.AnoProtocolo")
    extra_rows = db.execute_query(
        f"""
        SELECT
            p.NroProtocolo AS nr_os,
            p.AnoProtocolo AS ano,
            a.SituacaoLink AS situacao,
            a.SetorLink AS setor,
            a.`Data` AS last_update
        FROM tabProtocolos p
        INNER JOIN tabAndamento a
            ON a.NroProtocoloLink = p.NroProtocolo
           AND a.AnoProtocoloLink = p.AnoProtocolo
           AND a.CodStatus = {ultimo_os}
        WHERE a.SituacaoLink = %s
        ORDER BY a.`Data` DESC
        """,
        (SITUACAO_GRAVACAO_PENDENTE,),
    )
    for row in extra_rows or []:
        nr_os = _int_or_none(row.get("nr_os"))
        ano = _int_or_none(row.get("ano"))
        if nr_os is None or ano is None or (nr_os, ano) in seen:
            continue
        seen.add((nr_os, ano))
        sessions.append(
            {
                "nr_os": nr_os,
                "ano": ano,
                "situacao": row.get("situacao"),
                "setor": row.get("setor"),
                "last_update": _iso(row.get("last_update")),
                "gravacao_pendente_id": None,
                "componente": "todos",
                "chapas_por_maquina": [],
            }
        )

    chapas_map = _fetch_chapas_by_pendente_ids(pendente_ids)
    for session in sessions:
        pid = session.get("gravacao_pendente_id")
        if pid is not None:
            session["chapas_por_maquina"] = chapas_map.get(int(pid), [])

    cards = group_sessions_into_cards(sessions)
    for card in cards:
        merged: list[dict[str, Any]] = []
        for sess in card["sessions"]:
            merged.extend(sess.get("chapas_por_maquina") or [])
        card["sessions"] = [
            {
                "gravacao_externa_id": None,
                "gravacao_pendente_id": sess.get("gravacao_pendente_id"),
                "fornecedor_ponto": None,
                "fornecedor_nome": None,
                "status": None,
                "componente": sess.get("componente"),
                "chapas_por_maquina": sess.get("chapas_por_maquina") or [],
            }
            for sess in card["sessions"]
        ]
        if not any(s.get("chapas_por_maquina") for s in card["sessions"]) and merged:
            card["sessions"][0]["chapas_por_maquina"] = merged
    return cards


def _list_externa_session_rows() -> list[dict[str, Any]]:
    from services.andamento_operacional import ultimo_operacional_cod_subquery

    ultimo_cod = ultimo_operacional_cod_subquery("ge.OsNro", "ge.OsAno")
    rows = db.execute_query(
        f"""
        SELECT
            ge.Id AS gravacao_externa_id,
            ge.OsNro AS nr_os,
            ge.OsAno AS ano,
            ge.Status AS gravacao_status,
            ge.FornecedorPonto AS fornecedor_ponto,
            uf.Nome AS fornecedor_nome,
            ge.OrigemPendenteId AS origem_pendente_id,
            ge.JuntadaGrupoId AS juntada_grupo_id,
            ge.Componente AS componente,
            ge.EntregaLancadaEm AS entrega_lancada_em,
            ge.EntregaDispensadaEm AS entrega_dispensada_em,
            ge.CriadoEm AS gravacao_criado_em,
            ge.ConcluidaEm AS concluida_em,
            a.SituacaoLink AS situacao,
            a.SetorLink AS setor,
            a.`Data` AS last_update
        FROM tab_os_gravacao_externa ge
        INNER JOIN tabProtocolos p
            ON p.NroProtocolo = ge.OsNro AND p.AnoProtocolo = ge.OsAno
        LEFT JOIN tabAndamento a
            ON a.NroProtocoloLink = ge.OsNro
           AND a.AnoProtocoloLink = ge.OsAno
           AND a.CodStatus = {ultimo_cod}
        {_usuario_join()}
        WHERE ge.Status IN ('pendente', 'iniciada', 'concluida')
        ORDER BY ge.CriadoEm DESC, ge.Id DESC
        """
    )
    return list(rows or [])


def _attach_externa_chapas(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    origem_ids = []
    session_ids = []
    for row in rows:
        oid = _int_or_none(row.get("origem_pendente_id"))
        sid = _int_or_none(row.get("gravacao_externa_id"))
        if oid is not None:
            origem_ids.append(oid)
        if sid is not None:
            session_ids.append(sid)
    origem_ids = list(dict.fromkeys(origem_ids))
    chapas_origem = _fetch_chapas_by_pendente_ids(origem_ids)
    received_map = _fetch_received_by_session_ids(session_ids)

    attached: list[dict[str, Any]] = []
    for row in rows:
        status = str(row.get("gravacao_status") or "").strip()
        if status == "concluida":
            if row.get("entrega_lancada_em") or row.get("entrega_dispensada_em"):
                continue
        oid = _int_or_none(row.get("origem_pendente_id"))
        sid = _int_or_none(row.get("gravacao_externa_id"))
        original = chapas_origem.get(oid or -1, []) if oid else []
        received = received_map.get(sid or -1, []) if sid else []
        chapas = compute_remaining_chapas(original, received)
        if status == "concluida" and not session_has_remaining(chapas):
            continue
        attached.append(
            {
                "nr_os": int(row["nr_os"]),
                "ano": int(row["ano"]),
                "situacao": row.get("situacao"),
                "setor": row.get("setor"),
                "last_update": _iso(row.get("concluida_em") or row.get("last_update")),
                "gravacao_externa_id": sid,
                "fornecedor_ponto": (row.get("fornecedor_ponto") or "").strip() or None,
                "fornecedor_nome": (row.get("fornecedor_nome") or "").strip() or None,
                "juntada_grupo_id": str(row.get("juntada_grupo_id") or "").strip() or None,
                "status": status,
                "componente": normalize_stored_gravacao_componente(row.get("componente")),
                "chapas_por_maquina": chapas,
            }
        )
    return attached


def get_painel_gravacao_board() -> dict[str, Any]:
    columns = _empty_columns()
    columns[COLUMN_GRAV_PENDENTE] = _list_grav_pendente_cards()

    externa = _attach_externa_chapas(_list_externa_session_rows())
    by_col: dict[str, list[dict[str, Any]]] = {
        COLUMN_SAIDA: [],
        COLUMN_RECEBIDO: [],
        COLUMN_CONCLUIDA: [],
    }
    for session in externa:
        col = EXTERNA_STATUS_TO_COLUMN.get(str(session.get("status") or ""))
        if not col:
            continue
        by_col[col].append(session)
    for col_id, sessions in by_col.items():
        columns[col_id] = group_sessions_into_cards(sessions)
    return {"columns": columns}


def _load_os_sessions(
    targets: list[tuple[int, int]],
) -> list[dict[str, Any]]:
    if not targets:
        return []
    clauses = []
    params: list[Any] = []
    for nro, os_ano in targets:
        clauses.append("(ge.OsNro = %s AND ge.OsAno = %s)")
        params.extend([nro, os_ano])
    rows = db.execute_query(
        f"""
        SELECT
            ge.Id AS gravacao_externa_id,
            ge.OsNro AS nr_os,
            ge.OsAno AS ano,
            ge.Status AS gravacao_status,
            ge.FornecedorPonto AS fornecedor_ponto,
            uf.Nome AS fornecedor_nome,
            ge.OrigemPendenteId AS origem_pendente_id,
            ge.JuntadaGrupoId AS juntada_grupo_id,
            ge.Componente AS componente,
            ge.EntregaLancadaEm AS entrega_lancada_em,
            ge.EntregaDispensadaEm AS entrega_dispensada_em
        FROM tab_os_gravacao_externa ge
        {_usuario_join()}
        WHERE ({" OR ".join(clauses)})
          AND ge.Status IN ('pendente', 'iniciada', 'concluida')
        """,
        tuple(params),
    )
    return _attach_externa_chapas(list(rows or []))


def lancar_painel_gravacao(
    *,
    ano: int,
    nr_os: int,
    situacao: str,
    setor: str,
    obs: str,
    usuario: str,
    column_id: str,
    gravacao_externa_ids: list[int] | None,
    chapas: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    situacao_n = str(situacao or "").strip()
    setor_n = str(setor or "").strip()
    if not situacao_n:
        raise HTTPException(status_code=400, detail="Informe o andamento.")
    if not setor_n:
        raise HTTPException(status_code=400, detail="Informe o setor.")
    ponto_fmt = format_ponto(_clean_ponto(usuario) or str(usuario or "").strip())
    if not ponto_fmt:
        raise HTTPException(status_code=400, detail="Informe o ponto.")
    column = str(column_id or "").strip()
    if column not in COLUMN_TITLES:
        raise HTTPException(status_code=400, detail="Coluna inválida.")

    expected_status = COLUMN_TO_EXTERNA_STATUS.get(column)
    selected_ids = [
        int(v)
        for v in (gravacao_externa_ids or [])
        if _int_or_none(v) is not None
    ]
    targets = resolve_painel_gravacao_targets(nr_os, ano)
    os_sessions = _load_os_sessions(targets) if expected_status else []
    by_id = {
        int(s["gravacao_externa_id"]): s
        for s in os_sessions
        if s.get("gravacao_externa_id") is not None
    }
    if expected_status:
        if not selected_ids:
            selected_ids = [
                int(s["gravacao_externa_id"])
                for s in os_sessions
                if s.get("status") == expected_status and s.get("gravacao_externa_id")
            ]
        if not selected_ids:
            raise HTTPException(
                status_code=400,
                detail="Nenhuma sessão de fornecedor encontrada para esta coluna.",
            )
        for sid in selected_ids:
            session = by_id.get(sid)
            if not session:
                raise HTTPException(
                    status_code=400,
                    detail="Sessão de gravação externa não pertence a esta OS.",
                )
            if session.get("status") != expected_status:
                raise HTTPException(
                    status_code=400,
                    detail="Sessão fora da situação da coluna selecionada.",
                )

    chapas_input = chapas or []
    persist_entrega = column == COLUMN_CONCLUIDA
    if persist_entrega:
        _validate_partial_chapas(selected_ids, by_id, chapas_input)

    obs_final = format_andamento_obs(str(obs or "").strip())
    recebido_nome = _lookup_usuario_nome(ponto_fmt) or _lookup_usuario_nome(usuario) or ""

    from routers.os_audit_service import log_andamento_added
    from services.andamento_operacional import insert_andamento_as_ultimo, next_cod_status_for_os

    def tx(cursor):
        inserted: list[tuple[str, int, int]] = []
        for t_nro, t_ano in targets:
            new_cod = next_cod_status_for_os(cursor, t_nro, t_ano)
            insert_andamento_as_ultimo(
                cursor,
                cod_status=new_cod,
                nro=t_nro,
                ano=t_ano,
                situacao=situacao_n,
                setor=setor_n,
                obs=obs_final,
                ponto=ponto_fmt,
            )
            log_andamento_added(
                cursor,
                nro=t_nro,
                ano=t_ano,
                cod_status=new_cod,
                situacao=situacao_n,
                setor=setor_n,
                obs=obs_final,
                ponto=ponto_fmt,
                origem="painel_gravacao",
            )
            inserted.append((str(new_cod), t_nro, t_ano))
        completed_ids: list[int] = []
        if persist_entrega:
            completed_ids = _persist_partial_entrega_cursor(
                cursor,
                session_ids=selected_ids,
                sessions_by_id=by_id,
                chapas_input=chapas_input,
                ponto_fmt=ponto_fmt,
                recebido_nome=recebido_nome,
            )
        return inserted, completed_ids

    inserted, completed_ids = db.execute_transaction([tx])[0]
    for new_cod, t_nro, t_ano in inserted:
        _notify_andamento_mdb(
            task_name="painel_gravacao",
            ano=t_ano,
            os_id=t_nro,
            new_cod=str(new_cod),
            situacao=situacao_n,
            setor=setor_n,
            source="painel_gravacao",
            operation="insert",
        )
    first_cod = inserted[0][0] if inserted else ""
    return {
        "new_id": str(first_cod),
        "entrega_completa_ids": completed_ids,
        "replicated_to": len(targets),
    }


def _validate_partial_chapas(
    session_ids: list[int],
    sessions_by_id: dict[int, dict[str, Any]],
    chapas_input: list[dict[str, Any]],
) -> None:
    remaining_by: dict[tuple[int, str], int] = {}
    unknown_sessions: set[int] = set()
    for sid in session_ids:
        session = sessions_by_id[sid]
        chapas = session.get("chapas_por_maquina") or []
        if not chapas:
            unknown_sessions.add(sid)
            continue
        for ch in chapas:
            maquina = str(ch.get("maquina") or "").strip()
            remaining_by[(sid, maquina)] = int(ch.get("quantidade_restante") or 0)

    for item in chapas_input:
        sid = _int_or_none(item.get("gravacao_externa_id"))
        if sid is None:
            if len(session_ids) == 1:
                sid = session_ids[0]
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Informe a sessão de cada quantidade de chapas.",
                )
        if sid not in session_ids:
            raise HTTPException(
                status_code=400,
                detail="Chapas referem sessão que não foi selecionada.",
            )
        qty = int(item.get("quantidade") or 0)
        if qty < 0:
            raise HTTPException(status_code=400, detail="Quantidade de chapas inválida.")
        if qty == 0:
            continue
        maquina = str(item.get("maquina") or "").strip()
        if sid in unknown_sessions:
            continue
        restante = remaining_by.get((sid, maquina))
        if restante is None:
            raise HTTPException(
                status_code=400,
                detail=f"Máquina '{maquina}' não existe nesta sessão.",
            )
        if qty > restante:
            raise HTTPException(
                status_code=400,
                detail=f"Quantidade de {maquina} excede o restante ({restante}).",
            )


def _persist_partial_entrega_cursor(
    cursor,
    *,
    session_ids: list[int],
    sessions_by_id: dict[int, dict[str, Any]],
    chapas_input: list[dict[str, Any]],
    ponto_fmt: str,
    recebido_nome: str,
) -> list[int]:
    received_now: dict[int, dict[str, int]] = {sid: {} for sid in session_ids}
    for item in chapas_input:
        sid = _int_or_none(item.get("gravacao_externa_id"))
        if sid is None and len(session_ids) == 1:
            sid = session_ids[0]
        if sid is None or sid not in received_now:
            continue
        qty = int(item.get("quantidade") or 0)
        if qty <= 0:
            continue
        maquina = str(item.get("maquina") or "").strip()
        if not maquina:
            continue
        received_now[sid][maquina] = received_now[sid].get(maquina, 0) + qty
        cursor.execute(
            """
            INSERT INTO tab_os_gravacao_externa_entrega_chapa
                (GravacaoExternaId, Maquina, Quantidade, RecebidoPorPonto)
            VALUES (%s, %s, %s, %s)
            """,
            (sid, maquina, qty, ponto_fmt),
        )

    completed: list[int] = []
    nome = (recebido_nome or "").strip()[:128]
    for sid in session_ids:
        session = sessions_by_id[sid]
        original = session.get("chapas_por_maquina") or []
        if not original:
            completed.append(sid)
            continue
        still_remaining = False
        now_map = received_now.get(sid) or {}
        for ch in original:
            maquina = str(ch.get("maquina") or "").strip()
            restante = int(ch.get("quantidade_restante") or 0) - int(now_map.get(maquina) or 0)
            if restante > 0:
                still_remaining = True
                break
        if not still_remaining:
            completed.append(sid)

    for sid in completed:
        cursor.execute(
            """
            UPDATE tab_os_gravacao_externa
            SET EntregaLancadaEm = NOW(),
                RecebidoPorPonto = %s,
                RecebidoPorNome = %s
            WHERE Id = %s
              AND EntregaLancadaEm IS NULL
              AND EntregaDispensadaEm IS NULL
            """,
            (ponto_fmt, nome, sid),
        )
    return completed

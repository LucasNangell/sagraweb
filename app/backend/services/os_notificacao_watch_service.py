"""CRUD e consulta de inscrições de notificação por OS."""
from __future__ import annotations

import logging
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

_CONTROL_START_SITUACOES = frozenset({"Recebido", "Em Execução"})


def _clean_ponto(value: str | None) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip()


def _pontos_match(left: str | None, right: str | None) -> bool:
    a = _clean_ponto(left)
    b = _clean_ponto(right)
    if a and b:
        return a == b
    return _normalize_text(left) == _normalize_text(right)


def _fetch_andamentos_desc(*, nro: int, ano: int) -> list[dict[str, Any]]:
    from services.andamento_table import get_andamento_table

    tbl = get_andamento_table()
    return db.execute_query(
        f"""
        SELECT SituacaoLink, Ponto, CodStatus, `Data`
        FROM {tbl}
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        ORDER BY `Data` DESC, CodStatus DESC
        """,
        (nro, ano),
    )


def is_os_change_control_active(*, ponto: str, nro: int, ano: int) -> bool:
    """
    Controle de alterações ativo quando:
    - o último andamento é do usuário inscrito; e
    - na cadeia consecutiva desse usuário existe Recebido ou Em Execução.
    Zera quando outro ponto lança andamento (último deixa de ser do usuário).
    """
    rows = _fetch_andamentos_desc(nro=nro, ano=ano)
    if not rows:
        return False

    latest = rows[0]
    if not _pontos_match(latest.get("Ponto"), ponto):
        return False

    for row in rows:
        row_ponto = row.get("Ponto")
        if not _pontos_match(row_ponto, ponto):
            break
        situacao = _normalize_text(row.get("SituacaoLink"))
        if situacao in _CONTROL_START_SITUACOES:
            return True
    return False


def get_watch_for_user_os(*, ponto: str, nro: int, ano: int) -> Optional[dict[str, Any]]:
    clean = _clean_ponto(ponto) or str(ponto).strip()
    rows = db.execute_query(
        """
        SELECT Id, Ponto, NroProtocolo, AnoProtocolo,
               NotifyAndamentos, NotifyAllAndamentos,
               AndamentoSituacao, AndamentoSetor,
               NotifyOsChanges, Ativo, DataCriacao, DataAtualizacao
        FROM tabOsNotificacaoWatch
        WHERE (Ponto = %s OR REPLACE(REPLACE(Ponto, '.', ''), '-', '') = %s)
          AND NroProtocolo = %s AND AnoProtocolo = %s
        LIMIT 1
        """,
        (ponto, clean, nro, ano),
    )
    return rows[0] if rows else None


def upsert_watch(
    *,
    ponto: str,
    nro: int,
    ano: int,
    notify_andamentos: bool,
    notify_all_andamentos: bool,
    andamento_situacao: str | None,
    andamento_setor: str | None,
    notify_os_changes: bool,
) -> dict[str, Any]:
    if not notify_andamentos and not notify_os_changes:
        delete_watch(ponto=ponto, nro=nro, ano=ano)
        return {"deleted": True}

    situacao = None if notify_all_andamentos or not notify_andamentos else _normalize_text(andamento_situacao) or None
    setor = None if notify_all_andamentos or not notify_andamentos else _normalize_text(andamento_setor) or None

    if notify_andamentos and not notify_all_andamentos and (not situacao or not setor):
        raise ValueError("Informe andamento e setor ou marque todos os andamentos.")

    clean = _clean_ponto(ponto) or str(ponto).strip()
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tabOsNotificacaoWatch (
                Ponto, NroProtocolo, AnoProtocolo,
                NotifyAndamentos, NotifyAllAndamentos,
                AndamentoSituacao, AndamentoSetor,
                NotifyOsChanges, Ativo
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1)
            ON DUPLICATE KEY UPDATE
                NotifyAndamentos = VALUES(NotifyAndamentos),
                NotifyAllAndamentos = VALUES(NotifyAllAndamentos),
                AndamentoSituacao = VALUES(AndamentoSituacao),
                AndamentoSetor = VALUES(AndamentoSetor),
                NotifyOsChanges = VALUES(NotifyOsChanges),
                Ativo = 1
            """,
            (
                clean,
                nro,
                ano,
                int(notify_andamentos),
                int(notify_all_andamentos),
                situacao,
                setor,
                int(notify_os_changes),
            ),
        )
    row = get_watch_for_user_os(ponto=clean, nro=nro, ano=ano)
    return row or {"saved": True}


def delete_watch(*, ponto: str, nro: int, ano: int) -> None:
    clean = _clean_ponto(ponto) or str(ponto).strip()
    db.execute_query(
        """
        DELETE FROM tabOsNotificacaoWatch
        WHERE (Ponto = %s OR REPLACE(REPLACE(Ponto, '.', ''), '-', '') = %s)
          AND NroProtocolo = %s AND AnoProtocolo = %s
        """,
        (ponto, clean, nro, ano),
    )


def list_andamento_watchers(*, nro: int, ano: int, situacao: str | None, setor: str | None) -> list[str]:
    sit = _normalize_text(situacao)
    sec = _normalize_text(setor)
    rows = db.execute_query(
        """
        SELECT DISTINCT Ponto
        FROM tabOsNotificacaoWatch
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
          AND Ativo = 1 AND NotifyAndamentos = 1
          AND (
            NotifyAllAndamentos = 1
            OR (AndamentoSituacao = %s AND AndamentoSetor = %s)
          )
        """,
        (nro, ano, sit, sec),
    )
    return [str(r["Ponto"]) for r in rows if r.get("Ponto")]


def list_os_change_watchers(*, nro: int, ano: int) -> list[str]:
    rows = db.execute_query(
        """
        SELECT DISTINCT Ponto
        FROM tabOsNotificacaoWatch
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
          AND Ativo = 1 AND NotifyOsChanges = 1
        """,
        (nro, ano),
    )
    pontos = [str(r["Ponto"]) for r in rows if r.get("Ponto")]
    return [
        ponto
        for ponto in pontos
        if is_os_change_control_active(ponto=ponto, nro=nro, ano=ano)
    ]

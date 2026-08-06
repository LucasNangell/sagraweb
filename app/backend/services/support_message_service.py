"""Mensagens de suporte — tickets com thread até resolução pelo admin."""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from database import db
from services.notification_push_service import insert_user_notification, push_user_notification
from services.support_realtime_service import (
    push_support_thread_message,
    push_support_ticket_resolved,
)
from services.support_settings import list_admin_notify_pontos

logger = logging.getLogger(__name__)

_TICKET_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tabSupportMessages (
  Id int NOT NULL AUTO_INCREMENT,
  Ponto varchar(32) NOT NULL,
  NomeUsuario varchar(128) DEFAULT NULL,
  Tipo varchar(16) NOT NULL DEFAULT 'problema',
  Assunto varchar(255) NOT NULL,
  Mensagem text NOT NULL,
  Status varchar(16) NOT NULL DEFAULT 'aberto',
  Resposta text DEFAULT NULL,
  RespondidoPor varchar(64) DEFAULT NULL,
  DataCriacao datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  DataResposta datetime DEFAULT NULL,
  DataResolucao datetime DEFAULT NULL,
  ResolvidoPor varchar(64) DEFAULT NULL,
  PRIMARY KEY (Id),
  KEY idx_support_status (Status),
  KEY idx_support_ponto (Ponto),
  KEY idx_support_data (DataCriacao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_THREAD_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tabSupportThreadMessages (
  Id int NOT NULL AUTO_INCREMENT,
  TicketId int NOT NULL,
  AutorTipo varchar(16) NOT NULL,
  AutorPonto varchar(32) DEFAULT NULL,
  AutorNome varchar(128) DEFAULT NULL,
  Mensagem text NOT NULL,
  DataCriacao datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  KEY idx_support_thread_ticket (TicketId),
  KEY idx_support_thread_data (DataCriacao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_LEGACY_MIGRATED = False


def ensure_support_messages_schema() -> None:
    global _LEGACY_MIGRATED
    try:
        db.execute_query(_TICKET_SCHEMA_SQL)
        db.execute_query(_THREAD_SCHEMA_SQL)
        _ensure_ticket_extra_columns()
        if not _LEGACY_MIGRATED:
            _migrate_legacy_tickets()
            _LEGACY_MIGRATED = True
    except Exception as exc:
        logger.error("Falha ao garantir schema de suporte: %s", exc)


def _ensure_ticket_extra_columns() -> None:
    rows = db.execute_query(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tabSupportMessages'
        """
    )
    existing = {str(row.get("COLUMN_NAME") or "") for row in rows}
    if "DataResolucao" not in existing:
        db.execute_query(
            "ALTER TABLE tabSupportMessages ADD COLUMN DataResolucao datetime DEFAULT NULL"
        )
    if "ResolvidoPor" not in existing:
        db.execute_query(
            "ALTER TABLE tabSupportMessages ADD COLUMN ResolvidoPor varchar(64) DEFAULT NULL"
        )
    for col, ddl in (
        ("AssignedPonto", "varchar(32) DEFAULT NULL"),
        ("OsAno", "int DEFAULT NULL"),
        ("OsNro", "int DEFAULT NULL"),
        ("ClienteId", "int DEFAULT NULL"),
        ("VersaoPt", "varchar(64) DEFAULT NULL"),
        ("Source", "varchar(16) NOT NULL DEFAULT 'interno'"),
    ):
        if col not in existing:
            db.execute_query(
                f"ALTER TABLE tabSupportMessages ADD COLUMN {col} {ddl}"
            )


def _normalize_status(value: str | None) -> str:
    raw = str(value or "aberto").strip().lower()
    if raw in ("resolvido", "respondido"):
        return "resolvido"
    return "aberto"


def _migrate_legacy_tickets() -> None:
    db.execute_query(
        """
        UPDATE tabSupportMessages
        SET Status = 'aberto'
        WHERE Status IN ('pendente', 'respondido')
        """
    )
    tickets = db.execute_query("SELECT * FROM tabSupportMessages")
    for ticket in tickets:
        ticket_id = int(ticket["Id"])
        existing = db.execute_query(
            "SELECT COUNT(*) AS total FROM tabSupportThreadMessages WHERE TicketId = %s",
            (ticket_id,),
        )
        if existing and int(existing[0].get("total") or 0) > 0:
            continue
        initial = str(ticket.get("Mensagem") or "").strip()
        if initial:
            _insert_thread_message(
                ticket_id=ticket_id,
                autor_tipo="usuario",
                autor_ponto=str(ticket.get("Ponto") or ""),
                autor_nome=ticket.get("NomeUsuario"),
                mensagem=initial,
            )
        resposta = str(ticket.get("Resposta") or "").strip()
        if resposta:
            _insert_thread_message(
                ticket_id=ticket_id,
                autor_tipo="admin",
                autor_ponto=None,
                autor_nome=ticket.get("RespondidoPor"),
                mensagem=resposta,
            )


def _thread_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "Id": int(row["Id"]),
        "TicketId": int(row["TicketId"]),
        "AutorTipo": str(row.get("AutorTipo") or ""),
        "AutorPonto": row.get("AutorPonto"),
        "AutorNome": row.get("AutorNome"),
        "Mensagem": str(row.get("Mensagem") or ""),
        "DataCriacao": row.get("DataCriacao"),
    }


def _row_to_dict(row: dict[str, Any], *, thread: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    status = _normalize_status(row.get("Status"))
    payload: dict[str, Any] = {
        "Id": int(row["Id"]),
        "Ponto": str(row.get("Ponto") or ""),
        "NomeUsuario": row.get("NomeUsuario"),
        "Tipo": str(row.get("Tipo") or "problema"),
        "Assunto": str(row.get("Assunto") or ""),
        "Mensagem": str(row.get("Mensagem") or ""),
        "Status": status,
        "Resposta": row.get("Resposta"),
        "RespondidoPor": row.get("RespondidoPor"),
        "DataCriacao": row.get("DataCriacao"),
        "DataResposta": row.get("DataResposta"),
        "DataResolucao": row.get("DataResolucao"),
        "ResolvidoPor": row.get("ResolvidoPor"),
        "AssignedPonto": row.get("AssignedPonto"),
        "OsAno": row.get("OsAno"),
        "OsNro": row.get("OsNro"),
        "ClienteId": row.get("ClienteId"),
        "VersaoPt": row.get("VersaoPt"),
        "Source": str(row.get("Source") or "interno"),
    }
    if thread is not None:
        payload["Thread"] = thread
    return payload


def _clean_ponto_digits(value: str | None) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def _normalize_ptv_token(versao: str | None) -> str | None:
    if not versao or not str(versao).strip():
        return None
    ver_clean = (
        str(versao)
        .lower()
        .replace("original", "")
        .replace("v", "")
        .replace("(", "")
        .replace(")", "")
        .strip()
    )
    return f"ptv{ver_clean}" if ver_clean else None


def resolve_pt_registrant_ponto(
    nr_os: int,
    ano: int,
    versao: str | None = None,
) -> Optional[str]:
    """Ponto do analista que registrou o andamento de Problemas Técnicos."""
    rows = db.execute_query(
        """
        SELECT Ponto, `Observaçao` AS observacao
        FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
          AND SituacaoLink = 'Problemas Técnicos'
        ORDER BY `Data` DESC, CodStatus DESC
        """,
        (nr_os, ano),
    )
    if not rows:
        return None
    ptv_token = _normalize_ptv_token(versao)
    if ptv_token:
        for row in rows:
            obs = str(row.get("observacao") or "").lower().replace(" ", "")
            if ptv_token in obs:
                return str(row.get("Ponto") or "").strip() or None
        return None
    return str(rows[0].get("Ponto") or "").strip() or None


def _push_support_realtime(
    *,
    ticket_id: int,
    thread_message: dict[str, Any],
    ticket: dict[str, Any],
) -> None:
    owner = str(ticket.get("Ponto") or "")
    assigned = ticket.get("AssignedPonto")
    cliente_id = ticket.get("ClienteId")
    push_support_thread_message(
        ticket_id=ticket_id,
        thread_message=thread_message,
        owner_ponto=owner,
        ticket_status=str(ticket.get("Status") or "aberto"),
        assigned_ponto=str(assigned) if assigned else None,
        cliente_id=int(cliente_id) if cliente_id else None,
    )


def _notify_assigned_cliente_message(
    *,
    ticket: dict[str, Any],
    latest_message: str,
) -> None:
    assigned = str(ticket.get("AssignedPonto") or "").strip()
    if not assigned:
        return
    ticket_id = int(ticket["Id"])
    nr_os = int(ticket.get("OsNro") or 0)
    ano = int(ticket.get("OsAno") or 0)
    detalhes = json.dumps(
        {
            "type": "cliente_support",
            "support_message_id": ticket_id,
            "ticket_id": ticket_id,
            "assunto": ticket["Assunto"],
            "resposta": latest_message,
            "os_nro": nr_os,
            "os_ano": ano,
        },
        ensure_ascii=False,
    )
    mensagem = f"Cliente enviou dúvida sobre OS {nr_os}/{ano}: {ticket['Assunto']}"
    notification_id = insert_user_notification(
        ponto=assigned,
        nro=nr_os,
        ano=ano,
        mensagem=mensagem,
        detalhes_json=detalhes,
    )
    push_user_notification(
        target_ponto=assigned,
        mensagem=mensagem,
        nro=nr_os,
        ano=ano,
        notification_id=notification_id,
        action="cliente_support",
    )


def _insert_thread_message(
    *,
    ticket_id: int,
    autor_tipo: str,
    autor_ponto: str | None,
    autor_nome: str | None,
    mensagem: str,
) -> dict[str, Any]:
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tabSupportThreadMessages
                (TicketId, AutorTipo, AutorPonto, AutorNome, Mensagem)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (ticket_id, autor_tipo, autor_ponto, autor_nome, mensagem.strip()),
        )
        row_id = int(cursor.lastrowid or 0)
    rows = db.execute_query(
        "SELECT * FROM tabSupportThreadMessages WHERE Id = %s",
        (row_id,),
    )
    if not rows:
        raise RuntimeError("Mensagem da thread não encontrada após inserção.")
    return _thread_row_to_dict(rows[0])


def _get_thread_messages(ticket_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tabSupportThreadMessages
        WHERE TicketId = %s
        ORDER BY DataCriacao ASC, Id ASC
        """,
        (ticket_id,),
    )
    return [_thread_row_to_dict(row) for row in rows]


def _notify_admin_support_message(
    *,
    ticket: dict[str, Any],
    latest_message: str,
    is_new: bool,
) -> None:
    if str(ticket.get("Source") or "interno") == "cliente":
        return
    admin_pontos = list_admin_notify_pontos()
    if not admin_pontos:
        logger.warning(
            "Nenhum administrador configurado para notificações de suporte (ticket %s).",
            ticket.get("Id"),
        )
        return

    ticket_id = int(ticket["Id"])
    source = str(ticket.get("Source") or "interno")
    autor = str(ticket.get("NomeUsuario") or ticket.get("Ponto") or "Usuário")
    sender_ponto = str(ticket.get("Ponto") or "").strip()
    detalhes = json.dumps(
        {
            "type": "support_incoming",
            "support_message_id": ticket_id,
            "ticket_id": ticket_id,
            "assunto": ticket["Assunto"],
            "mensagem": latest_message,
            "tipo": ticket["Tipo"],
            "autor": autor,
            "autor_ponto": sender_ponto,
            "source": source,
        },
        ensure_ascii=False,
    )
    if source == "sistema":
        mensagem = f"Alerta do sistema: {ticket['Assunto']}"
    elif is_new:
        mensagem = f"Nova mensagem ao suporte de {autor}: {ticket['Assunto']}"
    else:
        mensagem = f"{autor} respondeu na conversa: {ticket['Assunto']}"

    for admin_ponto in admin_pontos:
        if sender_ponto and str(admin_ponto).strip() == sender_ponto:
            continue
        notification_id = insert_user_notification(
            ponto=admin_ponto,
            nro=0,
            ano=0,
            mensagem=mensagem,
            detalhes_json=detalhes,
        )
        push_user_notification(
            target_ponto=admin_ponto,
            mensagem=mensagem,
            nro=0,
            ano=0,
            notification_id=notification_id,
            action="support_incoming",
            ticket_id=ticket_id,
            support_message_id=ticket_id,
        )


def _notify_user_support_reply(
    *,
    ticket: dict[str, Any],
    latest_message: str,
) -> None:
    ticket_id = int(ticket["Id"])
    detalhes = json.dumps(
        {
            "type": "support_reply",
            "support_message_id": ticket_id,
            "ticket_id": ticket_id,
            "assunto": ticket["Assunto"],
            "resposta": latest_message,
            "tipo": ticket["Tipo"],
        },
        ensure_ascii=False,
    )
    mensagem = f"O suporte respondeu: {ticket['Assunto']}"
    notification_id = insert_user_notification(
        ponto=ticket["Ponto"],
        nro=0,
        ano=0,
        mensagem=mensagem,
        detalhes_json=detalhes,
    )
    push_user_notification(
        target_ponto=ticket["Ponto"],
        mensagem=mensagem,
        nro=0,
        ano=0,
        notification_id=notification_id,
        action="support_reply",
        ticket_id=ticket_id,
        support_message_id=ticket_id,
    )


def create_support_message(
    *,
    ponto: str,
    nome_usuario: str | None,
    tipo: str,
    assunto: str,
    mensagem: str,
) -> dict[str, Any]:
    ensure_support_messages_schema()
    tipo_norm = "sugestao" if tipo.strip().lower() == "sugestao" else "problema"
    body = mensagem.strip()
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tabSupportMessages
                (Ponto, NomeUsuario, Tipo, Assunto, Mensagem, Status)
            VALUES (%s, %s, %s, %s, %s, 'aberto')
            """,
            (ponto, nome_usuario, tipo_norm, assunto.strip(), body),
        )
        row_id = int(cursor.lastrowid or 0)
    first = _insert_thread_message(
        ticket_id=row_id,
        autor_tipo="usuario",
        autor_ponto=ponto,
        autor_nome=nome_usuario,
        mensagem=body,
    )
    created = get_support_message(row_id) or {}
    if created:
        _push_support_realtime(
            ticket_id=row_id,
            thread_message=first,
            ticket=created,
        )
        _notify_admin_support_message(
            ticket=created,
            latest_message=body,
            is_new=True,
        )
    return created


def create_system_mdb_alert(
    *,
    task_name: str,
    exc: Exception,
    cod_status: str | None = None,
    nro: int | None = None,
    ano: int | None = None,
    andamento: dict[str, str | int | None] | None = None,
) -> dict[str, Any] | None:
    """
    Abre ticket de suporte automático quando a sincronização Access/MDB falha.

    Notifica administradores imediatamente via push. Evita duplicar alertas idênticos
    em curto intervalo (mesma operação + OS + CodStatus).
    """
    from routers.mdb_writer import format_mdb_failure_detail

    ensure_support_messages_schema()
    record = andamento or {}
    alert_nro = nro if nro is not None else record.get("nro")
    alert_ano = ano if ano is not None else record.get("ano")
    alert_cod = cod_status or record.get("cod_status")

    assunto_parts = [f"Falha Access/MDB — {task_name}"]
    if alert_nro is not None and alert_ano is not None:
        assunto_parts.append(f"OS {alert_nro}/{alert_ano}")
    if alert_cod:
        assunto_parts.append(str(alert_cod))
    assunto = " — ".join(assunto_parts)

    body = format_mdb_failure_detail(
        exc,
        task_name=task_name,
        cod_status=str(alert_cod) if alert_cod else None,
        nro=int(alert_nro) if alert_nro is not None else None,
        ano=int(alert_ano) if alert_ano is not None else None,
        andamento=record,
    )

    recent = db.execute_query(
        """
        SELECT Id FROM tabSupportMessages
        WHERE Source = 'sistema'
          AND Assunto = %s
          AND Status = 'aberto'
          AND DataCriacao >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
        ORDER BY Id DESC
        LIMIT 1
        """,
        (assunto,),
    )
    if recent:
        ticket_id = int(recent[0]["Id"])
        latest = _insert_thread_message(
            ticket_id=ticket_id,
            autor_tipo="sistema",
            autor_ponto=None,
            autor_nome="SAGRA Web",
            mensagem=body,
        )
        updated = get_support_message(ticket_id)
        if updated:
            _push_support_realtime(
                ticket_id=ticket_id,
                thread_message=latest,
                ticket=updated,
            )
            _notify_admin_support_message(
                ticket=updated,
                latest_message=body,
                is_new=False,
            )
        return updated

    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tabSupportMessages
                (Ponto, NomeUsuario, Tipo, Assunto, Mensagem, Status, Source, OsAno, OsNro)
            VALUES (%s, %s, %s, %s, %s, 'aberto', 'sistema', %s, %s)
            """,
            (
                "SISTEMA",
                "SAGRA Web",
                "problema",
                assunto,
                body,
                int(alert_ano) if alert_ano is not None else ano,
                int(alert_nro) if alert_nro is not None else nro,
            ),
        )
        row_id = int(cursor.lastrowid or 0)
    first = _insert_thread_message(
        ticket_id=row_id,
        autor_tipo="sistema",
        autor_ponto=None,
        autor_nome="SAGRA Web",
        mensagem=body,
    )
    created = get_support_message(row_id) or {}
    if created:
        _push_support_realtime(
            ticket_id=row_id,
            thread_message=first,
            ticket=created,
        )
        _notify_admin_support_message(
            ticket=created,
            latest_message=body,
            is_new=True,
        )
    return created or None


def list_support_messages(
    *,
    status: str | None = None,
    ponto: str | None = None,
) -> list[dict[str, Any]]:
    ensure_support_messages_schema()
    clauses: list[str] = []
    params: list[Any] = []
    if ponto:
        clauses.append("Ponto = %s")
        params.append(ponto)
    if status in ("aberto", "resolvido"):
        clauses.append("Status = %s")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.execute_query(
        f"""
        SELECT * FROM tabSupportMessages
        {where}
        ORDER BY DataCriacao DESC
        """,
        tuple(params),
    )
    return [_row_to_dict(row) for row in rows]


def get_support_message(message_id: int, *, with_thread: bool = True) -> Optional[dict[str, Any]]:
    ensure_support_messages_schema()
    rows = db.execute_query(
        "SELECT * FROM tabSupportMessages WHERE Id = %s",
        (message_id,),
    )
    if not rows:
        return None
    thread = _get_thread_messages(message_id) if with_thread else None
    return _row_to_dict(rows[0], thread=thread)


def _assert_ticket_open(ticket: dict[str, Any]) -> None:
    if _normalize_status(ticket.get("Status")) != "aberto":
        raise ValueError("Esta conversa já foi encerrada pelo suporte.")


def add_admin_reply(
    *,
    message_id: int,
    resposta: str,
    respondido_por: str,
) -> Optional[dict[str, Any]]:
    ensure_support_messages_schema()
    existing = get_support_message(message_id, with_thread=False)
    if existing is None:
        return None
    _assert_ticket_open(existing)

    latest = _insert_thread_message(
        ticket_id=message_id,
        autor_tipo="admin",
        autor_ponto=None,
        autor_nome=respondido_por,
        mensagem=resposta,
    )
    db.execute_query(
        """
        UPDATE tabSupportMessages
        SET Resposta = %s,
            RespondidoPor = %s,
            DataResposta = NOW()
        WHERE Id = %s
        """,
        (resposta.strip(), respondido_por, message_id),
    )
    updated = get_support_message(message_id)
    if updated:
        _push_support_realtime(
            ticket_id=message_id,
            thread_message=latest,
            ticket=updated,
        )
        if str(updated.get("Source") or "") == "cliente":
            pass
        else:
            _notify_user_support_reply(ticket=updated, latest_message=latest["Mensagem"])
    return updated


def add_user_reply(
    *,
    message_id: int,
    ponto: str,
    nome_usuario: str | None,
    mensagem: str,
) -> Optional[dict[str, Any]]:
    ensure_support_messages_schema()
    existing = get_support_message(message_id, with_thread=False)
    if existing is None:
        return None
    if str(existing.get("Ponto") or "") != str(ponto):
        raise PermissionError("Conversa não pertence ao usuário.")
    _assert_ticket_open(existing)

    latest = _insert_thread_message(
        ticket_id=message_id,
        autor_tipo="usuario",
        autor_ponto=ponto,
        autor_nome=nome_usuario,
        mensagem=mensagem,
    )
    updated = get_support_message(message_id)
    if updated:
        _push_support_realtime(
            ticket_id=message_id,
            thread_message=latest,
            ticket=updated,
        )
        if str(updated.get("Source") or "") == "cliente":
            _notify_assigned_cliente_message(
                ticket=updated,
                latest_message=latest["Mensagem"],
            )
        else:
            _notify_admin_support_message(
                ticket=updated,
                latest_message=latest["Mensagem"],
                is_new=False,
            )
    return updated


def resolve_support_message(
    *,
    message_id: int,
    resolvido_por: str,
) -> Optional[dict[str, Any]]:
    ensure_support_messages_schema()
    existing = get_support_message(message_id, with_thread=False)
    if existing is None:
        return None
    db.execute_query(
        """
        UPDATE tabSupportMessages
        SET Status = 'resolvido',
            DataResolucao = NOW(),
            ResolvidoPor = %s
        WHERE Id = %s
        """,
        (resolvido_por, message_id),
    )
    updated = get_support_message(message_id)
    if updated:
        push_support_ticket_resolved(
            ticket_id=message_id,
            owner_ponto=str(updated["Ponto"]),
            assigned_ponto=str(updated.get("AssignedPonto") or "") or None,
            cliente_id=int(updated["ClienteId"]) if updated.get("ClienteId") else None,
        )
    return updated


def reply_support_message(
    *,
    message_id: int,
    resposta: str,
    respondido_por: str,
) -> Optional[dict[str, Any]]:
    """Compatibilidade com rota existente — adiciona mensagem admin sem encerrar."""
    return add_admin_reply(
        message_id=message_id,
        resposta=resposta,
        respondido_por=respondido_por,
    )


def _cliente_ponto_key(cliente_id: int) -> str:
    return f"cliente:{int(cliente_id)}"


def get_cliente_open_ticket(
    *,
    cliente_id: int,
    nr_os: int,
    ano: int,
) -> Optional[dict[str, Any]]:
    ensure_support_messages_schema()
    rows = db.execute_query(
        """
        SELECT Id FROM tabSupportMessages
        WHERE ClienteId = %s AND OsNro = %s AND OsAno = %s
          AND Source = 'cliente' AND Status = 'aberto'
        ORDER BY DataCriacao DESC
        LIMIT 1
        """,
        (cliente_id, nr_os, ano),
    )
    if not rows:
        return None
    return get_support_message(int(rows[0]["Id"]))


def create_cliente_support_message(
    *,
    cliente_id: int,
    nome_cliente: str | None,
    nr_os: int,
    ano: int,
    assunto: str,
    mensagem: str,
    versao: str | None = None,
) -> dict[str, Any]:
    ensure_support_messages_schema()
    assigned = resolve_pt_registrant_ponto(nr_os, ano, versao)
    if not assigned:
        raise ValueError(
            "Não foi possível identificar o responsável pelos problemas técnicos desta OS."
        )
    existing = get_cliente_open_ticket(
        cliente_id=cliente_id,
        nr_os=nr_os,
        ano=ano,
    )
    if existing:
        updated = add_cliente_reply(
            message_id=int(existing["Id"]),
            cliente_id=cliente_id,
            nome_cliente=nome_cliente,
            mensagem=mensagem,
        )
        if updated is None:
            raise RuntimeError("Falha ao enviar mensagem na conversa existente.")
        return updated

    body = mensagem.strip()
    ponto_key = _cliente_ponto_key(cliente_id)
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tabSupportMessages
                (Ponto, NomeUsuario, Tipo, Assunto, Mensagem, Status,
                 AssignedPonto, OsAno, OsNro, ClienteId, VersaoPt, Source)
            VALUES (%s, %s, 'problema', %s, %s, 'aberto',
                    %s, %s, %s, %s, %s, 'cliente')
            """,
            (
                ponto_key,
                nome_cliente,
                assunto.strip(),
                body,
                assigned,
                ano,
                nr_os,
                cliente_id,
                versao,
            ),
        )
        row_id = int(cursor.lastrowid or 0)
    first = _insert_thread_message(
        ticket_id=row_id,
        autor_tipo="cliente",
        autor_ponto=ponto_key,
        autor_nome=nome_cliente,
        mensagem=body,
    )
    created = get_support_message(row_id) or {}
    if created:
        _push_support_realtime(
            ticket_id=row_id,
            thread_message=first,
            ticket=created,
        )
        _notify_assigned_cliente_message(ticket=created, latest_message=body)
    return created


def get_cliente_support_message(
    message_id: int,
    *,
    cliente_id: int,
) -> Optional[dict[str, Any]]:
    item = get_support_message(message_id)
    if item is None or int(item.get("ClienteId") or 0) != int(cliente_id):
        return None
    return item


def add_cliente_reply(
    *,
    message_id: int,
    cliente_id: int,
    nome_cliente: str | None,
    mensagem: str,
) -> Optional[dict[str, Any]]:
    ensure_support_messages_schema()
    existing = get_support_message(message_id, with_thread=False)
    if existing is None or int(existing.get("ClienteId") or 0) != int(cliente_id):
        return None
    _assert_ticket_open(existing)

    latest = _insert_thread_message(
        ticket_id=message_id,
        autor_tipo="cliente",
        autor_ponto=_cliente_ponto_key(cliente_id),
        autor_nome=nome_cliente,
        mensagem=mensagem,
    )
    updated = get_support_message(message_id)
    if updated:
        _push_support_realtime(
            ticket_id=message_id,
            thread_message=latest,
            ticket=updated,
        )
        _notify_assigned_cliente_message(
            ticket=updated,
            latest_message=latest["Mensagem"],
        )
    return updated


def _ponto_matches(stored: str | None, session_ponto: str) -> bool:
    a = _clean_ponto_digits(stored)
    b = _clean_ponto_digits(session_ponto)
    if a and b and a == b:
        return True
    return str(stored or "").strip() == str(session_ponto).strip()


def list_assigned_support_messages(
    *,
    assigned_ponto: str,
    status: str | None = None,
) -> list[dict[str, Any]]:
    ensure_support_messages_schema()
    clauses = ["Source = 'cliente'", "AssignedPonto IS NOT NULL"]
    params: list[Any] = []
    digits = _clean_ponto_digits(assigned_ponto)
    if digits:
        clauses.append(
            "(REPLACE(REPLACE(AssignedPonto, '.', ''), '-', '') = %s OR AssignedPonto = %s)"
        )
        params.extend([digits, str(assigned_ponto).strip()])
    else:
        clauses.append("AssignedPonto = %s")
        params.append(str(assigned_ponto).strip())
    if status in ("aberto", "resolvido"):
        clauses.append("Status = %s")
        params.append(status)
    where = " AND ".join(clauses)
    rows = db.execute_query(
        f"""
        SELECT * FROM tabSupportMessages
        WHERE {where}
        ORDER BY DataCriacao DESC
        """,
        tuple(params),
    )
    return [_row_to_dict(row) for row in rows]


def get_assigned_support_message(
    message_id: int,
    *,
    assigned_ponto: str,
) -> Optional[dict[str, Any]]:
    item = get_support_message(message_id)
    if item is None or str(item.get("Source") or "") != "cliente":
        return None
    if not _ponto_matches(str(item.get("AssignedPonto") or ""), assigned_ponto):
        return None
    return item


def add_assigned_reply(
    *,
    message_id: int,
    assigned_ponto: str,
    respondido_por: str,
    resposta: str,
) -> Optional[dict[str, Any]]:
    existing = get_assigned_support_message(message_id, assigned_ponto=assigned_ponto)
    if existing is None:
        return None
    return add_admin_reply(
        message_id=message_id,
        resposta=resposta,
        respondido_por=respondido_por,
    )

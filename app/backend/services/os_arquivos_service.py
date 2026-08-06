"""Tokens e fluxo de envio de arquivos na abertura de OS (< 5000)."""
from __future__ import annotations

import logging
import os
import secrets
from typing import List, Optional, Tuple
from database import db
from routers.analise_routes import _save_client_upload_file
from services.os_folder_structure import (
    ensure_os_folder_on_network,
    resolve_initial_original_dir,
)

logger = logging.getLogger(__name__)

_OS_ARQUIVOS_COMPONENT = "Arquivos"
_TOKENS_DDL = """
CREATE TABLE IF NOT EXISTS tabOsArquivosTokens (
  ID int NOT NULL AUTO_INCREMENT,
  NroProtocolo int NOT NULL,
  AnoProtocolo int NOT NULL,
  Token varchar(64) NOT NULL,
  EmailCliente varchar(255) DEFAULT NULL,
  DataCriacao timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  DataExpiracao datetime DEFAULT NULL,
  PRIMARY KEY (ID),
  UNIQUE KEY uq_os_arquivos_token (Token),
  KEY idx_os_arquivos_os (NroProtocolo, AnoProtocolo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""


def ensure_tokens_table() -> None:
    db.execute_query(_TOKENS_DDL)


def _fetch_os_meta(ano: int, os_id: int) -> dict:
    rows = db.execute_query(
        """
        SELECT p.NomeUsuario AS solicitante, d.Titulo AS titulo, d.TipoPublicacaoLink AS produto
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON d.NroProtocoloLinkDet = p.NroProtocolo AND d.AnoProtocoloLinkDet = p.AnoProtocolo
        WHERE p.NroProtocolo = %s AND p.AnoProtocolo = %s
        """,
        (os_id, ano),
    )
    if not rows:
        raise ValueError(f"OS {os_id}/{ano} não encontrada.")
    row = rows[0]
    return {
        "solicitante": (row.get("solicitante") or "Cliente").strip(),
        "titulo": (row.get("titulo") or "Sem título").strip(),
        "produto": (row.get("produto") or "Produto").strip(),
    }


def create_or_reuse_token(
    *,
    os_id: int,
    ano: int,
    email_cliente: Optional[str] = None,
) -> str:
    ensure_tokens_table()
    existing = db.execute_query(
        """
        SELECT Token FROM tabOsArquivosTokens
        WHERE NroProtocolo=%s AND AnoProtocolo=%s
          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
        ORDER BY ID DESC LIMIT 1
        """,
        (os_id, ano),
    )
    if existing:
        token = existing[0]["Token"]
        if email_cliente:
            db.execute_query(
                "UPDATE tabOsArquivosTokens SET EmailCliente=%s WHERE Token=%s",
                (email_cliente.strip(), token),
            )
        return token

    token = secrets.token_urlsafe(48)
    db.execute_query(
        """
        INSERT INTO tabOsArquivosTokens (NroProtocolo, AnoProtocolo, Token, EmailCliente)
        VALUES (%s, %s, %s, %s)
        """,
        (os_id, ano, token, (email_cliente or "").strip() or None),
    )
    return token


def validate_os_arquivos_token(os_id: int, ano: int, token: str) -> dict:
    ensure_tokens_table()
    rows = db.execute_query(
        """
        SELECT ID, DataExpiracao FROM tabOsArquivosTokens
        WHERE NroProtocolo=%s AND AnoProtocolo=%s AND Token=%s
        """,
        (os_id, ano, token),
    )
    if not rows:
        raise ValueError("Acesso negado. Link inválido ou expirado.")
    if rows[0].get("DataExpiracao"):
        raise ValueError("Acesso negado. Link expirado (arquivos já enviados).")
    return rows[0]


def expire_token(token: str) -> None:
    db.execute_query(
        "UPDATE tabOsArquivosTokens SET DataExpiracao = NOW() WHERE Token = %s",
        (token,),
    )


def build_portal_url(os_id: int, ano: int, token: str) -> str:
    from services.activation_email_service import resolve_link_web_base

    base = resolve_link_web_base()
    return (
        f"{base.rstrip('/')}/portal/os-arquivos/{token}"
        f"?os={os_id}&ano={ano}"
    )


def send_client_arquivos_email(*, to_email: str, os_id: int, ano: int, token: str) -> None:
    from services.email_template_service import (
        get_rendered_html,
        get_rendered_subject,
        resolve_send_mailbox,
    )

    meta = _fetch_os_meta(ano, os_id)
    link = build_portal_url(os_id, ano, token)
    variables = {
        "nr_os": str(os_id),
        "nr_os_padded": f"{os_id:05d}",
        "ano": str(ano),
        "ano_curto": str(ano)[-2:],
        "produto": meta["produto"],
        "titulo": meta["titulo"],
        "solicitante": meta["solicitante"],
        "link": link,
    }
    subject = get_rendered_subject("os_arquivos_link", variables)
    html_body = get_rendered_html("os_arquivos_link", variables)

    from services.ews_service import EWSService
    from services.email_config_service import DEFAULT_EWS_URL, DEFAULT_VERIFY_SSL

    ews_url = os.getenv("EWS_URL", DEFAULT_EWS_URL)
    verify_ssl = os.getenv("EWS_VERIFY_SSL", str(DEFAULT_VERIFY_SSL)).lower() in (
        "1",
        "true",
        "yes",
    )
    service = EWSService(ews_url=ews_url, verify_ssl=verify_ssl)
    from_mailbox = resolve_send_mailbox(os_id, "os_lt_5000") or None
    service.send_email(
        to=[to_email.strip()],
        subject=subject,
        html_body=html_body,
        from_mailbox=from_mailbox,
    )
    logger.info("E-mail de arquivos OS enviado para %s (OS %s/%s)", to_email, os_id, ano)


def _add_upload_movement(
    *,
    os_id: int,
    ano: int,
    ponto: str,
    folder_name: str,
    saved_files: List[str],
    origem: str,
) -> None:
    from routers.analise_routes import add_movement_internal, format_andamento_obs, format_ponto

    obs = format_andamento_obs(
        f"Arquivo(s) de abertura enviados ({origem}) em {folder_name}: {', '.join(saved_files)}"
    )
    ponto_fmt = format_ponto(ponto)

    def transaction(cursor):
        return add_movement_internal(
            cursor,
            os_id,
            ano,
            "Em Execução",
            "SEFOC",
            ponto_fmt,
            obs,
        )

    cod = db.execute_transaction([transaction])[0]
    if cod:
        from routers.mdb_writer import push_andamento_to_mdb_after_mysql

        push_andamento_to_mdb_after_mysql(
            cod, os_id, ano, operation="insert", task_name="portal_os_arquivos_upload"
        )

    from routers.realtime import broadcast_os_system_update

    broadcast_os_system_update(
        os_id,
        ano,
        "portal_os_arquivos_upload",
        setor="SEFOC",
        origem="portal_cliente",
    )


def upload_files_to_original(
    *,
    os_id: int,
    ano: int,
    ponto: str,
    files,
    origem: str,
    token: Optional[str] = None,
    register_movement: bool = True,
) -> dict:
    """Cria pasta da OS (se necessário) e grava arquivos em Original."""
    meta = _fetch_os_meta(ano, os_id)
    os_dir, _folder_label = ensure_os_folder_on_network(
        nr_os=os_id,
        ano=ano,
        solicitante=meta["solicitante"],
        produto=meta["produto"],
    )
    final_dir, folder_name = resolve_initial_original_dir(os_dir)

    saved: List[str] = []
    for upload in files:
        saved.append(_save_client_upload_file(upload, final_dir))

    if register_movement:
        _add_upload_movement(
            os_id=os_id,
            ano=ano,
            ponto=ponto,
            folder_name=folder_name,
            saved_files=saved,
            origem=origem,
        )

    if token:
        expire_token(token)

    return {
        "status": "success",
        "files": saved,
        "folder": folder_name,
        "os_path": os_dir,
        "componente": _OS_ARQUIVOS_COMPONENT,
    }


def get_client_portal_payload(os_id: int, ano: int, token: str) -> dict:
    ensure_tokens_table()
    rows = db.execute_query(
        """
        SELECT ID, DataExpiracao FROM tabOsArquivosTokens
        WHERE NroProtocolo=%s AND AnoProtocolo=%s AND Token=%s
        """,
        (os_id, ano, token),
    )
    if not rows:
        raise ValueError("Acesso negado. Link inválido ou expirado.")
    meta = _fetch_os_meta(ano, os_id)
    portal_complete = bool(rows[0].get("DataExpiracao"))
    return {
        "exists": True,
        "osTitulo": meta["titulo"],
        "osProduto": meta["produto"],
        "titulo": f"OS {os_id}/{ano}",
        "solicitante": meta["solicitante"],
        "portalComplete": portal_complete,
        "items": [],
    }


def finalize_drive_upload(
    *,
    os_id: int,
    ano: int,
    ponto: str,
    token: str,
    saved_files: List[str],
    folder_name: str,
) -> dict:
    _add_upload_movement(
        os_id=os_id,
        ano=ano,
        ponto=ponto,
        folder_name=folder_name,
        saved_files=saved_files,
        origem="cliente (Drive)",
    )
    expire_token(token)
    return {
        "status": "success",
        "files": saved_files,
        "folder": folder_name,
        "componente": _OS_ARQUIVOS_COMPONENT,
        "portalComplete": True,
    }


def prepare_original_dir(os_id: int, ano: int) -> Tuple[str, str]:
    meta = _fetch_os_meta(ano, os_id)
    os_dir, _ = ensure_os_folder_on_network(
        nr_os=os_id,
        ano=ano,
        solicitante=meta["solicitante"],
        produto=meta["produto"],
    )
    return resolve_initial_original_dir(os_dir)

"""Envio compartilhado de e-mails de pendência (prova / problemas técnicos)."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from database import db

logger = logging.getLogger(__name__)


class PendenciaDispatchError(Exception):
    """Falha recuperável / fail-closed no montagem ou envio."""


def find_proof_filename_for_version(ano: int, os_id: int, version: str) -> Optional[str]:
    from services.proof_files_service import (
        extract_prova_version_from_filename,
        list_proof_pdf_files,
    )

    try:
        target = int(str(version).strip())
    except (TypeError, ValueError):
        return None
    listing = list_proof_pdf_files(ano, os_id)
    for item in listing.get("files") or []:
        name = str(item.get("name") or "")
        ver = extract_prova_version_from_filename(name)
        if ver == target:
            return name
    return None


def dispatch_pendencia_email(
    *,
    os_id: int,
    ano: int,
    email_type: str,
    versao: str,
    to: List[str],
    ponto: str,
    proof_filename: str = "",
    register_andamento: bool = True,
) -> Dict[str, Any]:
    """
    Monta e envia e-mail de prova ou PT (paridade com POST /email/send-pt).
    Levanta PendenciaDispatchError em falha fail-closed.
    """
    from routers.email_routes import (
        _register_pendencia_email_andamento,
        _resolve_ews_for_ponto,
        _resolve_send_plan,
    )
    from services.email_template_service import get_global_send_mailboxes
    from services.ews_service import MailboxFolderTarget

    email_type = (email_type or "").strip()
    if email_type not in ("proof", "pt"):
        raise PendenciaDispatchError(f"Tipo de envio não suportado: {email_type}")

    recipients = [str(addr).strip() for addr in (to or []) if str(addr).strip()]
    if not recipients:
        raise PendenciaDispatchError("Nenhum destinatário válido.")

    nova_versao = (versao or "").strip() or "1"
    proof_file_basename = ""
    send_mode_label = ""
    email_html = ""
    assunto = ""
    attachments_to_send: List[str] = []
    pt_inline_images: list[tuple[str, bytes, str, str]] = []

    if email_type == "proof":
        from services.email_template_model_service import (
            render_proof_email,
            resolve_prova_web_link_for_send,
            resolve_proof_send_plan,
        )
        from services.proof_files_service import (
            extract_prova_version_from_filename,
            resolve_proof_pdf_path,
            validate_proof_pdf_size,
        )

        plan = resolve_proof_send_plan(os_id)
        use_attachment = bool(plan.get("use_attachment"))
        prefer_prova_web = bool(plan.get("prefer_prova_web"))

        proof_link = ""
        prova_web_link_used = False
        if prefer_prova_web and not use_attachment:
            proof_link, prova_web_versao = resolve_prova_web_link_for_send(
                ano,
                os_id,
                ponto_envio=str(ponto),
            )
            if proof_link:
                nova_versao = prova_web_versao or nova_versao
                prova_web_link_used = True
                send_mode_label = "prova_web"

        pdf_path = ""
        if not prova_web_link_used:
            filename = (proof_filename or "").strip()
            if not filename:
                raise PendenciaDispatchError("PDF de prova não identificado.")
            try:
                pdf_path = resolve_proof_pdf_path(ano, os_id, filename)
            except Exception as exc:
                raise PendenciaDispatchError(str(exc)) from exc
            proof_file_basename = os.path.basename(pdf_path)
            parsed_ver = extract_prova_version_from_filename(proof_file_basename)
            if parsed_ver is not None:
                nova_versao = str(parsed_ver)

        q_dados = """
            SELECT
                p.NomeUsuario as solicitante,
                d.TipoPublicacaoLink as produto,
                d.Titulo as titulo
            FROM tabProtocolos p
            LEFT JOIN tabDetalhesServico d ON
                p.NroProtocolo = d.NroProtocoloLinkDet AND
                p.AnoProtocolo = d.AnoProtocoloLinkDet
            WHERE p.NroProtocolo = %(os)s AND p.AnoProtocolo = %(ano)s
        """
        res_dados = db.execute_query(q_dados, {"os": os_id, "ano": ano})
        solicitante = "Solicitante"
        produto = "Produto"
        titulo = ""
        if res_dados:
            solicitante = res_dados[0].get("solicitante") or "Solicitante"
            produto = res_dados[0].get("produto") or "Produto"
            titulo = res_dados[0].get("titulo") or ""

        if use_attachment:
            if not pdf_path:
                raise PendenciaDispatchError("PDF de prova obrigatório no modo anexo.")
            try:
                validate_proof_pdf_size(pdf_path)
            except Exception as exc:
                raise PendenciaDispatchError(str(exc)) from exc
            attachments_to_send = [pdf_path]
            send_mode_label = "anexo"
        elif not prova_web_link_used:
            from routers.proof_portal_routes import (
                build_proof_portal_url,
                ensure_proof_token,
            )

            proof_token = ensure_proof_token(
                os_id,
                ano,
                nova_versao,
                proof_file_basename,
                ponto_envio=str(ponto),
            )
            proof_link = build_proof_portal_url(os_id, ano, proof_token)
            send_mode_label = "portal"

        variables = {
            "nr_os": os_id,
            "ano": ano,
            "versao": nova_versao,
            "produto": produto,
            "titulo": titulo,
            "solicitante": solicitante,
            "link": proof_link,
            "jobname": str(os_id),
            "ordernumber": str(ano),
        }
        try:
            assunto, email_html = render_proof_email(
                os_id,
                variables,
                proof_link=proof_link,
                use_attachment=use_attachment,
                plan=plan,
            )
        except ValueError as exc:
            raise PendenciaDispatchError(str(exc)) from exc

    else:
        from services.email_template_model_service import (
            render_pt_email,
            resolve_pt_send_plan,
        )
        from services.pt_report_html_service import embed_indication_images_for_email

        query = """
            SELECT RelatorioEmail, RelatorioHTML, Versao
            FROM tabAnalises
            WHERE OS = %(os)s AND Ano = %(ano)s
        """
        result = db.execute_query(query, {"os": os_id, "ano": ano})
        if result and not (versao or "").strip():
            nova_versao = str(result[0].get("Versao") or nova_versao or "1")

        produto = "Produto"
        titulo = ""
        try:
            q_det = """
                SELECT Titulo, TipoPublicacaoLink
                FROM tabDetalhesServico
                WHERE NroProtocoloLinkDet = %(os)s AND AnoProtocoloLinkDet = %(ano)s
            """
            res_det = db.execute_query(q_det, {"os": os_id, "ano": ano})
            if res_det:
                produto = res_det[0].get("TipoPublicacaoLink") or "Produto"
                titulo = res_det[0].get("Titulo") or ""
        except Exception as e_det:
            logger.warning("Erro buscando detalhes OS envio auto: %s", e_det)

        pt_plan = resolve_pt_send_plan()
        send_mode_label = pt_plan.get("variante") or "portal"
        variables = {
            "nr_os": os_id,
            "ano": ano,
            "versao": nova_versao,
            "produto": produto,
            "titulo": titulo,
        }
        try:
            assunto, email_html = render_pt_email(
                ano,
                os_id,
                variables,
                plan=pt_plan,
            )
        except ValueError as exc:
            raise PendenciaDispatchError(str(exc)) from exc

        email_html, embedded = embed_indication_images_for_email(email_html)
        pt_inline_images = [
            (img.filename, img.content, img.content_id, img.mime_type)
            for img in embedded
        ]

    if not (email_html or "").strip() or not (assunto or "").strip():
        raise PendenciaDispatchError("Assunto ou corpo do e-mail vazio.")

    service, cfg = _resolve_ews_for_ponto(str(ponto))
    global_boxes = get_global_send_mailboxes()
    routing_plan = _resolve_send_plan(
        cfg=cfg,
        os_id=os_id,
        email_type=email_type,
        global_send_mailboxes=global_boxes,
    )
    from_mailbox = routing_plan["mailbox"]
    if not from_mailbox:
        raise PendenciaDispatchError("Conta de envio Exchange não configurada.")

    attachments_tuples = []
    for att_path in attachments_to_send:
        try:
            with open(att_path, "rb") as fh:
                content = fh.read()
            attachments_tuples.append((os.path.basename(att_path), content))
        except OSError as exc:
            raise PendenciaDispatchError(
                "Não foi possível ler o PDF de prova para anexar."
            ) from exc

    target_folder = routing_plan.get("target_folder") or {}
    target_folder_name = str(target_folder.get("name") or "").strip()
    save_to_folder_id = None
    try:
        target_parent = str(target_folder.get("parent") or "sentitems").strip().lower()
        if target_parent == "msgfolderroot":
            parent_target = MailboxFolderTarget(
                mailbox=from_mailbox,
                folder_type="distinguished_msgfolderroot",
                folder_label="msgfolderroot",
            )
        else:
            parent_target = MailboxFolderTarget(
                mailbox=from_mailbox,
                folder_type="distinguished_sentitems",
                folder_label="SentItems",
            )
        if target_folder_name:
            save_to_folder_id = service.find_folder_id(
                parent_target,
                target_folder_name,
            )
    except Exception as e_folder:
        logger.warning("auto_send: pasta de saída: %s", e_folder)

    try:
        service.send_email(
            to=recipients,
            subject=assunto,
            html_body=email_html,
            from_mailbox=from_mailbox,
            attachments=attachments_tuples,
            inline_images=pt_inline_images or None,
            save_to_folder_id=save_to_folder_id,
        )
    except Exception as exc:
        raise PendenciaDispatchError(f"Falha no envio EWS: {exc}") from exc

    andamento_result = None
    if register_andamento:
        try:
            andamento_result = _register_pendencia_email_andamento(
                os=os_id,
                ano=ano,
                ponto=ponto,
                email_type=email_type,
                nova_versao=nova_versao,
                proof_file_basename=proof_file_basename,
                send_mode_label=send_mode_label,
                to=recipients,
            )
        except Exception as exc:
            logger.error(
                "Envio ok, mas andamento pós-envio falhou OS %s/%s: %s",
                os_id,
                ano,
                exc,
            )

    return {
        "success": True,
        "email_type": email_type,
        "versao": nova_versao,
        "to": recipients,
        "send_mode": send_mode_label,
        "proof_filename": proof_file_basename,
        "andamento": andamento_result,
    }

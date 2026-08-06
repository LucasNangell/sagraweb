"""Pendências de e-mail originadas da pasta Apogee (aprovacaografica@camara.leg.br)."""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, List, Optional, Tuple

from database import db

logger = logging.getLogger(__name__)

APOGEE_MAILBOX = "aprovacaografica@camara.leg.br"
APOGEE_FOLDER = "Apogee"
APOGEE_MAX_ITEMS = 50

_OS_ANO_SUBJECT_RE = re.compile(r"(\d{1,5})\s*/\s*(\d{2,4})")
_OS_SIMPLE_RE = re.compile(r"OS\s*:?\s*(\d{1,5})", re.IGNORECASE)

# E-mails Apogee costumam trazer metadados no corpo (ex.: linha "SUBJECT ...").
_APOGEE_SUBJECT_LINE_RE = re.compile(
    r"^(?:\s|&nbsp;|<(?!br\s*/?>)[^>]*>)*"
    r"SUBJECT\s*:?\s*"
    r".*?(?:<br\s*/?>|</p>|\r?\n|$)",
    re.IGNORECASE | re.DOTALL,
)
_APOGEE_BODY_LABEL_RE = re.compile(
    r"^(?:\s|&nbsp;|<(?!br\s*/?>)[^>]*>)*BODY\s*:?\s*",
    re.IGNORECASE,
)


def clean_apogee_email_body(body: str | None, subject: str | None = None) -> str:
    """
    Remove linha/rótulo SUBJECT (e BODY) que o Apogee inclui no corpo do e-mail.
    O assunto real já vai no campo Subject do envio.
    """
    if not body:
        return ""

    result = body.strip()
    if not result:
        return ""

    prev = None
    while prev != result:
        prev = result
        result = _APOGEE_SUBJECT_LINE_RE.sub("", result, count=1).lstrip()
        result = _APOGEE_BODY_LABEL_RE.sub("", result, count=1).lstrip()

    subj = (subject or "").strip()
    if subj:
        dup_line = re.compile(
            rf"^(?:\s|&nbsp;|<(?!br\s*/?>)[^>]*>)*{re.escape(subj)}\s*(?:<br\s*/?>|</p>|\r?\n|$)",
            re.IGNORECASE | re.DOTALL,
        )
        result = dup_line.sub("", result, count=1).lstrip()

    return result


def parse_os_ano_from_subject(subject: str | None) -> Optional[Tuple[int, int]]:
    """Extrai número da OS e ano do assunto (formato OPNUM/YYYY ou OPNUM/YY)."""
    if not subject:
        return None

    match = _OS_ANO_SUBJECT_RE.search(subject)
    if match:
        os_num = int(match.group(1))
        year_raw = int(match.group(2))
        if year_raw < 100:
            year_raw += 2000
        return os_num, year_raw

    match_simple = _OS_SIMPLE_RE.search(subject)
    if match_simple:
        os_num = int(match_simple.group(1))
        year_match = re.search(r"\b(20\d{2})\b", subject)
        year_raw = int(year_match.group(1)) if year_match else datetime.now().year
        return os_num, year_raw

    return None


def _lookup_os_enrichment(os_num: int, ano: int) -> dict[str, Any]:
    query = """
        SELECT
            p.NroProtocolo AS os,
            p.AnoProtocolo AS ano,
            d.TipoPublicacaoLink AS produto,
            a.`Observaçao` AS observacao,
            a.SituacaoLink AS situacao,
            a.SetorLink AS setor,
            a.`Data` AS data
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
            ON p.NroProtocolo = d.NroProtocoloLinkDet
           AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        LEFT JOIN tabAndamento a
            ON p.NroProtocolo = a.NroProtocoloLink
           AND p.AnoProtocolo = a.AnoProtocoloLink
           AND a.UltimoStatus = 1
        WHERE p.NroProtocolo = %s AND p.AnoProtocolo = %s
        LIMIT 1
    """
    rows = db.execute_query(query, (os_num, ano))
    return rows[0] if rows else {}


def _normalize_content_id(raw: str) -> str:
    return (raw or "").strip().strip("<>").lower()


def _build_attachment_payload(
    all_atts: List[dict[str, Any]],
) -> tuple[List[dict[str, Any]], dict[str, int]]:
    """Separa anexos reais e mapa cid -> índice (1-based na lista EWS completa)."""
    display: List[dict[str, Any]] = []
    inline_images: dict[str, int] = {}
    for idx, att in enumerate(all_atts, start=1):
        if att.get("is_inline"):
            cid = _normalize_content_id(att.get("content_id") or "")
            if cid:
                inline_images[cid] = idx
        else:
            display.append(
                {
                    "name": att.get("name") or "Anexo",
                    "index": idx,
                }
            )
    return display, inline_images


def collect_apogee_inline_images_for_send(
    service: Any,
    details: dict[str, Any],
) -> List[tuple[str, bytes, str, str]]:
    """Carrega anexos inline do e-mail Apogee para reenvio com cid preservado."""
    import mimetypes

    inline_images: List[tuple[str, bytes, str, str]] = []
    for att in details.get("attachments") or []:
        if not att.get("is_inline"):
            continue
        cid = (att.get("content_id") or "").strip().strip("<>")
        att_id = att.get("attachment_id")
        if not cid or not att_id:
            continue
        try:
            name, content = service.get_attachment_content(att_id)
            mime = mimetypes.guess_type(name)[0] or "image/png"
            inline_images.append((name, content, cid, mime))
        except Exception as exc:
            logger.warning("Falha ao carregar imagem inline Apogee %s: %s", att_id, exc)
    return inline_images


def fetch_apogee_email_pendencias(service: Any, max_items: int = APOGEE_MAX_ITEMS) -> List[dict[str, Any]]:
    """
    Busca e-mails não lidos na pasta Apogee da mailbox de aprovação gráfica.
    Requer instância EWSService já resolvida (mesma credencial das demais contas).
    """
    from services.ews_service import MailboxFolderTarget

    pendencias: List[dict[str, Any]] = []

    try:
        inbox_target = MailboxFolderTarget(
            mailbox=APOGEE_MAILBOX,
            folder_type="distinguished_inbox",
            folder_label="Inbox",
        )
        folder_id = service.find_folder_id(inbox_target, APOGEE_FOLDER)
        if not folder_id:
            logger.warning(
                "Subpasta '%s' não encontrada em Inbox de '%s'",
                APOGEE_FOLDER,
                APOGEE_MAILBOX,
            )
            return []

        final_target = MailboxFolderTarget(
            mailbox=APOGEE_MAILBOX,
            folder_type="folder_id",
            folder_label=APOGEE_FOLDER,
            folder_id=folder_id,
        )

        items = service.find_unread_messages(
            final_target,
            max_items=max(1, min(int(max_items), 100)),
        )

        for item in items:
            subject = item.get("subject") or ""
            parsed = parse_os_ano_from_subject(subject)
            if not parsed:
                logger.warning(
                    "E-mail Apogee ignorado (assunto sem OS/ano): %s",
                    subject[:120],
                )
                continue

            os_num, ano = parsed
            full_body = item.get("body", "")
            att_display: List[dict[str, Any]] = []
            inline_map: dict[str, int] = {}

            try:
                details = service.get_message_details(item["item_id"])
                full_body = details.get("body", full_body)
                att_display, inline_map = _build_attachment_payload(
                    details.get("attachments") or []
                )
            except Exception as exc:
                logger.warning(
                    "Erro obtendo detalhes msg Apogee %s: %s",
                    item.get("item_id"),
                    exc,
                )

            enrichment = _lookup_os_enrichment(os_num, ano)
            email_date = item.get("date") or ""
            full_body = clean_apogee_email_body(full_body, subject)

            pendencias.append(
                {
                    "os": int(enrichment.get("os") or os_num),
                    "ano": int(enrichment.get("ano") or ano),
                    "produto": enrichment.get("produto"),
                    "observacao": enrichment.get("observacao"),
                    "situacao": enrichment.get("situacao") or "",
                    "setor": enrichment.get("setor") or "",
                    "data": enrichment.get("data") or email_date,
                    "source": "apogee",
                    "email_entry_id": item["item_id"],
                    "subject": subject,
                    "body": full_body,
                    "sender": item.get("sender_name") or item.get("sender_email") or "",
                    "account": APOGEE_MAILBOX,
                    "folder": APOGEE_FOLDER,
                    "email_date": email_date,
                    "attachments": att_display,
                    "inline_images": inline_map,
                    "has_attachment": bool(att_display) or bool(inline_map),
                }
            )

        pendencias.sort(
            key=lambda row: str(row.get("email_date") or row.get("data") or ""),
            reverse=True,
        )

    except Exception as exc:
        logger.error("Erro buscando pendências Apogee: %s", exc)

    return pendencias


def count_apogee_email_pendencias(service: Any, max_items: int = APOGEE_MAX_ITEMS) -> int:
    return len(fetch_apogee_email_pendencias(service, max_items=max_items))

"""Recebimento automático de e-mails de Prova e Problemas técnicos."""
from __future__ import annotations

import glob
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

Kind = Literal["prova_aprovacao", "prova_alteracao", "problemas_tecnicos"]

_APPROVAL_RE = re.compile(
    r"\b(aprovado|autorizado|aprovada|autorizada)\b",
    re.IGNORECASE,
)
_ALTER_RE = re.compile(
    r"\b("
    r"alterar|altera[cç][aã]o|altera[cç][oõ]es|"
    r"mudar|mudan[cç]a|mudan[cç]as|"
    r"corrigir|corre[cç][aã]o|corre[cç][oõ]es|"
    r"modificar|modifica[cç][aã]o|modifica[cç][oõ]es|"
    r"revisar|revis[aã]o|revis[oõ]es"
    r")\b",
    re.IGNORECASE,
)
_PONTO_RE = re.compile(r"\bp_\d{4,6}\b", re.IGNORECASE)
_PROVA_SUBJECT_RE = re.compile(r"prova", re.IGNORECASE)
_PT_SUBJECT_RE = re.compile(r"problemas\s+t[eé]cnicos", re.IGNORECASE)
_C_CAPA_RE = re.compile(r"c/\s*capa", re.IGNORECASE)


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._chunks: List[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        if tag.lower() in {"script", "style"}:
            self._skip = True
        if tag.lower() in {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4"}:
            self._chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"}:
            self._skip = False
        if tag.lower() in {"p", "div", "tr", "li", "h1", "h2", "h3", "h4"}:
            self._chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip and data:
            self._chunks.append(data)

    def text(self) -> str:
        return "".join(self._chunks)


def html_body_to_plain_text(body: str | None) -> str:
    raw = body or ""
    if "<" in raw and ">" in raw:
        parser = _HTMLTextExtractor()
        try:
            parser.feed(raw)
            parser.close()
            raw = parser.text()
        except Exception:
            raw = re.sub(r"<[^>]+>", " ", raw)
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    raw = re.sub(r"[ \t]+\n", "\n", raw)
    raw = re.sub(r"\n[ \t]+", "\n", raw)
    lines = [line.strip() for line in raw.split("\n") if line.strip()]
    return "\n".join(lines)


def strip_blank_lines(text: str | None) -> str:
    return html_body_to_plain_text(text)


_REPLY_HEADER_DE_RE = re.compile(r"(?m)^De:\s")


def truncate_body_before_reply_header(text: str | None) -> str:
    """Remove o trecho a partir do cabeçalho de resposta «De: …»."""
    cleaned = text or ""
    match = _REPLY_HEADER_DE_RE.search(cleaned)
    if match:
        return cleaned[: match.start()].rstrip()
    idx = cleaned.find("De: ")
    if idx >= 0:
        return cleaned[:idx].rstrip()
    return cleaned


def build_prova_obs(body: str | None) -> str:
    cleaned = truncate_body_before_reply_header(strip_blank_lines(body))
    if cleaned:
        return f"Dar prosseguimento:\n\n{cleaned}"
    return "Dar prosseguimento:"


def count_original_folders(os_path: str) -> int:
    if not os_path or not os.path.isdir(os_path):
        return 0
    count = 0
    try:
        entries = os.listdir(os_path)
    except OSError:
        return 0
    for name in entries:
        if not name.lower().startswith("original"):
            continue
        full = os.path.join(os_path, name)
        if os.path.isdir(full):
            count += 1
    return count


def next_original_folder_name(
    os_path: str,
    *,
    componente: str | None = None,
) -> Tuple[str, int]:
    version = count_original_folders(os_path) + 1
    name = f"Original V{version}"
    if componente in ("Capa", "Miolo"):
        name = f"{name} - {componente}"
    return name, version


def produto_exige_capa_miolo(produto: str | None) -> bool:
    """Livro ou produto com «c/ capa» no nome — mesma regra da análise."""
    p = (produto or "").strip()
    if not p:
        return False
    if p.lower() == "livro":
        return True
    return bool(_C_CAPA_RE.search(p))


def componente_por_paginas(pages: int) -> Literal["Capa", "Miolo"]:
    return "Miolo" if int(pages) > 4 else "Capa"


def pdf_page_count(content: bytes) -> Optional[int]:
    try:
        import fitz  # type: ignore
    except Exception:
        return None
    try:
        doc = fitz.open(stream=content, filetype="pdf")
        try:
            return int(getattr(doc, "page_count", 0) or 0)
        finally:
            doc.close()
    except Exception as exc:
        logger.warning("auto_receive: falha ao contar páginas do PDF: %s", exc)
        return None


def fetch_os_produto(os_num: int, ano: int) -> Optional[str]:
    from database import db

    rows = db.execute_query(
        """
        SELECT TipoPublicacaoLink
        FROM tabDetalhesServico
        WHERE NroProtocoloLinkDet = %(os)s AND AnoProtocoloLinkDet = %(ano)s
        LIMIT 1
        """,
        {"os": os_num, "ano": ano},
    )
    if not rows:
        return None
    value = rows[0].get("TipoPublicacaoLink")
    text = str(value or "").strip()
    return text or None


def resolve_original_folder_componente(
    *,
    produto: str | None,
    pdf_count: int,
    first_pdf_bytes: bytes | None,
) -> Optional[Literal["Capa", "Miolo"]]:
    if pdf_count != 1 or not produto_exige_capa_miolo(produto):
        return None
    if not first_pdf_bytes:
        return None
    pages = pdf_page_count(first_pdf_bytes)
    if pages is None or pages <= 0:
        return None
    return componente_por_paginas(pages)


def is_os_enabled_for_settings(
    os_num: int,
    *,
    enabled_os: bool,
    enabled_sp: bool,
) -> bool:
    if os_num >= 5000:
        return bool(enabled_sp)
    return bool(enabled_os)


_AUTO_RECEIVE_ALLOWED_SITUACOES = frozenset(
    {
        "Pendência Usuário",
        "Aguard. Aprovação",
    }
)


def fetch_ultimo_andamento_situacao(os_num: int, ano: int) -> Optional[str]:
    from database import db

    rows = db.execute_query(
        """
        SELECT SituacaoLink
        FROM tabAndamento
        WHERE NroProtocoloLink = %(os)s
          AND AnoProtocoloLink = %(ano)s
          AND UltimoStatus = 1
        ORDER BY `Data` DESC, CodStatus DESC
        LIMIT 1
        """,
        {"os": os_num, "ano": ano},
    )
    if not rows:
        return None
    value = str(rows[0].get("SituacaoLink") or "").strip()
    return value or None


def is_ultimo_andamento_elegivel_auto_receive(os_num: int, ano: int) -> bool:
    situacao = fetch_ultimo_andamento_situacao(os_num, ano)
    return situacao in _AUTO_RECEIVE_ALLOWED_SITUACOES


def attachment_is_pdf(name: str | None) -> bool:
    return str(name or "").strip().lower().endswith(".pdf")


def classify_email(
    *,
    subject: str | None,
    body: str | None,
    attachment_names: Sequence[str] | None = None,
) -> Optional[Kind]:
    subject_text = subject or ""
    body_text = strip_blank_lines(body)
    names = list(attachment_names or [])

    if _PROVA_SUBJECT_RE.search(subject_text):
        if _APPROVAL_RE.search(body_text) and _PONTO_RE.search(body_text):
            return "prova_aprovacao"
        if _ALTER_RE.search(body_text):
            return "prova_alteracao"
        return None

    if _PT_SUBJECT_RE.search(subject_text):
        if any(attachment_is_pdf(n) for n in names):
            return "problemas_tecnicos"
        return None

    return None


@dataclass
class AutoReceiveResult:
    processed: int = 0
    skipped: int = 0
    errors: int = 0


def _safe_filename(value: str, fallback: str = "email") -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return fallback
    invalid = '<>:"/\\|?*'
    for ch in invalid:
        cleaned = cleaned.replace(ch, "_")
    cleaned = cleaned.replace("\r", " ").replace("\n", " ")
    cleaned = " ".join(cleaned.split())
    return cleaned[:120] or fallback


def _get_os_folder_path(ano: int, os_id: int) -> Optional[str]:
    if os_id >= 5000:
        base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_Papelaria_{ano}"
    else:
        base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_{ano}"

    os_pattern = os.path.join(base_path, f"{os_id:05d}*")

    if not os.path.exists(r"\\redecamara\DfsData"):
        local_path = os.path.abspath(f"storage_test/{ano}/{os_id}")
        if os.path.exists(local_path):
            return local_path

    found = glob.glob(os_pattern)
    if found:
        return found[0]
    return None


def _insert_andamento(
    *,
    os_num: int,
    ano: int,
    situacao: str,
    setor: str,
    observacao: str,
    ponto: str,
) -> str:
    from database import db
    from routers.andamento_helpers import format_andamento_obs, format_ponto
    from routers.os_audit_service import log_andamento_added

    obs_formatada = format_andamento_obs(observacao or "")
    ponto_formatado = format_ponto(ponto)

    def transaction_logic(cursor):
        cursor.execute(
            "UPDATE tabAndamento SET UltimoStatus = 0 "
            "WHERE NroProtocoloLink = %(os)s AND AnoProtocoloLink = %(ano)s",
            {"os": os_num, "ano": ano},
        )
        base_prefix = f"{os_num:05d}{ano}-"
        cursor.execute(
            "SELECT MAX(CodStatus) as max_cod FROM tabAndamento "
            "WHERE CodStatus LIKE %(prefix)s",
            {"prefix": f"{base_prefix}%"},
        )
        res = cursor.fetchone()
        next_seq = 1
        if res and res.get("max_cod"):
            try:
                existing_suffix = str(res["max_cod"]).split("-")[-1]
                next_seq = int(existing_suffix) + 1
            except ValueError:
                next_seq = 1
        new_cod = f"{base_prefix}{next_seq:02d}"
        cursor.execute(
            """INSERT INTO tabAndamento
               (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink,
                `Data`, UltimoStatus, `Observaçao`, Ponto)
               VALUES (%(cod)s, %(os)s, %(ano)s, %(situacao)s, %(setor)s,
                       NOW(), 1, %(obs)s, %(ponto)s)""",
            {
                "cod": new_cod,
                "os": os_num,
                "ano": ano,
                "situacao": situacao,
                "setor": setor,
                "obs": obs_formatada,
                "ponto": ponto_formatado,
            },
        )
        log_andamento_added(
            cursor,
            nro=os_num,
            ano=ano,
            cod_status=new_cod,
            situacao=situacao,
            setor=setor,
            obs=obs_formatada,
            ponto=ponto_formatado,
            origem="EMAIL_AUTO",
        )
        return new_cod

    return db.execute_transaction([transaction_logic])[0]


def _save_mht(
    *,
    service: Any,
    item_id: str,
    os_path: str,
    os_num: int,
    ano: int,
    subject: str,
) -> str:
    sefoc_path = os.path.join(os_path, "Sefoc")
    os.makedirs(sefoc_path, exist_ok=True)
    mime_content = service.get_message_mime_content(item_id)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    subject_part = _safe_filename(subject, fallback="email")
    filename = f"{os_num:05d}_{ano}_{stamp}_{subject_part}.mht"
    output_path = os.path.join(sefoc_path, filename)
    with open(output_path, "wb") as fh:
        fh.write(mime_content)
    return output_path


def _save_pdf_attachments(
    *,
    service: Any,
    details: Dict[str, Any],
    os_path: str,
    os_num: int,
    ano: int,
) -> Tuple[str, int, List[str]]:
    downloaded: List[Tuple[str, bytes]] = []
    for att in details.get("attachments") or []:
        name = str(att.get("name") or "")
        if not attachment_is_pdf(name):
            continue
        if att.get("is_inline"):
            continue
        att_id = att.get("attachment_id")
        if not att_id:
            continue
        name_found, content_bytes = service.get_attachment_content(att_id)
        safe_name = _safe_filename(name_found or name, fallback="anexo.pdf")
        if not safe_name.lower().endswith(".pdf"):
            safe_name = f"{safe_name}.pdf"
        downloaded.append((safe_name, content_bytes))

    if not downloaded:
        raise RuntimeError("Nenhum anexo PDF pôde ser salvo.")

    produto = fetch_os_produto(os_num, ano)
    componente = resolve_original_folder_componente(
        produto=produto,
        pdf_count=len(downloaded),
        first_pdf_bytes=downloaded[0][1],
    )
    folder_name, version = next_original_folder_name(
        os_path,
        componente=componente,
    )
    target_dir = os.path.join(os_path, folder_name)
    os.makedirs(target_dir, exist_ok=True)

    saved: List[str] = []
    for safe_name, content_bytes in downloaded:
        out_path = os.path.join(target_dir, safe_name)
        with open(out_path, "wb") as fh:
            fh.write(content_bytes)
        saved.append(out_path)

    return folder_name, version, saved


def _process_one_email(
    *,
    service: Any,
    email: Dict[str, Any],
    settings: Dict[str, Any],
) -> Literal["processed", "skipped"]:
    from services.email_apogee_pendencias_service import parse_os_ano_from_subject
    from services.os_protocolo_guard import OsProtocoloGuardError, require_protocolo_mysql

    subject = email.get("subject") or ""
    body = email.get("body") or ""
    item_id = email.get("real_id") or email.get("id")
    if not item_id:
        return "skipped"

    att_names = [
        str(a.get("name") or "")
        for a in (email.get("attachments") or [])
        if isinstance(a, dict)
    ]
    # Prefer full attachment list from details when available (includes PDFs).
    details = None
    try:
        details = service.get_message_details(item_id)
        body = details.get("body") or body
        raw_atts = details.get("attachments") or []
        att_names = [str(a.get("name") or "") for a in raw_atts]
    except Exception as exc:
        logger.warning("auto_receive: falha GetItem %s: %s", item_id, exc)

    kind = classify_email(
        subject=subject,
        body=body,
        attachment_names=att_names,
    )
    if not kind:
        return "skipped"

    parsed = parse_os_ano_from_subject(subject)
    if not parsed:
        return "skipped"
    os_num, ano = parsed

    if not is_os_enabled_for_settings(
        os_num,
        enabled_os=bool(settings.get("enabled_os")),
        enabled_sp=bool(settings.get("enabled_sp")),
    ):
        return "skipped"

    ponto = str(settings.get("ponto") or "").strip()
    if not ponto:
        return "skipped"

    try:
        ano = require_protocolo_mysql(os_num, ano)
    except OsProtocoloGuardError:
        return "skipped"

    if not is_ultimo_andamento_elegivel_auto_receive(os_num, ano):
        situacao = fetch_ultimo_andamento_situacao(os_num, ano)
        logger.info(
            "auto_receive: skip OS %s/%s — último andamento=%r (exige Pendência Usuário ou Aguard. Aprovação)",
            os_num,
            ano,
            situacao,
        )
        return "skipped"

    os_path = _get_os_folder_path(ano, os_num)
    if not os_path:
        logger.warning(
            "auto_receive: pasta OS %s/%s não encontrada — skip",
            os_num,
            ano,
        )
        return "skipped"

    if details is None:
        details = service.get_message_details(item_id)

    version: Optional[int] = None
    if kind == "problemas_tecnicos":
        _folder, version, _saved = _save_pdf_attachments(
            service=service,
            details=details,
            os_path=os_path,
            os_num=os_num,
            ano=ano,
        )
        observacao = f"Analisar arquivos v{version}"
    else:
        observacao = build_prova_obs(body)

    _save_mht(
        service=service,
        item_id=item_id,
        os_path=os_path,
        os_num=os_num,
        ano=ano,
        subject=subject,
    )

    cod_status = _insert_andamento(
        os_num=os_num,
        ano=ano,
        situacao="Em Execução",
        setor="SEFOC",
        observacao=observacao,
        ponto=ponto,
    )

    try:
        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            os_num,
            ano,
            "history_added",
            setor="SEFOC",
            situacao="Em Execução",
            origem="email_auto",
        )
    except Exception as exc:
        logger.warning("auto_receive: broadcast falhou: %s", exc)

    try:
        from routers.mdb_writer import dispatch_mdb_sync, sync_andamento_from_mysql_to_mdb

        dispatch_mdb_sync(
            "email_auto_andamento",
            lambda: sync_andamento_from_mysql_to_mdb(cod_status, os_num, ano),
            cod_status=cod_status,
            nro=os_num,
            ano=ano,
        )
    except Exception as exc:
        logger.warning("auto_receive: sync MDB falhou: %s", exc)

    service.mark_as_read_and_categorize(
        item_id=item_id,
        category_text="Pedido atendido (lido e proc.)",
    )
    logger.info(
        "auto_receive: processado %s OS %s/%s kind=%s cod=%s",
        item_id,
        os_num,
        ano,
        kind,
        cod_status,
    )
    return "processed"


def run_auto_receive_cycle() -> AutoReceiveResult:
    from services.email_template_service import get_auto_receive_settings

    result = AutoReceiveResult()
    settings = get_auto_receive_settings()
    if not settings.get("enabled_os") and not settings.get("enabled_sp"):
        return result

    ponto = str(settings.get("ponto") or "").strip()
    if not ponto:
        logger.warning("auto_receive: ativo sem ponto configurado")
        return result

    try:
        from routers.email_routes import fetch_exchange_emails, _resolve_ews_for_ponto

        service, _cfg = _resolve_ews_for_ponto(ponto)
        emails = fetch_exchange_emails(ponto)
    except Exception as exc:
        logger.error("auto_receive: falha ao listar inbox: %s", exc, exc_info=True)
        result.errors += 1
        return result

    for email in emails or []:
        try:
            outcome = _process_one_email(
                service=service,
                email=email,
                settings=settings,
            )
            if outcome == "processed":
                result.processed += 1
            else:
                result.skipped += 1
        except Exception as exc:
            result.errors += 1
            logger.error(
                "auto_receive: erro processando %s: %s",
                email.get("id"),
                exc,
                exc_info=True,
            )

    if result.processed or result.errors:
        logger.info(
            "auto_receive: cycle processed=%s skipped=%s errors=%s",
            result.processed,
            result.skipped,
            result.errors,
        )
    return result

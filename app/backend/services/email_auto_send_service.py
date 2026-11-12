"""Envio automático de e-mail após andamento Encam. de Docum."""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from typing import List, Literal, Optional

logger = logging.getLogger(__name__)

SITUACAO_ENCAM = "Encam. de Docum."
SETOR_SEFOC = "SEFOC"

ObsKind = Literal["prova", "pt"]

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_PONTO_RE = re.compile(r"\bP_\d{4,6}\b", re.IGNORECASE)

# Enviar Prova N | Enviar pN | Enviar PTVN
_OBS_PROVA_RE = re.compile(
    r"(?i)\benviar\s+(?:prova\s+|p\s*)(\d+(?:\.\d+)?)\b",
)
_OBS_PTV_RE = re.compile(
    r"(?i)\benviar\s+ptv\s*(\d+(?:\.\d+)?)\b",
)


@dataclass(frozen=True)
class EncamSendRequest:
    kind: ObsKind
    versao: str


def parse_encam_send_obs(observacao: str | None) -> Optional[EncamSendRequest]:
    """Extrai pedido de envio automático da observação do Encam. de Docum."""
    obs = str(observacao or "")
    # Remover prefixo de hora do andamento (HHhMM\n...) se presente
    lines = obs.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    body = "\n".join(
        line for i, line in enumerate(lines) if not (i == 0 and re.match(r"^\d{1,2}h\d{2}$", line.strip()))
    ).strip()
    if not body:
        body = obs.strip()

    m_ptv = _OBS_PTV_RE.search(body)
    if m_ptv:
        return EncamSendRequest(kind="pt", versao=m_ptv.group(1))

    m_prova = _OBS_PROVA_RE.search(body)
    if m_prova:
        return EncamSendRequest(kind="prova", versao=m_prova.group(1))

    return None


def extract_emails_simple(text: str | None) -> List[str]:
    if not text:
        return []
    seen = set()
    out: List[str] = []
    for match in _EMAIL_RE.findall(text):
        email = match.strip().lower()
        if email and email not in seen:
            seen.add(email)
            out.append(email)
    return out


def extract_pontos_simple(text: str | None) -> List[str]:
    if not text:
        return []
    seen = set()
    out: List[str] = []
    for match in _PONTO_RE.findall(text):
        norm = match.upper()
        if norm not in seen:
            seen.add(norm)
            out.append(norm)
    return out


def is_os_enabled_for_auto_send(
    os_num: int,
    *,
    enabled_os: bool,
    enabled_sp: bool,
) -> bool:
    if os_num >= 5000:
        return bool(enabled_sp)
    return bool(enabled_os)


def resolve_pendencia_recipients(os_num: int, ano: int, *, ponto_ews: str) -> List[str]:
    """Paridade com preenchimento automático da página E-mail."""
    from database import db
    from routers.email_routes import _resolve_ews_for_ponto
    from services.deputados_camara_service import obter_emails_deputado

    rows = db.execute_query(
        """
        SELECT NomeUsuario, CategoriaLink, ContatoTrab
        FROM tabProtocolos
        WHERE NroProtocolo = %(os)s AND AnoProtocolo = %(ano)s
        LIMIT 1
        """,
        {"os": os_num, "ano": ano},
    )
    if not rows:
        return []

    row = rows[0]
    nome_usuario = str(row.get("NomeUsuario") or "").strip()
    categoria = str(row.get("CategoriaLink") or "").strip().upper()
    contato = str(row.get("ContatoTrab") or "").strip()

    recipients: List[str] = []
    seen = set()

    def _add(addr: str) -> None:
        email = str(addr or "").strip().lower()
        if email and email not in seen and "@" in email:
            seen.add(email)
            recipients.append(email)

    for email in extract_emails_simple(contato):
        _add(email)

    if not recipients:
        pontos = extract_pontos_simple(contato)
        if pontos:
            try:
                service, _cfg = _resolve_ews_for_ponto(str(ponto_ews))
                for ponto in pontos:
                    try:
                        items = service.resolve_names(ponto) or []
                        if items:
                            _add(str(items[0].get("email") or ""))
                    except Exception as exc:
                        logger.warning(
                            "auto_send: GAL resolve %s falhou: %s", ponto, exc
                        )
            except Exception as exc:
                logger.warning("auto_send: EWS/GAL indisponível: %s", exc)

    if categoria == "DEPUTADO" and nome_usuario:
        try:
            dep = obter_emails_deputado(nome_usuario)
            _add(dep.get("email_dep") or "")
            _add(dep.get("email_gab") or "")
        except Exception as exc:
            logger.warning("auto_send: e-mails deputado falhou: %s", exc)

    return recipients


def maybe_auto_send_after_encam(
    *,
    os_num: int,
    ano: int,
    situacao: str,
    setor: str,
    observacao: str,
) -> Optional[dict]:
    """
    Tenta envio automático após Encam. de Docum.
    Retorna resultado do envio ou None se skip/fail-closed.
    """
    if str(situacao or "").strip() != SITUACAO_ENCAM:
        return None
    if str(setor or "").strip().upper() != SETOR_SEFOC:
        return None

    parsed = parse_encam_send_obs(observacao)
    if not parsed:
        return None

    from services.email_template_service import get_auto_send_settings

    settings = get_auto_send_settings()
    if not is_os_enabled_for_auto_send(
        os_num,
        enabled_os=bool(settings.get("enabled_os")),
        enabled_sp=bool(settings.get("enabled_sp")),
    ):
        return None

    ponto = str(settings.get("ponto") or "").strip()
    if not ponto:
        logger.info(
            "auto_send: skip OS %s/%s — ponto não configurado",
            os_num,
            ano,
        )
        return None

    from services.email_dispatch_type_service import resolve_email_dispatch_type

    dispatch_type = resolve_email_dispatch_type(os_num, ano)
    if parsed.kind == "pt":
        if dispatch_type != "pt":
            logger.info(
                "auto_send: skip OS %s/%s — obs PTV mas dispatch=%s",
                os_num,
                ano,
                dispatch_type,
            )
            return None
        email_type = "pt"
    else:
        if dispatch_type != "proof":
            logger.info(
                "auto_send: skip OS %s/%s — obs Prova mas dispatch=%s",
                os_num,
                ano,
                dispatch_type,
            )
            return None
        email_type = "proof"

    recipients = resolve_pendencia_recipients(os_num, ano, ponto_ews=ponto)
    if not recipients:
        logger.info(
            "auto_send: skip OS %s/%s — sem destinatários",
            os_num,
            ano,
        )
        return None

    proof_filename = ""
    if email_type == "proof":
        from services.email_pendencia_dispatch_service import (
            find_proof_filename_for_version,
        )
        from services.email_template_model_service import resolve_proof_send_plan

        plan = resolve_proof_send_plan(os_num)
        use_attachment = bool(plan.get("use_attachment"))
        prefer_prova_web = bool(plan.get("prefer_prova_web"))
        proof_filename = (
            find_proof_filename_for_version(ano, os_num, parsed.versao) or ""
        )
        # Modo anexo ou portal exige o PDF da versão; prova_web pode seguir sem ele.
        if not proof_filename and (use_attachment or not prefer_prova_web):
            logger.info(
                "auto_send: skip OS %s/%s — PDF ProvaSefoc %s não encontrado",
                os_num,
                ano,
                parsed.versao,
            )
            return None

    from services.email_pendencia_dispatch_service import (
        PendenciaDispatchError,
        dispatch_pendencia_email,
    )

    try:
        result = dispatch_pendencia_email(
            os_id=os_num,
            ano=ano,
            email_type=email_type,
            versao=parsed.versao,
            to=recipients,
            ponto=ponto,
            proof_filename=proof_filename,
            register_andamento=True,
        )
        logger.info(
            "auto_send: enviado OS %s/%s type=%s to=%s",
            os_num,
            ano,
            email_type,
            recipients,
        )
        return result
    except PendenciaDispatchError as exc:
        logger.info(
            "auto_send: skip OS %s/%s — %s",
            os_num,
            ano,
            exc,
        )
        return None
    except Exception as exc:
        logger.error(
            "auto_send: erro OS %s/%s: %s",
            os_num,
            ano,
            exc,
            exc_info=True,
        )
        return None


def schedule_auto_send_after_encam(
    *,
    os_num: int,
    ano: int,
    situacao: str,
    setor: str,
    observacao: str,
) -> None:
    """Dispara maybe_auto_send em thread daemon (não bloqueia a request)."""
    if str(situacao or "").strip() != SITUACAO_ENCAM:
        return

    def _run() -> None:
        try:
            maybe_auto_send_after_encam(
                os_num=os_num,
                ano=ano,
                situacao=situacao,
                setor=setor,
                observacao=observacao,
            )
        except Exception as exc:
            logger.error(
                "auto_send: thread error OS %s/%s: %s",
                os_num,
                ano,
                exc,
                exc_info=True,
            )

    threading.Thread(
        target=_run,
        name=f"email-auto-send-{os_num}-{ano}",
        daemon=True,
    ).start()

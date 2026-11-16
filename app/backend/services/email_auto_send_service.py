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
    cod_status: str | None = None,
) -> Optional[dict]:
    """
    Tenta envio automático após Encam. de Docum.
    Retorna resultado do envio ou None se skip/fail-closed.
    """
    from services.email_auto_send_claim import (
        find_current_encam_cod_status,
        release_auto_send_claim,
        try_claim_auto_send,
        update_auto_send_claim,
    )

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

    claim_code = str(cod_status or "").strip() or find_current_encam_cod_status(
        os_num, ano
    )
    if not claim_code:
        logger.info(
            "auto_send: skip OS %s/%s — CodStatus Encam. não encontrado",
            os_num,
            ano,
        )
        return None
    if not try_claim_auto_send(cod_status=claim_code, os_num=os_num, ano=ano):
        logger.info(
            "auto_send: skip OS %s/%s — CodStatus %s já claimado",
            os_num,
            ano,
            claim_code,
        )
        return None

    def _skip(reason: str) -> None:
        update_auto_send_claim(claim_code, status="skipped", detail=reason)
        logger.info("auto_send: skip OS %s/%s — %s", os_num, ano, reason)

    from services.email_dispatch_type_service import resolve_email_dispatch_type

    dispatch_type = resolve_email_dispatch_type(os_num, ano)
    if parsed.kind == "pt":
        if dispatch_type != "pt":
            _skip(f"obs PTV mas dispatch={dispatch_type}")
            return None
        email_type = "pt"
    else:
        if dispatch_type != "proof":
            _skip(f"obs Prova mas dispatch={dispatch_type}")
            return None
        email_type = "proof"

    recipients = resolve_pendencia_recipients(os_num, ano, ponto_ews=ponto)
    if not recipients:
        _skip("sem destinatários")
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
            # PDF pode chegar depois (Access) — liberar para retry do monitor.
            release_auto_send_claim(claim_code)
            logger.info(
                "auto_send: retry later OS %s/%s — PDF prova %s não encontrado",
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
        update_auto_send_claim(
            claim_code,
            status="sent",
            detail=f"{email_type}:{','.join(recipients)[:200]}",
        )
        logger.info(
            "auto_send: enviado OS %s/%s type=%s to=%s cod=%s",
            os_num,
            ano,
            email_type,
            recipients,
            claim_code,
        )
        return result
    except PendenciaDispatchError as exc:
        # Falha de montagem/EWS — libera para o monitor tentar de novo.
        release_auto_send_claim(claim_code)
        logger.info(
            "auto_send: retry later OS %s/%s — %s",
            os_num,
            ano,
            exc,
        )
        return None
    except Exception as exc:
        release_auto_send_claim(claim_code)
        logger.error(
            "auto_send: erro OS %s/%s: %s",
            os_num,
            ano,
            exc,
            exc_info=True,
        )
        return None


def list_mysql_encam_pendencias(*, limit: int = 50) -> list[dict]:
    """Encam. de Docum. atuais no MySQL (inclui origem Access via sync)."""
    from database import db

    rows = db.execute_query(
        """
        SELECT
            a.CodStatus AS cod_status,
            a.NroProtocoloLink AS os,
            a.AnoProtocoloLink AS ano,
            a.SituacaoLink AS situacao,
            a.SetorLink AS setor,
            a.`Observaçao` AS observacao,
            a.`Data` AS data
        FROM tabAndamento a
        WHERE a.SituacaoLink = %(sit)s
          AND a.UltimoStatus = 1
          AND a.SetorLink = %(setor)s
        ORDER BY a.`Data` ASC, a.CodStatus ASC
        LIMIT %(limit)s
        """,
        {"sit": SITUACAO_ENCAM, "setor": SETOR_SEFOC, "limit": max(1, min(int(limit), 200))},
    )
    return rows or []


def run_auto_send_mysql_monitor_cycle() -> dict:
    """
    Monitora MySQL por Encam. de Docum. elegíveis (Access→MySQL ou API).
    Não altera a sincronia Access; só lê tabAndamento.
    """
    from services.email_auto_send_claim import is_auto_send_claimed
    from services.email_template_service import get_auto_send_settings

    result = {"seen": 0, "attempted": 0, "sent": 0, "skipped": 0}
    settings = get_auto_send_settings()
    if not settings.get("enabled_os") and not settings.get("enabled_sp"):
        return result

    rows = list_mysql_encam_pendencias(limit=50)
    result["seen"] = len(rows)
    for row in rows:
        os_num = int(row.get("os") or 0)
        ano = int(row.get("ano") or 0)
        cod = str(row.get("cod_status") or "").strip()
        obs = str(row.get("observacao") or "")
        if not os_num or not ano or not cod:
            continue
        if not parse_encam_send_obs(obs):
            continue
        if not is_os_enabled_for_auto_send(
            os_num,
            enabled_os=bool(settings.get("enabled_os")),
            enabled_sp=bool(settings.get("enabled_sp")),
        ):
            continue
        if is_auto_send_claimed(cod):
            continue

        result["attempted"] += 1
        sent = maybe_auto_send_after_encam(
            os_num=os_num,
            ano=ano,
            situacao=str(row.get("situacao") or SITUACAO_ENCAM),
            setor=str(row.get("setor") or SETOR_SEFOC),
            observacao=obs,
            cod_status=cod,
        )
        if sent:
            result["sent"] += 1
        else:
            result["skipped"] += 1

    if result["attempted"] or result["sent"]:
        logger.info(
            "auto_send monitor: seen=%s attempted=%s sent=%s skipped=%s",
            result["seen"],
            result["attempted"],
            result["sent"],
            result["skipped"],
        )
    return result


def schedule_auto_send_after_encam(
    *,
    os_num: int,
    ano: int,
    situacao: str,
    setor: str,
    observacao: str,
    cod_status: str | None = None,
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
                cod_status=cod_status,
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

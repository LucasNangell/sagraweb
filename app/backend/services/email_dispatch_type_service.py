"""Classificação do tipo de envio de e-mail (prova vs problemas técnicos) por OS/ano."""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Literal, Optional

from database import db

logger = logging.getLogger(__name__)

EmailDispatchType = Literal["pt", "proof"]

SITUACAO_PROBLEMAS_TECNICOS = "Problemas Técnicos"
SITUACAO_ENCAM_DOCUM = "Encam. de Docum."
def _normalize_situacao(value: Any) -> str:
    return str(value or "").strip()


def _normalize_obs(value: Any) -> str:
    return str(value or "").strip()


def fetch_recent_andamentos(os_id: int, ano: int, *, limit: int = 5) -> List[Dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT SituacaoLink AS situacao, `Observaçao` AS observacao,
               UltimoStatus AS ultimo_status, `Data` AS data, CodStatus AS cod_status
        FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        ORDER BY `Data` DESC, CodStatus DESC
        LIMIT %s
        """,
        (os_id, ano, limit),
    )
    return rows or []


def _has_pt_relatorio(os_id: int, ano: int) -> bool:
    rows = db.execute_query(
        """
        SELECT RelatorioEmail, RelatorioHTML
        FROM tabAnalises
        WHERE OS = %s AND Ano = %s
        LIMIT 1
        """,
        (os_id, ano),
    )
    if not rows:
        return False
    row = rows[0]
    return bool((row.get("RelatorioEmail") or "").strip() or (row.get("RelatorioHTML") or "").strip())


def is_problema_tecnico_dispatch(os_id: int, ano: int) -> bool:
    """
    Verdadeiro quando a pendência de e-mail é de problemas técnicos.

    Regra principal: andamento atual é Encam. de Docum. e o imediatamente
    anterior é Problemas Técnicos.
    """
    rows = fetch_recent_andamentos(os_id, ano, limit=3)
    if len(rows) < 2:
        return False

    current = rows[0]
    previous = rows[1]
    current_sit = _normalize_situacao(current.get("situacao"))
    previous_sit = _normalize_situacao(previous.get("situacao"))

    if current_sit != SITUACAO_ENCAM_DOCUM:
        return False
    return previous_sit == SITUACAO_PROBLEMAS_TECNICOS


def extract_pt_versao_from_obs(observacao: str) -> Optional[str]:
    obs = _normalize_obs(observacao)
    match = re.search(r"ptv\s*([0-9]+(?:\.[0-9]+)?)", obs, re.IGNORECASE)
    if not match:
        match = re.search(r"enviar\s+ptv\s*([0-9]+(?:\.[0-9]+)?)", obs, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def resolve_email_dispatch_type(os_id: int, ano: int) -> EmailDispatchType:
    """
    Define se o envio pendente é prova ou problemas técnicos.

    1. RelatorioEmail/HTML na análise → PT
    2. Encam. de Docum. logo após Problemas Técnicos → PT
    3. Caso contrário → prova
    """
    if _has_pt_relatorio(os_id, ano):
        return "pt"
    if is_problema_tecnico_dispatch(os_id, ano):
        logger.info(
            "Tipo de e-mail PT inferido por andamento (OS %s/%s): Encam. de Docum. após Problemas Técnicos",
            os_id,
            ano,
        )
        return "pt"
    return "proof"


def resolve_pt_versao_for_dispatch(os_id: int, ano: int) -> str:
    rows = db.execute_query(
        "SELECT Versao FROM tabAnalises WHERE OS = %s AND Ano = %s LIMIT 1",
        (os_id, ano),
    )
    if rows and (rows[0].get("Versao") or "").strip():
        return str(rows[0]["Versao"]).strip()

    recent = fetch_recent_andamentos(os_id, ano, limit=2)
    if recent:
        from_obs = extract_pt_versao_from_obs(str(recent[0].get("observacao") or ""))
        if from_obs:
            return from_obs
    return "1"

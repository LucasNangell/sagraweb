"""OS/Ano identificáveis na caixa de entrada (e-mails não lidos)."""
from __future__ import annotations

import logging
from typing import Any, Iterable, List, Optional

from services.email_apogee_pendencias_service import parse_os_ano_from_subject
from services.email_config_service import get_default_runtime_config

logger = logging.getLogger(__name__)


def collect_inbox_os_refs(summaries: Iterable[dict[str, Any]]) -> List[dict[str, Any]]:
    """
    Extrai OS/Ano do assunto e devolve uma entrada por par, com a data mais recente.
    Assuntos sem OS/Ano válido são ignorados.
    """
    best: dict[tuple[int, int], dict[str, Any]] = {}
    for item in summaries:
        parsed = parse_os_ano_from_subject(item.get("subject"))
        if not parsed:
            continue
        os_num, ano = parsed
        date = str(item.get("date") or "").strip()
        key = (os_num, ano)
        previous = best.get(key)
        if previous is None or date > str(previous.get("date") or ""):
            best[key] = {"os": os_num, "ano": ano, "date": date}
    return sorted(
        best.values(),
        key=lambda row: str(row.get("date") or ""),
        reverse=True,
    )


def _max_items_per_folder(cfg: Any) -> int:
    try:
        return max(1, min(int(getattr(cfg, "max_items_per_folder", 20) or 20), 100))
    except (TypeError, ValueError):
        return 20


def fetch_inbox_os_refs(service: Any, cfg: Optional[Any] = None) -> List[dict[str, Any]]:
    """
    Lista OS/Ano a partir dos não lidos das pastas monitoradas (FindItem, sem corpo).
    """
    from services.ews_service import MailboxFolderTarget

    targets_cfg = list(getattr(cfg, "monitored_targets", None) or [])
    if not targets_cfg:
        targets_cfg = get_default_runtime_config().monitored_targets

    max_items = _max_items_per_folder(cfg)
    summaries: List[dict[str, Any]] = []

    for target_cfg in targets_cfg:
        mailbox = target_cfg.get("mailbox")
        folder_entries = target_cfg.get("folders") or []
        if not mailbox or not folder_entries:
            continue

        inbox_target = MailboxFolderTarget(
            mailbox=mailbox,
            folder_type="distinguished_inbox",
            folder_label="Inbox",
        )

        for folder_entry in folder_entries:
            folder_name = folder_entry.get("name")
            folder_id = (folder_entry.get("id") or "").strip()
            if not folder_name:
                continue
            try:
                if not folder_id:
                    folder_id = service.find_folder_id(inbox_target, folder_name)
                if not folder_id:
                    logger.warning(
                        "Subpasta '%s' não encontrada em Inbox de '%s'",
                        folder_name,
                        mailbox,
                    )
                    continue

                final_target = MailboxFolderTarget(
                    mailbox=mailbox,
                    folder_type="folder_id",
                    folder_label=folder_name,
                    folder_id=folder_id,
                )
                items = service.find_unread_messages(final_target, max_items=max_items)
                for item in items or []:
                    summaries.append(
                        {
                            "subject": item.get("subject"),
                            "date": item.get("date"),
                        }
                    )
            except Exception as folder_err:
                logger.error(
                    "Erro lendo pasta %s de %s para inbox-os: %s",
                    folder_name,
                    mailbox,
                    folder_err,
                )

    return collect_inbox_os_refs(summaries)

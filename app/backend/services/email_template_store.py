"""Persistência de modelos de e-mail — MySQL (primário) + arquivo JSON (backup)."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from config_manager import PROJECT_ROOT
from database import db

logger = logging.getLogger(__name__)

_CONFIG_ROW_ID = 1
_FILE_PATH = PROJECT_ROOT / "config" / "email_templates.json"


def get_file_path() -> Path:
    return _FILE_PATH


def ensure_email_template_config_schema() -> None:
    db.execute_query(
        """
        CREATE TABLE IF NOT EXISTS tabEmailTemplateConfig (
            Id INT NOT NULL PRIMARY KEY,
            Payload LONGTEXT NULL,
            UpdatedAt DATETIME NOT NULL
                DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )


def _parse_payload(value: Any) -> Dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def load_persisted() -> Dict[str, Any]:
    """Carrega do MySQL; se vazio, tenta arquivo e migra para o banco."""
    ensure_email_template_config_schema()
    try:
        rows = db.execute_query(
            "SELECT Payload FROM tabEmailTemplateConfig WHERE Id = %s LIMIT 1",
            (_CONFIG_ROW_ID,),
        )
        if rows:
            data = _parse_payload(rows[0].get("Payload"))
            if data:
                return data
    except Exception as exc:
        logger.error("Falha ao ler tabEmailTemplateConfig: %s", exc)

    file_data = _load_from_file()
    if file_data:
        try:
            save_persisted(file_data, sync_file=False)
            logger.info(
                "Modelos de e-mail migrados do arquivo para MySQL (%s)",
                _FILE_PATH,
            )
        except Exception as exc:
            logger.error("Falha ao migrar modelos de e-mail para MySQL: %s", exc)
        return file_data
    return {}


def save_persisted(data: Dict[str, Any], *, sync_file: bool = True) -> None:
    """Grava no MySQL e, opcionalmente, espelha no arquivo de backup."""
    ensure_email_template_config_schema()
    payload_json = json.dumps(data, ensure_ascii=False)
    db.execute_query(
        """
        INSERT INTO tabEmailTemplateConfig (Id, Payload)
        VALUES (%s, %s)
        ON DUPLICATE KEY UPDATE
            Payload = VALUES(Payload),
            UpdatedAt = CURRENT_TIMESTAMP
        """,
        (_CONFIG_ROW_ID, payload_json),
    )
    logger.info("Modelos de e-mail gravados no MySQL (tabEmailTemplateConfig)")

    if sync_file:
        _save_to_file(data)


def _load_from_file() -> Dict[str, Any]:
    if not _FILE_PATH.is_file():
        return {}
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            with _FILE_PATH.open(encoding=encoding) as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError, UnicodeError) as exc:
            logger.warning(
                "Não foi possível ler %s (%s): %s",
                _FILE_PATH,
                encoding,
                exc,
            )
    return {}


def _save_to_file(data: Dict[str, Any]) -> None:
    _FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        with _FILE_PATH.open("w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError:
                pass
        logger.info("Backup de modelos de e-mail em %s", _FILE_PATH)
    except OSError as exc:
        logger.error("Falha ao gravar backup %s: %s", _FILE_PATH, exc)

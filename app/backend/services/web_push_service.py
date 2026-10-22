"""Web Push (VAPID) — envio para subscriptions registradas."""
from __future__ import annotations

import base64
import json
import logging
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from database import db

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_VAPID_FILE = _PROJECT_ROOT / "config" / "vapid.json"
_DEV_VAPID_FILE = _PROJECT_ROOT / "config" / "vapid_dev.json"


def _clean_ponto(value: str | None) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def _generate_vapid_pair() -> tuple[str, str]:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid02

    vapid = Vapid02()
    vapid.generate_keys()
    private_pem = vapid.private_pem().decode("utf-8")
    raw_public = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    public_b64url = base64.urlsafe_b64encode(raw_public).decode("ascii").rstrip("=")
    return public_b64url, private_pem


def _load_vapid_from_file(path: Path) -> tuple[str, str] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        public = str(data.get("public_key") or "").strip()
        private = str(data.get("private_key") or "").strip()
        if public and private:
            return public, private
    except Exception as exc:
        logger.warning("Falha ao ler %s: %s", path, exc)
    return None


def _save_vapid_to_file(path: Path, public: str, private: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"public_key": public, "private_key": private},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _load_dev_vapid_from_file() -> tuple[str, str] | None:
    return _load_vapid_from_file(_DEV_VAPID_FILE)


def _save_dev_vapid_to_file(public: str, private: str) -> None:
    _save_vapid_to_file(_DEV_VAPID_FILE, public, private)


def _resolve_vapid_subject() -> str:
    gov_subject = (
        os.getenv("VAPID_SUBJECT") or "mailto:sagra-web@redecamara.camara.gov.br"
    ).strip()
    leg_subject = (
        os.getenv("VAPID_SUBJECT_CAMARA_LEG_BR")
        or "mailto:sagra-web@cgrafsysvm.camara.leg.br"
    ).strip()
    try:
        from config_manager import config_manager

        public_base = config_manager.get_public_web_base().lower()
        if "camara.leg.br" in public_base:
            return leg_subject
    except Exception:
        pass
    if os.getenv("VAPID_SUBJECT_CAMARA_LEG_BR") and not os.getenv("VAPID_SUBJECT"):
        return leg_subject
    return gov_subject


def _load_vapid_keys() -> tuple[str, str, str]:
    public = (os.getenv("VAPID_PUBLIC_KEY") or "").strip()
    private = (os.getenv("VAPID_PRIVATE_KEY") or "").strip()
    subject = _resolve_vapid_subject()

    if public and private:
        return public, private, subject

    cached = _load_vapid_from_file(_VAPID_FILE)
    if cached:
        return cached[0], cached[1], subject

    try:
        from config_manager import config_manager

        if config_manager.is_development():
            cached = _load_dev_vapid_from_file()
            if cached:
                return cached[0], cached[1], subject
            public, private = _generate_vapid_pair()
            _save_dev_vapid_to_file(public, private)
            logger.info(
                "Web Push DEV: chaves VAPID geradas em %s (reinicie não necessário)",
                _DEV_VAPID_FILE,
            )
            return public, private, subject
    except Exception as exc:
        logger.warning("Falha ao resolver VAPID DEV: %s", exc)

    return "", "", subject


def get_vapid_public_key() -> str:
    public, _, _ = _load_vapid_keys()
    return public


def save_push_subscription(
    *,
    ponto: str,
    endpoint: str,
    p256dh: str,
    auth_key: str,
    user_agent: str | None = None,
) -> None:
    clean = _clean_ponto(ponto) or str(ponto).strip()
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tabPushSubscriptions (Ponto, Endpoint, P256dh, AuthKey, UserAgent)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                Ponto = VALUES(Ponto),
                P256dh = VALUES(P256dh),
                AuthKey = VALUES(AuthKey),
                UserAgent = VALUES(UserAgent)
            """,
            (clean, endpoint.strip(), p256dh.strip(), auth_key.strip(), user_agent),
        )


def delete_push_subscription(*, endpoint: str) -> None:
    db.execute_query("DELETE FROM tabPushSubscriptions WHERE Endpoint = %s", (endpoint.strip(),))


def _subscriptions_for_ponto(ponto: str) -> list[dict[str, Any]]:
    clean = _clean_ponto(ponto) or str(ponto).strip()
    return db.execute_query(
        """
        SELECT Id, Endpoint, P256dh, AuthKey
        FROM tabPushSubscriptions
        WHERE Ponto = %s OR REPLACE(REPLACE(Ponto, '.', ''), '-', '') = %s
        """,
        (ponto, clean),
    )


def count_push_subscriptions_for_ponto(ponto: str) -> int:
    return len(_subscriptions_for_ponto(ponto))


def _endpoint_host(endpoint: str) -> str:
    try:
        return urlparse(endpoint).netloc or "(sem-host)"
    except Exception:
        return "(invalido)"


def send_web_push_to_ponto(
    *,
    ponto: str,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
    nro: int | None = None,
    ano: int | None = None,
    notification_id: int | None = None,
    urgent: bool = False,
) -> int:
    _, private, subject = _load_vapid_keys()
    if not private:
        return 0

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush não instalado — Web Push ignorado.")
        return 0

    resolved_tag = tag or (
        f"sagra-notif-{notification_id}" if notification_id else "sagra-os"
    )
    payload_obj: dict[str, Any] = {
        "title": title,
        "body": body,
        "url": url,
        "tag": resolved_tag,
        "nro": nro,
        "ano": ano,
    }
    if notification_id:
        payload_obj["notification_id"] = int(notification_id)
    if urgent:
        payload_obj["urgent"] = True
    payload = json.dumps(payload_obj, ensure_ascii=False)
    sent = 0
    subs = _subscriptions_for_ponto(ponto)
    if not subs:
        logger.info("Web Push: nenhuma subscription para ponto=%s", ponto)
        return 0
    for sub in subs:
        endpoint = str(sub.get("Endpoint") or "")
        host = _endpoint_host(endpoint)
        try:
            webpush(
                subscription_info={
                    "endpoint": endpoint,
                    "keys": {"p256dh": sub["P256dh"], "auth": sub["AuthKey"]},
                },
                data=payload,
                vapid_private_key=private,
                vapid_claims={"sub": subject},
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                delete_push_subscription(endpoint=endpoint)
            logger.warning(
                "Web Push falhou ponto=%s host=%s status=%s: %s",
                ponto,
                host,
                status,
                exc,
            )
        except Exception as exc:
            logger.warning("Web Push erro ponto=%s host=%s: %s", ponto, host, exc)
    if sent == 0:
        logger.warning(
            "Web Push: 0 enviados para ponto=%s (%s subscription(s))",
            ponto,
            len(subs),
        )
    else:
        logger.info("Web Push: %s enviado(s) para ponto=%s", sent, ponto)
    return sent

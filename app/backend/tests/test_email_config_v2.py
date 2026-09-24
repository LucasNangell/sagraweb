"""Testes de compatibilidade para Email Exchange Config V2."""
from __future__ import annotations

from types import SimpleNamespace


def _cfg(**kwargs):
    base = {
        "send_mailbox_os_lt_5000": "legacy.lt@camara.leg.br",
        "send_mailbox_os_gte_5000": "legacy.gte@camara.leg.br",
        "send_routing": {},
        "sent_folder_routing": {},
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


def test_resolve_send_plan_uses_global_over_by_type_override():
    """Contas de envio (global) vencem send_routing.by_type para o From."""
    from routers.email_routes import _resolve_send_plan

    cfg = _cfg(
        send_routing={"by_type": {"pt": "v2.pt@camara.leg.br"}},
        sent_folder_routing={
            "by_mailbox": {
                "global.lt@camara.leg.br": {
                    "pt": {"id": "folder-123", "name": "Saida PT", "parent": "sentitems"}
                }
            }
        },
    )
    global_boxes = {
        "os_lt_5000": "global.lt@camara.leg.br",
        "os_gte_5000": "global.gte@camara.leg.br",
    }

    plan = _resolve_send_plan(
        cfg=cfg,
        os_id=1200,
        email_type="pt",
        global_send_mailboxes=global_boxes,
    )

    assert plan["mailbox"] == "global.lt@camara.leg.br"
    assert plan["mailbox_source"] == "global"
    assert plan["target_folder"]["name"] == "Saida PT"
    assert plan["folder_source"] == "v2"


def test_resolve_send_plan_uses_papelaria_global_for_os_gte_5000():
    from routers.email_routes import _resolve_send_plan

    cfg = _cfg(
        send_routing={"by_type": {"proof": "sepim.ignored@camara.leg.br"}},
        sent_folder_routing={},
    )
    global_boxes = {
        "os_lt_5000": "global.lt@camara.leg.br",
        "os_gte_5000": "global.gte@camara.leg.br",
    }

    plan = _resolve_send_plan(
        cfg=cfg,
        os_id=7000,
        email_type="proof",
        global_send_mailboxes=global_boxes,
    )

    assert plan["mailbox"] == "global.gte@camara.leg.br"
    assert plan["mailbox_source"] == "global"


def test_resolve_send_plan_falls_back_to_global_and_legacy_folder():
    from routers.email_routes import _resolve_send_plan

    cfg = _cfg(send_routing={"by_type": {}}, sent_folder_routing={})
    global_boxes = {
        "os_lt_5000": "",
        "os_gte_5000": "global.gte@camara.leg.br",
    }

    plan = _resolve_send_plan(
        cfg=cfg,
        os_id=7000,
        email_type="proof",
        global_send_mailboxes=global_boxes,
    )

    assert plan["mailbox"] == "global.gte@camara.leg.br"
    assert plan["mailbox_source"] == "global"
    assert plan["target_folder"]["name"] == "Saida de Provas"
    assert plan["folder_source"] == "legacy"


def test_save_config_persists_global_scope(monkeypatch):
    from services import email_config_service as svc

    captured = {}

    def fake_execute_query(sql, params=None):
        if "INSERT INTO tabEmailExchangeConfig" in sql:
            captured["params"] = params
            return []
        if "SELECT * FROM tabEmailExchangeConfig WHERE Ponto = %s LIMIT 1" in sql:
            return [
                {
                    "Ponto": svc.GLOBAL_EMAIL_CONFIG_PONTO,
                    "EwsUrl": svc.DEFAULT_EWS_URL,
                    "VerifySsl": 0,
                    "MaxItemsPerFolder": 20,
                    "RefreshIntervalSec": 5,
                    "OnlyUnread": 1,
                    "MonitoredTargets": "[]",
                    "SendMailboxOsLt5000": "",
                    "SendMailboxOsGte5000": "",
                    "SendRouting": "{}",
                    "SentFolderRouting": "{}",
                    "ConfigVersion": 1,
                    "UpdatedAt": None,
                }
            ]
        return []

    monkeypatch.setattr(svc.db, "execute_query", fake_execute_query)

    svc.save_config(
        ponto="1234",
        ews_url=svc.DEFAULT_EWS_URL,
        verify_ssl=False,
        max_items_per_folder=20,
        refresh_interval_sec=5,
        only_unread=True,
        monitored_targets=[],
    )

    assert captured["params"][0] == svc.GLOBAL_EMAIL_CONFIG_PONTO


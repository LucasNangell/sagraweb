"""Testes da exclusão segura de OS (sync_os_deletes)."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sync_os_deletes as osdel  # noqa: E402
from sync_policy import apply_env_kill_switches, effective_os_delete_policy  # noqa: E402


def _policies(delete_policy="on"):
    return {
        "tabProtocolos": {
            "table_name": "tabProtocolos",
            "enabled": True,
            "mode": "uni",
            "delete_policy": delete_policy,
        },
        "tabDetalhesServico": {
            "table_name": "tabDetalhesServico",
            "enabled": True,
            "mode": "uni",
            "delete_policy": delete_policy,
        },
        "tabAndamento": {
            "table_name": "tabAndamento",
            "enabled": True,
            "mode": "bi",
            "delete_policy": "on",
        },
    }


def _make_mgr(*, present=None, cache=None, verify=True, recent=False):
    sync = MagicMock()
    sync._svc_log = MagicMock()
    sync.logger = MagicMock()
    sync.logger.log = MagicMock()
    sync.conn_mgr = MagicMock()
    mgr = osdel.OsDeleteManager(sync)
    mgr.read_mdb_os_keys = MagicMock(return_value=present if present is not None else {})
    mgr.load_cache = MagicMock(return_value=cache if cache is not None else {})
    mgr.upsert_cache = MagicMock()
    mgr.verify_os_absent_both_mdbs = MagicMock(return_value=verify)
    mgr.recent_web_write = MagicMock(return_value=recent)
    mgr._count_andamentos = MagicMock(return_value=2)
    mgr._get_pending = MagicMock(return_value=None)
    mgr._upsert_pending = MagicMock(
        side_effect=lambda nro, ano, origem, **kw: {
            "nro": nro,
            "ano": ano,
            "origem": origem,
            "confirm_count": kw.get("bump_confirm", True) and 2 or 1,
            "first_missing_at": datetime.now() - timedelta(seconds=200),
            "status": kw.get("status", "pending"),
            "andamentos_count": kw.get("andamentos_count", 2),
        }
    )
    mgr._clear_pending_if_present = MagicMock()
    mgr.execute_delete = MagicMock(return_value=True)
    # approved query
    mysql = MagicMock()
    cur = MagicMock()
    cur.fetchall.return_value = []
    mysql.cursor.return_value = cur
    sync.conn_mgr.get_mysql.return_value = mysql
    return mgr


def test_mysql_only_os_never_candidate():
    """OS só no MySQL (não estava no cache) não é candidata."""
    mgr = _make_mgr(present={}, cache={})
    result = mgr.run_phase(_policies("on"))
    assert result.candidates == 0
    mgr.execute_delete.assert_not_called()


def test_mdb_read_failure_aborts():
    mgr = _make_mgr()
    mgr.read_mdb_os_keys = MagicMock(return_value=None)
    result = mgr.run_phase(_policies("on"))
    assert result.aborted is True
    assert result.abort_reason == "mdb_read_failed"
    mgr.execute_delete.assert_not_called()


def test_volume_drop_aborts(monkeypatch):
    monkeypatch.setattr(osdel, "OS_DELETE_VOLUME_DROP_PCT", 10.0)
    cache = {(i, 2026): "OS_Atual" for i in range(1, 21)}
    present = {(i, 2026): "OS_Atual" for i in range(1, 5)}  # 80% drop
    mgr = _make_mgr(present=present, cache=cache)
    result = mgr.run_phase(_policies("on"))
    assert result.aborted is True
    assert result.volume_alert is True
    mgr.execute_delete.assert_not_called()


def test_dwell_requires_confirm_and_age(monkeypatch):
    monkeypatch.setattr(osdel, "OS_DELETE_MIN_CONFIRM", 2)
    monkeypatch.setattr(osdel, "OS_DELETE_DWELL_SECONDS", 120)
    mgr = _make_mgr(
        present={},
        cache={(100, 2026): "OS_Atual"},
        verify=True,
    )

    def upsert(nro, ano, origem, **kw):
        return {
            "nro": nro,
            "ano": ano,
            "confirm_count": 1,
            "first_missing_at": datetime.now(),
            "status": "pending",
            "andamentos_count": 1,
        }

    mgr._upsert_pending = MagicMock(side_effect=upsert)
    result = mgr.run_phase(_policies("on"))
    assert result.executed == 0
    mgr.execute_delete.assert_not_called()


def test_dryrun_quarantines_ready(monkeypatch):
    monkeypatch.setattr(osdel, "OS_DELETE_MIN_CONFIRM", 2)
    monkeypatch.setattr(osdel, "OS_DELETE_DWELL_SECONDS", 60)
    mgr = _make_mgr(present={}, cache={(200, 2026): "OS_Atual"}, verify=True)

    def upsert(nro, ano, origem, **kw):
        return {
            "nro": nro,
            "ano": ano,
            "confirm_count": 3,
            "first_missing_at": datetime.now() - timedelta(seconds=200),
            "status": kw.get("status", "pending"),
            "andamentos_count": 2,
        }

    mgr._upsert_pending = MagicMock(side_effect=upsert)
    result = mgr.run_phase(_policies("dryrun"))
    assert result.quarantined >= 1
    mgr.execute_delete.assert_not_called()


def test_batch_over_limit_quarantines(monkeypatch):
    monkeypatch.setattr(osdel, "OS_DELETE_AUTO_LIMIT", 2)
    monkeypatch.setattr(osdel, "OS_DELETE_MIN_CONFIRM", 2)
    monkeypatch.setattr(osdel, "OS_DELETE_DWELL_SECONDS", 60)
    cache = {(i, 2026): "OS_Atual" for i in range(1, 5)}
    mgr = _make_mgr(present={}, cache=cache, verify=True)

    def upsert(nro, ano, origem, **kw):
        return {
            "nro": nro,
            "ano": ano,
            "confirm_count": 3,
            "first_missing_at": datetime.now() - timedelta(seconds=300),
            "status": kw.get("status", "pending"),
            "andamentos_count": 1,
        }

    mgr._upsert_pending = MagicMock(side_effect=upsert)
    result = mgr.run_phase(_policies("on"))
    assert result.quarantined >= 3
    mgr.execute_delete.assert_not_called()


def test_execute_delete_writes_tombstones_and_deletes():
    sync = MagicMock()
    sync._svc_log = MagicMock()
    sync.logger = MagicMock()
    sync.logger.log = MagicMock()

    mysql = MagicMock()
    cur = MagicMock()
    # fetchone sequence: protocolo, detalhes; fetchall: andamentos
    protocolo = {"NroProtocolo": 10, "AnoProtocolo": 2026, "NomeUsuario": "X"}
    detalhes = {"NroProtocoloLinkDet": 10, "AnoProtocoloLinkDet": 2026, "Titulo": "T"}
    andamentos = [
        {
            "CodStatus": "000102026-01",
            "SituacaoLink": "Recebido",
            "SetorLink": "SEGEP",
            "Data": "2026-01-01",
            "UltimoStatus": 1,
            "Observaçao": "",
            "Ponto": "1",
        }
    ]
    cur.fetchone.side_effect = [protocolo, detalhes]
    cur.fetchall.return_value = andamentos
    cur.rowcount = 1
    mysql.cursor.return_value = cur
    sync.conn_mgr.get_mysql.return_value = mysql

    mgr = osdel.OsDeleteManager(sync)
    mgr.verify_os_absent_both_mdbs = MagicMock(return_value=True)
    ok = mgr.execute_delete(10, 2026, origem="OS_Atual")
    assert ok is True
    mysql.commit.assert_called()
    sqls = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "INSERT INTO backup_os" in sqls
    assert "INSERT INTO deleted_os" in sqls
    assert "INSERT INTO deleted_andamentos" in sqls
    assert "DELETE FROM tabandamento" in sqls
    assert "DELETE FROM tabDetalhesServico" in sqls
    assert "DELETE FROM tabProtocolos" in sqls


def test_execute_aborts_if_still_present():
    sync = MagicMock()
    sync._svc_log = MagicMock()
    sync.logger = MagicMock()
    mgr = osdel.OsDeleteManager(sync)
    mgr.verify_os_absent_both_mdbs = MagicMock(return_value=False)
    assert mgr.execute_delete(1, 2026) is False


def test_effective_policy_most_restrictive():
    p = _policies()
    p["tabProtocolos"]["delete_policy"] = "off"
    p["tabDetalhesServico"]["delete_policy"] = "on"
    assert effective_os_delete_policy(p) == "off"


def test_env_kill_switch_forces_uni(monkeypatch):
    monkeypatch.setenv("SYNC_TABANDAMENTO_BIDI", "false")
    policies = apply_env_kill_switches(_policies())
    assert policies["tabAndamento"]["mode"] == "uni"


def test_audit_grace_skips_candidate():
    mgr = _make_mgr(
        present={},
        cache={(50, 2026): "OS_Atual"},
        verify=True,
        recent=True,
    )
    result = mgr.run_phase(_policies("on"))
    assert result.skipped_grace >= 1
    mgr.execute_delete.assert_not_called()

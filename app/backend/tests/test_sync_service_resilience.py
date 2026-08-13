"""
Testes do runner resiliente sync_andamentos_service.py (sem MySQL/MDB reais).
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Importa o runner (carrega sync_andamentos_v2_Old como dependencia)
import sync_andamentos_service as svc  # noqa: E402


@pytest.fixture()
def tmp_hb(tmp_path):
    path = tmp_path / "sync_heartbeat.json"
    return svc.HeartbeatWriter(str(path))


def test_heartbeat_write_and_snapshot(tmp_hb, tmp_path):
    hb = tmp_hb
    hb.mark_progress("read_mysql")
    hb.mark_cycle_ok()
    hb.write()

    data = json.loads(Path(hb.path).read_text(encoding="utf-8"))
    assert data["pid"] == os.getpid()
    assert data["cycles"] == 1
    assert data["consecutive_errors"] == 0
    assert data["phase"] == "idle"
    assert data["last_cycle_at"]
    assert "stall_seconds" in data
    assert data["written_at"]


def test_heartbeat_marks_errors(tmp_hb):
    hb = tmp_hb
    hb.mark_cycle_error("boom")
    snap = hb.snapshot()
    assert snap["consecutive_errors"] == 1
    assert snap["last_error"] == "boom"
    assert snap["phase"] == "error"
    hb.mark_cycle_ok()
    snap2 = hb.snapshot()
    assert snap2["consecutive_errors"] == 0
    assert snap2["last_error"] is None


def test_stall_detection_with_fake_clock(tmp_hb, monkeypatch):
    hb = tmp_hb
    mono = {"t": 1000.0}

    def fake_mono():
        return mono["t"]

    monkeypatch.setattr(svc.time, "monotonic", fake_mono)
    hb.last_progress_mono = 1000.0
    hb.mark_progress("read_mdb_os")

    mono["t"] = 1000.0 + svc.SYNC_STALL_TIMEOUT + 5
    snap = hb.snapshot()
    assert snap["stall_seconds"] >= svc.SYNC_STALL_TIMEOUT
    assert snap["phase"] == "read_mdb_os"


def test_invalidate_mdb_forces_reconnect(monkeypatch):
    config = SimpleNamespace(
        mysql_host="127.0.0.1",
        mysql_port=3306,
        mysql_user="u",
        mysql_password="p",
        mysql_database="db",
        mdb_os_atual_path=r"C:\fake\os.mdb",
        mdb_papelaria_path=r"C:\fake\pap.mdb",
    )
    mgr = svc.ResilientConnectionManager(config)

    fake_conn = MagicMock()
    mgr.mdb_os_conn = fake_conn
    mgr.invalidate_mdb_os()
    fake_conn.close.assert_called_once()
    assert mgr.mdb_os_conn is None

    new_conn = MagicMock()
    monkeypatch.setattr(mgr, "_connect_mdb", MagicMock(return_value=new_conn))
    got = mgr.get_mdb_os()
    assert got is new_conn
    assert mgr.mdb_os_conn is new_conn


def test_invalidate_mysql(monkeypatch):
    config = SimpleNamespace(
        mysql_host="127.0.0.1",
        mysql_port=3306,
        mysql_user="u",
        mysql_password="p",
        mysql_database="db",
        mdb_os_atual_path=r"C:\fake\os.mdb",
        mdb_papelaria_path=r"C:\fake\pap.mdb",
    )
    mgr = svc.ResilientConnectionManager(config)
    fake = MagicMock()
    mgr.mysql_conn = fake
    mgr.invalidate_mysql()
    fake.close.assert_called_once()
    assert mgr.mysql_conn is None


def test_read_mdb_invalidates_on_error(tmp_path, monkeypatch):
    config = SimpleNamespace(
        mysql_host="127.0.0.1",
        mysql_port=3306,
        mysql_user="u",
        mysql_password="p",
        mysql_database="db",
        mdb_os_atual_path=str(tmp_path / "os.mdb"),
        mdb_papelaria_path=str(tmp_path / "pap.mdb"),
        dias_monitoramento=15,
        intervalo_segundos=0.2,
    )
    # Cria arquivos vazios so a pre-checagem de path nao falhe em outros testes
    Path(config.mdb_os_atual_path).write_bytes(b"")
    Path(config.mdb_papelaria_path).write_bytes(b"")

    log = logging.getLogger("test_sync_service")
    hb = svc.HeartbeatWriter(str(tmp_path / "hb.json"))

    # Evita SyncLogger tocar no MySQL real
    with patch.object(svc.core, "SyncLogger") as MockLogger, patch.object(
        svc.core, "BackupManager"
    ):
        mock_logger = MagicMock()
        mock_logger.logger = log
        MockLogger.return_value = mock_logger

        sync = svc.ResilientSynchronizer.__new__(svc.ResilientSynchronizer)
        sync.config = config
        sync.conn_mgr = svc.ResilientConnectionManager(config)
        sync.logger = mock_logger
        sync.backup_mgr = MagicMock()
        sync._blocked_warnings_cache = {}
        sync._blocked_warning_interval = 300
        sync._mdb_insert_error_cache = {}
        sync._mdb_insert_error_interval = 300
        sync.running = False
        sync._hb = hb
        sync._svc_log = log
        sync._mdb_missing_warn_ts = 0.0
        sync._mdb_missing_warn_interval = 60.0

        bad_conn = MagicMock()
        bad_conn.cursor.side_effect = Exception("ODBC network error")
        sync.conn_mgr.mdb_os_conn = bad_conn

        result = sync.read_mdb(bad_conn)
        assert result is None
        assert sync.conn_mgr.mdb_os_conn is None
        bad_conn.close.assert_called()


def test_read_mysql_failure_returns_sentinel(tmp_path):
    config = SimpleNamespace(
        mysql_host="127.0.0.1",
        mysql_port=3306,
        mysql_user="u",
        mysql_password="p",
        mysql_database="db",
        mdb_os_atual_path=str(tmp_path / "os.mdb"),
        mdb_papelaria_path=str(tmp_path / "pap.mdb"),
        dias_monitoramento=15,
        intervalo_segundos=0.2,
    )
    log = logging.getLogger("test_sync_service")
    hb = svc.HeartbeatWriter(str(tmp_path / "hb.json"))

    with patch.object(svc.core, "SyncLogger") as MockLogger, patch.object(
        svc.core, "BackupManager"
    ):
        mock_logger = MagicMock()
        mock_logger.logger = log
        MockLogger.return_value = mock_logger

        sync = svc.ResilientSynchronizer.__new__(svc.ResilientSynchronizer)
        sync.config = config
        sync.conn_mgr = svc.ResilientConnectionManager(config)
        sync.logger = mock_logger
        sync._hb = hb
        sync._svc_log = log

        sync.conn_mgr.get_mysql = MagicMock(side_effect=Exception("Can't connect to MySQL"))
        result = sync.read_mysql()
        assert result is svc._MYSQL_READ_FAILED


def test_mdb_paths_available_throttled(tmp_path):
    config = SimpleNamespace(
        mysql_host="127.0.0.1",
        mysql_port=3306,
        mysql_user="u",
        mysql_password="p",
        mysql_database="db",
        mdb_os_atual_path=str(tmp_path / "missing_os.mdb"),
        mdb_papelaria_path=str(tmp_path / "missing_pap.mdb"),
        dias_monitoramento=15,
        intervalo_segundos=0.2,
    )
    log = logging.getLogger("test_sync_service")
    hb = svc.HeartbeatWriter(str(tmp_path / "hb.json"))

    sync = svc.ResilientSynchronizer.__new__(svc.ResilientSynchronizer)
    sync.config = config
    sync._svc_log = log
    sync._mdb_missing_warn_ts = 0.0
    sync._mdb_missing_warn_interval = 60.0

    assert sync._mdb_paths_available() is False
    # Paths existentes
    Path(config.mdb_os_atual_path).write_bytes(b"")
    Path(config.mdb_papelaria_path).write_bytes(b"")
    assert sync._mdb_paths_available() is True


def test_resolve_log_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "SYNC_LOG_DIR", str(tmp_path / "custom_logs"))
    path = svc.resolve_log_dir()
    assert path == str(tmp_path / "custom_logs")
    assert Path(path).is_dir()


def test_instance_mutex_exclusive():
    if sys.platform != "win32":
        pytest.skip("mutex Windows")
    name = r"Global\SagraSyncAndamentosTest_%s" % os.getpid()
    m1 = svc.InstanceMutex(name)
    m2 = svc.InstanceMutex(name)
    assert m1.acquire() is True
    assert m2.acquire() is False
    assert m2.already_running is True
    m1.release()
    assert m2.acquire() is True
    m2.release()


def test_stall_exit_code_constant():
    assert svc.STALL_EXIT_CODE == 17


def _make_sync_for_notify(tmp_path, monkeypatch):
    config = SimpleNamespace(
        mysql_host="127.0.0.1",
        mysql_port=3306,
        mysql_user="u",
        mysql_password="p",
        mysql_database="db",
        mdb_os_atual_path=str(tmp_path / "os.mdb"),
        mdb_papelaria_path=str(tmp_path / "pap.mdb"),
        dias_monitoramento=15,
        intervalo_segundos=0.2,
    )
    Path(config.mdb_os_atual_path).write_bytes(b"")
    Path(config.mdb_papelaria_path).write_bytes(b"")
    log = logging.getLogger("test_sync_notify")
    hb = svc.HeartbeatWriter(str(tmp_path / "hb.json"))

    mock_logger = MagicMock()
    mock_logger.logger = log
    # Espelha o comportamento do Old: INSERT/DELETE chamam notify_api
    def original_log(tipo, origem, destino, codstatus, nro=None, ano=None,
                     detalhes=None, sucesso=True, erro=None):
        if sucesso and tipo in ("INSERT", "DELETE") and nro and ano:
            mock_logger.notify_api(nro, ano, f"sync_{tipo.lower()}")

    mock_logger.log = original_log
    mock_logger.notify_api = MagicMock()

    with patch.object(svc.core, "SyncLogger", return_value=mock_logger), patch.object(
        svc.core, "BackupManager"
    ):
        sync = svc.ResilientSynchronizer.__new__(svc.ResilientSynchronizer)
        sync.config = config
        sync.conn_mgr = svc.ResilientConnectionManager(config)
        sync.logger = mock_logger
        sync.backup_mgr = MagicMock()
        sync._hb = hb
        sync._svc_log = log
        sync._notify_fail_ts = 0.0
        sync._mdb_missing_warn_ts = 0.0
        sync._mdb_missing_warn_interval = 60.0
        sync._cycle_stats = {
            "ins_m2y": 0,
            "upd_m2y": 0,
            "ins_y2m": 0,
            "upd_y2m": 0,
            "del_y": 0,
            "ultimo_heals": 0,
            "safety_lock_aborts": 0,
            "mysql_only_remaining": 0,
        }
        sync._install_reliable_notify()
        return sync


def test_notify_api_uses_internal_base(tmp_path, monkeypatch):
    sync = _make_sync_for_notify(tmp_path, monkeypatch)
    posted = {}

    class FakeCM:
        def get_api_internal_base(self):
            return "http://127.0.0.1:8001/api"

        def get_api_base(self):
            return "/sagra/api"

    def fake_post(url, json=None, headers=None, timeout=None):
        posted["url"] = url
        posted["json"] = json
        posted["headers"] = headers or {}
        return MagicMock(status_code=200)

    monkeypatch.setitem(sys.modules, "config_manager", SimpleNamespace(config_manager=FakeCM()))
    monkeypatch.setenv("SAGRA_NOTIFY_SECRET", "test-secret")
    # Garante reimport do helper com o env
    import security.notify_auth as notify_auth

    monkeypatch.setattr(notify_auth, "_notify_secret_configured", lambda: "test-secret")

    with patch("requests.post", side_effect=fake_post):
        sync.logger.notify_api(84, 2026, "sync_insert")

    assert posted["url"] == "http://127.0.0.1:8001/api/realtime/notify"
    assert posted["json"]["id"] == 84
    assert posted["json"]["ano"] == 2026
    assert posted["json"]["origem"] == "sync_bot"
    assert posted["headers"].get("x-sagra-notify-secret") == "test-secret"


def test_notify_on_update_via_log(tmp_path, monkeypatch):
    sync = _make_sync_for_notify(tmp_path, monkeypatch)
    calls = []

    class FakeCM:
        def get_api_internal_base(self):
            return "http://127.0.0.1:8001/api"

        def get_api_base(self):
            return "/sagra/api"

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append({"url": url, "json": json})
        return MagicMock(status_code=200)

    monkeypatch.setitem(sys.modules, "config_manager", SimpleNamespace(config_manager=FakeCM()))
    with patch("requests.post", side_effect=fake_post):
        sync.logger.log(
            "UPDATE", "OS_Atual", "MySQL", "000842026-01",
            84, 2026, "Andamento atualizado", True, None,
        )

    assert len(calls) == 1
    assert calls[0]["json"]["action"] == "sync_update"
    assert calls[0]["url"].startswith("http://127.0.0.1:8001/api/")


def test_mark_skip_cycle_updates_last_cycle(tmp_hb):
    hb = tmp_hb
    hb.mark_skip_cycle("mdb_unavailable")
    snap = hb.snapshot()
    assert snap["phase"] == "mdb_unavailable"
    assert snap["last_cycle_at"]
    assert snap["cycles"] == 0


def test_heartbeat_includes_stats(tmp_hb):
    hb = tmp_hb
    hb.mark_cycle_ok({"ins_y2m": 2, "upd_y2m": 1})
    snap = hb.snapshot()
    assert snap["stats"]["ins_y2m"] == 2
    assert snap["stats"]["upd_y2m"] == 1
    assert "tabandamento_bidi" in snap


def test_mysql_wins_lww():
    assert svc.ResilientSynchronizer._mysql_wins_lww(
        {"Data": "2026-08-12 12:00:00"},
        {"Data": "2026-08-12 11:00:00"},
    )
    assert svc.ResilientSynchronizer._mysql_wins_lww(
        {"Data": "2026-08-12 12:00:00"},
        {"Data": "2026-08-12 12:00:00"},
    )
    assert not svc.ResilientSynchronizer._mysql_wins_lww(
        {"Data": "2026-08-12 10:00:00"},
        {"Data": "2026-08-12 12:00:00"},
    )


def test_perform_sync_catchup_insert_mdb(tmp_path, monkeypatch):
    sync = _make_sync_for_notify(tmp_path, monkeypatch)
    sync._cycle_stats = {
        "ins_m2y": 0,
        "upd_m2y": 0,
        "ins_y2m": 0,
        "upd_y2m": 0,
        "del_y": 0,
        "ultimo_heals": 0,
        "safety_lock_aborts": 0,
        "mysql_only_remaining": 0,
    }
    mysql_row = {
        "CodStatus": "000882026-99",
        "NroProtocoloLink": 886,
        "AnoProtocoloLink": 2026,
        "SituacaoLink": "Recebido",
        "SetorLink": "SEGEP",
        "Data": "2026-08-12 10:00:00",
        "UltimoStatus": 1,
        "Observaçao": "web",
        "Ponto": "1",
    }
    monkeypatch.setattr(svc, "SYNC_TABANDAMENTO_BIDI", True)
    monkeypatch.setattr(svc, "SYNC_MYSQL_TO_MDB_CATCHUP", True)
    sync._mdb_paths_available = MagicMock(return_value=True)
    sync.read_mysql = MagicMock(return_value=[mysql_row])
    sync.read_mdb = MagicMock(return_value=[])
    sync.detect_and_register_deletions = MagicMock(return_value=set())
    sync.update_cache = MagicMock()
    sync.insert_mdb = MagicMock()
    sync.ensure_mysql_ultimo_status_from_mdb = MagicMock()
    sync._heal_os_batch = MagicMock()
    sync._heal_broken_ultimo_flags = MagicMock(return_value=0)
    sync.conn_mgr.get_mdb_by_nro = MagicMock(return_value=MagicMock())
    sync.conn_mgr.get_mdb_name_by_nro = MagicMock(return_value="OS_Atual")
    sync.conn_mgr.get_mdb_os = MagicMock()
    sync.conn_mgr.get_mdb_pap = MagicMock()
    sync.perform_sync()
    sync.insert_mdb.assert_called_once()
    assert sync.insert_mdb.call_args.args[0]["CodStatus"] == "000882026-99"
    assert sync._hb.snapshot()["stats"]["ins_y2m"] == 1


def test_perform_sync_update_mysql_to_mdb_when_newer(tmp_path, monkeypatch):
    sync = _make_sync_for_notify(tmp_path, monkeypatch)
    sync._cycle_stats = {
        "ins_m2y": 0,
        "upd_m2y": 0,
        "ins_y2m": 0,
        "upd_y2m": 0,
        "del_y": 0,
        "ultimo_heals": 0,
        "safety_lock_aborts": 0,
        "mysql_only_remaining": 0,
    }
    mysql_row = {
        "CodStatus": "000882026-01",
        "NroProtocoloLink": 886,
        "AnoProtocoloLink": 2026,
        "SituacaoLink": "WebEdit",
        "SetorLink": "SEGEP",
        "Data": "2026-08-12 15:00:00",
        "UltimoStatus": 1,
        "Observaçao": "from mysql",
        "Ponto": "1",
    }
    mdb_row = dict(mysql_row)
    mdb_row["SituacaoLink"] = "AccessOld"
    mdb_row["Data"] = "2026-08-12 10:00:00"
    mdb_row["Observaçao"] = "from mdb"
    monkeypatch.setattr(svc, "SYNC_TABANDAMENTO_BIDI", True)
    monkeypatch.setattr(svc, "SYNC_MYSQL_TO_MDB_CATCHUP", True)
    sync._mdb_paths_available = MagicMock(return_value=True)
    sync.read_mysql = MagicMock(return_value=[mysql_row])
    sync.read_mdb = MagicMock(side_effect=[[mdb_row], []])
    sync.detect_and_register_deletions = MagicMock(return_value=set())
    sync.update_cache = MagicMock()
    sync.update_mdb = MagicMock()
    sync.update_mysql = MagicMock()
    sync._andamentos_differ = MagicMock(return_value=True)
    sync.ensure_mysql_ultimo_status_from_mdb = MagicMock()
    sync._heal_os_batch = MagicMock()
    sync._heal_broken_ultimo_flags = MagicMock(return_value=0)
    sync.conn_mgr.get_mdb_by_nro = MagicMock(return_value=MagicMock())
    sync.conn_mgr.get_mdb_name_by_nro = MagicMock(return_value="OS_Atual")
    sync.conn_mgr.get_mdb_os = MagicMock()
    sync.conn_mgr.get_mdb_pap = MagicMock()
    sync.perform_sync()
    sync.update_mdb.assert_called_once()
    sync.update_mysql.assert_not_called()
    assert sync._hb.snapshot()["stats"]["upd_y2m"] == 1


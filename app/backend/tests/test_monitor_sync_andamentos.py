"""Testes da máquina de estados do monitor de divergência (sem MDB/MySQL)."""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import monitor_sync_andamentos_service as mon  # noqa: E402


class TestTickMonitor:
    def test_idle_when_equal(self):
        state = mon.MonitorState(phase=mon.STATUS_PHASE_DIVERGED, first_diverged_mono=10.0)
        result = mon.tick_monitor(state, counts_equal=True, now_mono=100.0)
        assert result.should_restart is False
        assert result.state.phase == mon.STATUS_PHASE_IDLE
        assert result.state.alert_active is False
        assert result.state.restart_done_this_episode is False

    def test_first_diverge_sets_timer(self):
        result = mon.tick_monitor(
            mon.MonitorState(),
            counts_equal=False,
            now_mono=50.0,
            diverge_seconds=30.0,
        )
        assert result.should_restart is False
        assert result.state.phase == mon.STATUS_PHASE_DIVERGED
        assert result.state.first_diverged_mono == 50.0

    def test_restart_after_diverge_window(self):
        state = mon.MonitorState(
            phase=mon.STATUS_PHASE_DIVERGED,
            first_diverged_mono=0.0,
        )
        result = mon.tick_monitor(
            state,
            counts_equal=False,
            now_mono=30.0,
            diverge_seconds=30.0,
            alert_after_restart_seconds=60.0,
        )
        assert result.should_restart is True
        assert result.state.phase == mon.STATUS_PHASE_RESTARTED
        assert result.state.restart_done_this_episode is True
        assert result.state.restarted_mono == 30.0
        assert result.state.alert_active is False

    def test_no_second_restart_same_episode(self):
        state = mon.MonitorState(
            phase=mon.STATUS_PHASE_RESTARTED,
            first_diverged_mono=0.0,
            restarted_mono=30.0,
            restart_done_this_episode=True,
        )
        result = mon.tick_monitor(
            state,
            counts_equal=False,
            now_mono=50.0,
            diverge_seconds=30.0,
            alert_after_restart_seconds=60.0,
        )
        assert result.should_restart is False
        assert result.state.phase == mon.STATUS_PHASE_RESTARTED
        assert result.state.alert_active is False

    def test_alert_after_restart_window(self):
        state = mon.MonitorState(
            phase=mon.STATUS_PHASE_RESTARTED,
            first_diverged_mono=0.0,
            restarted_mono=30.0,
            restart_done_this_episode=True,
        )
        result = mon.tick_monitor(
            state,
            counts_equal=False,
            now_mono=90.0,
            diverge_seconds=30.0,
            alert_after_restart_seconds=60.0,
        )
        assert result.should_restart is False
        assert result.state.phase == mon.STATUS_PHASE_ALERTING
        assert result.state.alert_active is True

    def test_read_error_does_not_restart_or_alert(self):
        result = mon.tick_monitor(
            mon.MonitorState(),
            counts_equal=None,
            now_mono=10.0,
        )
        assert result.should_restart is False
        assert result.state.phase == mon.STATUS_PHASE_READ_ERROR
        assert result.state.alert_active is False

    def test_read_error_preserves_episode(self):
        state = mon.MonitorState(
            phase=mon.STATUS_PHASE_ALERTING,
            first_diverged_mono=0.0,
            restarted_mono=30.0,
            alert_active=True,
            restart_done_this_episode=True,
        )
        result = mon.tick_monitor(state, counts_equal=None, now_mono=200.0)
        assert result.state.alert_active is True
        assert result.state.phase == mon.STATUS_PHASE_ALERTING

    def test_recover_from_alerting(self):
        state = mon.MonitorState(
            phase=mon.STATUS_PHASE_ALERTING,
            first_diverged_mono=0.0,
            restarted_mono=30.0,
            alert_active=True,
            restart_done_this_episode=True,
        )
        result = mon.tick_monitor(state, counts_equal=True, now_mono=500.0)
        assert result.state.phase == mon.STATUS_PHASE_IDLE
        assert result.state.alert_active is False
        assert result.should_restart is False

    def test_full_episode_timeline(self):
        state = mon.MonitorState()
        # t=0 diverge
        r = mon.tick_monitor(state, counts_equal=False, now_mono=0.0, diverge_seconds=30, alert_after_restart_seconds=60)
        state = r.state
        assert r.should_restart is False
        # t=29 still waiting
        r = mon.tick_monitor(state, counts_equal=False, now_mono=29.0, diverge_seconds=30, alert_after_restart_seconds=60)
        state = r.state
        assert r.should_restart is False
        # t=30 restart
        r = mon.tick_monitor(state, counts_equal=False, now_mono=30.0, diverge_seconds=30, alert_after_restart_seconds=60)
        state = r.state
        assert r.should_restart is True
        # t=89 still waiting recovery
        r = mon.tick_monitor(state, counts_equal=False, now_mono=89.0, diverge_seconds=30, alert_after_restart_seconds=60)
        state = r.state
        assert r.should_restart is False
        assert state.alert_active is False
        # t=90 alert
        r = mon.tick_monitor(state, counts_equal=False, now_mono=90.0, diverge_seconds=30, alert_after_restart_seconds=60)
        assert r.state.alert_active is True
        assert r.should_restart is False


def _tick_counts(state, mdb, mysql, now, **kwargs):
    kwargs.setdefault("diverge_seconds", 30.0)
    kwargs.setdefault("alert_after_restart_seconds", 60.0)
    kwargs.setdefault("diverge_max_seconds", 300.0)
    return mon.tick_monitor(
        state,
        counts_equal=mdb == mysql,
        now_mono=now,
        mdb_total=mdb,
        mysql_total=mysql,
        **kwargs,
    )


class TestDivergenceProgress:
    def test_lagging_but_advancing_sync_is_not_restarted(self):
        # Sequência de 06/10/2026 11:28–11:29: MySQL sempre um atrás, mas avançando.
        timeline = [(0, 649, 648), (10, 649, 648), (21, 650, 649), (32, 651, 649), (42, 651, 650)]
        state = mon.MonitorState()
        for now, mdb, mysql in timeline:
            r = _tick_counts(state, mdb, mysql, float(now))
            state = r.state
            assert r.should_restart is False, (now, mdb, mysql)
        assert state.phase == mon.STATUS_PHASE_DIVERGED

    def test_stuck_mysql_count_still_requests_recovery(self):
        state = mon.MonitorState()
        r = _tick_counts(state, 650, 649, 0.0)
        r = _tick_counts(r.state, 651, 649, 15.0)
        assert r.should_restart is False
        r = _tick_counts(r.state, 652, 649, 30.0)
        assert r.should_restart is True
        assert r.state.restart_done_this_episode is True

    def test_continuous_divergence_requests_recovery_after_max(self):
        state = mon.MonitorState()
        mdb, mysql = 100, 99
        restarts = []
        for now in range(0, 310, 10):
            r = _tick_counts(state, mdb, mysql, float(now))
            state = r.state
            if r.should_restart:
                restarts.append(now)
            # A cada ciclo o MySQL alcança o alvo anterior, mas chega um novo registro.
            mdb, mysql = mdb + 1, mdb
        assert restarts == [300]

    def test_progress_after_recovery_clears_alert_and_restart_flag(self):
        state = mon.MonitorState()
        r = _tick_counts(state, 10, 9, 0.0)
        r = _tick_counts(r.state, 10, 9, 30.0)
        assert r.should_restart is True
        r = _tick_counts(r.state, 10, 9, 90.0)
        assert r.state.alert_active is True
        r = _tick_counts(r.state, 11, 10, 100.0)
        assert r.should_restart is False
        assert r.state.alert_active is False
        assert r.state.restart_done_this_episode is False
        assert r.state.phase == mon.STATUS_PHASE_DIVERGED

    def test_mysql_extra_rows_progress_when_count_drops_to_mdb(self):
        state = mon.MonitorState()
        r = _tick_counts(state, 654, 655, 0.0)
        r = _tick_counts(r.state, 654, 655, 20.0)
        r = _tick_counts(r.state, 655, 654, 25.0)
        assert r.should_restart is False
        assert r.state.first_diverged_mono == 25.0


NOW = 1_000_000.0


def _hb(started_ago=600.0, written_ago=5.0, phase="idle"):
    return {"started_at": NOW - started_ago, "written_at": NOW - written_ago, "phase": phase}


class TestSyncGate:
    def test_ready_sync_is_evaluated(self):
        assert (
            mon.sync_gate_reason(
                maintenance_active=False, service_status="Running", heartbeat=_hb(), now_epoch=NOW
            )
            is None
        )

    def test_maintenance_suspends(self):
        assert (
            mon.sync_gate_reason(
                maintenance_active=True, service_status="Running", heartbeat=_hb(), now_epoch=NOW
            )
            == mon.STATUS_PHASE_MAINTENANCE
        )

    def test_stopped_sync_is_not_evaluated(self):
        for status in ("Stopped", "StartPending", "Paused", None):
            assert (
                mon.sync_gate_reason(
                    maintenance_active=False, service_status=status, heartbeat=_hb(), now_epoch=NOW
                )
                == mon.STATUS_PHASE_WAITING_SYNC
            )

    def test_grace_after_start(self):
        assert (
            mon.sync_gate_reason(
                maintenance_active=False,
                service_status="Running",
                heartbeat=_hb(started_ago=30),
                now_epoch=NOW,
                ready_grace_seconds=90,
            )
            == mon.STATUS_PHASE_WAITING_SYNC
        )

    def test_stale_or_previous_process_heartbeat(self):
        for hb in (
            _hb(written_ago=120),
            _hb(phase="stopped"),
            {"started_at": None, "written_at": None, "phase": None},
        ):
            assert (
                mon.sync_gate_reason(
                    maintenance_active=False, service_status="Running", heartbeat=hb, now_epoch=NOW
                )
                == mon.STATUS_PHASE_WAITING_SYNC
            )


class TestHoldEpisode:
    def test_without_restart_resets_episode(self):
        state = mon.MonitorState(phase=mon.STATUS_PHASE_DIVERGED, first_diverged_mono=1.0)
        assert mon.hold_episode(state, 50.0) == mon.MonitorState()

    def test_after_restart_slides_alert_window(self):
        state = mon.MonitorState(
            phase=mon.STATUS_PHASE_RESTARTED,
            first_diverged_mono=0.0,
            restarted_mono=30.0,
            restart_done_this_episode=True,
        )
        held = mon.hold_episode(state, 200.0)
        assert held.restart_done_this_episode is True
        assert held.restarted_mono == 200.0
        r = mon.tick_monitor(held, counts_equal=False, now_mono=230.0, alert_after_restart_seconds=60)
        assert r.should_restart is False
        assert r.state.alert_active is False


def test_read_sync_heartbeat_info(tmp_path: Path):
    path = tmp_path / "sync_heartbeat.json"
    started = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
    path.write_text(
        json.dumps(
            {
                "started_at": started.isoformat(),
                "written_at": (started + timedelta(minutes=5)).isoformat(),
                "phase": "idle",
            }
        ),
        encoding="utf-8",
    )
    info = mon.read_sync_heartbeat_info(str(path))
    assert info["started_at"] == started.timestamp()
    assert info["phase"] == "idle"
    assert mon.read_sync_heartbeat_info(str(tmp_path / "missing.json"))["started_at"] is None


class TestRestartSyncAndamentos:
    def _patch(self, monkeypatch, status):
        calls = []
        monkeypatch.setattr(mon.sys, "platform", "win32")
        monkeypatch.setattr(
            mon.swd, "query_windows_service", lambda _name: {"exists": True, "status": status}
        )
        monkeypatch.setattr(mon.swd, "resolve_nssm_path", lambda _roots: Path("nssm.exe"))

        def recover(name, nssm, *, start_only=False):
            calls.append((name, start_only))
            return True, "ok"

        monkeypatch.setattr(mon.swd, "recover_service", recover)
        return calls

    def test_stopped_service_is_started_not_restarted(self, monkeypatch):
        calls = self._patch(monkeypatch, "Stopped")
        assert mon.restart_sync_andamentos(logging.getLogger("t")) is True
        assert calls == [("SAGRA-SyncAndamentos", True)]

    def test_running_service_is_restarted(self, monkeypatch):
        calls = self._patch(monkeypatch, "Running")
        assert mon.restart_sync_andamentos(logging.getLogger("t")) is True
        assert calls == [("SAGRA-SyncAndamentos", False)]

    def test_transition_state_is_left_alone(self, monkeypatch):
        calls = self._patch(monkeypatch, "StartPending")
        assert mon.restart_sync_andamentos(logging.getLogger("t")) is False
        assert calls == []


class _FakeMdbSession:
    def __init__(self, _log):
        pass

    def close(self):
        pass


def _make_loop(
    tmp_path: Path,
    monkeypatch,
    *,
    sync_status: str,
    maintenance: bool = False,
    watchdog_status=None,
    counts=(10, 5, 15, 14),
):
    monkeypatch.setattr(mon, "MdbCountSession", _FakeMdbSession)
    current_counts = {"value": counts}
    monkeypatch.setattr(mon, "fetch_counts", lambda _log, _mdb: current_counts["value"])

    def query(name):
        status = watchdog_status if name == mon.SYSTEM_WATCHDOG_SERVICE_NAME else sync_status
        return {"exists": status is not None, "status": status}

    monkeypatch.setattr(mon.swd, "query_windows_service", query)
    restarts = []
    monkeypatch.setattr(mon, "restart_sync_andamentos", lambda _log: restarts.append(1) or True)
    now = datetime.now(timezone.utc)
    (tmp_path / "sync_heartbeat.json").write_text(
        json.dumps(
            {
                "started_at": (now - timedelta(minutes=10)).isoformat(),
                "written_at": now.isoformat(),
                "phase": "idle",
            }
        ),
        encoding="utf-8",
    )
    lock = tmp_path / "run" / "system-watchdog.maintenance"
    if maintenance:
        lock.parent.mkdir(parents=True)
        lock.write_text('{"reason":"teste"}', encoding="utf-8")
    log = logging.getLogger("test_monitor_loop")
    log.handlers = [logging.NullHandler()]
    log.propagate = False
    loop = mon.MonitorLoop(log, mon.StatusWriter(str(tmp_path / mon.STATUS_FILENAME)))
    loop.maintenance_file = lock
    loop.set_counts = lambda value: current_counts.update(value=value)
    return loop, restarts


def _status(tmp_path: Path) -> dict:
    return json.loads((tmp_path / mon.STATUS_FILENAME).read_text(encoding="utf-8"))


def test_loop_never_restarts_stopped_sync(tmp_path: Path, monkeypatch):
    loop, restarts = _make_loop(tmp_path, monkeypatch, sync_status="Stopped")
    for t in (0.0, 40.0, 80.0, 200.0):
        loop.run_once(now_mono=t)
    assert restarts == []
    assert _status(tmp_path)["phase"] == mon.STATUS_PHASE_WAITING_SYNC
    assert _status(tmp_path)["alert"] is False


def test_loop_respects_maintenance_lock(tmp_path: Path, monkeypatch):
    loop, restarts = _make_loop(tmp_path, monkeypatch, sync_status="Running", maintenance=True)
    for t in (0.0, 40.0, 80.0):
        loop.run_once(now_mono=t)
    assert restarts == []
    assert _status(tmp_path)["phase"] == mon.STATUS_PHASE_MAINTENANCE


def test_loop_without_system_watchdog_restarts_directly(tmp_path: Path, monkeypatch):
    loop, restarts = _make_loop(tmp_path, monkeypatch, sync_status="Running")
    loop.run_once(now_mono=0.0)
    loop.run_once(now_mono=31.0)
    assert restarts == [1]
    assert _status(tmp_path)["phase"] == mon.STATUS_PHASE_RESTARTED
    assert _status(tmp_path)["recovery_request"] is None


def test_loop_with_system_watchdog_only_requests_recovery(tmp_path: Path, monkeypatch):
    loop, restarts = _make_loop(
        tmp_path, monkeypatch, sync_status="Running", watchdog_status="Running"
    )
    loop.run_once(now_mono=0.0)
    loop.run_once(now_mono=31.0)
    request = _status(tmp_path)["recovery_request"]
    assert restarts == []
    assert request and request["id"] and "mdb=15 mysql=14" in request["reason"]

    loop.run_once(now_mono=45.0)
    assert _status(tmp_path)["recovery_request"]["id"] == request["id"]

    loop.set_counts((10, 5, 15, 15))
    loop.run_once(now_mono=60.0)
    assert _status(tmp_path)["recovery_request"] is None

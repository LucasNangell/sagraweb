"""Testes da máquina de estados do monitor de divergência (sem MDB/MySQL)."""
from __future__ import annotations

import sys
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

from __future__ import annotations

import json
import logging
import sys
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import system_watchdog_service as watchdog  # noqa: E402


def make_config(tmp_path: Path, **overrides) -> watchdog.WatchdogConfig:
    current = tmp_path / "current"
    current.mkdir(exist_ok=True)
    config = watchdog.WatchdogConfig(
        system_root=tmp_path,
        current_root=current,
        log_dir=tmp_path / "logs",
        maintenance_file=tmp_path / "run" / "system-watchdog.maintenance",
        api_port=8050,
        api_service_name="",
        sync_service_name="SAGRA-SyncAndamentos",
        poll_seconds=20,
        http_timeout_seconds=1,
        failure_threshold=3,
        cooldown_seconds=180,
        max_actions=3,
        action_window_seconds=900,
        circuit_break_seconds=900,
        startup_grace_seconds=0,
        recovery_grace_seconds=90,
        sync_stale_seconds=180,
        maintenance_max_seconds=1800,
    )
    return replace(config, **overrides)


def make_logger() -> logging.Logger:
    logger = logging.getLogger("test_system_watchdog")
    logger.handlers = [logging.NullHandler()]
    logger.propagate = False
    return logger


def healthy_http(url: str, _timeout: int):
    if url.endswith("/health/live"):
        return {"ok": True, "status_code": 200, "payload": {"status": "ok"}, "error": None}
    return {
        "ok": True,
        "status_code": 200,
        "payload": {"status": "ok", "db": "ok"},
        "error": None,
    }


class TestRecoveryPolicy:
    def test_requires_consecutive_failures(self):
        state = watchdog.RecoveryState()
        policy = watchdog.RecoveryPolicy(failure_threshold=3)

        assert not watchdog.note_failure(state, now=1, reason="x", policy=policy).should_act
        assert not watchdog.note_failure(state, now=2, reason="x", policy=policy).should_act
        assert watchdog.note_failure(state, now=3, reason="x", policy=policy).should_act

    def test_cooldown_blocks_repeated_action(self):
        state = watchdog.RecoveryState()
        policy = watchdog.RecoveryPolicy(failure_threshold=1, cooldown_seconds=100)

        assert watchdog.note_failure(state, now=1000, reason="x", policy=policy).should_act
        decision = watchdog.note_failure(state, now=1050, reason="x", policy=policy)
        assert decision.should_act is False
        assert decision.phase == "cooldown"

    def test_circuit_breaker_survives_success_between_failures(self):
        state = watchdog.RecoveryState()
        policy = watchdog.RecoveryPolicy(
            failure_threshold=1,
            cooldown_seconds=1,
            max_actions=2,
            action_window_seconds=100,
            circuit_break_seconds=60,
        )

        assert watchdog.note_failure(state, now=10, reason="x", policy=policy).should_act
        watchdog.note_healthy(state, now=11)
        assert watchdog.note_failure(state, now=12, reason="x", policy=policy).should_act
        decision = watchdog.note_failure(state, now=14, reason="x", policy=policy)
        assert decision.should_act is False
        assert decision.phase == "circuit_opened"
        assert state.circuit_open_until == 74


def test_state_store_persists_restart_budget(tmp_path: Path):
    path = tmp_path / "state.json"
    store = watchdog.StateStore(path)
    states = {
        "api": watchdog.RecoveryState(last_action_at=20, action_history=[10, 20]),
        "sync": watchdog.RecoveryState(circuit_open_until=100),
    }

    store.write(states)
    loaded = store.load()

    assert loaded["api"].action_history == [10.0, 20.0]
    assert loaded["sync"].circuit_open_until == 100.0


def test_unhealthy_since_tracks_episode_and_persists(tmp_path: Path):
    state = watchdog.RecoveryState()
    policy = watchdog.RecoveryPolicy(failure_threshold=3)

    watchdog.note_failure(state, now=100, reason="x", policy=policy)
    watchdog.note_failure(state, now=120, reason="x", policy=policy)
    assert state.unhealthy_since == 100

    state.last_action_ok = False
    state.last_action_detail = "status final=Stopped"
    store = watchdog.StateStore(tmp_path / "state.json")
    store.write({"api": watchdog.RecoveryState(), "sync": state})
    loaded = store.load()["sync"]
    assert loaded.unhealthy_since == 100
    assert loaded.last_action_ok is False
    assert loaded.last_action_detail == "status final=Stopped"

    watchdog.note_healthy(state, now=200)
    assert state.unhealthy_since == 0


def test_state_store_ignores_structurally_corrupt_json(tmp_path: Path):
    path = tmp_path / "state.json"
    path.write_text('{"api":[],"sync":"invalid"}', encoding="utf-8")

    loaded = watchdog.StateStore(path).load()

    assert loaded == {"api": watchdog.RecoveryState(), "sync": watchdog.RecoveryState()}


def test_state_store_rejects_far_future_circuit(tmp_path: Path):
    path = tmp_path / "state.json"
    path.write_text(
        json.dumps({"api": {"circuit_open_until": time.time() + 86400}, "sync": {}}),
        encoding="utf-8",
    )

    loaded = watchdog.StateStore(path).load()

    assert loaded["api"].circuit_open_until == 0


def test_read_api_port_reads_only_valid_port(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("DB_PASSWORD=nao-deve-ser-usada\nPORT=8123\n", encoding="utf-8")
    assert watchdog._read_api_port(env) == 8123
    env.write_text("PORT=99999\n", encoding="utf-8")
    assert watchdog._read_api_port(env, default=8050) == 8050


def test_config_preserves_logical_current_path(tmp_path: Path, monkeypatch):
    logical_current = tmp_path / "current"
    logical_current.mkdir()
    monkeypatch.setenv("SYSTEM_WATCHDOG_ROOT", str(tmp_path))
    monkeypatch.setenv("SYSTEM_WATCHDOG_CURRENT_ROOT", str(logical_current))

    config = watchdog.WatchdogConfig.from_environment(script_dir=tmp_path)

    assert str(config.current_root).endswith("current")


def test_mdb_unavailable_uses_fresh_watchdog_timestamp(tmp_path: Path):
    heartbeat = tmp_path / "sync_heartbeat.json"
    fresh = datetime.now(timezone.utc)
    heartbeat.write_text(
        json.dumps(
            {
                "phase": "mdb_unavailable",
                "last_cycle_at": fresh.isoformat(),
                "written_at": fresh.isoformat(),
            }
        ),
        encoding="utf-8",
    )

    result = watchdog.probe_sync_heartbeat(heartbeat, datetime.now(timezone.utc).timestamp(), 180)

    assert result["healthy"] is True
    assert result["external_dependency"] is True


def test_mdb_unavailable_with_stale_watchdog_is_unhealthy(tmp_path: Path):
    heartbeat = tmp_path / "sync_heartbeat.json"
    old = datetime.now(timezone.utc) - timedelta(hours=2)
    heartbeat.write_text(
        json.dumps(
            {
                "phase": "mdb_unavailable",
                "last_cycle_at": old.isoformat(),
                "written_at": datetime.now(timezone.utc).isoformat(),
            }
        ),
        encoding="utf-8",
    )

    result = watchdog.probe_sync_heartbeat(
        heartbeat, datetime.now(timezone.utc).timestamp(), 180
    )

    assert result["healthy"] is False
    assert result["external_dependency"] is False


def test_stale_maintenance_lock_is_ignored(tmp_path: Path):
    lock = tmp_path / "maintenance"
    lock.write_text('{"reason":"deploy interrompido"}', encoding="utf-8")

    result = watchdog.maintenance_status(lock, lock.stat().st_mtime + 1900, 1800)

    assert result["active"] is False
    assert result["stale"] is True


def test_manual_maintenance_honors_requested_minutes(tmp_path: Path):
    lock = tmp_path / "maintenance"
    lock.write_text('{"requested_minutes":5}', encoding="utf-8")

    result = watchdog.maintenance_status(lock, lock.stat().st_mtime + 301, 1800)

    assert result["active"] is False
    assert result["stale"] is True


def test_future_maintenance_mtime_is_rejected(tmp_path: Path, monkeypatch):
    lock = tmp_path / "maintenance"
    lock.write_text('{"reason":"clock corrupt"}', encoding="utf-8")
    now = lock.stat().st_mtime
    monkeypatch.setattr(watchdog.Path, "stat", lambda _self: type("S", (), {"st_mtime": now + 3600})())

    result = watchdog.maintenance_status(lock, now, 1800)

    assert result["active"] is False
    assert result["stale"] is True


def test_db_readiness_failure_does_not_restart_healthy_api(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, failure_threshold=1)
    called = []

    def probe(url: str, _timeout: int):
        if url.endswith("/health/live"):
            return {"ok": True, "status_code": 200, "payload": {"status": "ok"}, "error": None}
        return {
            "ok": False,
            "status_code": 503,
            "payload": {"status": "degraded", "db": "unavailable"},
            "error": "HTTP 503",
        }

    monkeypatch.setattr(watchdog, "probe_http_json", probe)
    monkeypatch.setattr(
        watchdog,
        "query_windows_service",
        lambda _name: {"exists": False, "status": None, "query_ok": True, "error": None},
    )
    monkeypatch.setattr(watchdog, "restart_api", lambda _cfg: (called.append(True) or True, ""))

    result = watchdog.SystemWatchdog(config, make_logger()).run_once(now=time.time() + 1)

    assert result["overall"] == "external_dependency"
    assert result["api"]["dependency_degraded"] is True
    assert called == []
    assert (config.maintenance_file.parent / "system_watchdog_status.json").is_file()
    assert not (config.log_dir / "system_watchdog_status.json").exists()


def test_api_restart_only_after_threshold(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, failure_threshold=3)
    calls = []
    monkeypatch.setattr(
        watchdog,
        "probe_http_json",
        lambda _url, _timeout: {
            "ok": False,
            "status_code": 0,
            "payload": {},
            "error": "connection refused",
        },
    )
    monkeypatch.setattr(
        watchdog,
        "query_windows_service",
        lambda _name: {"exists": False, "status": None, "query_ok": True, "error": None},
    )
    monkeypatch.setattr(
        watchdog,
        "restart_api",
        lambda _cfg: (calls.append("restart") or True, "ok"),
    )
    service = watchdog.SystemWatchdog(config, make_logger())
    base = time.time() + 1

    service.run_once(now=base)
    service.run_once(now=base + 20)
    result = service.run_once(now=base + 40)

    assert calls == ["restart"]
    assert result["api"]["recovery"]["attempted"] is True


def test_stopped_sync_is_started_after_threshold(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, failure_threshold=1)
    calls = []
    monkeypatch.setattr(watchdog, "probe_http_json", healthy_http)
    monkeypatch.setattr(
        watchdog,
        "query_windows_service",
        lambda _name: {"exists": True, "status": "Stopped", "query_ok": True, "error": None},
    )

    def control(_config, name, *, start_only=False):
        calls.append((name, start_only))
        return True, "ok"

    monkeypatch.setattr(watchdog, "control_windows_service", control)

    result = watchdog.SystemWatchdog(config, make_logger()).run_once(now=time.time() + 1)

    assert calls == [("SAGRA-SyncAndamentos", True)]
    assert result["sync"]["recovery"]["ok"] is True


def _scripted_service(monkeypatch, states):
    """query_windows_service devolve os estados em sequência (o último se repete)."""
    queue = list(states)

    def query(_name):
        status = queue.pop(0) if len(queue) > 1 else queue[0]
        return {"exists": True, "status": status, "query_ok": True, "error": None}

    monkeypatch.setattr(watchdog, "query_windows_service", query)
    monkeypatch.setattr(watchdog.time, "sleep", lambda _s: None)


def test_recover_retries_start_when_restart_leaves_service_stopped(monkeypatch):
    commands = []
    _scripted_service(monkeypatch, ["StopPending", "Stopped", "StartPending", "Running"])
    monkeypatch.setattr(
        watchdog, "_run_command", lambda args, timeout=120: (commands.append(args[1]) or True, "")
    )

    ok, _detail = watchdog.recover_service("SAGRA-SyncAndamentos", Path("nssm.exe"))

    assert ok is True
    assert commands == ["restart", "start"]


def test_recover_with_nssm_never_sends_sc_stop(monkeypatch):
    commands = []
    _scripted_service(monkeypatch, ["Running"])
    monkeypatch.setattr(
        watchdog,
        "_run_command",
        lambda args, timeout=120: (commands.append(args) or False, "exit 1: not started"),
    )

    ok, _detail = watchdog.recover_service(
        "SAGRA-SyncAndamentos", Path("nssm.exe"), start_only=True
    )

    assert ok is True
    assert all("stop" not in args for args in commands)


def test_recover_reports_failure_when_service_never_runs(monkeypatch):
    _scripted_service(monkeypatch, ["Stopped"])
    monkeypatch.setattr(watchdog, "_run_command", lambda args, timeout=120: (True, ""))

    ok, detail = watchdog.recover_service("SAGRA-SyncAndamentos", Path("nssm.exe"))

    assert ok is False
    assert "status final=Stopped" in detail


def test_resolve_nssm_uses_env_and_path(tmp_path: Path, monkeypatch):
    exe = tmp_path / "nssm.exe"
    exe.write_bytes(b"")
    monkeypatch.setenv("SYSTEM_WATCHDOG_NSSM_PATH", str(exe))
    assert watchdog.resolve_nssm_path([tmp_path / "x"]) == exe.resolve()

    monkeypatch.delenv("SYSTEM_WATCHDOG_NSSM_PATH")
    monkeypatch.setattr(watchdog.shutil, "which", lambda _name: str(exe))
    assert watchdog.resolve_nssm_path([tmp_path / "x"]) == exe.resolve()


def _write_monitor_request(sync_root: Path, request_id: str, requested_at: datetime) -> None:
    path = sync_root / "logs" / "sync" / watchdog.MONITOR_STATUS_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "phase": "restarted",
                "recovery_request": {
                    "id": request_id,
                    "requested_at": requested_at.isoformat(),
                    "reason": "divergencia persistente mdb=15 mysql=14",
                },
            }
        ),
        encoding="utf-8",
    )


def _write_fresh_heartbeat(sync_root: Path, at: float = None) -> None:
    path = sync_root / "logs" / "sync" / "sync_heartbeat.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    moment = datetime.fromtimestamp(at, timezone.utc) if at else datetime.now(timezone.utc)
    path.write_text(
        json.dumps({"phase": "idle", "last_cycle_at": moment.isoformat()}), encoding="utf-8"
    )


def test_recovery_request_validation(tmp_path: Path):
    path = tmp_path / "logs" / "sync" / watchdog.MONITOR_STATUS_FILENAME
    now = datetime.now(timezone.utc)
    _write_monitor_request(tmp_path, "abc123", now - timedelta(seconds=30))
    request = watchdog.read_sync_recovery_request(path, now.timestamp(), 600)
    assert request["id"] == "abc123"

    _write_monitor_request(tmp_path, "abc123", now - timedelta(minutes=20))
    assert watchdog.read_sync_recovery_request(path, now.timestamp(), 600) is None

    _write_monitor_request(tmp_path, "../../x", now)
    assert watchdog.read_sync_recovery_request(path, now.timestamp(), 600) is None

    assert watchdog.read_sync_recovery_request(tmp_path / "missing.json", now.timestamp(), 600) is None


def test_monitor_request_restarts_healthy_sync_once(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, failure_threshold=2)
    sync_root = tmp_path / "sync"
    monkeypatch.setenv("SYSTEM_WATCHDOG_SYNC_ROOT", str(sync_root))
    _write_fresh_heartbeat(sync_root)
    _write_monitor_request(sync_root, "req1", datetime.now(timezone.utc))
    calls = []
    monkeypatch.setattr(watchdog, "probe_http_json", healthy_http)
    monkeypatch.setattr(
        watchdog,
        "query_windows_service",
        lambda _name: {"exists": True, "status": "Running", "query_ok": True, "error": None},
    )
    monkeypatch.setattr(
        watchdog,
        "control_windows_service",
        lambda _cfg, name, *, start_only=False: (calls.append((name, start_only)) or True, "ok"),
    )
    service = watchdog.SystemWatchdog(config, make_logger())
    base = time.time() + 1

    first = service.run_once(now=base)
    assert first["sync"]["recovery"]["phase"] == "confirming_failure"
    second = service.run_once(now=base + 20)
    assert second["sync"]["recovery"]["attempted"] is True
    for offset in (200, 400, 590):
        _write_fresh_heartbeat(sync_root, at=base + offset)
        service.run_once(now=base + offset)

    assert calls == [("SAGRA-SyncAndamentos", False)]
    persisted = json.loads((config.maintenance_file.parent / "system_watchdog_state.json").read_text())
    assert persisted["sync"]["handled_request_id"] == "req1"


def test_monitor_request_ignored_during_maintenance(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, failure_threshold=1)
    config.maintenance_file.parent.mkdir(parents=True)
    config.maintenance_file.write_text('{"reason":"deploy"}', encoding="utf-8")
    sync_root = tmp_path / "sync"
    monkeypatch.setenv("SYSTEM_WATCHDOG_SYNC_ROOT", str(sync_root))
    _write_fresh_heartbeat(sync_root)
    _write_monitor_request(sync_root, "req2", datetime.now(timezone.utc))
    calls = []
    monkeypatch.setattr(watchdog, "probe_http_json", healthy_http)
    monkeypatch.setattr(
        watchdog,
        "query_windows_service",
        lambda _name: {"exists": True, "status": "Running", "query_ok": True, "error": None},
    )
    monkeypatch.setattr(
        watchdog, "control_windows_service", lambda *_a, **_k: (calls.append(1) or True, "")
    )

    result = watchdog.SystemWatchdog(config, make_logger()).run_once(
        now=config.maintenance_file.stat().st_mtime
    )

    assert calls == []
    assert result["sync"]["recovery"]["phase"] == "maintenance"


def test_future_sync_heartbeat_is_rejected(tmp_path: Path):
    heartbeat = tmp_path / "sync_heartbeat.json"
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    heartbeat.write_text(
        json.dumps({"phase": "idle", "last_cycle_at": future.isoformat()}),
        encoding="utf-8",
    )

    result = watchdog.probe_sync_heartbeat(
        heartbeat, datetime.now(timezone.utc).timestamp(), 180
    )

    assert result["healthy"] is False
    assert "futuro" in result["error"]


def test_sync_transition_eventually_triggers_recovery(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, failure_threshold=2)
    calls = []
    monkeypatch.setattr(watchdog, "probe_http_json", healthy_http)
    monkeypatch.setattr(
        watchdog,
        "query_windows_service",
        lambda _name: {"exists": True, "status": "StartPending", "query_ok": True, "error": None},
    )
    monkeypatch.setattr(
        watchdog,
        "control_windows_service",
        lambda *_args, **_kwargs: (calls.append("restart") or True, "ok"),
    )
    service = watchdog.SystemWatchdog(config, make_logger())
    base = time.time() + 1

    service.run_once(now=base)
    service.run_once(now=base + 20)

    assert calls == ["restart"]


def test_maintenance_suppresses_all_recovery(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, failure_threshold=1)
    config.maintenance_file.parent.mkdir(parents=True)
    config.maintenance_file.write_text('{"reason":"deploy"}', encoding="utf-8")
    calls = []
    monkeypatch.setattr(
        watchdog,
        "probe_http_json",
        lambda _url, _timeout: {"ok": False, "status_code": 0, "payload": {}, "error": "down"},
    )
    monkeypatch.setattr(
        watchdog,
        "query_windows_service",
        lambda _name: {"exists": True, "status": "Stopped", "query_ok": True, "error": None},
    )
    monkeypatch.setattr(watchdog, "restart_api", lambda _cfg: (calls.append("api") or True, ""))
    monkeypatch.setattr(
        watchdog,
        "control_windows_service",
        lambda *_args, **_kwargs: (calls.append("sync") or True, ""),
    )

    result = watchdog.SystemWatchdog(config, make_logger()).run_once(
        now=config.maintenance_file.stat().st_mtime
    )

    assert result["overall"] == "maintenance"
    assert calls == []


def test_publication_uses_maintenance_and_automatic_rollback():
    script = (ROOT / "deploy" / "scripts" / "publicar-release-prod.ps1").read_text(
        encoding="utf-8-sig"
    )

    assert script.index("Enter-SystemWatchdogMaintenance") < script.index(
        "Stop-SagraApiForDeploy"
    )
    assert "Rollback automatico" in script
    assert "Update-CurrentPointer -ProdPath $ProdPath -ReleaseName $activeNow" in script
    assert "finally" in script and "Exit-SystemWatchdogMaintenance" in script


def test_publication_restarts_sync_and_monitor_inside_maintenance_lock():
    script = (ROOT / "deploy" / "scripts" / "publicar-release-prod.ps1").read_text(
        encoding="utf-8-sig"
    )
    health = script.index("Wait-SagraHealthCheck -ProdPath $ProdPath -TimeoutSec $HealthWaitSec")
    sync_restart = script.index('Restart-SagraBackgroundServiceForDeploy -Name "SAGRA-SyncAndamentos"')
    monitor_restart = script.index(
        'Restart-SagraBackgroundServiceForDeploy -Name "SAGRA-MonitorSyncAndamentos"'
    )
    heartbeat = script.index("Wait-SyncHeartbeatRenewed")
    lock_exit = script.rindex("Exit-SystemWatchdogMaintenance")
    finally_block = script.rindex("} finally {")

    assert script.index("Enter-SystemWatchdogMaintenance") < health
    assert health < sync_restart < monitor_restart < heartbeat < finally_block < lock_exit

    common = (ROOT / "deploy" / "scripts" / "deploy-common.ps1").read_text(encoding="utf-8-sig")
    assert "function Restart-SagraBackgroundServiceForDeploy" in common
    assert "function Wait-SyncHeartbeatRenewed" in common


def test_package_requires_sync_and_monitor_services():
    script = (ROOT / "deploy" / "scripts" / "package-release.ps1").read_text(
        encoding="utf-8-sig"
    )
    critical = script[script.index("$criticalFiles = @("):]

    assert "sync_andamentos_service.py obrigatorio" in script
    assert "monitor_sync_andamentos_service.py obrigatorio" in script
    assert '"sync_andamentos_service.py"' in critical
    assert '"monitor_sync_andamentos_service.py"' in critical


def test_package_requires_watchdog_and_integrity_manifest():
    script = (ROOT / "deploy" / "scripts" / "package-release.ps1").read_text(
        encoding="utf-8-sig"
    )

    assert "system_watchdog_service.py obrigatorio" in script
    assert "RELEASE-INTEGRITY.json" in script
    assert "OutDir recusado" in script
    assert "function Get-Sha256Hex" in script
    assert "Get-FileHash" not in script


def test_watchdog_installer_acl_check_uses_atomic_write_rights():
    script = (ROOT / "deploy" / "templates" / "instalar-servico-watchdog-sistema.ps1").read_text(
        encoding="utf-8-sig"
    )

    assert "::WriteData" in script
    assert "::AppendData" in script
    assert "::DeleteSubdirectoriesAndFiles" in script
    assert "::FullControl" not in script
    assert "::Modify" not in script


def test_watchdog_installer_finds_server_nssm_and_sets_account_safely():
    script = (ROOT / "deploy" / "templates" / "instalar-servico-watchdog-sistema.ps1").read_text(
        encoding="utf-8-sig"
    )

    assert "Get-Command nssm.exe" in script
    assert "-HostedServiceName $SyncServiceName" in script
    assert "SYSTEM_WATCHDOG_NSSM_PATH=$nssm" in script
    assert "[pscredential]$ServiceCredential" in script
    assert "Invoke-Nssm -Exe $nssm -Arguments @(\"set\", $ServiceName, \"ObjectName\"" not in script
    assert script.index("Set-ServiceLogon -Exe") < script.index("Protect-ControlDirectory -Path $runDir")


def test_package_build_uses_installed_vite_without_implicit_pnpm_install():
    script = (ROOT / "deploy" / "scripts" / "package-release.ps1").read_text(
        encoding="utf-8-sig"
    )

    assert 'node_modules\\.bin\\vite.cmd' in script
    assert 'node_modules\\vite' in script
    assert "Get-Item -LiteralPath $vitePackagePath" in script
    assert "$vitePackage.Target" in script
    assert "& $viteCmd build" in script
    assert "& $nodeCommand.Source $resolvedViteCli build" in script
    assert "pnpm exec vite build" not in script


class TestApiRuntimeIssues:
    def test_no_issues_when_everything_matches(self):
        payload = {
            "status": "ok",
            "mdb": "ok",
            "release": "20261015_205753",
            "process_user": "REDECAMARA\\usr_sefoc",
        }
        assert watchdog.evaluate_api_runtime(
            payload,
            expected_release="20261015_205753",
            expected_user="redecamara\\USR_SEFOC",
        ) == []

    def test_reports_mdb_release_and_account(self):
        payload = {
            "status": "ok",
            "mdb": "error",
            "mdb_error_kind": "permission",
            "release": None,
            "process_user": "REDECAMARA\\P_918713",
        }
        issues = watchdog.evaluate_api_runtime(
            payload,
            expected_release="20261015_205753",
            expected_user="REDECAMARA\\usr_sefoc",
        )
        assert issues == [
            "mdb=error classe=permission",
            "release=ausente esperado=20261015_205753",
            "conta=REDECAMARA\\P_918713 esperado=REDECAMARA\\usr_sefoc",
        ]

    def test_ignores_unready_payload_and_missing_fields(self):
        assert watchdog.evaluate_api_runtime(
            None, expected_release="x", expected_user="y"
        ) == []
        assert watchdog.evaluate_api_runtime(
            {"status": "ok"}, expected_release="", expected_user="y"
        ) == []

    def test_read_release_name_handles_powershell_bom(self, tmp_path: Path):
        (tmp_path / "RELEASE.txt").write_text(
            "release=20261015_205753\ndeployed_at=2026-10-15T20:58:31\n",
            encoding="utf-8-sig",
        )
        assert watchdog.read_release_name(tmp_path) == "20261015_205753"
        assert watchdog.read_release_name(tmp_path / "missing") == ""


def _runtime_http(payload_extra):
    def probe(url: str, _timeout: int):
        if url.endswith("/health/live"):
            return {"ok": True, "status_code": 200, "payload": {"status": "ok"}, "error": None}
        return {
            "ok": True,
            "status_code": 200,
            "payload": {"status": "ok", "db": "ok", **payload_extra},
            "error": None,
        }

    return probe


def _healthy_sync(monkeypatch):
    monkeypatch.setattr(
        watchdog,
        "query_windows_service",
        lambda _name: {"exists": True, "status": "Running", "query_ok": True, "error": None},
    )
    monkeypatch.setattr(
        watchdog,
        "probe_sync_heartbeat",
        lambda *_a, **_k: {"healthy": True, "phase": "os_deletes", "age_seconds": 1, "error": None},
    )


def test_mdb_error_degrades_without_restarting_api(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, failure_threshold=1)
    monkeypatch.setattr(
        watchdog, "probe_http_json", _runtime_http({"mdb": "error", "mdb_error_kind": "permission"})
    )
    _healthy_sync(monkeypatch)
    monkeypatch.setattr(
        watchdog, "restart_api", lambda _c: pytest.fail("API nao deve ser reiniciada por MDB")
    )

    result = watchdog.SystemWatchdog(config, make_logger()).run_once(now=time.time() + 1)

    assert result["overall"] == "degraded"
    assert result["api"]["runtime_issues"] == ["mdb=error classe=permission"]
    assert result["api"]["readiness"]["payload"]["mdb"] == "error"


def test_release_divergence_degrades(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path)
    (config.current_root / "RELEASE.txt").write_text(
        "release=20261015_205753\n", encoding="utf-8-sig"
    )
    monkeypatch.setattr(watchdog, "probe_http_json", _runtime_http({"mdb": "ok"}))
    _healthy_sync(monkeypatch)

    result = watchdog.SystemWatchdog(config, make_logger()).run_once(now=time.time() + 1)

    assert result["overall"] == "degraded"
    assert result["api"]["runtime_issues"] == [
        "release=ausente esperado=20261015_205753"
    ]


def test_matching_runtime_is_ok(tmp_path: Path, monkeypatch):
    config = make_config(tmp_path, api_expected_user="REDECAMARA\\usr_sefoc")
    (config.current_root / "RELEASE.txt").write_text("release=r1\n", encoding="utf-8")
    monkeypatch.setattr(
        watchdog,
        "probe_http_json",
        _runtime_http({"mdb": "ok", "release": "r1", "process_user": "REDECAMARA\\usr_sefoc"}),
    )
    _healthy_sync(monkeypatch)

    result = watchdog.SystemWatchdog(config, make_logger()).run_once(now=time.time() + 1)

    assert result["overall"] == "ok"
    assert result["api"]["runtime_issues"] == []

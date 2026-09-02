from __future__ import annotations

from services.admin_reload_state import (
    get_admin_reload_state,
    is_admin_force_reload,
    record_admin_reload,
    reset_admin_reload_state_for_tests,
)


def setup_function() -> None:
    reset_admin_reload_state_for_tests()


def test_is_admin_force_reload_accepts_panel_payload():
    assert is_admin_force_reload(
        {
            "type": "force_refresh",
            "action": "reload",
            "origem": "admin_panel",
        }
    )


def test_is_admin_force_reload_rejects_reconcile():
    assert not is_admin_force_reload(
        {
            "type": "force_refresh",
            "scope": "os_search",
            "reason": "reconcile",
        }
    )


def test_record_admin_reload_increments_epoch():
    assert get_admin_reload_state()["epoch"] == 0
    first = record_admin_reload(overwrite_config=False)
    second = record_admin_reload(overwrite_config=True)
    assert first["epoch"] == 1
    assert first["overwriteConfig"] is False
    assert second["epoch"] == 2
    assert second["overwriteConfig"] is True
    assert second["at"]

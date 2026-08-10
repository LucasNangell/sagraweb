"""Testes do ciclo async de render da Prova WEB."""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from services import prova_web_job_service as jobs
from services import prova_web_record_service as svc


def test_is_render_helpers() -> None:
    assert svc.is_render_ready({"renderStatus": "ready"})
    assert not svc.is_render_ready({"renderStatus": "pending"})
    assert svc.is_render_in_flight({"renderStatus": "running"})
    assert not svc.is_render_in_flight({"renderStatus": "error"})


def test_claim_uses_rowcount(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Any] = []

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.rowcount = 1
        for op in ops:
            op(cursor)
            calls.append(cursor.execute.call_args)
        return []

    monkeypatch.setattr(svc.db, "execute_transaction", fake_tx)
    assert svc.claim_prova_web_render(2026, 10, 1) is True
    assert calls


def test_finalize_only_when_running(monkeypatch: pytest.MonkeyPatch) -> None:
    rowcounts = [0]

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.rowcount = rowcounts[0]
        for op in ops:
            op(cursor)
        return []

    monkeypatch.setattr(svc.db, "execute_transaction", fake_tx)
    assert (
        svc.finalize_prova_web_render(
            2026, 10, 1, render_status=svc.RENDER_READY, clear_error=True
        )
        is False
    )
    rowcounts[0] = 1
    assert (
        svc.finalize_prova_web_render(
            2026, 10, 1, render_status=svc.RENDER_READY, clear_error=True
        )
        is True
    )


def test_worker_success_marks_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    states: list[str] = []

    monkeypatch.setattr(jobs, "claim_prova_web_render", lambda *a, **k: True)
    monkeypatch.setattr(
        jobs,
        "get_prova_web_record_by_versao",
        lambda *a, **k: {
            "versao": 1,
            "modo": "unico",
            "pastaRender": "Prova1",
            "cropJson": None,
            "arquivoUnico": "a.pdf",
        },
    )
    monkeypatch.setattr(
        "services.prova_web_record_service.require_os_folder",
        lambda *a, **k: r"C:\os",
    )
    monkeypatch.setattr(
        jobs,
        "resolve_record_sources",
        lambda *a, **k: ("unico", [r"C:\os\a.pdf"]),
    )
    monkeypatch.setattr(
        jobs,
        "ensure_prova_web_pages",
        lambda *a, **k: {"pages": []},
    )

    def fake_finalize(*_a, **kwargs):
        states.append(kwargs["render_status"])
        return True

    monkeypatch.setattr(jobs, "finalize_prova_web_render", fake_finalize)

    rt = jobs._ProvaWebJobRuntime()
    rt._gen[(2026, 10, 1)] = 1
    rt._run_job(2026, 10, 1, 1)
    assert states == [svc.RENDER_READY]


def test_worker_failure_marks_error(monkeypatch: pytest.MonkeyPatch) -> None:
    states: list[tuple[str, str | None]] = []

    monkeypatch.setattr(jobs, "claim_prova_web_render", lambda *a, **k: True)
    monkeypatch.setattr(
        jobs,
        "get_prova_web_record_by_versao",
        lambda *a, **k: {
            "versao": 1,
            "modo": "unico",
            "pastaRender": "Prova1",
            "cropJson": None,
        },
    )
    monkeypatch.setattr(
        "services.prova_web_record_service.require_os_folder",
        lambda *a, **k: r"C:\os",
    )
    monkeypatch.setattr(
        jobs,
        "resolve_record_sources",
        lambda *a, **k: ("unico", [r"C:\os\a.pdf"]),
    )

    def boom(*_a, **_k):
        raise ValueError("crop inválido")

    monkeypatch.setattr(jobs, "ensure_prova_web_pages", boom)

    def fake_finalize(*_a, **kwargs):
        states.append((kwargs["render_status"], kwargs.get("render_error")))
        return True

    monkeypatch.setattr(jobs, "finalize_prova_web_render", fake_finalize)

    rt = jobs._ProvaWebJobRuntime()
    rt._gen[(2026, 10, 1)] = 1
    rt._run_job(2026, 10, 1, 1)
    assert states[0][0] == svc.RENDER_ERROR
    assert "crop" in (states[0][1] or "").lower()


def test_stale_job_skips_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    claimed = {"n": 0}

    def fake_claim(*_a, **_k):
        claimed["n"] += 1
        return True

    monkeypatch.setattr(jobs, "claim_prova_web_render", fake_claim)
    rt = jobs._ProvaWebJobRuntime()
    rt._gen[(2026, 10, 1)] = 2
    rt._run_job(2026, 10, 1, 1)
    assert claimed["n"] == 0


def test_recover_resets_running(monkeypatch: pytest.MonkeyPatch) -> None:
    reset: list[tuple[int, int, int]] = []
    enqueued: list[tuple[int, int, int]] = []

    monkeypatch.setattr(
        jobs,
        "list_prova_web_render_jobs",
        lambda *, statuses=None: (
            [
                {
                    "anoProtocolo": 2026,
                    "nroProtocolo": 10,
                    "versao": 1,
                }
            ]
            if statuses == [svc.RENDER_RUNNING]
            else [
                {
                    "anoProtocolo": 2026,
                    "nroProtocolo": 10,
                    "versao": 1,
                }
            ]
        ),
    )
    monkeypatch.setattr(
        jobs,
        "mark_prova_web_render_pending",
        lambda ano, os_id, versao: reset.append((ano, os_id, versao)),
    )

    rt = jobs._ProvaWebJobRuntime()

    def fake_enqueue(ano, os_id, versao):
        enqueued.append((ano, os_id, versao))
        return True

    monkeypatch.setattr(jobs, "_runtime", rt)
    monkeypatch.setattr(rt, "start", lambda: None)
    monkeypatch.setattr(rt, "enqueue", fake_enqueue)

    out = jobs.recover_prova_web_render_jobs()
    assert reset == [(2026, 10, 1)]
    assert enqueued == [(2026, 10, 1)]
    assert out["resetRunning"] == 1
    assert out["enqueued"] == 1


def test_render_for_record_blocks_when_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    from routers import prova_web_routes as routes

    with pytest.raises(HTTPException) as exc:
        routes._render_for_record(
            2026,
            10,
            {"renderStatus": "pending", "versao": 1, "pastaRender": "Prova1"},
        )
    assert exc.value.status_code == 409

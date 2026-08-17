"""Testes do job/cache de ZIP da Gravação Externa."""
from __future__ import annotations

import os
from datetime import datetime

import pytest
from fastapi import HTTPException

from services import gravacao_externa_zip_job_service as jobs
from services.gravacao_externa_service import compute_arquivos_signature


def test_enqueue_reuses_ready_zip(monkeypatch: pytest.MonkeyPatch, tmp_path):
    zip_file = tmp_path / "ready.zip"
    zip_file.write_bytes(b"PK")
    arquivos = [
        {
            "id": 1,
            "relative": "a.tif",
            "absolute_path": "",
            "nome": "a.tif",
            "tamanho_bytes": 2,
            "ordem": 0,
        }
    ]
    signature = compute_arquivos_signature(arquivos)
    existing = {
        "id": 9,
        "gravacao_externa_id": 4,
        "assinatura": signature,
        "status": jobs.ZIP_READY,
        "erro": None,
        "arquivo_path": str(zip_file),
        "nome_arquivo": "pack.zip",
        "tamanho_bytes": 2,
        "total_arquivos": 1,
        "arquivos_prontos": 1,
        "bytes_prontos": 2,
        "etag": jobs.zip_etag(signature),
    }
    touched = {"ok": False}
    monkeypatch.setattr(jobs, "_fetch_arquivos", lambda _sid: arquivos)
    monkeypatch.setattr(jobs, "get_zip_row", lambda _sid: existing)
    monkeypatch.setattr(
        jobs,
        "touch_zip_last_access",
        lambda _sid: touched.__setitem__("ok", True),
    )
    enqueued = {"ok": False}
    monkeypatch.setattr(jobs._runtime, "enqueue", lambda *a, **k: enqueued.__setitem__("ok", True))

    out = jobs.enqueue_zip_job({"id": 4, "os_ano": 2024, "os_nro": 1})
    assert out["status"] == "pronto"
    assert touched["ok"] is True
    assert enqueued["ok"] is False


def test_enqueue_empty_raises(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(jobs, "_fetch_arquivos", lambda _sid: [])
    with pytest.raises(HTTPException) as exc:
        jobs.enqueue_zip_job({"id": 1, "os_ano": 2024, "os_nro": 1})
    assert exc.value.status_code == 404


def test_worker_success_writes_atomic_zip(monkeypatch: pytest.MonkeyPatch, tmp_path):
    dest_dir = tmp_path / "zips"
    dest_dir.mkdir()
    monkeypatch.setattr(jobs, "zip_cache_dir", lambda: dest_dir)
    monkeypatch.setattr(jobs, "_claim_zip_job", lambda *a, **k: True)
    monkeypatch.setattr(
        jobs,
        "get_zip_row",
        lambda _sid: {"assinatura": "sig", "status": jobs.ZIP_GENERATING},
    )
    monkeypatch.setattr(
        jobs,
        "get_session_by_id",
        lambda _sid: {"id": 4, "os_ano": 2024, "os_nro": 77},
    )

    def fake_write(session, dest_path, on_progress=None, should_abort=None):
        with open(dest_path, "wb") as fh:
            fh.write(b"ZIPDATA")
        if on_progress:
            on_progress(1, 1, 7)
        return {
            "filename": "gravacao_externa_OS_00077_2024.zip",
            "tamanho_bytes": 7,
            "total_arquivos": 1,
            "bytes_prontos": 7,
        }

    monkeypatch.setattr(jobs, "write_session_arquivos_zip", fake_write)
    finalized = {}

    def fake_ready(*args):
        finalized["args"] = args
        return True

    monkeypatch.setattr(jobs, "_finalize_ready", fake_ready)
    monkeypatch.setattr(jobs, "purge_expired_zips", lambda: {"expired": 0, "evicted": 0})
    monkeypatch.setattr(jobs._runtime, "is_stale", lambda *a, **k: False)

    jobs._runtime._run_job(4, "sig", 1)

    dest = jobs.zip_dest_path(4, "sig")
    assert dest.is_file()
    assert dest.read_bytes() == b"ZIPDATA"
    assert not os.path.exists(str(dest) + ".part")
    assert finalized["args"][0] == 4
    assert finalized["args"][2] == str(dest)


def test_mark_zip_downloaded_renews_expira_em(monkeypatch: pytest.MonkeyPatch):
    captured: list[tuple[str, tuple]] = []

    def fake_query(sql, params=None):
        captured.append((sql, params or ()))
        return []

    monkeypatch.setattr(jobs.db, "execute_query", fake_query)
    monkeypatch.setattr(jobs, "zip_ttl_hours", lambda: 24)

    jobs.mark_zip_downloaded(12)

    assert len(captured) == 1
    sql, params = captured[0]
    assert "ExpiraEm = DATE_ADD(NOW(), INTERVAL %s HOUR)" in sql
    assert "UltimoAcessoEm = NOW()" in sql
    assert params == (24, 12, jobs.ZIP_READY)


def test_touch_zip_last_access_does_not_renew_ttl(monkeypatch: pytest.MonkeyPatch):
    captured: list[str] = []

    def fake_query(sql, params=None):
        captured.append(sql)
        return []

    monkeypatch.setattr(jobs.db, "execute_query", fake_query)
    jobs.touch_zip_last_access(12)

    assert len(captured) == 1
    assert "ExpiraEm" not in captured[0]
    assert "UltimoAcessoEm = NOW()" in captured[0]


def test_purge_expired_deletes_old_rows(monkeypatch: pytest.MonkeyPatch, tmp_path):
    old_zip = tmp_path / "old.zip"
    old_zip.write_bytes(b"OLD")
    expired_row = {
        "Id": 1,
        "GravacaoExternaId": 8,
        "Assinatura": "aa",
        "Status": jobs.ZIP_READY,
        "Erro": None,
        "ArquivoPath": str(old_zip),
        "NomeArquivo": "old.zip",
        "TamanhoBytes": 3,
        "TotalArquivos": 1,
        "ArquivosProntos": 1,
        "BytesProntos": 3,
        "CriadoEm": datetime(2020, 1, 1),
        "ProntoEm": datetime(2020, 1, 1),
        "ExpiraEm": datetime(2020, 1, 2),
        "UltimoAcessoEm": datetime(2020, 1, 1),
    }
    deleted = []

    def fake_query(sql, params=None):
        if "ExpiraEm" in sql:
            return [expired_row]
        return []

    monkeypatch.setattr(jobs.db, "execute_query", fake_query)
    monkeypatch.setattr(jobs, "list_zip_jobs", lambda **k: [])
    monkeypatch.setattr(jobs, "_delete_zip_row", lambda sid: deleted.append(sid))

    out = jobs.purge_expired_zips()
    assert out["expired"] == 1
    assert deleted == [8]
    assert not old_zip.exists()

"""Testes do job/cache de ZIP da Gravação Externa."""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import pytest
from fastapi import HTTPException

from services import gravacao_externa_zip_job_service as jobs
from services.gravacao_externa_service import (
    ZipFileWriteError,
    ZipFilesPrecheckError,
    compute_arquivos_signature,
)


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

    def fake_write(session, dest_path, on_progress=None, should_abort=None, **kwargs):
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
    monkeypatch.setattr(jobs, "estimate_zip_bytes", lambda *a, **k: 100)
    monkeypatch.setattr(jobs, "ensure_space_for", lambda *a, **k: None)
    monkeypatch.setattr(jobs, "precheck_session_arquivos_zip", lambda *a, **k: None)
    monkeypatch.setattr(jobs, "_fetch_arquivos", lambda _sid: [{"id": 1, "nome": "a.tif"}])
    monkeypatch.setattr(jobs, "_finalize_error", lambda *a, **k: None)
    monkeypatch.setattr(jobs, "_finalize_error_from_exception", lambda *a, **k: None)

    finalized: dict[str, Any] = {}

    def fake_ready(*args):
        finalized["args"] = args
        return True

    monkeypatch.setattr(jobs, "_finalize_ready", fake_ready)
    monkeypatch.setattr(jobs, "purge_expired_zips", lambda: {"expired": 0, "evicted": 0, "parts_removed": 0})
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


def test_describe_zip_failure_sem_espaco():
    exc = jobs.ZipSpaceError(
        needed_bytes=5_000_000_000,
        free_bytes=500_000_000,
        reserve_bytes=1_000_000_000,
        cache_dir="F:\\SagraWeb\\gravacao_externa_zips",
        volume="F:",
    )
    codigo, msg, detalhe = jobs._describe_zip_failure(exc)
    assert codigo == "SEM_ESPACO"
    assert "[SEM_ESPACO]" in msg
    assert "F:" in msg
    assert "needed_bytes=5000000000" in detalhe


def test_describe_zip_failure_arquivo_ausente_precheck():
    exc = ZipFilesPrecheckError(
        missing=[("a.tif", "\\\\srv\\a.tif")],
        inaccessible=[],
        total=3,
    )
    codigo, msg, _det = jobs._describe_zip_failure(exc)
    assert codigo == "ARQUIVO_AUSENTE"
    assert "a.tif" in msg


def test_describe_zip_failure_file_write_wraps_inner():
    inner = OSError(28, "No space left on device")
    exc = ZipFileWriteError(2, 5, "b.tif", "C:\\b.tif", inner)
    codigo, msg, detalhe = jobs._describe_zip_failure(exc)
    assert codigo == "SEM_ESPACO"
    assert "2/5" in msg
    assert "b.tif" in msg
    assert "file_index=2" in detalhe


def test_ensure_space_evicts_other_session_zip(monkeypatch: pytest.MonkeyPatch, tmp_path):
    cache = tmp_path / "zips"
    cache.mkdir()
    other_zip = cache / "99_old.zip"
    other_zip.write_bytes(b"x" * 2048)
    monkeypatch.setattr(jobs, "zip_cache_dir", lambda: cache)
    monkeypatch.setattr(jobs, "_min_free_bytes", lambda: 512)
    monkeypatch.setattr(jobs, "purge_expired_zips", lambda: {"expired": 0, "evicted": 0, "parts_removed": 0})

    usage = {"free": 256}

    def fake_disk_usage(_path):
        class U:
            total = 4096
            free = usage["free"]
            used = total - free

        return U()

    monkeypatch.setattr(jobs.shutil, "disk_usage", fake_disk_usage)
    purged = []

    def fake_purge(row):
        purged.append(int(row["gravacao_externa_id"]))
        other_zip.unlink(missing_ok=True)
        usage["free"] = 4096

    monkeypatch.setattr(jobs, "_purge_row", fake_purge)
    monkeypatch.setattr(
        jobs,
        "list_zip_jobs",
        lambda **k: [
            {
                "gravacao_externa_id": 99,
                "arquivo_path": str(other_zip),
                "tamanho_bytes": 2048,
                "ultimo_acesso_em": "2020-01-01",
            }
        ],
    )

    jobs.ensure_space_for(1024, session_id=53)
    assert purged == [99]


def test_ensure_space_raises_when_still_insufficient(monkeypatch: pytest.MonkeyPatch, tmp_path):
    cache = tmp_path / "zips"
    cache.mkdir()
    monkeypatch.setattr(jobs, "zip_cache_dir", lambda: cache)
    monkeypatch.setattr(jobs, "_min_free_bytes", lambda: 1024)
    monkeypatch.setattr(jobs, "purge_expired_zips", lambda: {"expired": 0, "evicted": 0, "parts_removed": 0})
    monkeypatch.setattr(jobs, "list_zip_jobs", lambda **k: [])

    class U:
        total = 10_000
        free = 100
        used = total - free

    monkeypatch.setattr(jobs.shutil, "disk_usage", lambda _p: U())

    with pytest.raises(jobs.ZipSpaceError) as exc:
        jobs.ensure_space_for(5000, session_id=1)
    assert exc.value.needed_bytes == 5000


def test_purge_orphan_parts_removed(monkeypatch: pytest.MonkeyPatch, tmp_path):
    cache = tmp_path / "zips"
    cache.mkdir()
    part = cache / "54_deadbeef.zip.part"
    part.write_bytes(b"")
    monkeypatch.setattr(jobs, "zip_cache_dir", lambda: cache)
    monkeypatch.setattr(jobs.db, "execute_query", lambda *a, **k: [])
    monkeypatch.setattr(jobs, "list_zip_jobs", lambda **k: [])

    out = jobs.purge_expired_zips()
    assert out["parts_removed"] == 1
    assert not part.exists()


def test_enqueue_precheck_failure_persists_error(monkeypatch: pytest.MonkeyPatch):
    arquivos = [
        {
            "id": 1,
            "relative": "a.tif",
            "absolute_path": "",
            "nome": "a.tif",
            "tamanho_bytes": 10,
            "ordem": 0,
        }
    ]
    signature = compute_arquivos_signature(arquivos)
    existing = {
        "id": 1,
        "gravacao_externa_id": 53,
        "assinatura": signature,
        "status": jobs.ZIP_ERROR,
        "erro": "old",
        "erro_codigo": None,
        "erro_detalhe": None,
        "arquivo_path": None,
        "nome_arquivo": None,
        "tamanho_bytes": None,
        "total_arquivos": 1,
        "arquivos_prontos": 0,
        "bytes_prontos": 0,
        "etag": None,
    }
    store = {"row": dict(existing)}
    finalized = {}

    monkeypatch.setattr(jobs, "_fetch_arquivos", lambda _sid: arquivos)
    monkeypatch.setattr(jobs, "estimate_zip_bytes", lambda _a, _s: 100)
    monkeypatch.setattr(jobs, "ensure_space_for", lambda *a, **k: None)

    def fail_precheck(session, arquivos=None, **k):
        raise ZipFilesPrecheckError(
            missing=[("a.tif", "C:\\missing.tif")],
            inaccessible=[],
            total=1,
        )

    monkeypatch.setattr(jobs, "precheck_session_arquivos_zip", fail_precheck)

    def capture_finalize(sid, sig, msg, **kw):
        finalized.update({"msg": msg, **kw})
        store["row"] = {
            **existing,
            "erro": msg,
            "erro_codigo": kw.get("erro_codigo"),
            "erro_detalhe": kw.get("erro_detalhe"),
            "status": jobs.ZIP_ERROR,
        }

    monkeypatch.setattr(jobs, "_finalize_error", capture_finalize)
    monkeypatch.setattr(jobs, "get_zip_row", lambda _sid: store["row"])

    out = jobs.enqueue_zip_job({"id": 53, "os_ano": 2024, "os_nro": 1805})
    assert out["status"] == "erro"
    assert finalized.get("erro_codigo") == "ARQUIVO_AUSENTE"
    assert "a.tif" in finalized.get("msg", "")

"""Regressões das correções de carga no MySQL (nov/2026): cache da busca, sync e heartbeat."""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services import os_search_cache as cache  # noqa: E402


def _etag(result):
    return f"etag-{result['n']}"


class TestOsSearchCache:
    def test_segunda_chamada_igual_usa_cache(self):
        calls = []

        def compute():
            calls.append(1)
            return {"n": len(calls)}

        key = cache.make_key({"anos": [2026], "fetch_all": True})
        r1, e1, hit1 = cache.get_or_compute(key, compute, _etag)
        r2, e2, hit2 = cache.get_or_compute(key, compute, _etag)
        assert (hit1, hit2) == (False, True)
        assert r1 is r2 and e1 == e2 == "etag-1"
        assert len(calls) == 1

    def test_bump_de_versao_invalida(self):
        calls = []

        def compute():
            calls.append(1)
            return {"n": len(calls)}

        key = cache.make_key({"anos": [2026]})
        cache.get_or_compute(key, compute, _etag)
        cache.bump_os_search_cache_version("teste")
        r, _, hit = cache.get_or_compute(key, compute, _etag)
        assert hit is False and r["n"] == 2

    def test_ttl_expira(self, monkeypatch):
        monkeypatch.setenv("SAGRA_OS_SEARCH_CACHE_TTL_SEC", "1")
        calls = []

        def compute():
            calls.append(1)
            return {"n": len(calls)}

        key = cache.make_key({"x": 1})
        cache.get_or_compute(key, compute, _etag)
        real = time.monotonic
        monkeypatch.setattr(cache.time, "monotonic", lambda: real() + 5)
        _, _, hit = cache.get_or_compute(key, compute, _etag)
        assert hit is False and len(calls) == 2

    def test_bump_durante_calculo_nao_guarda_resultado_velho(self):
        calls = []

        def compute():
            calls.append(1)
            if len(calls) == 1:
                cache.bump_os_search_cache_version("alteracao durante a query")
            return {"n": len(calls)}

        key = cache.make_key({"y": 1})
        cache.get_or_compute(key, compute, _etag)
        _, _, hit = cache.get_or_compute(key, compute, _etag)
        assert hit is False and len(calls) == 2

    def test_single_flight_executa_query_uma_vez(self):
        calls = []
        started = threading.Event()
        release = threading.Event()

        def compute():
            calls.append(1)
            started.set()
            release.wait(2)
            return {"n": len(calls)}

        key = cache.make_key({"z": 1})
        results = []

        def worker():
            results.append(cache.get_or_compute(key, compute, _etag))

        threads = [threading.Thread(target=worker) for _ in range(8)]
        threads[0].start()
        started.wait(2)
        for t in threads[1:]:
            t.start()
        time.sleep(0.05)
        release.set()
        for t in threads:
            t.join(3)
        assert len(calls) == 1
        assert len(results) == 8
        assert all(r[0]["n"] == 1 for r in results)

    def test_desligado_por_env(self, monkeypatch):
        monkeypatch.setenv("SAGRA_OS_SEARCH_CACHE", "0")
        calls = []

        def compute():
            calls.append(1)
            return {"n": len(calls)}

        key = cache.make_key({"w": 1})
        cache.get_or_compute(key, compute, _etag)
        _, _, hit = cache.get_or_compute(key, compute, _etag)
        assert hit is False and len(calls) == 2

    def test_broadcast_ws_invalida_cache(self):
        import asyncio

        from routers.realtime import manager

        before = cache.snapshot()["version"]
        asyncio.run(manager.broadcast({"type": "system_update", "nro": 1, "ano": 2026}))
        assert cache.snapshot()["version"] == before + 1
        asyncio.run(manager.broadcast({"type": "support_chat_typing", "ticket_id": 1}))
        assert cache.snapshot()["version"] == before + 1


class TestSyncOsDeletesCache:
    def _mgr(self):
        import sync_os_deletes as osdel

        sync = MagicMock()
        mgr = osdel.OsDeleteManager(sync)
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value = cur
        mgr._mysql = MagicMock(return_value=conn)
        return mgr, conn, cur

    def test_sem_mudanca_nao_grava(self):
        mgr, conn, cur = self._mgr()
        present = {(1, 2026): "OS_Atual", (2, 2026): "Papelaria"}
        mgr.upsert_cache(present, dict(present))
        cur.execute.assert_not_called()
        conn.commit.assert_not_called()

    def test_grava_so_novas_ou_com_origem_alterada_em_lote(self):
        mgr, conn, cur = self._mgr()
        present = {(1, 2026): "OS_Atual", (2, 2026): "Papelaria", (3, 2026): "OS_Atual"}
        known = {(1, 2026): "OS_Atual", (2, 2026): "OS_Atual"}
        mgr.upsert_cache(present, known)
        assert cur.execute.call_count == 1
        sql, params = cur.execute.call_args[0]
        assert sql.count("(%s, %s, %s, NOW())") == 2
        assert params == [2, 2026, "Papelaria", 3, 2026, "OS_Atual"]
        conn.commit.assert_called_once()


class TestPapelariaHeartbeatDdl:
    def test_create_table_roda_uma_vez(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "_heartbeat_table_ready", False)
        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        fake_db = MagicMock()
        monkeypatch.setattr(svc, "db", fake_db)
        for _ in range(5):
            svc._persist_worker_heartbeat("w1", svc.datetime.now(), {})
        ddl = [c for c in fake_db.execute_query.call_args_list if "CREATE TABLE" in c[0][0]]
        assert len(ddl) == 1
        assert fake_db.execute_query.call_count == 6


class TestSyncAndamentosCacheDiff:
    def _sync(self, existing_rows):
        import sync_andamentos_service as svc

        sync = svc.ResilientSynchronizer.__new__(svc.ResilientSynchronizer)
        conn = MagicMock()
        cur = MagicMock()
        cur.fetchall.return_value = existing_rows
        conn.cursor.return_value = cur
        sync.conn_mgr = MagicMock()
        sync.conn_mgr.get_mysql.return_value = conn
        sync._svc_log = MagicMock()
        sync.logger = MagicMock()
        sync._invalidate_for_conn = MagicMock()
        return sync, conn, cur

    def test_sem_mudanca_so_le(self):
        sync, conn, cur = self._sync([("10", 1, 2026, "OS_Atual")])
        sync.update_cache(
            [{"CodStatus": 10, "NroProtocoloLink": 1, "AnoProtocoloLink": 2026}], []
        )
        assert cur.execute.call_count == 1  # só o SELECT
        conn.commit.assert_not_called()

    def test_aplica_apenas_diferenca(self):
        sync, conn, cur = self._sync(
            [("10", 1, 2026, "OS_Atual"), ("11", 2, 2026, "OS_Atual"), ("99", 9, 2025, "OS_Atual")]
        )
        sync.update_cache(
            [
                {"CodStatus": 10, "NroProtocoloLink": 1, "AnoProtocoloLink": 2026},
                {"CodStatus": 12, "NroProtocoloLink": 3, "AnoProtocoloLink": 2026},
            ],
            [{"CodStatus": 11, "NroProtocoloLink": 2, "AnoProtocoloLink": 2026}],
        )
        sqls = [c[0][0] for c in cur.execute.call_args_list]
        assert sqls[0].startswith("SELECT")
        delete_calls = [c for c in cur.execute.call_args_list if c[0][0].startswith("DELETE")]
        insert_calls = [c for c in cur.execute.call_args_list if c[0][0].startswith("INSERT")]
        assert delete_calls[0][0][1] == ["99"]
        params = insert_calls[0][0][1]
        assert sorted([params[i : i + 4] for i in range(0, len(params), 4)]) == [
            ["11", 2, 2026, "Papelaria"],
            ["12", 3, 2026, "OS_Atual"],
        ]
        conn.commit.assert_called_once()

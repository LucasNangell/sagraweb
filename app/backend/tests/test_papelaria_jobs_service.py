"""Testes — fila de jobs Papelaria (sem COM / sem worker)."""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest


MODEL_SAMPLE = {
    "id": 1,
    "produto": "Ct Visita",
    "frente_versao": "Frente e Verso",
    "cores": "Policromia",
    "arquivo_modelo": "CtVisitaFV.cdr",
    "campos": {},
    "campos_formulario": [
        {"key": "nome_deputado", "label": "Nome", "required": True, "type": "text"},
        {"key": "email", "label": "E-mail", "required": True, "type": "email"},
    ],
    "variaveis": [],
}


@pytest.fixture(autouse=True)
def _skip_ensure_tables(monkeypatch):
    from services import papelaria_jobs_service as svc

    monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
    monkeypatch.setattr(svc, "_backfill_prova_revisao_pending", lambda: None)
    monkeypatch.setattr(svc, "_tables_ready", True)


class TestSanitizeDados:
    def test_rejeita_caminho_unc(self):
        from services.papelaria_jobs_service import _sanitize_dados

        with pytest.raises(ValueError, match="caminho"):
            _sanitize_dados({"nome": r"\\server\share\file.cdr"})

    def test_rejeita_payload_grande(self):
        from services.papelaria_jobs_service import _sanitize_dados

        huge = {f"campo_{i}": "x" * 500 for i in range(80)}
        with pytest.raises(ValueError, match="limite"):
            _sanitize_dados(huge)


class TestCreateJob:
    def test_cria_job_com_modelo_valido(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        calls: list[tuple] = []

        class _FakeCursor:
            lastrowid = 42

            def execute(self, sql, params=None):
                calls.append((sql.strip()[:40], params))

        def fake_transaction(operations):
            cursor = _FakeCursor()
            return [op(cursor) for op in operations]

        def fake_query(sql, params=None):
            calls.append((sql.strip()[:40], params))
            if "FROM tabProtocolos" in sql:
                return [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in sql:
                return [
                    {
                        "ID": 42,
                        "NroProtocolo": 5954,
                        "AnoProtocolo": 2026,
                        "TipoJob": "create",
                        "Produto": "Ct Visita",
                        "ModeloID": 1,
                        "ArquivoModelo": "CtVisitaFV.cdr",
                        "DadosJson": json.dumps(
                            {"nome_deputado": "Samuel Viana", "email": "a@b.com"}
                        ),
                        "Status": "pending",
                        "Prioridade": 0,
                        "OrdemFila": 3,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": None,
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "Erro": None,
                        "Tentativas": 0,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            if "MAX(OrdemFila)" in sql:
                return [{"next_pos": 3}]
            if "INSERT INTO tabPapelariaJobLog" in sql:
                return []
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc.db, "execute_transaction", fake_transaction)
        with patch.object(
            svc,
            "broadcast_job_update",
        ), patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ):
            job = svc.create_job(
                ano=2026,
                nro=5954,
                modelo_id=1,
                dados={"nome_deputado": "Samuel Viana", "email": "a@b.com"},
                solicitado_por="918713",
            )

        assert job["id"] == 42
        assert job["status"] == "pending"
        assert job["arquivo_modelo"] == "CtVisitaFV.cdr"

    def test_bloqueia_campos_obrigatorios(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ):
            with pytest.raises(ValueError, match="obrigatórios"):
                svc.create_job(
                    ano=2026,
                    nro=5954,
                    modelo_id=1,
                    dados={"nome_deputado": "Samuel Viana"},
                    solicitado_por="918713",
                )

    def test_permite_campo_obrigatorio_excluido(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ):
            cleaned = svc._sanitize_dados({
                "nome_deputado": "Samuel Viana",
                "__exclusoes": json.dumps(["email"])
            })
            missing = svc._validate_required_fields(MODEL_SAMPLE, cleaned)
            assert not missing

    def test_bloqueia_modelo_inexistente(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=None,
        ):
            with pytest.raises(LookupError, match="Modelo"):
                svc.create_job(
                    ano=2026,
                    nro=5954,
                    modelo_id=999,
                    dados={"nome_deputado": "X", "email": "a@b.com"},
                    solicitado_por="918713",
                )

    def test_permite_os_menor_5000_com_produto_papelaria(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        class _FakeCursor:
            lastrowid = 43

            def execute(self, sql, params=None):
                pass

        def fake_transaction(operations):
            cursor = _FakeCursor()
            return [op(cursor) for op in operations]

        def fake_query(sql, params=None):
            if "FROM tabProtocolos" in sql:
                return [{"NroProtocolo": 1234, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in sql:
                return [
                    {
                        "ID": 43,
                        "NroProtocolo": 1234,
                        "AnoProtocolo": 2026,
                        "TipoJob": "create",
                        "Produto": "Ct Visita",
                        "ModeloID": 1,
                        "ArquivoModelo": "CtVisitaFV.cdr",
                        "DadosJson": json.dumps(
                            {"nome_deputado": "Samuel Viana", "email": "a@b.com"}
                        ),
                        "Status": "pending",
                        "Prioridade": 0,
                        "OrdemFila": 1,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": None,
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "Erro": None,
                        "Tentativas": 0,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            if "MAX(OrdemFila)" in sql:
                return [{"next_pos": 1}]
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc.db, "execute_transaction", fake_transaction)
        with patch.object(svc, "broadcast_job_update"), patch(
            "services.papelaria_models_service.is_papelaria_os_by_product",
            return_value=True,
        ), patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ):
            job = svc.create_job(
                ano=2026,
                nro=1234,
                modelo_id=1,
                dados={"nome_deputado": "Samuel Viana", "email": "a@b.com"},
                solicitado_por="918713",
            )

        assert job["id"] == 43
        assert job["nro_protocolo"] == 1234

    def test_bloqueia_os_menor_5000_sem_produto_papelaria(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        with patch(
            "services.papelaria_models_service.is_papelaria_os_by_product",
            return_value=False,
        ):
            with pytest.raises(
                ValueError,
                match="OS de papelaria deve ter número >= 5000 ou possuir produto de papelaria configurado",
            ):
                svc.create_job(
                    ano=2026,
                    nro=1234,
                    modelo_id=1,
                    dados={"nome_deputado": "Samuel Viana", "email": "a@b.com"},
                    solicitado_por="918713",
                )

    def test_credenciais_depol_aceita_os_menor_5000(self, monkeypatch):
        """DEPOL não exige faixa/produto de papelaria — só OS existente."""
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "next_queue_position", lambda: 1)
        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"NroProtocolo": 1234, "AnoProtocolo": 2026, "produto": "Outro"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        monkeypatch.setattr(svc.db, "execute_transaction", lambda ops: [99])
        monkeypatch.setattr(
            svc,
            "get_job",
            lambda job_id: {
                "id": job_id,
                "nro_protocolo": 1234,
                "ano_protocolo": 2026,
                "tipo_job": "credenciais_depol",
                "produto": "Credenciais DEPOL",
                "status": "pending",
            },
        )
        monkeypatch.setattr(svc, "append_job_log", lambda *a, **k: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)

        with patch(
            "services.papelaria_models_service.is_papelaria_os_by_product",
            return_value=False,
        ) as mock_papelaria:
            job = svc.create_credenciais_depol_job(
                ano=2026,
                nro=1234,
                dados={
                    "itens": [
                        {
                            "modelo_arquivo": "a.jpg",
                            "linha1": "X",
                            "num_linhas": 1,
                            "svg_arquivo": "TXT01.svg",
                        }
                    ]
                },
                solicitado_por="918713",
            )

        assert job["id"] == 99
        assert job["tipo_job"] == "credenciais_depol"
        mock_papelaria.assert_not_called()


class TestListAndCancel:
    def _job_row(self, job_id: int = 1, status: str = "pending", nro: int = 5954):
        return {
            "ID": job_id,
            "NroProtocolo": nro,
            "AnoProtocolo": 2026,
            "TipoJob": "create",
            "Produto": "Ct Visita",
            "ModeloID": 1,
            "ArquivoModelo": "CtVisitaFV.cdr",
            "DadosJson": "{}",
            "Status": status,
            "Prioridade": 0,
            "OrdemFila": 1,
            "SolicitadoPor": "918713",
            "SolicitadoEm": None,
            "IniciadoEm": None,
            "ConcluidoEm": None,
            "WorkerID": None,
            "ArquivoCdrGerado": None,
            "ArquivoPdfGerado": None,
            "Erro": None,
            "Tentativas": 0,
            "Versao": 1,
            "JobPaiID": None,
        }

    def test_lista_jobs_da_os(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [self._job_row(2), self._job_row(1)]
                if "AnoProtocolo" in sql and "tabPapelariaJobs" in sql
                else []
            ),
        )
        jobs = svc.list_jobs_for_os(2026, 5954)
        assert len(jobs) == 2
        assert jobs[0]["id"] == 2

    def test_lista_jobs_os_menor_5000(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [self._job_row(3, nro=1234)]
                if "AnoProtocolo" in sql and "tabPapelariaJobs" in sql
                else []
            ),
        )
        jobs = svc.list_jobs_for_os(2026, 1234)
        assert len(jobs) == 1
        assert jobs[0]["nro_protocolo"] == 1234

    def test_cancela_pending(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        state = {"status": "pending"}

        def fake_query(sql, params=None):
            if "UPDATE tabPapelariaJobs" in sql:
                state["status"] = "cancelled"
                return []
            if "SELECT * FROM tabPapelariaJobs" in sql:
                return [self._job_row(5, state["status"])]
            if "INSERT INTO tabPapelariaJobLog" in sql:
                return []
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        with patch.object(svc, "broadcast_job_update"):
            job = svc.cancel_job(5, "918713")
        assert job["status"] == "cancelled"

    def test_heartbeat_sinaliza_job_cancelado(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "is_job_cancelled", lambda job_id: job_id == 9)
        out = svc.record_worker_heartbeat("corel-ws-01", {"processing_job_id": 9})
        assert out["cancelled_job_id"] == 9

    def test_cancela_processing(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        state = {"status": "processing"}

        def fake_query(sql, params=None):
            if "UPDATE tabPapelariaJobs" in sql:
                state["status"] = "cancelled"
                return []
            if "SELECT Status FROM tabPapelariaJobs" in sql:
                return [{"Status": state["status"]}]
            if "SELECT * FROM tabPapelariaJobs" in sql:
                return [self._job_row(5, state["status"])]
            if "INSERT INTO tabPapelariaJobLog" in sql:
                return []
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        with patch.object(svc, "broadcast_job_update"):
            job = svc.cancel_job(5, "918713")
        assert job["status"] == "cancelled"

    def test_impede_cancelar_completed(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [self._job_row(5, "completed")]
                if "SELECT * FROM tabPapelariaJobs" in sql
                else []
            ),
        )
        with pytest.raises(ValueError, match="não pode ser cancelado"):
            svc.cancel_job(5, "918713")


class TestMovePendingQueue:
    def _job_row(self, job_id: int = 1, status: str = "pending", ordem: int = 1):
        row = TestListAndCancel._job_row(self, job_id, status)
        row["OrdemFila"] = ordem
        return row

    def test_move_up_troca_ordem(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        state = {
            "orders": {10: 1, 11: 2},
            "status": {10: "pending", 11: "pending"},
        }

        def fake_query(sql, params=None):
            text = sql.strip()
            if "SELECT ID FROM tabPapelariaJobs" in text and "COALESCE" in text:
                return [{"ID": 10}, {"ID": 11}]
            if "SELECT ID, OrdemFila FROM tabPapelariaJobs" in text:
                return [
                    {"ID": 10, "OrdemFila": state["orders"][10]},
                    {"ID": 11, "OrdemFila": state["orders"][11]},
                ]
            if "UPDATE tabPapelariaJobs" in text and params:
                jid = int(params["id"])
                state["orders"][jid] = int(params["ordem"])
                return []
            if "SELECT * FROM tabPapelariaJobs" in text and params:
                jid = int(params["id"])
                return [self._job_row(jid, state["status"][jid], state["orders"][jid])]
            if "INSERT INTO tabPapelariaJobLog" in text:
                return []
            return []

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)

        job = svc.move_pending_job(11, "up", "admin:918713")
        assert state["orders"][11] == 1
        assert state["orders"][10] == 2
        assert job["id"] == 11

    def test_move_pending_invalido(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(
            svc,
            "normalize_pending_queue_orders",
            lambda: None,
        )
        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"ID": 10, "OrdemFila": 1}]
                if "SELECT ID, OrdemFila" in sql
                else []
            ),
        )
        with pytest.raises(ValueError, match="pending"):
            svc.move_pending_job(99, "up", "admin:918713")


class TestAdminWorkerQueue:
    def _job_row(self, job_id: int = 1, status: str = "pending"):
        return TestListAndCancel._job_row(self, job_id, status)

    def test_snapshot_fila_e_totais(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        def fake_query(sql, params=None):
            text = sql.strip()
            if "GROUP BY Status" in text:
                return [
                    {"Status": "pending", "total": 2},
                    {"Status": "processing", "total": 1},
                    {"Status": "completed", "total": 5},
                ]
            if "Status IN" in text and params:
                if "completed" in params:
                    return [self._job_row(3, "completed")]
                return [
                    self._job_row(9, "processing"),
                    self._job_row(8, "pending"),
                ]
            return []

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc, "recover_stale_processing_jobs", lambda: [])
        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(
            svc,
            "list_worker_heartbeats",
            lambda: [
                {
                    "worker_id": "corel-ws-01",
                    "heartbeat_em": "2026-06-10 18:00:00",
                    "online": True,
                    "seconds_since_heartbeat": 3,
                }
            ],
        )

        snap = svc.get_admin_worker_queue_snapshot()
        assert snap["totais"]["pending"] == 2
        assert snap["totais"]["processing"] == 1
        assert snap["totais"]["completed"] == 5
        assert len(snap["fila"]) == 2
        assert snap["fila"][0]["status"] == "processing"
        assert snap["workers_online"] == 1
        assert snap["recentes"][0]["id"] == 3


class TestQueuePosition:
    def test_next_queue_position(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [{"next_pos": 7}],
        )
        assert svc.next_queue_position() == 7


class TestRecoverStaleProcessing:
    def test_startup_reenfileira_jobs_do_worker(self, monkeypatch):
        from datetime import datetime, timedelta

        from services import papelaria_jobs_service as svc

        updates: list[str] = []

        def fake_query(sql, params=None):
            text = sql.strip()
            if "SELECT ID FROM tabPapelariaJobs" in text and "WorkerID" in text:
                return [{"ID": 9}]
            if "SELECT ID, Status, WorkerID, IniciadoEm" in text:
                return [
                    {
                        "ID": 9,
                        "Status": "processing",
                        "WorkerID": "corel-ws-01",
                        "IniciadoEm": datetime.now() - timedelta(minutes=5),
                    }
                ]
            if "UPDATE tabPapelariaJobs" in text and "pending" in text:
                updates.append("requeue")
                return []
            if "SELECT ID FROM tabPapelariaJobs WHERE ID" in text and params:
                if params.get("pending") == "pending":
                    return [{"ID": params["id"]}]
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in text:
                return [
                    {
                        "ID": 9,
                        "NroProtocolo": 5024,
                        "AnoProtocolo": 2025,
                        "TipoJob": "create",
                        "Produto": "Ct Visita",
                        "ModeloID": 1,
                        "ArquivoModelo": "Ct.cdr",
                        "DadosJson": "{}",
                        "Status": "pending",
                        "Prioridade": 0,
                        "OrdemFila": 1,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": None,
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "Erro": "Worker reiniciado",
                        "Tentativas": 1,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            if "INSERT INTO tabPapelariaJobLog" in text:
                return []
            return []

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)

        result = svc.record_worker_heartbeat("corel-ws-01", {"event": "startup"})

        assert result["requeued_jobs"] == [9]
        assert updates

    def test_recupera_job_sem_heartbeat_recente(self, monkeypatch):
        from datetime import datetime, timedelta

        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "_worker_heartbeat_stale_seconds", lambda: 60)
        monkeypatch.setattr(svc, "_is_worker_recently_alive", lambda _w, **_k: False)
        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)
        monkeypatch.setattr(svc, "append_job_log", lambda *a, **k: None)

        calls: list[str] = []

        def fake_query(sql, params=None):
            text = sql.strip()
            if "SELECT ID, Status, WorkerID, IniciadoEm" in text:
                return [
                    {
                        "ID": 3,
                        "Status": "processing",
                        "WorkerID": "corel-ws-01",
                        "IniciadoEm": datetime.now() - timedelta(seconds=90),
                    }
                ]
            if "UPDATE tabPapelariaJobs" in text and "pending" in text:
                calls.append("requeue")
                return []
            if "SELECT ID FROM tabPapelariaJobs WHERE ID" in text:
                return [{"ID": 3}]
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in text:
                return [
                    {
                        "ID": 3,
                        "NroProtocolo": 5024,
                        "AnoProtocolo": 2025,
                        "TipoJob": "create",
                        "Produto": "Ct Visita",
                        "ModeloID": 1,
                        "ArquivoModelo": "Ct.cdr",
                        "DadosJson": "{}",
                        "Status": "pending",
                        "Prioridade": 0,
                        "OrdemFila": 1,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": None,
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "Erro": "Worker interrompido",
                        "Tentativas": 1,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)

        assert svc.maybe_recover_processing_job(3) is True
        assert calls

    def test_recupera_job_sem_resposta_em_30s(self, monkeypatch):
        from datetime import datetime, timedelta

        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "_job_stall_seconds", lambda: 30)
        monkeypatch.setattr(svc, "_is_worker_recently_alive", lambda _w, **_k: False)
        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)
        monkeypatch.setattr(svc, "append_job_log", lambda *a, **k: None)

        calls: list[str] = []

        def fake_query(sql, params=None):
            text = sql.strip()
            if "SELECT ID, Status, WorkerID, IniciadoEm" in text:
                return [
                    {
                        "ID": 7,
                        "Status": "processing",
                        "WorkerID": "corel-ws-02",
                        "IniciadoEm": datetime.now() - timedelta(seconds=35),
                    }
                ]
            if "UPDATE tabPapelariaJobs" in text and "pending" in text:
                calls.append("requeue")
                return []
            if "SELECT ID FROM tabPapelariaJobs WHERE ID" in text:
                return [{"ID": 7}]
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in text:
                return [
                    {
                        "ID": 7,
                        "NroProtocolo": 5024,
                        "AnoProtocolo": 2025,
                        "TipoJob": "create",
                        "Produto": "Ct Visita",
                        "ModeloID": 1,
                        "ArquivoModelo": "Ct.cdr",
                        "DadosJson": "{}",
                        "Status": "pending",
                        "Prioridade": 0,
                        "OrdemFila": 1,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": None,
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "Erro": "Worker não respondeu",
                        "Tentativas": 1,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)

        assert svc.maybe_recover_processing_job(7) is True
        assert calls

    def test_heartbeat_sinaliza_job_redirecionado(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc, "_persist_worker_heartbeat", lambda *a, **k: None)
        monkeypatch.setattr(svc, "maybe_recover_processing_job", lambda _id: False)
        monkeypatch.setattr(
            svc,
            "get_job",
            lambda job_id, recover_stale=False: {
                "id": job_id,
                "status": "pending",
                "worker_id": None,
                "erro": "Job redirecionado para outro worker.",
            },
        )
        monkeypatch.setattr(svc, "is_job_cancelled", lambda _id: False)

        result = svc.record_worker_heartbeat(
            "corel-ws-01",
            {"processing_job_id": 12},
        )

        assert result["cancelled_job_id"] == 12
        assert "redirecionado" in (result.get("cancelled_reason") or "").lower()


class TestFleetLoadBalance:
    def setup_method(self):
        from services import papelaria_jobs_service as svc

        svc._worker_heartbeats.clear()
        svc._worker_meta.clear()

    def test_worker_sem_metricas_elegivel(self):
        from services import papelaria_jobs_service as svc

        assert svc._worker_eligible_for_claim("w1") is True

    def test_worker_mais_leve_elegivel(self):
        from datetime import datetime

        from services import papelaria_jobs_service as svc

        now = datetime.now()
        svc._worker_heartbeats["light"] = now
        svc._worker_meta["light"] = {
            "system_load": {"cpu_percent": 10, "memory_percent": 20, "score": 15}
        }
        svc._worker_heartbeats["heavy"] = now
        svc._worker_meta["heavy"] = {
            "system_load": {"cpu_percent": 90, "memory_percent": 85, "score": 87.5}
        }
        assert svc._worker_eligible_for_claim("light") is True
        assert svc._worker_eligible_for_claim("heavy") is False

    def test_list_worker_heartbeats_inclui_carga(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        stored: dict[str, dict] = {}

        def fake_query(sql, params=None):
            text = sql.upper()
            if "TABPAPELARIAWORKERHEARTBEAT" not in text:
                return []
            if "INSERT" in text and params:
                stored[params["wid"]] = {
                    "WorkerID": params["wid"],
                    "HeartbeatEm": params["heartbeat_em"],
                    "MetaJson": params["meta"],
                }
                return []
            if "SELECT" in text:
                return list(stored.values())
            return []

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc.db, "execute_query", fake_query)

        svc.record_worker_heartbeat(
            "corel-ws-01",
            {"system_load": {"cpu_percent": 22, "memory_percent": 48, "score": 35}},
        )
        workers = svc.list_worker_heartbeats()
        assert workers[0]["cpu_percent"] == 22.0
        assert workers[0]["memory_percent"] == 48.0
        assert workers[0]["load_score"] == 35.0

    def test_claim_bloqueado_para_worker_pesado(self, monkeypatch):
        from datetime import datetime

        from services import papelaria_jobs_service as svc

        now = datetime.now()
        svc._worker_heartbeats["light"] = now
        svc._worker_meta["light"] = {
            "system_load": {"cpu_percent": 5, "memory_percent": 10, "score": 7.5}
        }
        svc._worker_heartbeats["heavy"] = now
        svc._worker_meta["heavy"] = {
            "system_load": {"cpu_percent": 95, "memory_percent": 90, "score": 92.5}
        }

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc, "recover_stale_processing_jobs", lambda: None)

        assert svc.claim_next_job("heavy") is None

    def test_claim_falha_payload_marca_job_failed(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        job_state = {
            "id": 42,
            "status": svc.STATUS_PROCESSING,
            "worker_id": "corel-ws-01",
            "tentativas": 1,
            "erro": None,
        }
        updates: list[dict] = []

        monkeypatch.setattr(svc, "recover_stale_processing_jobs", lambda: None)
        monkeypatch.setattr(svc, "_worker_eligible_for_claim", lambda _wid: True)
        monkeypatch.setattr(svc.db, "execute_transaction", lambda _ops: [42])
        monkeypatch.setattr(svc, "append_job_log", lambda *a, **k: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)
        monkeypatch.setattr(
            svc,
            "build_worker_job_payload",
            lambda _id: (_ for _ in ()).throw(
                LookupError("Pasta da OS não encontrada na rede.")
            ),
        )

        def fake_get(job_id, include_logs=False, recover_stale=True):
            assert job_id == 42
            return dict(job_state)

        def fake_query(sql, params=None):
            text = (sql or "").upper()
            if "UPDATE" in text and "TABPAPELARIAJOBS" in text and params:
                updates.append(dict(params))
                if params.get("status") == svc.STATUS_FAILED:
                    job_state["status"] = svc.STATUS_FAILED
                    job_state["erro"] = params.get("erro")
                return []
            return []

        monkeypatch.setattr(svc, "get_job", fake_get)
        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc, "is_job_cancelled", lambda _id: False)

        with pytest.raises(LookupError, match="Pasta da OS não encontrada"):
            svc.claim_next_job("corel-ws-01")

        assert job_state["status"] == svc.STATUS_FAILED
        assert job_state["erro"] == "Pasta da OS não encontrada na rede."
        assert any(u.get("status") == svc.STATUS_FAILED for u in updates)


class TestExtractProvaVersion:
    def test_extrai_prova_sefoc_novo_padrao(self):
        from services.papelaria_jobs_service import extract_prova_version_from_filename

        assert (
            extract_prova_version_from_filename(
                "05024-JonasDonizette-CtVisita-ProvaSefoc 3.pdf"
            )
            == 3
        )

    def test_extrai_prova_sefoc_legado(self):
        from services.papelaria_jobs_service import extract_prova_version_from_filename

        assert extract_prova_version_from_filename("05024-Prova2_SEFOC.pdf") == 2


class TestProvaReview:
    def _job_dict(self, **overrides):
        base = {
            "id": 99,
            "nro_protocolo": 5954,
            "ano_protocolo": 2026,
            "tipo_job": "create",
            "produto": "Ct Visita",
            "modelo_id": 1,
            "arquivo_modelo": "Ct.cdr",
            "dados": {},
            "status": "completed",
            "prioridade": 0,
            "ordem_fila": 1,
            "solicitado_por": "918.713",
            "solicitado_em": None,
            "iniciado_em": None,
            "concluido_em": None,
            "worker_id": "w1",
            "arquivo_cdr": "Base.cdr",
            "arquivo_pdf": "05024-Nome-ProvaSefoc 2.pdf",
            "erro": None,
            "tentativas": 0,
            "versao": 1,
            "job_pai_id": None,
            "tem_arquivo_pdf": True,
            "tem_arquivo_cdr": True,
            "prova_revisao": "pending",
        }
        base.update(overrides)
        return base

    def _job_row(self, **overrides):
        base = {
            "ID": 99,
            "NroProtocolo": 5954,
            "AnoProtocolo": 2026,
            "TipoJob": "create",
            "Produto": "Ct Visita",
            "ModeloID": 1,
            "ArquivoModelo": "Ct.cdr",
            "DadosJson": "{}",
            "Status": "completed",
            "Prioridade": 0,
            "OrdemFila": 1,
            "SolicitadoPor": "918.713",
            "SolicitadoEm": None,
            "IniciadoEm": None,
            "ConcluidoEm": None,
            "WorkerID": "w1",
            "ArquivoCdrGerado": "Base.cdr",
            "ArquivoPdfGerado": "05024-Nome-ProvaSefoc 2.pdf",
            "ProvaRevisao": "pending",
            "Erro": None,
            "Tentativas": 0,
            "Versao": 1,
            "JobPaiID": None,
        }
        base.update(overrides)
        return base

    def test_discard_remove_pdf_e_marca_descartada(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        pdf_name = "05024-Nome-ProvaSefoc 2.pdf"
        pdf_path = sefoc / pdf_name
        pdf_path.write_bytes(b"%PDF")

        job_state = self._job_dict()
        removed = {"pdf": False, "updated": False}

        def fake_get(job_id, include_logs=False, recover_stale=True):
            if int(job_id) != 99:
                return None
            return dict(job_state)

        def fake_resolve(ano, nro, create=False):
            return str(sefoc)

        def fake_query(sql, params=None):
            text = (sql or "").upper()
            if "UPDATE TABPAPELARIAJOBS" in text and params:
                if params.get("revisao") == svc.PROVA_REVISAO_DISCARDED:
                    job_state["arquivo_pdf"] = None
                    job_state["tem_arquivo_pdf"] = False
                    job_state["prova_revisao"] = svc.PROVA_REVISAO_DISCARDED
                    removed["updated"] = True
            return []

        monkeypatch.setattr(svc, "get_job", fake_get)
        monkeypatch.setattr(svc, "resolve_os_papelaria_dir", fake_resolve)
        monkeypatch.setattr(svc, "_cleanup_job_preview_cache", lambda _job: None)
        monkeypatch.setattr(svc, "append_job_log", lambda *_a, **_k: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *_a, **_k: None)
        monkeypatch.setattr(svc.db, "execute_query", fake_query)

        result = svc.discard_job_prova(99, "918.713")

        assert not pdf_path.exists()
        assert removed["updated"] is True
        assert result["prova_revisao"] == svc.PROVA_REVISAO_DISCARDED
        assert result["tem_arquivo_pdf"] is False

    def test_approve_registra_andamento_e_token(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        job_state = self._job_dict()
        calls: dict = {"movement": None, "token": None, "preview": False}

        def fake_get(job_id, include_logs=False, recover_stale=True):
            if int(job_id) != 99:
                return None
            return dict(job_state)

        def fake_transaction(ops):
            class _Cursor:
                rowcount = 1

                def execute(self, sql, params=None):
                    if "UPDATE tabPapelariaJobs" in sql:
                        job_state["prova_revisao"] = svc.PROVA_REVISAO_APPROVED

            cursor = _Cursor()
            return [ops[0](cursor)]

        def fake_add_movement(cursor, os_id, ano, situacao, setor, ponto, obs):
            calls["movement"] = (situacao, setor, obs)
            return "059542026-01"

        def fake_ensure_token(os_id, ano, versao, arquivo, ponto_envio=None):
            calls["token"] = (versao, arquivo, ponto_envio)
            return "tok-test"

        def fake_resolve_path(job_id, tipo):
            return ("/tmp/prova.pdf", "05024-Nome-ProvaSefoc 2.pdf")

        def fake_query(sql, params=None):
            if "tabProofTokens" in sql:
                return [{"ID": 7}]
            return []

        monkeypatch.setattr(svc, "get_job", fake_get)
        monkeypatch.setattr(svc.db, "execute_transaction", fake_transaction)
        monkeypatch.setattr(svc, "append_job_log", lambda *_a, **_k: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *_a, **_k: None)
        monkeypatch.setattr(svc, "resolve_job_file_path", fake_resolve_path)
        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(
            "routers.analise_routes.add_movement_internal",
            fake_add_movement,
        )
        monkeypatch.setattr(
            "routers.proof_portal_routes.ensure_proof_token",
            fake_ensure_token,
        )
        monkeypatch.setattr(
            "routers.mdb_writer.push_andamento_to_mdb_after_mysql",
            lambda *_a, **_k: None,
        )
        monkeypatch.setattr(
            "routers.realtime.broadcast_os_system_update",
            lambda *_a, **_k: None,
        )
        monkeypatch.setattr(
            "services.papelaria_preview_service.ensure_proof_preview_pages",
            lambda *_a, **_k: calls.update({"preview": True}),
        )

        result = svc.approve_job_prova(99, "918.713")

        assert calls["movement"] == ("Encam. de Docum.", "SEFOC", "Enviar Prova 2")
        assert calls["token"] == ("2", "05024-Nome-ProvaSefoc 2.pdf", "918.713")
        assert calls["preview"] is True
        assert result["prova_versao"] == 2
        assert result["job"]["prova_revisao"] == svc.PROVA_REVISAO_APPROVED


class TestExportExistingCdrJob:
    def test_falha_sem_cdr_na_pasta(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ), patch.object(
            svc,
            "select_os_usable_cdr",
            side_effect=FileNotFoundError("Corel não encontrado"),
        ):
            with pytest.raises(FileNotFoundError, match="Corel"):
                svc.create_export_existing_cdr_job(
                    ano=2026,
                    nro=5954,
                    modelo_id=1,
                    dados={},
                    solicitado_por="918713",
                )

    def test_cria_job_sem_validar_campos_obrigatorios(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        captured = {}

        class _FakeCursor:
            lastrowid = 55

            def execute(self, sql, params=None):
                captured["params"] = params

        def fake_transaction(operations):
            cursor = _FakeCursor()
            return [op(cursor) for op in operations]

        def fake_query(sql, params=None):
            if "FROM tabProtocolos" in sql:
                return [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in sql:
                return [
                    {
                        "ID": 55,
                        "NroProtocolo": 5954,
                        "AnoProtocolo": 2026,
                        "TipoJob": svc.TIPO_JOB_EXPORT_EXISTING_CDR,
                        "Produto": "Ct Visita",
                        "ModeloID": 1,
                        "ArquivoModelo": "CtVisitaFV.cdr",
                        "DadosJson": captured.get("params", {}).get("dados") or "{}",
                        "Status": "pending",
                        "Prioridade": 0,
                        "OrdemFila": 4,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": None,
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "Erro": None,
                        "Tentativas": 0,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            if "MAX(OrdemFila)" in sql:
                return [{"next_pos": 4}]
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc.db, "execute_transaction", fake_transaction)
        with patch.object(
            svc,
            "broadcast_job_update",
        ), patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ), patch.object(
            svc,
            "select_os_usable_cdr",
            return_value={
                "filename": "layout_pronto.cdr",
                "relative_path": "Sefoc/layout_pronto.cdr",
                "absolute_path": r"\\server\os\Sefoc\layout_pronto.cdr",
                "mtime": 1.0,
            },
        ):
            job = svc.create_export_existing_cdr_job(
                ano=2026,
                nro=5954,
                modelo_id=1,
                dados={},
                solicitado_por="918713",
                arquivo_cdr="Sefoc/layout_pronto.cdr",
            )

        assert job["id"] == 55
        assert job["tipo_job"] == svc.TIPO_JOB_EXPORT_EXISTING_CDR
        assert job["status"] == "pending"
        assert job["dados"][svc.INPUT_CDR_DADOS_KEY] == "Sefoc/layout_pronto.cdr"

    def test_recusa_cdr_fora_da_lista(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ), patch.object(
            svc,
            "list_os_usable_cdrs",
            return_value=[
                {
                    "filename": "layout_pronto.cdr",
                    "relative_path": "Sefoc/layout_pronto.cdr",
                    "absolute_path": r"\\server\os\Sefoc\layout_pronto.cdr",
                    "mtime": 1.0,
                }
            ],
        ):
            with pytest.raises(ValueError, match="não foi encontrado"):
                svc.create_export_existing_cdr_job(
                    ano=2026,
                    nro=5954,
                    modelo_id=1,
                    dados={},
                    solicitado_por="918713",
                    arquivo_cdr="Sefoc/outro.cdr",
                )

    def test_exige_escolha_quando_ha_varios_cdrs(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Ct Visita"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ), patch.object(
            svc,
            "list_os_usable_cdrs",
            return_value=[
                {
                    "filename": "a.cdr",
                    "relative_path": "Sefoc/a.cdr",
                    "absolute_path": r"\\server\os\Sefoc\a.cdr",
                    "mtime": 2.0,
                },
                {
                    "filename": "b.cdr",
                    "relative_path": "Sefoc/b.cdr",
                    "absolute_path": r"\\server\os\Sefoc\b.cdr",
                    "mtime": 1.0,
                },
            ],
        ):
            with pytest.raises(ValueError, match="mais de um arquivo Corel"):
                svc.create_export_existing_cdr_job(
                    ano=2026,
                    nro=5954,
                    modelo_id=1,
                    dados={},
                    solicitado_por="918713",
                )

    def test_build_worker_payload_usa_cdr_persistido(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        base = sefoc / "05024-Nome-BaseSefoc.cdr"
        base.write_bytes(b"std")
        chosen = sefoc / "layout_pronto.cdr"
        chosen.write_bytes(b"ok")

        job = {
            "id": 77,
            "ano_protocolo": 2026,
            "nro_protocolo": 5954,
            "tipo_job": svc.TIPO_JOB_EXPORT_EXISTING_CDR,
            "produto": "Ct Visita",
            "modelo_id": 1,
            "arquivo_modelo": "CtVisitaFV.cdr",
            "dados": {svc.INPUT_CDR_DADOS_KEY: "Sefoc/layout_pronto.cdr"},
            "tentativas": 0,
        }

        monkeypatch.setattr(svc, "get_job", lambda job_id: job if job_id == 77 else None)
        monkeypatch.setattr(
            svc,
            "resolve_os_papelaria_dir",
            lambda ano, nro, create=False: str(sefoc),
        )
        monkeypatch.setattr(svc, "get_os_folder_basename", lambda ano, nro: "05024-Nome")
        monkeypatch.setattr(
            "routers.os_routes._get_os_folder_path",
            lambda ano, nro: str(tmp_path),
        )
        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=MODEL_SAMPLE,
        ):
            payload = svc.build_worker_job_payload(77)

        assert payload["tipo_job"] == svc.TIPO_JOB_EXPORT_EXISTING_CDR
        assert payload["input_cdr_path"] == str(chosen.resolve())
        assert svc.INPUT_CDR_DADOS_KEY not in payload["dados"]
        assert payload["output_pdf_name"].endswith(".pdf")


class TestDiscoverOsCdr:
    def _mock_os_paths(self, monkeypatch, os_root, sefoc):
        from services import papelaria_jobs_service as svc

        os_root = sefoc.parent
        monkeypatch.setattr(
            "routers.os_routes._get_os_folder_path",
            lambda ano, nro: str(os_root),
        )
        monkeypatch.setattr(svc, "resolve_os_papelaria_dir", lambda ano, nro, create=False: str(sefoc))
        monkeypatch.setattr(svc, "get_os_folder_basename", lambda ano, nro: "05024-Nome")

    def test_encontra_cdr_com_nome_livre(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        (sefoc / "cartao_deputado.cdr").write_bytes(b"cdr")
        self._mock_os_paths(monkeypatch, tmp_path, sefoc)

        path = svc.discover_os_cdr_absolute_path(2026, 5954)
        assert path.endswith("cartao_deputado.cdr")

    def test_ignora_copia_de_seguranca(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        (sefoc / "05024-Nome-Cópia_de_segurança.cdr").write_bytes(b"bkp")
        (sefoc / "prova.cdr").write_bytes(b"cdr")
        self._mock_os_paths(monkeypatch, tmp_path, sefoc)

        path = svc.discover_os_cdr_absolute_path(2026, 5954)
        assert path.endswith("prova.cdr")

    def test_prefere_basesefoc_quando_existe(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        (sefoc / "outro.cdr").write_bytes(b"x")
        standard = sefoc / "05024-Nome-BaseSefoc.cdr"
        standard.write_bytes(b"std")
        self._mock_os_paths(monkeypatch, tmp_path, sefoc)

        path = svc.discover_os_cdr_absolute_path(2026, 5954)
        assert path == str(standard)

    def test_encontra_cdr_na_raiz_da_os(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        root_cdr = tmp_path / "layout.cdr"
        root_cdr.write_bytes(b"cdr")
        self._mock_os_paths(monkeypatch, tmp_path, sefoc)

        path = svc.discover_os_cdr_absolute_path(2026, 5954)
        assert path == str(root_cdr)

    def test_lista_varios_cdrs_e_payload_inclui_files(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        standard = sefoc / "05024-Nome-BaseSefoc.cdr"
        standard.write_bytes(b"std")
        (sefoc / "layout_pronto.cdr").write_bytes(b"ok")
        self._mock_os_paths(monkeypatch, tmp_path, sefoc)

        files = svc.list_os_usable_cdrs(2026, 5954)
        assert [item["filename"] for item in files] == [
            "05024-Nome-BaseSefoc.cdr",
            "layout_pronto.cdr",
        ]
        payload = svc.list_os_cdr_path_payload(2026, 5954)
        assert payload["filename"] == "05024-Nome-BaseSefoc.cdr"
        assert len(payload["files"]) == 2
        assert payload["files"][1]["relative_path"] == "Sefoc/layout_pronto.cdr"

    def test_select_usa_arquivo_informado(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        (sefoc / "05024-Nome-BaseSefoc.cdr").write_bytes(b"std")
        pronto = sefoc / "layout_pronto.cdr"
        pronto.write_bytes(b"ok")
        self._mock_os_paths(monkeypatch, tmp_path, sefoc)

        chosen = svc.select_os_usable_cdr(
            2026, 5954, arquivo_cdr="Sefoc/layout_pronto.cdr"
        )
        assert chosen["filename"] == "layout_pronto.cdr"
        assert chosen["absolute_path"] == str(pronto.resolve())


TIMBRADO_DIGITAL_MODEL = {
    "id": 24,
    "produto": "Timbrado A4 (Digital)",
    "frente_versao": "SF",
    "cores": "Policromia",
    "arquivo_modelo": "TimbradoA4.cdr",
    "campos": {
        "Cabecalho": "Gabinete {artigo} {genero_curto}\n{nome_deputado}",
        "Rodape": "{email}",
    },
    "campos_formulario": [
        {"key": "nome_deputado", "label": "Nome", "required": True, "type": "text"},
        {"key": "email", "label": "E-mail", "required": True, "type": "email"},
    ],
    "variaveis": [],
}


class TestTimbradoA4DigitalJob:
    def test_is_timbrado_a4_digital_produto(self):
        from services.papelaria_jobs_service import is_timbrado_a4_digital_produto

        assert is_timbrado_a4_digital_produto("Timbrado A4 (Digital)") is True
        assert is_timbrado_a4_digital_produto("timbrado a4 (digital)") is True
        assert is_timbrado_a4_digital_produto("Timbrado A4") is False
        assert is_timbrado_a4_digital_produto("Bloco A5") is False

    def test_rejeita_produto_nao_digital(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"NroProtocolo": 5954, "AnoProtocolo": 2026, "produto": "Timbrado A4"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=TIMBRADO_DIGITAL_MODEL,
        ):
            with pytest.raises(ValueError, match="Timbrado A4 \\(Digital\\)"):
                svc.create_timbrado_a4_digital_job(
                    ano=2026,
                    nro=5954,
                    modelo_id=24,
                    dados={"nome_deputado": "Ana", "email": "a@b.com"},
                    solicitado_por="918713",
                )

    def test_cria_job_digital(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        captured = {}

        class _FakeCursor:
            lastrowid = 88

            def execute(self, sql, params=None):
                captured["params"] = params

        def fake_transaction(operations):
            cursor = _FakeCursor()
            return [op(cursor) for op in operations]

        def fake_query(sql, params=None):
            if "FROM tabProtocolos" in sql:
                return [
                    {
                        "NroProtocolo": 5954,
                        "AnoProtocolo": 2026,
                        "produto": "Timbrado A4 (Digital)",
                    }
                ]
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in sql:
                return [
                    {
                        "ID": 88,
                        "NroProtocolo": 5954,
                        "AnoProtocolo": 2026,
                        "TipoJob": svc.TIPO_JOB_TIMBRADO_A4_DIGITAL,
                        "Produto": "Timbrado A4 (Digital)",
                        "ModeloID": 24,
                        "ArquivoModelo": "TimbradoA4.cdr",
                        "DadosJson": captured.get("params", {}).get("dados") or "{}",
                        "Status": "pending",
                        "Prioridade": 0,
                        "OrdemFila": 9,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": None,
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "ProvaRevisao": None,
                        "Erro": None,
                        "Tentativas": 0,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            if "MAX(OrdemFila)" in sql:
                return [{"next_pos": 9}]
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc.db, "execute_transaction", fake_transaction)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda job: None)
        monkeypatch.setattr(svc, "append_job_log", lambda *a, **k: None)

        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=TIMBRADO_DIGITAL_MODEL,
        ):
            job = svc.create_timbrado_a4_digital_job(
                ano=2026,
                nro=5954,
                modelo_id=24,
                dados={"nome_deputado": "Ana", "email": "a@b.com"},
                solicitado_por="918713",
            )

        assert job["tipo_job"] == svc.TIPO_JOB_TIMBRADO_A4_DIGITAL
        assert captured["params"]["tipo"] == svc.TIPO_JOB_TIMBRADO_A4_DIGITAL

    def test_complete_sem_prova_revisao_pending(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        digital = sefoc / "Digital"
        digital.mkdir()
        prefix = "05954-Pasta"
        names = [
            f"{prefix}-TimbradoA4Digital-Cor.docx",
            f"{prefix}-TimbradoA4Digital-PB.docx",
        ]
        for name in names:
            (digital / name).write_bytes(b"ok")

        updates = {}

        def fake_query(sql, params=None):
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in sql:
                status = updates.get("status", "processing")
                dados = updates.get(
                    "dados",
                    json.dumps({"nome_deputado": "Ana", "email": "a@b.com"}),
                )
                return [
                    {
                        "ID": 88,
                        "NroProtocolo": 5954,
                        "AnoProtocolo": 2026,
                        "TipoJob": svc.TIPO_JOB_TIMBRADO_A4_DIGITAL,
                        "Produto": "Timbrado A4 (Digital)",
                        "ModeloID": 24,
                        "ArquivoModelo": "TimbradoA4.cdr",
                        "DadosJson": dados,
                        "Status": status,
                        "Prioridade": 0,
                        "OrdemFila": 9,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": "corel-test",
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "ProvaRevisao": updates.get("prova", None),
                        "Erro": None,
                        "Tentativas": 1,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            if "UPDATE tabPapelariaJobs" in sql:
                updates["status"] = params["status"]
                updates["prova"] = params["prova_revisao"]
                updates["dados"] = params["dados"]
                return []
            if "INSERT INTO tabPapelariaJobLog" in sql:
                return []
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda job: None)
        monkeypatch.setattr(svc, "is_job_cancelled", lambda job_id: False)
        monkeypatch.setattr(
            svc,
            "resolve_os_papelaria_dir",
            lambda ano, nro, create=True: str(sefoc),
        )
        monkeypatch.setattr(
            svc,
            "get_os_folder_basename",
            lambda ano, nro: prefix,
        )
        movements: list[dict] = []

        def fake_add(cursor, nro, ano, situacao, setor, ponto, obs):
            movements.append(
                {
                    "nro": nro,
                    "ano": ano,
                    "situacao": situacao,
                    "setor": setor,
                    "ponto": ponto,
                    "obs": obs,
                }
            )
            return "ok"

        monkeypatch.setattr(
            "routers.analise_routes.add_movement_internal",
            fake_add,
        )
        monkeypatch.setattr(
            svc.db,
            "execute_transaction",
            lambda ops: [op(object()) for op in ops],
        )

        updated = svc.complete_job(
            job_id=88,
            worker_id="corel-test",
            arquivo_cdr="",
            arquivo_pdf="",
            artefatos=names,
            log_resumo="OK digital",
        )
        assert updated["status"] == "completed"
        assert updated["prova_revisao"] == svc.PROVA_REVISAO_NA
        assert updated["artefatos"] == names
        assert updated["tem_arquivo_pdf"] is False
        assert len(movements) == 1
        assert movements[0]["situacao"] == svc.SITUACAO_ENCAM_DOCUM
        assert movements[0]["setor"] == svc.SETOR_SEFOC
        assert movements[0]["obs"] == svc.OBS_ENVIAR_TIMBRADO_DIGITAL
        assert movements[0]["ponto"] == "918713"

    def test_complete_aceita_docx_sem_svg(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        digital = sefoc / "Digital"
        digital.mkdir()
        prefix = "05954-Pasta"
        docx_names = [
            f"{prefix}-TimbradoA4Digital-Cor.docx",
            f"{prefix}-TimbradoA4Digital-PB.docx",
        ]
        for name in docx_names:
            (digital / name).write_bytes(b"docx")

        updates = {}

        def fake_query(sql, params=None):
            if "SELECT * FROM tabPapelariaJobs WHERE ID" in sql:
                status = updates.get("status", "processing")
                dados = updates.get("dados", "{}")
                return [
                    {
                        "ID": 89,
                        "NroProtocolo": 5954,
                        "AnoProtocolo": 2026,
                        "TipoJob": svc.TIPO_JOB_TIMBRADO_A4_DIGITAL,
                        "Produto": "Timbrado A4 (Digital)",
                        "ModeloID": 24,
                        "ArquivoModelo": "TimbradoA4.cdr",
                        "DadosJson": dados,
                        "Status": status,
                        "Prioridade": 0,
                        "OrdemFila": 9,
                        "SolicitadoPor": "918713",
                        "SolicitadoEm": None,
                        "IniciadoEm": None,
                        "ConcluidoEm": None,
                        "WorkerID": "corel-test",
                        "ArquivoCdrGerado": None,
                        "ArquivoPdfGerado": None,
                        "ProvaRevisao": updates.get("prova", None),
                        "Erro": None,
                        "Tentativas": 1,
                        "Versao": 1,
                        "JobPaiID": None,
                    }
                ]
            if "UPDATE tabPapelariaJobs" in sql:
                updates["status"] = params["status"]
                updates["prova"] = params["prova_revisao"]
                updates["dados"] = params["dados"]
                return []
            if "INSERT INTO tabPapelariaJobLog" in sql:
                return []
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda job: None)
        monkeypatch.setattr(svc, "is_job_cancelled", lambda job_id: False)
        monkeypatch.setattr(
            svc,
            "resolve_os_papelaria_dir",
            lambda ano, nro, create=True: str(sefoc),
        )
        monkeypatch.setattr(
            svc,
            "get_os_folder_basename",
            lambda ano, nro: prefix,
        )
        monkeypatch.setattr(
            "routers.analise_routes.add_movement_internal",
            lambda *a, **k: "ok",
        )
        monkeypatch.setattr(
            svc.db,
            "execute_transaction",
            lambda ops: [op(object()) for op in ops],
        )

        updated = svc.complete_job(
            job_id=89,
            worker_id="corel-test",
            arquivo_cdr="",
            arquivo_pdf="",
            artefatos=docx_names,
        )
        assert updated["status"] == "completed"
        assert set(updated["artefatos"]) == set(docx_names)
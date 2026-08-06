"""Testes — endpoints e serviço do worker Papelaria."""
from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from security.api_auth import APIAccessMiddleware


WORKER_SECRET = "test-worker-secret-value-32chars"


@pytest.fixture
def worker_env(monkeypatch):
    monkeypatch.setenv("SAGRA_PAPELARIA_WORKER_SECRET", WORKER_SECRET)


@pytest.fixture
def worker_client(worker_env):
    from routers import papelaria_worker_routes

    app = FastAPI()
    app.add_middleware(APIAccessMiddleware)
    app.include_router(papelaria_worker_routes.router, prefix="/api")
    return TestClient(app)


def _headers():
    return {"X-Sagra-Worker-Secret": WORKER_SECRET}


class TestWorkerAuth:
    def test_worker_path_normaliza_prefixo_sagra(self):
        from security.papelaria_worker_auth import is_papelaria_worker_path

        assert is_papelaria_worker_path(
            "/sagra/api/papelaria/worker/inspect/claim", "POST"
        )
        assert is_papelaria_worker_path("/sagra/api/papelaria/jobs/claim", "POST")

    def test_sem_secret_recebe_401(self, worker_client):
        res = worker_client.post(
            "/api/papelaria/worker/heartbeat",
            json={"worker_id": "w1"},
        )
        assert res.status_code == 401

    def test_secret_invalido_recebe_401(self, worker_client):
        res = worker_client.post(
            "/api/papelaria/worker/heartbeat",
            json={"worker_id": "w1"},
            headers={"X-Sagra-Worker-Secret": "errado"},
        )
        assert res.status_code == 401

    def test_heartbeat_com_secret_ok(self, worker_client):
        res = worker_client.post(
            "/api/papelaria/worker/heartbeat",
            json={"worker_id": "corel-ws-01", "meta": {"v": 1}},
            headers=_headers(),
        )
        assert res.status_code == 200
        assert res.json()["worker_id"] == "corel-ws-01"

    def test_inspect_claim_sem_secret_recebe_401(self, worker_client):
        res = worker_client.post(
            "/api/papelaria/worker/inspect/claim",
            json={"worker_id": "corel-ws-01"},
        )
        assert res.status_code == 401

    def test_heartbeat_com_prefixo_sagra_api(self, worker_env):
        """Simula Nginx (/sagra/api) antes do rewrite interno para /api."""
        from routers import papelaria_worker_routes
        from routers.api import SagraApiPrefixMiddleware

        app = FastAPI()
        app.add_middleware(SagraApiPrefixMiddleware)
        app.add_middleware(APIAccessMiddleware)
        app.include_router(papelaria_worker_routes.router, prefix="/api")
        client = TestClient(app)
        res = client.post(
            "/sagra/api/papelaria/worker/heartbeat",
            json={"worker_id": "corel-ws-01", "meta": {"v": 1}},
            headers=_headers(),
        )
        assert res.status_code == 200
        assert res.json()["worker_id"] == "corel-ws-01"

    def test_inspect_claim_com_prefixo_sagra_api(self, worker_env):
        from routers import papelaria_worker_routes
        from routers.api import SagraApiPrefixMiddleware

        app = FastAPI()
        app.add_middleware(SagraApiPrefixMiddleware)
        app.add_middleware(APIAccessMiddleware)
        app.include_router(papelaria_worker_routes.router, prefix="/api")
        client = TestClient(app)
        res = client.post(
            "/sagra/api/papelaria/worker/inspect/claim",
            json={"worker_id": "corel-ws-01"},
            headers=_headers(),
        )
        assert res.status_code == 200

    def test_download_inspect_cdr_exige_secret(self, worker_client):
        res = worker_client.get(
            "/api/papelaria/worker/inspect/abc123/cdr",
            params={"worker_id": "corel-ws-01"},
        )
        assert res.status_code == 401

    def test_download_inspect_cdr_ok(self, worker_client, tmp_path, monkeypatch):
        from services import papelaria_cdr_inspect_service as inspect_svc

        token = "a" * 32
        cdr = tmp_path / f"{token}.cdr"
        cdr.write_bytes(b"RIFF")
        monkeypatch.setattr(
            inspect_svc,
            "resolve_inspect_cdr_for_worker",
            lambda tid, wid: (cdr, "Modelo.cdr"),
        )
        res = worker_client.get(
            f"/api/papelaria/worker/inspect/{token}/cdr",
            params={"worker_id": "corel-ws-01"},
            headers=_headers(),
        )
        assert res.status_code == 200
        assert res.content == b"RIFF"


class TestWorkerClaimComplete:
    def _job_row(self, job_id: int = 10, status: str = "pending"):
        return {
            "ID": job_id,
            "NroProtocolo": 5954,
            "AnoProtocolo": 2026,
            "TipoJob": "create",
            "Produto": "Ct Visita",
            "ModeloID": 1,
            "ArquivoModelo": "CtVisitaFV.cdr",
            "DadosJson": json.dumps({"nome_deputado": "João", "gabinete": "123"}),
            "Status": status,
            "Prioridade": 0,
            "OrdemFila": 1,
            "SolicitadoPor": "918713",
            "SolicitadoEm": None,
            "IniciadoEm": None,
            "ConcluidoEm": None,
            "WorkerID": "corel-ws-01" if status == "processing" else None,
            "ArquivoCdrGerado": None,
            "ArquivoPdfGerado": None,
            "Erro": None,
            "Tentativas": 1 if status == "processing" else 0,
            "Versao": 1,
            "JobPaiID": None,
        }

    def test_claim_atomico_pending_para_processing(self, worker_client, monkeypatch):
        from services import papelaria_jobs_service as svc

        claimed = {"ok": False}

        def fake_transaction(_ops):
            claimed["ok"] = True
            return [10]

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc, "_tables_ready", True)
        monkeypatch.setattr(svc.db, "execute_transaction", fake_transaction)
        monkeypatch.setattr(svc, "append_job_log", lambda *a, **k: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)

        modelo = {
            "id": 1,
            "produto": "Ct Visita",
            "cores": "Policromia",
            "campos": {"Nome": "{nome_deputado}"},
            "campos_formulario": [],
            "arquivo_modelo": "CtVisitaFV.cdr",
        }

        with patch(
            "services.papelaria_models_service.get_modelo_by_id",
            return_value=modelo,
        ), patch.object(
            svc,
            "get_job",
            side_effect=lambda jid, **kw: {
                "id": 10,
                "nro_protocolo": 5954,
                "ano_protocolo": 2026,
                "tipo_job": "create",
                "produto": "Ct Visita",
                "modelo_id": 1,
                "arquivo_modelo": "CtVisitaFV.cdr",
                "dados": {"nome_deputado": "João"},
                "status": "processing",
                "worker_id": "corel-ws-01",
                "tentativas": 1,
            },
        ), patch.object(
            svc,
            "resolve_os_papelaria_dir",
            return_value=r"C:\os\Sefoc",
        ):
            res = worker_client.post(
                "/api/papelaria/jobs/claim",
                json={"worker_id": "corel-ws-01"},
                headers=_headers(),
            )

        assert res.status_code == 200
        assert claimed["ok"] is True
        assert res.json()["job"]["job_id"] == 10

    def test_claim_sem_job_retorna_null(self, worker_client, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc.db, "execute_transaction", lambda ops: [None])
        res = worker_client.post(
            "/api/papelaria/jobs/claim",
            json={"worker_id": "corel-ws-01"},
            headers=_headers(),
        )
        assert res.status_code == 200
        assert res.json()["job"] is None

    def test_complete_muda_para_completed(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc, "append_job_log", lambda *a, **k: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)
        monkeypatch.setattr(svc.db, "execute_query", lambda *a, **k: [])
        monkeypatch.setattr(
            svc,
            "resolve_os_papelaria_dir",
            lambda *a, **k: r"C:\os\Sefoc",
        )

        jobs = [
            {
                "id": 10,
                "status": "processing",
                "worker_id": "corel-ws-01",
                "ano_protocolo": 2026,
                "nro_protocolo": 5954,
                "tentativas": 1,
            },
            {
                "id": 10,
                "status": "completed",
                "worker_id": "corel-ws-01",
                "ano_protocolo": 2026,
                "nro_protocolo": 5954,
                "arquivo_cdr": "out.cdr",
                "arquivo_pdf": "out.pdf",
                "tem_arquivo_pdf": True,
                "tem_arquivo_cdr": True,
            },
        ]

        with patch.object(svc, "get_job", side_effect=jobs), patch(
            "os.path.isfile",
            return_value=True,
        ), patch("os.path.realpath", side_effect=lambda p: p):
            result = svc.complete_job(
                10,
                "corel-ws-01",
                "out.cdr",
                "out.pdf",
                log_resumo="OK",
            )
        assert result["status"] == "completed"

    def test_worker_errado_nao_completa(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        with patch.object(
            svc,
            "get_job",
            return_value={
                "id": 10,
                "status": "processing",
                "worker_id": "outro-worker",
                "tentativas": 1,
            },
        ):
            with pytest.raises(ValueError, match="outro worker"):
                svc.complete_job(10, "corel-ws-01", "a.cdr", "a.pdf")

    def test_fail_muda_para_failed(self, monkeypatch):
        from services import papelaria_jobs_service as svc

        monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
        monkeypatch.setattr(svc, "append_job_log", lambda *a, **k: None)
        monkeypatch.setattr(svc, "broadcast_job_update", lambda *a, **k: None)
        monkeypatch.setattr(svc.db, "execute_query", lambda *a, **k: [])

        jobs = [
            {
                "id": 10,
                "status": "processing",
                "worker_id": "corel-ws-01",
                "tentativas": 3,
            },
            {
                "id": 10,
                "status": "failed",
                "worker_id": "corel-ws-01",
                "erro": "Corel travou",
            },
        ]

        with patch.object(svc, "get_job", side_effect=jobs):
            result = svc.fail_job(10, "corel-ws-01", "Corel travou", retryable=False)
        assert result["status"] == "failed"


class TestOutputNames:
    def test_build_output_filenames_padrao_sefoc(self, monkeypatch, tmp_path):
        from services import papelaria_jobs_service as svc

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        monkeypatch.setattr(
            svc,
            "get_os_folder_basename",
            lambda _a, _n: "05024-JonasDonizette-CtVisita",
        )
        monkeypatch.setattr(
            svc,
            "resolve_os_papelaria_dir",
            lambda _a, _n, create=True: str(sefoc),
        )

        cdr, pdf = svc.build_output_filenames(2025, 5024)
        assert cdr == "05024-JonasDonizette-CtVisita-BaseSefoc.cdr"
        assert pdf == "05024-JonasDonizette-CtVisita-ProvaSefoc 1.pdf"

        (sefoc / "05024-JonasDonizette_CtVisita-Prova1_SEFOC.pdf").write_bytes(b"x")
        cdr2, pdf2 = svc.build_output_filenames(2025, 5024)
        assert cdr2 == cdr
        assert pdf2 == "05024-JonasDonizette-CtVisita-ProvaSefoc 2.pdf"

    def test_sanitize_relative_filename_rejeita_traversal(self):
        from services.papelaria_jobs_service import _sanitize_relative_filename

        with pytest.raises(ValueError):
            _sanitize_relative_filename("../evil.cdr")

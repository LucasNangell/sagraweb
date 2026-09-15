"""Dispatch de jobs do worker (sem COM)."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import worker as worker_mod  # noqa: E402
from corel_generator import GenerationResult  # noqa: E402
from worker import resolve_worker_tipo_job  # noqa: E402


class FakeThread:
    def __init__(self, target=None, name=None, daemon=None):
        self.target = target

    def start(self):
        return None

    def join(self, timeout=None):
        return None


class FakeApi:
    def __init__(self):
        self.failed: list[tuple] = []
        self.completed: list[tuple] = []
        self.logs: list[str] = []

    def fail(self, job_id, msg, retryable=False, log_resumo=None):
        self.failed.append((job_id, msg, retryable))

    def complete(self, job_id, cdr, pdf, log_resumo=None, artefatos=None):
        self.completed.append((job_id, cdr, pdf, artefatos))

    def append_log(self, job_id, msg, nivel="info"):
        self.logs.append(msg)

    def heartbeat(self, meta=None):
        return {}


def _cfg(tmp_path: Path) -> worker_mod.WorkerConfig:
    return worker_mod.WorkerConfig(
        api_base_url="http://localhost",
        worker_secret="secret",
        worker_id="w1",
        models_dir=str(tmp_path / "models"),
        temp_dir=str(tmp_path / "temp"),
        logs_dir=str(tmp_path / "logs"),
        prevent_sleep=False,
        load_balance_enabled=False,
        auto_update_enabled=False,
        corel_visible=False,
        job_timeout_sec=30,
    )


def _job(**overrides):
    base = {
        "job_id": 9,
        "ano": 2026,
        "nro": 5954,
        "tipo_job": "create",
        "output_dir": r"C:\os\Sefoc",
        "output_cdr_name": "05024-Nome-BaseSefoc.cdr",
        "output_pdf_name": "05024-Nome-ProvaSefoc 1.pdf",
        "arquivo_modelo": "CtVisitaFV.cdr",
        "produto": "Ct Visita",
        "campos": {"nome_deputado": "{nome_deputado}"},
        "dados": {"nome_deputado": "Fulano"},
    }
    base.update(overrides)
    return base


def _ok_result(path: str = "x.pdf") -> GenerationResult:
    return GenerationResult(cdr_path="x.cdr", pdf_path=path, logs=["ok"])


@pytest.fixture
def patched_runtime(monkeypatch, tmp_path):
    monkeypatch.setattr(worker_mod, "_ativar_protecao_suspensao", lambda cfg: None)
    monkeypatch.setattr(worker_mod, "cleanup_temp_dir", lambda *a, **k: None)
    monkeypatch.setattr(worker_mod, "reset_corel_session", lambda: None)
    monkeypatch.setattr(worker_mod.threading, "Thread", FakeThread)
    monkeypatch.setattr(
        worker_mod,
        "validar_acesso_export_cdr",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        worker_mod,
        "validar_acesso_job",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        worker_mod,
        "_resolve_model_path",
        lambda models_dir, name: str(tmp_path / "models" / name),
    )
    gerar = MagicMock(return_value=_ok_result())
    exportar = MagicMock(return_value=_ok_result())
    monkeypatch.setattr(worker_mod, "gerar_arquivo_corel", gerar)
    monkeypatch.setattr(worker_mod, "exportar_prova_de_cdr_existente", exportar)
    return gerar, exportar, _cfg(tmp_path)


class TestResolveWorkerTipoJob:
    def test_export_pelo_tipo(self):
        assert (
            resolve_worker_tipo_job({"tipo_job": "export_existing_cdr"})
            == "export_existing_cdr"
        )

    def test_export_pelo_input_cdr_mesmo_com_create(self):
        assert (
            resolve_worker_tipo_job(
                {
                    "tipo_job": "create",
                    "input_cdr_path": r"C:\os\Sefoc\pronto.cdr",
                }
            )
            == "export_existing_cdr"
        )

    def test_vazio_vira_create(self):
        assert resolve_worker_tipo_job({}) == "create"


class TestProcessJobDispatch:
    def test_export_nao_chama_gerar_arquivo(self, patched_runtime):
        gerar, exportar, cfg = patched_runtime
        api = FakeApi()
        worker_mod._process_job_body(
            api,
            cfg,
            _job(
                tipo_job="export_existing_cdr",
                input_cdr_path=r"C:\os\Sefoc\pronto.cdr",
                output_cdr_name="",
            ),
        )
        exportar.assert_called_once()
        gerar.assert_not_called()
        assert api.completed
        assert api.completed[0][1] == "pronto.cdr"

    def test_input_cdr_path_sozinho_exporta(self, patched_runtime):
        gerar, exportar, cfg = patched_runtime
        api = FakeApi()
        worker_mod._process_job_body(
            api,
            cfg,
            _job(
                tipo_job="create",
                input_cdr_path=r"C:\os\Sefoc\pronto.cdr",
            ),
        )
        exportar.assert_called_once()
        gerar.assert_not_called()

    def test_tipo_desconhecido_nao_gera_arquivo(self, patched_runtime):
        gerar, exportar, cfg = patched_runtime
        api = FakeApi()
        worker_mod._process_job_body(
            api,
            cfg,
            _job(tipo_job="algo_novo"),
        )
        gerar.assert_not_called()
        exportar.assert_not_called()
        assert api.failed
        assert api.failed[0][2] is False

    def test_create_ainda_gera_arquivo(self, patched_runtime):
        gerar, exportar, cfg = patched_runtime
        api = FakeApi()
        worker_mod._process_job_body(api, cfg, _job(tipo_job="create"))
        gerar.assert_called_once()
        exportar.assert_not_called()
        assert api.completed

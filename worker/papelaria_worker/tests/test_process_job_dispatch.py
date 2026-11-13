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
from timbrado_a4_digital_generator import TimbradoDigitalResult  # noqa: E402
from worker import resolve_create_models_dir, resolve_worker_tipo_job  # noqa: E402


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


class TestResolveCreateModelsDir:
    def test_web_usa_models_dir(self, tmp_path):
        cfg = _cfg(tmp_path)
        assert resolve_create_models_dir(cfg, {"prova_modo": "prova_web"}) == cfg.models_dir

    def test_email_tambem_usa_models_dir_web(self, tmp_path):
        cfg = _cfg(tmp_path)
        web = tmp_path / "CSP" / "WEB"
        cfg.models_dir = str(web)
        resolved = resolve_create_models_dir(cfg, {"prova_modo": "prova_email"})
        assert resolved == str(web)


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

    def test_imposicao_tem_prioridade_sobre_input_cdr(self):
        assert (
            resolve_worker_tipo_job(
                {
                    "tipo_job": "imposicao",
                    "input_cdr_path": r"C:\os\Sefoc\pronto.cdr",
                }
            )
            == "imposicao"
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

    def test_imposicao_grava_jdf(self, patched_runtime, tmp_path):
        gerar, exportar, cfg = patched_runtime
        jdf_dir = tmp_path / "jdf"
        jdf_dir.mkdir()
        base_pdf = tmp_path / "base.pdf"
        base_pdf.write_bytes(b"%PDF")
        api = FakeApi()
        worker_mod._process_job_body(
            api,
            cfg,
            _job(
                tipo_job="imposicao",
                output_cdr_name="",
                output_pdf_name="2026_05954_Teste.jdf",
                jdf_xml="<JDF/>",
                jdf_filename="2026_05954_Teste.jdf",
                jdf_output_dir=str(jdf_dir),
                base_pdf_path=str(base_pdf),
                output_dir=str(jdf_dir),
            ),
        )
        exportar.assert_not_called()
        gerar.assert_not_called()
        assert (jdf_dir / "2026_05954_Teste.jdf").is_file()
        assert api.completed
        assert api.completed[0][1] == ""
        assert api.completed[0][2] == "2026_05954_Teste.jdf"

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
        assert gerar.call_args.kwargs["carimbo"] is None
        assert gerar.call_args.kwargs["pdf_somente_primeira_pagina"] is False
        assert api.completed

    def test_create_email_usa_modelo_web_e_a4(self, patched_runtime, monkeypatch, tmp_path):
        gerar, _exportar, cfg = patched_runtime
        web = tmp_path / "CSP" / "WEB"
        web.mkdir(parents=True)
        cfg.models_dir = str(web)
        out_dir = tmp_path / "Sefoc"
        out_dir.mkdir()
        base_pdf = out_dir / "05024-Nome-BaseSefoc.pdf"
        base_pdf.write_bytes(b"%PDF")

        def fake_gerar(**kwargs):
            Path(kwargs["output_pdf_path"]).write_bytes(b"%PDF-base")
            return GenerationResult(
                cdr_path=kwargs["output_cdr_path"],
                pdf_path=kwargs["output_pdf_path"],
                logs=["ok"],
            )

        gerar.side_effect = fake_gerar
        seen: dict[str, str] = {}

        def resolve(models_dir, name):
            seen["dir"] = models_dir
            seen["name"] = name
            return str(tmp_path / name)

        monkeypatch.setattr(worker_mod, "_resolve_model_path", resolve)
        compose = MagicMock(return_value=["a4 ok"])
        monkeypatch.setattr(worker_mod, "compose_prova_email_a4", compose)
        api = FakeApi()
        worker_mod._process_job_body(
            api,
            cfg,
            _job(
                prova_modo="prova_email",
                arquivo_modelo="CtVisitaFV.cdr",
                output_dir=str(out_dir),
                output_pdf_name="05024-Nome-BaseSefoc.pdf",
                prova_email_pdf_name="05024-Nome-ProvaSefoc 1.pdf",
                prova_numero=1,
            ),
        )
        assert seen["dir"] == str(web)
        assert seen["name"] == "CtVisitaFV.cdr"
        gerar.assert_called_once()
        assert gerar.call_args.kwargs["carimbo"] is None
        assert gerar.call_args.kwargs["pdf_somente_primeira_pagina"] is False
        compose.assert_called_once()
        assert api.completed
        assert api.completed[0][2] == "05024-Nome-ProvaSefoc 1.pdf"

    def test_timbrado_digital_nao_chama_gerar_arquivo(
        self, patched_runtime, monkeypatch, tmp_path
    ):
        gerar, exportar, cfg = patched_runtime
        templates = tmp_path / "templates"
        templates.mkdir()
        cfg.timbrado_a4_digital_templates_dir = str(templates)
        digital = MagicMock(
            return_value=TimbradoDigitalResult(
                artefatos=["a-Cor.docx", "a-PB.docx"],
                logs=["ok"],
            )
        )
        monkeypatch.setattr(worker_mod, "gerar_timbrado_a4_digital", digital)
        api = FakeApi()
        worker_mod._process_job_body(
            api,
            cfg,
            _job(
                tipo_job="timbrado_a4_digital",
                arquivo_modelo="TimbradoA4.cdr",
                produto="Timbrado A4 (Digital)",
                output_cdr_name="",
                output_pdf_name="",
                output_cabecalho_svg="cabecalho.svg",
                output_rodape_svg="rodape.svg",
                output_docx_cor="a-Cor.docx",
                output_docx_pb="a-PB.docx",
            ),
        )
        digital.assert_called_once()
        gerar.assert_not_called()
        exportar.assert_not_called()
        assert api.completed
        assert api.completed[0][1] == ""
        assert api.completed[0][2] == ""
        assert api.completed[0][3] == ["a-Cor.docx", "a-PB.docx"]

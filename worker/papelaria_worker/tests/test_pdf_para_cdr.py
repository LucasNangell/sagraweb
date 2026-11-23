"""«Gerar Corel» a partir do PDF final (sem o modelo .cdr) — sem COM real."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_ROOT = Path(__file__).resolve().parents[1]
for _p in (_ROOT, _ROOT / "tests"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import corel_generator as cg  # noqa: E402
import pdf_para_cdr  # noqa: E402
import worker as worker_mod  # noqa: E402
from corel_generator import CorelGenerationError, GenerationResult  # noqa: E402
from test_process_job_dispatch import FakeApi, FakeThread, _cfg, _job  # noqa: E402

# --------------------------------------------------------------------- COM falso


class _Colecao:
    def __init__(self, itens):
        self._itens = list(itens)

    @property
    def Count(self):
        return len(self._itens)

    def Item(self, i):
        return self._itens[i - 1]


class _Shape:
    def __init__(self, tipo, filhos=()):
        self.Type = tipo
        self.Shapes = _Colecao(filhos)


class _Pagina:
    def __init__(self, shapes):
        self.Name = ""
        self.Layers = _Colecao([type("Camada", (), {"Shapes": _Colecao(shapes)})()])


class _Doc:
    def __init__(self, paginas):
        self.Pages = _Colecao(paginas)
        self.salvo_em = None
        self.fechado = False

    def SaveAs(self, caminho, opts=None):
        Path(caminho).write_bytes(b"CDR" * 2000)
        self.salvo_em = caminho

    def Close(self, *_a):
        self.fechado = True


class _Corel:
    def __init__(self, doc):
        self.doc = doc
        self.abertos: list[str] = []

    def CreateStructSaveAsOptions(self):
        return type("Opcoes", (), {})()

    def OpenDocument(self, caminho):
        self.abertos.append(caminho)
        return self.doc


class _Sessao:
    def __init__(self, corel):
        self.corel = corel

    def _ensure_com(self):
        return None

    def has_application(self):
        return False

    def get_application(self, visible, *, force_new=False):
        return self.corel


@pytest.fixture
def corel_falso(monkeypatch):
    texto = pdf_para_cdr.CDR_TEXT_SHAPE
    grupo = _Shape(pdf_para_cdr.CDR_GROUP_SHAPE, [_Shape(texto), _Shape(3)])
    doc = _Doc([_Pagina([_Shape(texto), grupo]), _Pagina([_Shape(texto)])])
    corel = _Corel(doc)
    monkeypatch.setattr(cg, "_corel_session", _Sessao(corel))
    monkeypatch.setattr(cg, "_release_corel_after_job", lambda logs, completed: None)
    monkeypatch.setattr(cg, "_sincronizar_documento_corel", lambda *a, **k: None)
    monkeypatch.setattr(
        pdf_para_cdr, "_executar", lambda func, *a, timeout, **k: func(*a, **k)
    )
    return corel


def test_gerar_cdr_de_pdf_importa_e_salva(tmp_path, corel_falso):
    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    pdf = sefoc / "05954-Pasta-BaseSefoc.pdf"
    pdf.write_bytes(b"%PDF-1.7" + b"0" * 4000)
    saida_cdr = sefoc / "05954-Pasta-BaseSefoc.cdr"

    r = pdf_para_cdr.gerar_cdr_de_pdf(
        pdf_path=str(pdf),
        temp_dir=str(tmp_path / "temp"),
        output_cdr_path=str(saida_cdr),
        output_pdf_path=str(pdf),
        job_id=7,
    )
    # O Corel abre uma cópia local do PDF, nunca o arquivo da pasta da OS.
    assert corel_falso.abertos and Path(corel_falso.abertos[0]).name == "fonte.pdf"
    assert saida_cdr.is_file() and r.cdr_path == str(saida_cdr)
    assert r.pdf_path == str(pdf)
    assert [corel_falso.doc.Pages.Item(i).Name for i in (1, 2)] == ["Frente", "Verso"]
    assert any("3 texto(s) editável(is)" in linha for linha in r.logs)
    assert corel_falso.doc.fechado


def test_gerar_cdr_de_pdf_avisa_quando_texto_vira_curva(tmp_path, monkeypatch, corel_falso):
    corel_falso.doc = _Doc([_Pagina([_Shape(3)])])
    pdf = tmp_path / "base.pdf"
    pdf.write_bytes(b"%PDF" + b"0" * 4000)
    r = pdf_para_cdr.gerar_cdr_de_pdf(
        pdf_path=str(pdf),
        temp_dir=str(tmp_path / "temp"),
        output_cdr_path=str(tmp_path / "base.cdr"),
        output_pdf_path=str(pdf),
    )
    assert any("Importar texto como: Texto" in linha for linha in r.logs)


def test_validar_pdf_fonte_exige_arquivo(tmp_path):
    with pytest.raises(CorelGenerationError, match="não encontrado"):
        pdf_para_cdr.validar_pdf_fonte(str(tmp_path / "nao-existe.pdf"), str(tmp_path))


# ------------------------------------------------------------------- dispatch


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    monkeypatch.setattr(worker_mod, "_ativar_protecao_suspensao", lambda cfg: None)
    monkeypatch.setattr(worker_mod, "cleanup_temp_dir", lambda *a, **k: None)
    monkeypatch.setattr(worker_mod, "reset_corel_session", lambda: None)
    monkeypatch.setattr(worker_mod, "finalizar_trabalho_corel", lambda: None, raising=False)
    monkeypatch.setattr(worker_mod.threading, "Thread", FakeThread)
    gerar_modelo = MagicMock(side_effect=AssertionError("não deveria usar o modelo .cdr"))
    monkeypatch.setattr(worker_mod, "gerar_arquivo_corel", gerar_modelo)
    return _cfg(tmp_path)


def test_job_com_pdf_fonte_gera_corel_do_pdf(runtime, monkeypatch, tmp_path):
    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    base_pdf = sefoc / "05954-Pasta-BaseSefoc.pdf"
    base_pdf.write_bytes(b"%PDF-1.4\n%%EOF")
    chamadas: list[dict] = []

    def _gerar(**kw):
        chamadas.append(kw)
        Path(kw["output_cdr_path"]).write_bytes(b"cdr")
        return GenerationResult(cdr_path=kw["output_cdr_path"], pdf_path=kw["output_pdf_path"], logs=["ok"])

    monkeypatch.setattr(worker_mod, "gerar_cdr_de_pdf", _gerar)
    monkeypatch.setattr(
        worker_mod, "copy_pdf_without_blank_pages", lambda src, dst: {"kept_pages": [1]}
    )
    monkeypatch.setattr(worker_mod, "summarize_kept_pages", lambda pages: "1")
    api = FakeApi()
    worker_mod._process_job_body(
        api,
        runtime,
        _job(
            output_dir=str(sefoc),
            output_cdr_name="05954-Pasta-BaseSefoc.cdr",
            output_pdf_name="05954-Pasta-BaseSefoc.pdf",
            arquivo_modelo="modelo-que-nao-existe.cdr",
            source_pdf_path=str(base_pdf),
            prova_modo="prova_web",
            prova_web_pdf_name="05954-Pasta-Prova1.pdf",
        ),
    )
    assert not api.failed, api.failed
    assert chamadas and chamadas[0]["pdf_path"] == str(base_pdf)
    assert chamadas[0]["output_cdr_path"] == str(sefoc / "05954-Pasta-BaseSefoc.cdr")
    assert api.completed and api.completed[0][1] == "05954-Pasta-BaseSefoc.cdr"
    assert any("a partir do PDF final" in m for m in api.logs)


def test_job_com_pdf_fonte_ausente_falha_sem_retry(runtime, tmp_path):
    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    api = FakeApi()
    worker_mod._process_job_body(
        api,
        runtime,
        _job(output_dir=str(sefoc), source_pdf_path=str(sefoc / "sumiu.pdf")),
    )
    assert api.failed and api.failed[0][2] is False
    assert "PDF para gerar o Corel" in api.failed[0][1]

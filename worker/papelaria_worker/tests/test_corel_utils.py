"""Testes unitários dos utilitários Corel (sem COM)."""
from __future__ import annotations

import sys
from pathlib import Path

from unittest.mock import MagicMock

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from corel_generator import (  # noqa: E402
    CAMADA_PROVA_SEFOC,
    _release_corel_after_job,
    dividir_frente_verso,
    humanizar_erro_corel,
    limpar_nome_arquivo,
    normalizar_gabinete,
    nome_saida,
    reset_corel_session,
    resolver_modelo_em_cache,
    substituir_variaveis,
    validar_acesso_job,
    _e_camada_prova_sefoc,
    _tamanho_pagina1_cdr,
    corel_processo_em_execucao,
)


class TestUtilitarios:
    def test_normalizar_gabinete(self):
        assert normalizar_gabinete("Gabinete 123") == "123"
        assert normalizar_gabinete("Anexo IV, Gabinete 45") == "045"

    def test_substituir_variaveis(self):
        out = substituir_variaveis(
            "{nome_deputado} — {partido}/{uf}",
            {"nome_deputado": "João", "partido": "PT", "uf": "DF"},
        )
        assert "João" in out
        assert "PT" in out

    def test_dividir_frente_verso(self):
        texto = "Frente:\nLinha A\nVerso:\nLinha B"
        fv = dividir_frente_verso(texto)
        assert fv is not None
        assert "Linha A" in fv[1]
        assert "Linha B" in fv[2]

    def test_limpar_nome_arquivo(self):
        assert limpar_nome_arquivo('Teste: "A/B"') == "Teste_AB"

    def test_nome_saida(self):
        modelo = {"produto": "Ct Visita", "cores": "Policromia"}
        dados = {"nome_deputado": "Maria", "gabinete": "123"}
        nome = nome_saida(modelo, dados)
        assert "Maria" in nome
        assert "Gab123" in nome

    def test_release_corel_after_job(self, monkeypatch):
        logs: list[str] = []
        quit_calls: list[str] = []

        class FakeCorel:
            def Quit(self) -> None:
                quit_calls.append("quit")

        import corel_generator as cg

        cg._corel_session._corel = FakeCorel()
        _release_corel_after_job(logs, completed=True)
        assert quit_calls == ["quit"]
        assert cg._corel_session._corel is None
        assert any("encerrado após exportação" in line for line in logs)

        reset_corel_session()

    def test_corel_processo_em_execucao_tasklist(self, monkeypatch):
        class Resultado:
            stdout = "CorelDRW.exe    12345 Console    1    200.000 K"

        def fake_run(cmd, **kwargs):
            assert any("CorelDRW.exe" in str(part) for part in cmd)
            return Resultado()

        monkeypatch.setattr("corel_generator.subprocess.run", fake_run)
        assert corel_processo_em_execucao() is True

    def test_corel_processo_em_execucao_ausente(self, monkeypatch):
        class Resultado:
            stdout = "INFORMAÇÕES: nenhuma tarefa em execução"

        monkeypatch.setattr("corel_generator.subprocess.run", lambda *a, **k: Resultado())
        assert corel_processo_em_execucao() is False

    def test_e_camada_prova_sefoc(self):
        assert _e_camada_prova_sefoc(CAMADA_PROVA_SEFOC)
        assert _e_camada_prova_sefoc("  provasefoc  ")
        assert not _e_camada_prova_sefoc("Guia")
        assert not _e_camada_prova_sefoc("")

    def test_tamanho_pagina1_cdr_zip(self, tmp_path):
        import zipfile

        cdr = tmp_path / "fake.cdr"
        with zipfile.ZipFile(cdr, "w") as zf:
            zf.writestr("content/data/page1.dat", b"x" * 5000)
            zf.writestr("content/data/page2.dat", b"tiny")
        assert _tamanho_pagina1_cdr(str(cdr)) == 5000

    def test_resolver_modelo_em_cache(self, tmp_path):
        src_dir = tmp_path / "remoto"
        cache_dir = tmp_path / "cache"
        src_dir.mkdir()
        modelo = src_dir / "CtVisita.cdr"
        modelo.write_bytes(b"modelo-v1")

        p1 = resolver_modelo_em_cache(str(modelo), str(cache_dir))
        p2 = resolver_modelo_em_cache(str(modelo), str(cache_dir))
        assert p1 == p2
        assert (cache_dir / "CtVisita.cdr").is_file()

        modelo.write_bytes(b"modelo-v2-atualizado")
        p3 = resolver_modelo_em_cache(str(modelo), str(cache_dir))
        assert p3 == str(cache_dir / "CtVisita.cdr")
        assert (cache_dir / "CtVisita.cdr").read_bytes() == b"modelo-v2-atualizado"

    def test_excluir_campo(self):
        from corel_generator import excluir_campo

        deleted_calls = []

        class FakeShape:
            def __init__(self, name):
                self.Name = name

            def Delete(self):
                deleted_calls.append(self.Name)

        class FakeShapes:
            def __init__(self, items):
                self.items = items
                self.Count = len(items)

            def Item(self, i):
                return self.items[i - 1]

        class FakeLayer:
            def __init__(self, shapes):
                self.Shapes = FakeShapes(shapes)

        class FakeLayers:
            def __init__(self, items):
                self.items = items
                self.Count = len(items)

            def Item(self, i):
                return self.items[i - 1]

        class FakePage:
            def __init__(self, layers):
                self.Layers = FakeLayers(layers)

        class FakePages:
            def __init__(self, items):
                self.items = items
                self.Count = len(items)

            def Item(self, i):
                return self.items[i - 1]

        class FakeDoc:
            def __init__(self, pages):
                self.Pages = FakePages(pages)

        s1 = FakeShape("campo1")
        s2 = FakeShape("campo2")
        s3 = FakeShape("campo1")

        doc = FakeDoc([
            FakePage([FakeLayer([s1, s2])]),
            FakePage([FakeLayer([s3])]),
        ])

        logs = []
        excluir_campo(doc, "campo1", logs)

        assert deleted_calls == ["campo1", "campo1"]
        assert any("excluído em 2 ocorrência" in log for log in logs)


class TestHumanizarErroCorel:
    def test_com_server_exec_failure(self):
        msg = humanizar_erro_corel(
            Exception("(-2146959355, 'Falha na execução do servidor', None, None)")
        )
        assert "CorelDRAW" in msg
        assert "Falha na execução do servidor" not in msg

    def test_file_not_found(self):
        msg = humanizar_erro_corel(FileNotFoundError(r"\\server\modelo.cdr"))
        assert "não encontrado" in msg.lower()

    def test_permission_error(self):
        msg = humanizar_erro_corel(PermissionError(r"\\server\Sefoc"))
        assert "permissão" in msg.lower()

    def test_validar_acesso_job_modelo_ausente(self, tmp_path):
        from corel_generator import CorelGenerationError

        with pytest.raises(CorelGenerationError, match="Modelo indisponível"):
            validar_acesso_job(
                str(tmp_path / "inexistente.cdr"),
                str(tmp_path / "out"),
            )

    def test_validar_acesso_job_saida_gravavel(self, tmp_path):
        modelo = tmp_path / "modelo.cdr"
        modelo.write_bytes(b"x")
        saida = tmp_path / "Sefoc"
        validar_acesso_job(str(modelo), str(saida))
        assert saida.is_dir()

    def test_validar_acesso_export_cdr_ausente(self, tmp_path):
        from corel_generator import CorelGenerationError, validar_acesso_export_cdr

        with pytest.raises(CorelGenerationError, match="Corel da OS indisponível"):
            validar_acesso_export_cdr(
                str(tmp_path / "inexistente.cdr"),
                str(tmp_path / "Sefoc"),
            )

    def test_validar_acesso_export_cdr_saida_gravavel(self, tmp_path):
        from corel_generator import validar_acesso_export_cdr

        cdr = tmp_path / "BaseSefoc.cdr"
        cdr.write_bytes(b"x")
        saida = tmp_path / "Sefoc"
        validar_acesso_export_cdr(str(cdr), str(saida))
        assert saida.is_dir()


class TestExportProvaSemAlterar:
    def test_fecha_sem_salvar(self):
        from corel_generator import _fechar_documento_sem_salvar

        calls: list[object] = []

        class Doc:
            Dirty = True

            def Close(self, save=None):
                calls.append(save)

        logs: list[str] = []
        doc = Doc()
        _fechar_documento_sem_salvar(doc, logs)
        assert calls == [False]
        assert doc.Dirty is False
        assert any("sem gravar" in line for line in logs)

    def test_rejeita_documento_aberto_na_origem(self, tmp_path):
        from corel_generator import (
            CorelGenerationError,
            _assert_documento_e_copia_temp,
        )

        origem = tmp_path / "pronto.cdr"
        origem.write_bytes(b"x")
        temp = tmp_path / "working.cdr"
        temp.write_bytes(b"x")

        class Doc:
            FullFileName = str(origem.resolve())

        with pytest.raises(CorelGenerationError, match="original da OS"):
            _assert_documento_e_copia_temp(Doc(), str(temp), str(origem), [])

    def test_export_abre_copia_temp_e_fecha_sem_salvar(self, tmp_path, monkeypatch):
        from pathlib import Path

        import corel_generator as cg

        origem = tmp_path / "os" / "pronto.cdr"
        origem.parent.mkdir()
        origem.write_bytes(b"cdr-original")
        temp_cdr = tmp_path / "temp" / "working.cdr"
        temp_cdr.parent.mkdir()
        out_pdf = tmp_path / "out" / "prova.pdf"
        out_pdf.parent.mkdir()

        opened: dict[str, object] = {}

        class Doc:
            def __init__(self, path: str):
                self.FullFileName = path
                self.Dirty = True
                self.Pages = MagicMock(Count=1)

            def Close(self, save=None):
                opened["close"] = save

        class Corel:
            Visible = False

            def OpenDocument(self, path):
                opened["path"] = path
                doc = Doc(path)
                opened["doc"] = doc
                return doc

        fake_session = MagicMock()
        fake_session.has_application.return_value = True
        fake_session.get_application.return_value = Corel()

        def fake_export(corel, doc, path, logs):
            Path(path).write_bytes(b"%PDF-1.4 " + b"x" * 2048)

        monkeypatch.setattr(cg, "_corel_session", fake_session)
        monkeypatch.setattr(cg, "exportar_pdf", fake_export)
        monkeypatch.setattr(cg, "_release_corel_after_job", lambda logs, completed=False: None)

        logs: list[str] = []
        cg._exportar_prova_cdr_existente_impl(
            str(origem),
            str(temp_cdr),
            str(out_pdf),
            False,
            logs,
            reuse_corel_session=True,
        )

        assert opened["close"] is False
        assert Path(str(opened["path"])).name == "working.cdr"
        assert origem.read_bytes() == b"cdr-original"
        assert out_pdf.is_file()
        assert fake_session.get_application.called


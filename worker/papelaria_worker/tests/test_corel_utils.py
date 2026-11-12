"""Testes unitários dos utilitários Corel (sem COM)."""
from __future__ import annotations

import sys
from pathlib import Path

from unittest.mock import MagicMock

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from datetime import date  # noqa: E402

from corel_generator import (  # noqa: E402
    CAMADA_PROVA_SEFOC,
    CorelGenerationError,
    _manter_somente_primeira_pagina,
    _ajustar_pasta_avulso_para_a4,
    _resolver_shapes_all,
    aplicar_campo,
    calcular_ajuste_a4_paisagem,
    encaixar_retangulo_na_pagina,
    montar_carimbo_prova_email,
    pagina_e_pasta_avulso_mm,
    resolve_prova_numero,
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


class TestAplicarCampoOpcional:
    def test_tipoosint_ausente_e_ignorado(self):
        logs: list[str] = []
        aplicar_campo(
            object(),
            "TipoOSint",
            "SP",
            {},
            logs,
            indice_shapes={},
        )
        assert any("ignorado" in log.lower() for log in logs)

    def test_campo_obrigatorio_ausente_falha(self):
        with pytest.raises(CorelGenerationError, match="OSint"):
            aplicar_campo(
                object(),
                "OSint",
                "05954/2026",
                {},
                [],
                indice_shapes={},
            )


class TestCarimboProvaEmail:
    def test_sp_e_os(self):
        email = montar_carimbo_prova_email(
            nro=5954, ano=2026, prova_numero=3, hoje=date(2026, 11, 12)
        )
        assert email == {
            "TipoOSint": "SP",
            "OSint": "05954/2026",
            "DataInt": "12/11/2026",
            "ProvaNroInt": "3",
        }
        os_menor = montar_carimbo_prova_email(
            nro=4999, ano=2026, prova_numero=1, hoje=date(2026, 1, 2)
        )
        assert os_menor["TipoOSint"] == "OS"
        assert os_menor["OSint"] == "04999/2026"
        assert os_menor["DataInt"] == "02/01/2026"

    def test_numero_da_prova_vem_do_pdf(self):
        assert (
            resolve_prova_numero({"output_pdf_name": "05954-Nome-ProvaSefoc 4.pdf"})
            == 4
        )
        assert resolve_prova_numero({"prova_numero": 2, "output_pdf_name": "x.pdf"}) == 2
        with pytest.raises(CorelGenerationError):
            resolve_prova_numero({"output_pdf_name": "sem-numero.pdf"})

    def test_pdf_fica_so_com_a_primeira_pagina(self):
        class Paginas:
            def __init__(self, total: int):
                self.total = total

            @property
            def Count(self) -> int:
                return self.total

            def Item(self, indice: int):
                assert indice == 2
                paginas = self

                class Pagina:
                    def Delete(self) -> None:
                        paginas.total -= 1

                return Pagina()

        class Documento:
            def __init__(self, total: int):
                self.Pages = Paginas(total)

        doc = Documento(3)
        logs: list[str] = []
        _manter_somente_primeira_pagina(doc, logs)
        assert doc.Pages.Count == 1
        assert any("página 1" in linha for linha in logs)


class TestAjustePastaAvulsoA4:
    def test_shapes_all_usa_metodo_all(self):
        class ShapeRange:
            Count = 1
            CenterX = 10

        class Shapes:
            def All(self):
                return ShapeRange()

        shape_range = _resolver_shapes_all(Shapes())
        assert shape_range.Count == 1
        assert shape_range.CenterX == 10

    def test_shapes_all_aceita_com_callable(self):
        """win32com marca Dispatch como callable; isso não invalida o range."""

        class FakeComRange:
            Count = 2
            SizeWidth = 100.0

            def __call__(self):
                raise AssertionError("ShapeRange COM não deve ser chamado")

            def Stretch(self, *args, **kwargs):
                return None

        class Shapes:
            def All(self):
                return FakeComRange()

        shape_range = _resolver_shapes_all(Shapes())
        assert callable(shape_range)
        assert shape_range.Count == 2

    def test_shapes_all_fallback_range_quando_all_falha(self):
        class ShapeRange:
            def __init__(self, total: int) -> None:
                self.Count = total
                self.SizeWidth = 1.0

            def Stretch(self, *args, **kwargs):
                return None

        class Shapes:
            Count = 3

            def All(self):
                raise RuntimeError("All indisponível")

            def Range(self, indices):
                assert list(indices) == [1, 2, 3]
                return ShapeRange(len(indices))

        shape_range = _resolver_shapes_all(Shapes())
        assert shape_range.Count == 3

    def test_detecta_folha_470x460(self):
        assert pagina_e_pasta_avulso_mm(470, 460)
        assert pagina_e_pasta_avulso_mm(460, 470)
        assert not pagina_e_pasta_avulso_mm(297, 210)

    def test_escala_cabe_em_a4_paisagem(self):
        ajuste = calcular_ajuste_a4_paisagem(470, 460)
        assert ajuste["pagina_largura"] == 297
        assert ajuste["pagina_altura"] == 210
        assert ajuste["escala"] == pytest.approx(210 / 460)
        largura = 470 * ajuste["escala"]
        altura = 460 * ajuste["escala"]
        assert largura <= 297
        assert altura == pytest.approx(210)
        assert ajuste["offset_x"] == pytest.approx((297 - largura) / 2)
        assert ajuste["offset_y"] == pytest.approx(0)

    def test_folha_inteira_cabe_centralizada_no_a4(self):
        escala = 210 / 460
        esquerda, base, largura, altura = encaixar_retangulo_na_pagina(
            pagina_esquerda=0,
            pagina_base=0,
            pagina_largura=470,
            pagina_altura=460,
            esquerda=0,
            base=0,
            largura=470,
            altura=460,
            nova_esquerda=0,
            nova_base=0,
            nova_largura=297,
            nova_altura=210,
            escala=escala,
        )
        assert largura == pytest.approx(470 * escala)
        assert altura == pytest.approx(210)
        assert esquerda == pytest.approx((297 - largura) / 2)
        assert base == pytest.approx(0)
        assert esquerda >= 0
        assert base >= 0
        assert esquerda + largura <= 297 + 0.01
        assert base + altura <= 210 + 0.01

    def test_aplica_ajuste_em_polegadas_com_stretch(self):
        escala = 210 / 460
        page_w_in = 470 / 25.4
        page_h_in = 460 / 25.4
        a4_w_in = 297 / 25.4
        a4_h_in = 210 / 25.4

        class ShapeRange:
            def __init__(self) -> None:
                self.Count = 2
                # SizeWidth mentiroso (bug observado no Corel da pasta).
                self.SizeWidth = 45720.0
                self.SizeHeight = 45720.0
                self.LeftX = -100.0
                self.BottomY = -100.0
                self.stretch_calls: list[tuple[float, float]] = []
                self.align_calls = 0
                self.RotationCenterX = 0.0
                self.RotationCenterY = 0.0
                self._real_w = page_w_in
                self._real_h = page_h_in
                self._cx = page_w_in / 2
                self._cy = page_h_in / 2

            def Stretch(self, sx: float, sy: float, size_characters: bool = True) -> None:
                self.stretch_calls.append((sx, sy))
                self._real_w *= sx
                self._real_h *= sy

            def AlignToPageCenter(self) -> None:
                self.align_calls += 1
                self._cx = a4_w_in / 2
                self._cy = a4_h_in / 2
                self.LeftX = self._cx - self._real_w / 2
                self.BottomY = self._cy - self._real_h / 2

        class Shapes:
            def __init__(self, shape_range: ShapeRange) -> None:
                self._all = shape_range
                self.Count = 2

            def All(self) -> ShapeRange:
                return self._all

        class Pagina:
            def __init__(self) -> None:
                self.SizeWidth = page_w_in
                self.SizeHeight = page_h_in
                self.CenterX = page_w_in / 2
                self.CenterY = page_h_in / 2
                self.Shapes = Shapes(ShapeRange())
                self._bbox = (0.0, 0.0, page_w_in, page_h_in)

            def SetSize(self, largura: float, altura: float) -> None:
                self.SizeWidth = largura
                self.SizeHeight = altura
                self.CenterX = largura / 2
                self.CenterY = altura / 2

            def GetObjectsBoundingBox(self, *_args):
                sr = self.Shapes.All()
                return (
                    sr.LeftX,
                    sr.BottomY,
                    sr._real_w,
                    sr._real_h,
                )

        class Documento:
            def __init__(self, pagina: Pagina) -> None:
                self.Unit = 0
                self.ReferencePoint = 0
                self.Application = type("App", (), {"Unit": 0})()
                self.Pages = type("Pages", (), {"Item": lambda _self, _i: pagina})()
                self.pagina = pagina

        pasta = Documento(Pagina())
        logs: list[str] = []
        _ajustar_pasta_avulso_para_a4(pasta, logs)
        shape_range = pasta.pagina.Shapes.All()
        assert pasta.Unit == 1  # cdrInch
        assert pasta.pagina.SizeWidth == pytest.approx(a4_w_in)
        assert pasta.pagina.SizeHeight == pytest.approx(a4_h_in)
        assert shape_range.stretch_calls[0][0] == pytest.approx(escala)
        assert shape_range.align_calls == 1
        assert shape_range._real_w == pytest.approx(page_w_in * escala)
        assert shape_range._real_h == pytest.approx(page_h_in * escala)
        assert any("cdrInch" in linha for linha in logs)
        assert any("Stretch em cdrInch" in linha for linha in logs)

        # Página que não é pasta: não altera.
        outra = Documento(Pagina())
        outra.pagina.SizeWidth = 90 / 25.4
        outra.pagina.SizeHeight = 50 / 25.4
        _ajustar_pasta_avulso_para_a4(outra, [])
        assert outra.pagina.SizeWidth == pytest.approx(90 / 25.4)


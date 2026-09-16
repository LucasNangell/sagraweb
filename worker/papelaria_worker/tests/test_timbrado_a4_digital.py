"""Testes unitários Timbrado A4 Digital (sem COM)."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from timbrado_a4_digital_generator import (  # noqa: E402
    CorelGenerationError,
    _aspectos_proximos,
    _caminho_para_word,
    _chamar_export_bitmap,
    _chamar_export_ex,
    _coletar_shapes_por_nomes,
    _deslocamento_para_pagina,
    _exportar_shape_imagem,
    _preencher_e_exportar_imagens,
    _substituir_inline_por_imagem,
    _tentar_export_arquivo,
    _tentar_export_bitmap_png,
    resolve_timbrado_a4_digital_templates_dir,
)


def test_resolve_templates_dir_default_sibling():
    models = r"\\server\share\Papelaria\CSP\WEB"
    got = resolve_timbrado_a4_digital_templates_dir(models)
    assert got.replace("/", "\\").endswith(r"Papelaria\Timbrado A4 Digital")


def test_resolve_templates_dir_configured_override(tmp_path):
    custom = tmp_path / "custom_templates"
    custom.mkdir()
    got = resolve_timbrado_a4_digital_templates_dir(
        r"C:\models",
        str(custom),
    )
    assert Path(got) == custom.resolve()


def test_export_ex_chama_finish_e_grava_arquivo(tmp_path):
    dest = tmp_path / "cabecalho.svg"
    finish = MagicMock(side_effect=lambda: dest.write_bytes(b"<svg/>"))

    class Filter:
        Finish = finish

    class Doc:
        def ClearSelection(self):
            return None

        def ExportEx(self, path, filtro, *args):
            assert Path(path) == dest.resolve()
            assert isinstance(filtro, int)
            return Filter()

    logs: list[str] = []
    erros: list[str] = []
    ok = _tentar_export_arquivo(
        Doc(), MagicMock(), str(dest), 1714, logs, erros, "Cabecalho", "SVG", 10.0, 1.0
    )
    assert ok is True
    finish.assert_called_once()
    assert dest.is_file() and dest.stat().st_size > 0


def test_export_ex_sem_arquivo_retorna_false(tmp_path):
    dest = tmp_path / "cabecalho.svg"

    class Filter:
        def Finish(self):
            return None

    class Doc:
        def ClearSelection(self):
            return None

        def ExportEx(self, path, filtro, *args):
            return Filter()

    ok = _tentar_export_arquivo(
        Doc(), MagicMock(), str(dest), 1714, [], [], "Cabecalho", "SVG", 10.0, 1.0
    )
    assert ok is False


def test_export_bitmap_png_chama_finish(tmp_path):
    dest = tmp_path / "cabecalho.png"
    finish = MagicMock(side_effect=lambda: dest.write_bytes(b"\x89PNG"))

    class Filter:
        Finish = finish

    doc = MagicMock()
    doc.ExportBitmap.return_value = Filter()
    ok = _tentar_export_bitmap_png(doc, MagicMock(), str(dest), [], [], "Cabecalho", 1.0, 1.0)
    assert ok is True
    finish.assert_called_once()
    args = doc.ExportBitmap.call_args[0]
    assert len(args) == 11
    assert args[6] == 600 and args[7] == 600
    assert args[9] is False


def test_export_bitmap_sempre_11_ints():
    alvo = MagicMock()
    alvo.ExportBitmap.return_value = MagicMock()
    _chamar_export_bitmap(alvo, r"C:\tmp\x.png", 802, 1, 4)
    args = alvo.ExportBitmap.call_args[0]
    assert len(args) == 11
    assert args[1:] == (802, 1, 4, 0, 0, 600, 600, 1, False, False)
    assert str(args[0]).lower().endswith("x.png")
    assert all(type(a) in (str, int, bool) for a in args)


class _Pages:
    def Item(self, _i):
        return MagicMock()


def _shape_basico(w=10.0, h=1.0):
    shape = MagicMock()
    shape.SizeWidth = w
    shape.SizeHeight = h
    shape.LeftX = 0
    shape.BottomY = 0
    shape.RightX = w
    shape.TopY = h
    shape.ConvertToCurves.side_effect = Exception("skip")
    shape.Application.ActiveDocument.Unit = 1
    return shape


def _doc_temp(*, publish=None, svg_bytes=None, png_via_bitmap=False, boom=None):
    class TempDoc:
        Pages = _Pages()

        def ClearSelection(self):
            return None

        def Activate(self):
            return None

        def PublishToPDF(self, path):
            if boom == "pdf":
                raise RuntimeError("pdf fail")
            if publish:
                Path(path).write_bytes(b"%PDF-1.4 fake")
            elif publish is False:
                raise RuntimeError("pdf fail")

        def ExportEx(self, path, filtro, *args):
            if boom == "ex":
                raise RuntimeError("ex fail")
            if svg_bytes and str(path).lower().endswith(".svg"):
                Path(path).write_bytes(svg_bytes)
            return MagicMock(Finish=lambda: None)

        def ExportBitmap(self, path, *args):
            if boom == "bmp":
                raise RuntimeError("bitmap fail")
            if png_via_bitmap:
                Path(path).write_bytes(b"\x89PNG")
            return MagicMock(Finish=lambda: None)

        def Close(self):
            return None

        @property
        def ActiveLayer(self):
            return MagicMock()

        @property
        def ActiveShape(self):
            pasted = MagicMock()
            pasted.ConvertToCurves.side_effect = Exception("skip")
            pasted.SizeWidth = 10
            pasted.SizeHeight = 1
            return pasted

    return TempDoc()


class _FakePage:
    def __init__(self, svg: str, pix_w: int, pix_h: int, png_path_writer=None):
        self._svg = svg
        self._pix_w = pix_w
        self._pix_h = pix_h
        self._png_path_writer = png_path_writer

    def get_svg_image(self, text_as_path=True):
        assert text_as_path is True
        return self._svg

    def get_pixmap(self, dpi=600):
        assert dpi == 600
        pix = MagicMock()
        pix.width = self._pix_w
        pix.height = self._pix_h

        def save(path):
            Path(path).write_bytes(b"\x89PNG")

        pix.save.side_effect = save
        return pix


class _FakePdf:
    def __init__(self, page):
        self._page = page

    def __getitem__(self, idx):
        return self._page

    def close(self):
        return None


def test_exportar_prefere_pdf_svg(tmp_path):
    stem = str(tmp_path / "cabecalho")
    svg = '<svg viewBox="0 0 1000 100"><path d="M0 0"/></svg>'
    corel = MagicMock()
    corel.CreateDocument.return_value = _doc_temp(publish=True)
    fake_fitz = MagicMock()
    fake_fitz.open.return_value = _FakePdf(_FakePage(svg, 1000, 100))
    with patch.dict(sys.modules, {"fitz": fake_fitz}):
        result = _exportar_shape_imagem(corel, _shape_basico(), stem, [], "Cabecalho")
    assert result.lower().endswith(".svg")
    assert Path(result).is_file()


def test_exportar_pdf_sem_vetor_cai_para_png(tmp_path):
    stem = str(tmp_path / "cabecalho")
    corel = MagicMock()
    corel.CreateDocument.return_value = _doc_temp(publish=True)
    fake_fitz = MagicMock()
    fake_fitz.open.return_value = _FakePdf(_FakePage("<svg></svg>", 1000, 100))
    with patch.dict(sys.modules, {"fitz": fake_fitz}):
        result = _exportar_shape_imagem(corel, _shape_basico(), stem, [], "Cabecalho")
    assert result.lower().endswith(".png")


def test_proporcao_divergente_rejeitada(tmp_path):
    stem = str(tmp_path / "cabecalho")
    # SVG quadrado vs shape 10x1
    svg = '<svg viewBox="0 0 100 100"><path d="M0 0"/></svg>'
    corel = MagicMock()
    corel.CreateDocument.return_value = _doc_temp(publish=True, boom="ex")
    fake_fitz = MagicMock()
    fake_fitz.open.return_value = _FakePdf(_FakePage(svg, 100, 100))
    with patch.dict(sys.modules, {"fitz": fake_fitz}):
        with pytest.raises(CorelGenerationError, match="propor"):
            _exportar_shape_imagem(corel, _shape_basico(), stem, [], "Cabecalho")


def test_exportar_shape_erro_agrega_tentativas(tmp_path):
    stem = str(tmp_path / "cabecalho")
    corel = MagicMock()
    corel.CreateDocument.return_value = _doc_temp(publish=False, boom="ex")
    doc = corel.CreateDocument.return_value

    def bmp(*args, **kwargs):
        raise RuntimeError("bitmap fail")

    doc.ExportBitmap = bmp
    with pytest.raises(CorelGenerationError) as ei:
        _exportar_shape_imagem(corel, _shape_basico(), stem, [], "Cabecalho")
    msg = str(ei.value)
    assert "PublishToPDF" in msg
    assert "ExportEx SVG" in msg
    assert "ExportEx EMF" in msg
    assert "ExportEx WMF" in msg
    assert "ExportBitmap" in msg or "bitmap" in msg.lower()


def test_export_ex_nao_inverte_argumentos():
    calls = []

    class Doc:
        def ExportEx(self, a, b, *rest):
            calls.append((a, b, rest))
            raise RuntimeError("stop")

    with pytest.raises(Exception):
        _chamar_export_ex(Doc(), r"C:\tmp\cabecalho.svg", 1714)
    assert calls
    path, filtro, _rest = calls[0]
    assert str(path).lower().endswith("cabecalho.svg")
    assert filtro == 1714


def test_aspectos_proximos():
    assert _aspectos_proximos(1000, 100, 10, 1)
    assert not _aspectos_proximos(100, 100, 10, 1)


def test_word_nao_estica_imagem_quadrada_no_header():
    class Pic:
        Width = 328.0
        Height = 328.0
        LockAspectRatio = 0

    class Placeholder:
        Width = 328.0
        Height = 28.0

        def __init__(self, pic: Pic):
            self.Range = MagicMock()
            self.Range.InlineShapes.AddPicture.return_value = pic

        def Delete(self):
            return None

    pic = Pic()
    _substituir_inline_por_imagem(Placeholder(pic), r"C:\tmp\x.png", [], "Cabeçalho")
    assert pic.Width == pytest.approx(28.0)
    assert pic.LockAspectRatio == -1


def test_caminho_para_word_rasteriza_svg_via_pdf(tmp_path):
    svg = tmp_path / "cabecalho.svg"
    pdf = tmp_path / "cabecalho_export.pdf"
    svg.write_text("<svg><path d='M0 0'/></svg>", encoding="utf-8")
    pdf.write_bytes(b"%PDF-1.4")
    logs: list[str] = []

    class Pix:
        def save(self, path):
            Path(path).write_bytes(b"\x89PNG")

    class Page:
        def get_pixmap(self, dpi=300):
            assert dpi == 300
            return Pix()

    class Pdf:
        def __getitem__(self, _i):
            return Page()

        def close(self):
            return None

    fake_fitz = MagicMock()
    fake_fitz.open.return_value = Pdf()
    with patch.dict(sys.modules, {"fitz": fake_fitz}):
        got = _caminho_para_word(str(svg), logs)
    assert got.lower().endswith("_word.png")
    assert Path(got).is_file()
    assert "rasterizado" in " ".join(logs)


def test_export_cabecalho_so_camara_e_cabecalho():
    cam = MagicMock()
    cam.Name = 'Camara'
    cab = MagicMock()
    cab.Name = 'Cabecalho'
    indice = {
        'Camara': [{'pagina': 1, 'shape': cam}],
        'Cabecalho': [{'pagina': 1, 'shape': cab}],
        'Brasao': [{'pagina': 1, 'shape': MagicMock(Name='Brasao')}],
        'Rodape': [{'pagina': 1, 'shape': MagicMock(Name='Rodape')}],
    }
    logs: list[str] = []
    got = _coletar_shapes_por_nomes(
        MagicMock(), indice, ('Camara', 'Cabecalho'), logs, 'Cabecalho'
    )
    assert got == [cam, cab]
    assert 'Brasao' not in ' '.join(logs)


def test_export_camara_aceita_acento_no_indice():
    cam = MagicMock()
    cam.Name = 'Câmara'
    cab = MagicMock()
    cab.Name = 'Cabecalho'
    indice = {
        'Câmara': [{'pagina': 1, 'shape': cam}],
        'Cabecalho': [{'pagina': 1, 'shape': cab}],
    }
    got = _coletar_shapes_por_nomes(
        MagicMock(), indice, ('Camara', 'Cabecalho'), [], 'Cabecalho'
    )
    assert got == [cam, cab]


def test_export_falha_se_faltar_objeto_nomeado():
    indice = {'Cabecalho': [{'pagina': 1, 'shape': MagicMock()}]}
    with pytest.raises(CorelGenerationError, match='Camara'):
        _coletar_shapes_por_nomes(
            MagicMock(), indice, ('Camara', 'Cabecalho'), [], 'Cabecalho'
        )


def test_export_rodape_so_rodape():
    rod = MagicMock()
    rod.Name = 'Rodape'
    indice = {
        'Rodape': [{'pagina': 1, 'shape': rod}],
        'Cabecalho': [{'pagina': 1, 'shape': MagicMock()}],
    }
    got = _coletar_shapes_por_nomes(
        MagicMock(), indice, ('Rodape',), [], 'Rodape'
    )
    assert got == [rod]


def test_deslocamento_traz_camara_e_cabecalho_para_a_pagina():
    cam = MagicMock()
    cam.LeftX, cam.BottomY, cam.RightX, cam.TopY = 10.0, 48.0, 30.0, 50.0
    cam.SizeWidth, cam.SizeHeight = 20.0, 2.0
    cab = MagicMock()
    cab.LeftX, cab.BottomY, cab.RightX, cab.TopY = 10.0, 40.0, 30.0, 47.0
    cab.SizeWidth, cab.SizeHeight = 20.0, 7.0
    dx, dy = _deslocamento_para_pagina([cam, cab], 10.0)
    assert dx == pytest.approx(-10.0)
    assert dy == pytest.approx(-40.0)


def test_word_encaixa_faixa_pela_proporcao_do_arquivo(tmp_path):
    png = tmp_path / "cab.png"
    png.write_bytes(b"\x89PNG")

    class Pic:
        Width = 328.0
        Height = 28.0
        LockAspectRatio = 0

    class Placeholder:
        Width = 328.0
        Height = 28.0

        def __init__(self, pic: Pic):
            self.Range = MagicMock()
            self.Range.InlineShapes.AddPicture.return_value = pic

        def Delete(self):
            return None

    pic = Pic()
    with patch(
        "timbrado_a4_digital_generator._dimensao_arquivo",
        return_value=(384.0, 62.0),
    ):
        _substituir_inline_por_imagem(Placeholder(pic), str(png), [], "Cabeçalho")
    assert pic.Height == pytest.approx(28.0)
    assert pic.Width == pytest.approx(28.0 * 384.0 / 62.0)
    assert pic.Width < 328.0


def _modelo_minimo_timbrado() -> dict:
    return {"campos": {"Cabecalho": "{nome}", "Rodape": "{email}"}}


def test_preencher_fecha_sem_salvar_e_nao_altera_modelo(tmp_path):
    modelo_cdr = tmp_path / "TimbradoA4.cdr"
    modelo_cdr.write_bytes(b"modelo")
    before = (modelo_cdr.stat().st_size, modelo_cdr.stat().st_mtime)
    temp_job = tmp_path / "job"
    temp_job.mkdir()
    temp_cdr = temp_job / "timbrado_digital_working.cdr"
    close_args: list[object] = []

    class Doc:
        Dirty = True
        FullFileName = str(temp_cdr)
        Pages = MagicMock(Count=1)

        def Close(self, save=None):
            close_args.append(save)

    doc = Doc()
    corel = MagicMock()
    corel.OpenDocument.return_value = doc
    cab = tmp_path / "cab.svg"
    rod = tmp_path / "rod.svg"
    cab.write_text("<svg/>")
    rod.write_text("<svg/>")

    with (
        patch("timbrado_a4_digital_generator._corel_session") as session,
        patch("timbrado_a4_digital_generator._preparar_corel_para_edicao"),
        patch(
            "timbrado_a4_digital_generator.overlay_campos_com_templates_preview",
            return_value={"Cabecalho": "x", "Rodape": "y"},
        ),
        patch(
            "timbrado_a4_digital_generator.construir_indice_shapes_documento",
            return_value={},
        ),
        patch("timbrado_a4_digital_generator.aplicar_campo"),
        patch("timbrado_a4_digital_generator._sincronizar_documento_corel"),
        patch(
            "timbrado_a4_digital_generator._coletar_shapes_por_nomes",
            side_effect=[[MagicMock()], [MagicMock()]],
        ),
        patch(
            "timbrado_a4_digital_generator._exportar_shape_imagem",
            side_effect=[str(cab), str(rod)],
        ),
        patch("timbrado_a4_digital_generator._release_corel_after_job"),
    ):
        session.get_application.return_value = corel
        logs: list[str] = []
        got = _preencher_e_exportar_imagens(
            modelo=_modelo_minimo_timbrado(),
            dados={"nome_deputado": "Ana"},
            caminho_modelo=str(modelo_cdr),
            temp_job_dir=str(temp_job),
            cabecalho_stem=str(tmp_path / "cab"),
            rodape_stem=str(tmp_path / "rod"),
            corel_visible=False,
            models_cache_dir="",
            logs=logs,
        )

    assert got == (str(cab), str(rod))
    assert close_args == [False]
    assert doc.Dirty is False
    after = (modelo_cdr.stat().st_size, modelo_cdr.stat().st_mtime)
    assert after == before
    assert any("sem gravar" in line for line in logs)
    assert not any(line.startswith("ERRO:") for line in logs)


def test_preencher_rejeita_abrir_modelo_original(tmp_path):
    modelo_cdr = tmp_path / "TimbradoA4.cdr"
    modelo_cdr.write_bytes(b"modelo")
    temp_job = tmp_path / "job"
    temp_job.mkdir()
    close_args: list[object] = []

    class Doc:
        Dirty = True
        FullFileName = str(modelo_cdr.resolve())
        Pages = MagicMock(Count=1)

        def Close(self, save=None):
            close_args.append(save)

    doc = Doc()
    corel = MagicMock()
    corel.OpenDocument.return_value = doc

    with (
        patch("timbrado_a4_digital_generator._corel_session") as session,
        patch("timbrado_a4_digital_generator._preparar_corel_para_edicao"),
        patch("timbrado_a4_digital_generator._release_corel_after_job"),
    ):
        session.get_application.return_value = corel
        logs: list[str] = []
        with pytest.raises(CorelGenerationError, match="cópia temporária"):
            _preencher_e_exportar_imagens(
                modelo=_modelo_minimo_timbrado(),
                dados={"nome_deputado": "Ana"},
                caminho_modelo=str(modelo_cdr),
                temp_job_dir=str(temp_job),
                cabecalho_stem=str(tmp_path / "cab"),
                rodape_stem=str(tmp_path / "rod"),
                corel_visible=False,
                models_cache_dir="",
                logs=logs,
            )

    assert close_args == [False]
    assert doc.Dirty is False

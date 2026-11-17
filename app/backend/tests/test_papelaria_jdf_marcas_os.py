"""Testes — JDF sem papel (Apogee escolhe) e PDF de marcas na pasta da OS."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest


def _pdf(path: Path) -> Path:
    path.write_bytes(b"%PDF-1.4\n%fake\n")
    return path


def test_jdf_nao_declara_papel(tmp_path: Path):
    """O papel é escolhido no Apogee: o JDF não leva Media/MediaRef/MediaLink."""
    import fitz

    from services import papelaria_jdf_service as jdf

    base = tmp_path / "base.pdf"
    doc = fitz.open()
    doc.new_page(width=420, height=595)
    doc.save(str(base))
    doc.close()
    comum = dict(
        ano=2026,
        nro=5000,
        descriptive_name="05000 - Teste",
        comment="c",
        export_folder=str(tmp_path),
        export_filename="x.pdf",
        base_pdf_path=str(base),
        base_pdf_user_name="base",
        page_w_mm=148,
        page_h_mm=210,
    )
    config = {
        "folha_mm": {"largura": 297, "altura": 210},
        "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
        "grid": {"colunas": 2, "linhas": 1},
        "espacamento_mm": {"horizontal": 0, "vertical": 0},
        "sangria_mm": 0,
        "marcas_corte": False,
        "marcas_pdf_path": None,
        "imposicao_pdf_path": None,
        "centralizar_na_folha": True,
        "work_style": "Simplex",
        "usar_pre_impresso": False,
        "jdf_import_root": None,
    }
    for xml in (
        jdf.build_apogee_jdf_xml(config=config, **comum),
        jdf.build_apogee_passthrough_jdf_xml(n_pages=1, **comum),
    ):
        assert "<Media " not in xml
        assert "MediaRef" not in xml
        assert "MediaLink" not in xml
        assert "Brand=" not in xml


class TestMarcasNaPastaOs:
    def test_copia_marcas_externas_para_sefoc(self, tmp_path: Path):
        from services import papelaria_jobs_service as jobs

        (tmp_path / "rede").mkdir()
        externo = _pdf(tmp_path / "rede" / "marcas.pdf")
        sefoc = tmp_path / "os" / "Sefoc"
        with patch.object(jobs, "get_os_folder_basename", return_value="05000-Teste"):
            cfg = jobs.ensure_marcas_pdf_na_pasta_os(
                {"marcas_corte": True, "marcas_pdf_path": str(externo)},
                ano=2026,
                nro=5000,
                sefoc_dir=str(sefoc),
            )
        dest = Path(cfg["marcas_pdf_path"])
        assert dest == sefoc / "05000-Teste-Marcas.pdf"
        assert dest.read_bytes() == externo.read_bytes()

    def test_marcas_ja_na_pasta_nao_copia(self, tmp_path: Path):
        from services import papelaria_jobs_service as jobs

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        ja = _pdf(sefoc / "05000-Teste-Marcas-OP.pdf")
        cfg_in = {"marcas_corte": True, "marcas_pdf_path": str(ja)}
        with patch.object(jobs.shutil, "copyfile") as copia:
            cfg = jobs.ensure_marcas_pdf_na_pasta_os(cfg_in, ano=2026, nro=5000, sefoc_dir=str(sefoc))
        copia.assert_not_called()
        assert cfg is cfg_in

    def test_sem_marcas_ou_inexistente(self, tmp_path: Path):
        from services import papelaria_jobs_service as jobs

        cfg = {"marcas_corte": False, "marcas_pdf_path": "x.pdf"}
        assert jobs.ensure_marcas_pdf_na_pasta_os(cfg, ano=2026, nro=5000, sefoc_dir=str(tmp_path)) is cfg
        with pytest.raises(FileNotFoundError):
            jobs.ensure_marcas_pdf_na_pasta_os(
                {"marcas_corte": True, "marcas_pdf_path": str(tmp_path / "nao.pdf")},
                ano=2026,
                nro=5000,
                sefoc_dir=str(tmp_path / "Sefoc"),
            )


class TestLimpezaPosApogee:
    def test_remove_so_auxiliares_do_lote(self, tmp_path: Path):
        from services import papelaria_jobs_service as jobs

        pastas = {5000: tmp_path / "A" / "Sefoc", 5001: tmp_path / "B" / "Sefoc"}
        for p in pastas.values():
            p.mkdir(parents=True)
        prefix = {5000: "05000-A", 5001: "05001-B"}
        aux_a = [
            _pdf(pastas[5000] / f"05000-A{s}")
            for s in ("-Marcas.pdf", "-Marcas-OP.pdf", "-ImposicaoGang.pdf", "-BaseSefoc-PreImpresso.pdf")
        ]
        aux_b = _pdf(pastas[5001] / "05001-B-BaseSefoc-PreImpresso.pdf")
        manter = [
            _pdf(pastas[5000] / "05000-A-BaseSefoc.pdf"),
            _pdf(pastas[5000] / "05000-A-Prova3.pdf"),
            _pdf(pastas[5000] / "outro-Marcas.pdf"),
        ]
        job = {"ano_protocolo": 2026, "nro_protocolo": 5000}
        dados = {"juntada_membros": [{"ano": 2026, "nro": 5001}]}
        with patch.object(
            jobs, "resolve_os_papelaria_dir", side_effect=lambda a, n, create=False: str(pastas[n])
        ), patch.object(jobs, "get_os_folder_basename", side_effect=lambda a, n: prefix[n]):
            removidos = jobs.cleanup_imposicao_intermediate_pdfs(job, dados)

        assert all(not p.exists() for p in [*aux_a, aux_b])
        assert all(p.exists() for p in manter)
        assert "05001/05001-B-BaseSefoc-PreImpresso.pdf" in removidos
        assert len(removidos) == 5

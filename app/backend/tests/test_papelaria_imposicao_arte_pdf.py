"""Imposição pré-impressa a partir do PDF base (prova sem CorelDRAW)."""
from __future__ import annotations

import os

import pytest

fitz = pytest.importorskip("fitz")


def _pdf_com_brasao(path, *, com_brasao: bool = True) -> str:
    """A4 com um «brasão» (300 desenhos encostados) e textos fora dele."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    if com_brasao:
        for i in range(20):
            for j in range(15):
                r = fitz.Rect(40 + i * 3, 30 + j * 4, 43.5 + i * 3, 34.5 + j * 4)
                page.draw_rect(r, color=None, fill=(0.1, 0.5, 0.2))
    page.draw_line((38, 800), (557, 800), color=(0.3, 0.3, 0.3))
    page.insert_text((130, 50), "CAMARA DOS DEPUTADOS", fontsize=12)
    page.insert_text((200, 820), "Rodape", fontsize=8)
    doc.save(str(path))
    doc.close()
    return str(path)


def _cor_no_ponto(pdf_path: str, x: float, y: float) -> tuple[int, int, int]:
    with fitz.open(pdf_path) as doc:
        pix = doc[0].get_pixmap(dpi=72, clip=fitz.Rect(x, y, x + 1, y + 1))
        return pix.pixel(0, 0)[:3]


def test_area_do_brasao_acha_o_grupo_grande(tmp_path):
    from services import papelaria_imposicao_arte_pdf as svc

    src = _pdf_com_brasao(tmp_path / "base.pdf")
    with fitz.open(src) as doc:
        area = svc.area_do_brasao(doc[0])
    assert area is not None
    assert area.contains(fitz.Rect(41, 31, 100, 90))
    assert area.x1 < 130  # não engole o texto ao lado


def test_area_do_brasao_none_sem_grupo_grande(tmp_path):
    from services import papelaria_imposicao_arte_pdf as svc

    src = _pdf_com_brasao(tmp_path / "base.pdf", com_brasao=False)
    with fitz.open(src) as doc:
        assert svc.area_do_brasao(doc[0]) is None


def test_gerar_pre_impresso_remove_brasao_e_mantem_texto(tmp_path):
    from services import papelaria_imposicao_arte_pdf as svc

    src = _pdf_com_brasao(tmp_path / "base.pdf")
    assert _cor_no_ponto(src, 60, 50) != (255, 255, 255)
    dest = str(tmp_path / "pre.pdf")
    logs = svc.gerar_pre_impresso_de_pdf(src, dest)
    assert any("Brasão removido" in m for m in logs)
    assert _cor_no_ponto(dest, 60, 50) == (255, 255, 255)
    with fitz.open(dest) as doc:
        texto = doc[0].get_text()
    assert "CAMARA DOS DEPUTADOS" in texto
    assert "Rodape" in texto


def test_arte_da_os_prefere_pdf_quando_prova_veio_do_servidor(tmp_path, monkeypatch):
    from services import papelaria_imposicao_arte_pdf as svc
    from services import papelaria_jobs_service as jobs

    base = _pdf_com_brasao(tmp_path / "base.pdf")
    monkeypatch.setattr(jobs, "select_os_usable_cdr", lambda a, n: {"absolute_path": "x.cdr"})
    monkeypatch.setattr(jobs, "resolve_base_sefoc_pdf_path", lambda a, n: base)

    monkeypatch.setattr(svc, "prova_gerada_no_servidor", lambda a, n: False)
    assert svc.arte_da_os(2026, 1) == {"cdr_path": "x.cdr", "arte_pdf_path": ""}

    monkeypatch.setattr(svc, "prova_gerada_no_servidor", lambda a, n: True)
    assert svc.arte_da_os(2026, 1) == {"cdr_path": "", "arte_pdf_path": base}


def test_arte_da_os_sem_cdr_usa_pdf_e_sem_nada_explica(tmp_path, monkeypatch):
    from services import papelaria_imposicao_arte_pdf as svc
    from services import papelaria_jobs_service as jobs

    def _sem_cdr(a, n):
        raise FileNotFoundError("sem cdr")

    monkeypatch.setattr(svc, "prova_gerada_no_servidor", lambda a, n: False)
    monkeypatch.setattr(jobs, "select_os_usable_cdr", _sem_cdr)
    monkeypatch.setattr(jobs, "resolve_base_sefoc_pdf_path", lambda a, n: "/b.pdf")
    assert svc.arte_da_os(2026, 7)["arte_pdf_path"] == "/b.pdf"

    def _sem_pdf(a, n):
        raise FileNotFoundError("sem pdf")

    monkeypatch.setattr(jobs, "resolve_base_sefoc_pdf_path", _sem_pdf)
    with pytest.raises(FileNotFoundError, match="nem PDF BaseSefoc"):
        svc.arte_da_os(2026, 7)


def test_aplicar_arte_no_lote_misto_e_so_pdf(tmp_path, monkeypatch):
    from services import papelaria_imposicao_arte_pdf as svc

    base = _pdf_com_brasao(tmp_path / "base.pdf")
    origem = {1: {"cdr_path": "a.cdr", "arte_pdf_path": ""}, 2: {"cdr_path": "", "arte_pdf_path": base}}
    monkeypatch.setattr(svc, "arte_da_os", lambda a, n: origem[n])
    lote = [
        {"ano": 2026, "nro": 1, "pre_pdf_path": str(tmp_path / "1-pre.pdf")},
        {"ano": 2026, "nro": 2, "pre_pdf_path": str(tmp_path / "2-pre.pdf")},
    ]
    assert svc.aplicar_arte_no_lote(lote) is False
    assert lote[0]["cdr_path"] == "a.cdr" and not lote[0].get("pre_pdf_pronto")
    assert lote[1]["pre_pdf_pronto"] is True and os.path.isfile(lote[1]["pre_pdf_path"])

    so_pdf = [{"ano": 2026, "nro": 2, "pre_pdf_path": str(tmp_path / "3-pre.pdf")}]
    assert svc.aplicar_arte_no_lote(so_pdf) is True


def test_garantir_refaz_pre_impresso_e_combinado(tmp_path, monkeypatch):
    from services import papelaria_imposicao_arte_pdf as svc
    from services import papelaria_jobs_service as jobs

    base = _pdf_com_brasao(tmp_path / "base.pdf")
    monkeypatch.setattr(jobs, "resolve_base_sefoc_pdf_path", lambda a, n: base)
    gang = str(tmp_path / "Gang.pdf")
    dados = {
        "juntada_lote": [
            {"ano": 2026, "nro": 1, "slots": 2, "pre_pdf_path": str(tmp_path / "1-pre.pdf")},
            {"ano": 2026, "nro": 2, "slots": 1, "pre_pdf_path": str(tmp_path / "2-pre.pdf")},
        ]
    }
    logs = svc.garantir_pdfs_pre_impresso(dados, gang)
    assert os.path.isfile(gang)
    with fitz.open(gang) as doc:
        assert doc.page_count == 3
    assert any("combinado refeito" in m for m in logs)

    # Com slot map, a ordem segue os slots.
    os.remove(gang)
    dados["juntada_slot_map"] = [
        {"slot": 2, "ano": 2026, "nro": 1},
        {"slot": 1, "ano": 2026, "nro": 2},
    ]
    svc.garantir_pdfs_pre_impresso(dados, gang)
    with fitz.open(gang) as doc:
        assert doc.page_count == 2

    # Tudo presente: nada é refeito.
    assert svc.garantir_pdfs_pre_impresso(dados, gang) == []

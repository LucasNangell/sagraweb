"""Testes do Análise Lab (pasta, marcas, bordas e espelhamento)."""
from __future__ import annotations

import pytest

from services import analise_lab_service as lab
from services import prova_web_render_service as render_svc


def test_validate_pasta_render_accepts_analise_lab() -> None:
    assert render_svc.validate_pasta_render("AnaliseLab") == "AnaliseLab"
    assert render_svc.validate_pasta_render("Prova1") == "Prova1"
    assert render_svc.LAB_PASTA_RENDER == "AnaliseLab"


def test_validate_pasta_render_rejects_bad() -> None:
    with pytest.raises(ValueError):
        render_svc.validate_pasta_render("../x")
    with pytest.raises(ValueError):
        render_svc.validate_pasta_render("Prova0")
    with pytest.raises(ValueError):
        render_svc.validate_pasta_render("AnaliseLab2")


def test_validate_geometry_offset() -> None:
    g = lab._validate_geometry("offset_corte", {"edge": "top", "offsetMm": 7})
    assert g == {"edge": "top", "offsetMm": 7.0}


def test_validate_geometry_accepts_all_edges() -> None:
    g = lab._validate_geometry("offset_corte", {"edge": "all", "offsetMm": 5})
    assert g["edge"] == "all"
    f = lab._validate_geometry(
        "faixa", {"edge": "all", "fromMm": 0, "toMm": 10}
    )
    assert f["edge"] == "all"


def test_validate_geometry_rejects_bad_type() -> None:
    with pytest.raises(ValueError, match="Tipo"):
        lab._validate_geometry("xyz", {})


def test_validate_geometry_grade_bounds() -> None:
    with pytest.raises(ValueError):
        lab._validate_geometry("grade", {"stepMm": 0.5})
    g = lab._validate_geometry("grade", {"stepMm": 10})
    assert g["stepMm"] == 10.0


def test_add_mark_rejects_invalid_tipo(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="Tipo"):
        lab.add_mark(
            1,
            pagina=0,
            tipo="invalido",
            geometria={},
            rotulo=None,
            cor="red",
            ponto=None,
        )


def test_canonicalize_crop_json_stable() -> None:
    a = lab._canonicalize_crop_json({"unico": {"top": 1, "left": 2, "right": 3, "bottom": 4}})
    b = lab._canonicalize_crop_json({"unico": {"left": 2, "bottom": 4, "right": 3, "top": 1}})
    assert a == b
    assert lab._canonicalize_crop_json(None) is None


def test_parse_page_spec_mixed() -> None:
    pages = lab.parse_page_spec("1-15,20,23,25-30")
    assert pages == [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 23, 25, 26, 27, 28,
        29, 30,
    ]
    assert len(pages) == 23


def test_format_page_spec_merges_overlaps() -> None:
    assert lab.format_page_spec(lab.parse_page_spec("1-5,3-8")) == "1-8"


def test_parse_page_spec_rejects_bad() -> None:
    with pytest.raises(ValueError):
        lab.parse_page_spec("0")
    with pytest.raises(ValueError):
        lab.parse_page_spec("5-1")
    with pytest.raises(ValueError):
        lab.parse_page_spec("abc")
    with pytest.raises(ValueError):
        lab.parse_page_spec("")


def test_normalize_paginas_spec_sets_first_page() -> None:
    pagina, paginas = lab._normalize_paginas(pagina=0, paginas="4,2,6-7")
    assert pagina == 2
    assert paginas == "2,4,6-7"


def test_role_to_componente_and_split() -> None:
    from services import analise_lab_items_service as items

    assert items.role_to_componente("cover-front", modo="capa_miolo") == "Capa"
    assert items.role_to_componente("page", modo="capa_miolo") == "Miolo"
    assert items.role_to_componente("page", modo="unico") == "Arq. Único"
    manifest = {
        "pages": [
            {"page": 1, "role": "cover-front"},
            {"page": 2, "role": "cover-front-inside"},
            {"page": 3, "role": "page"},
            {"page": 4, "role": "page"},
        ]
    }
    grouped = items.componente_for_pages(
        {"modo": "capa_miolo"}, manifest, [1, 2, 3, 4]
    )
    assert grouped == {"Capa": [1, 2], "Miolo": [3, 4]}


def test_item_occurrences_arquivo_e_paginas() -> None:
    from services import analise_lab_items_service as items

    manifest = {
        "pages": [
            {"page": 1, "role": "cover-front"},
            {"page": 2, "role": "page"},
            {"page": 3, "role": "page"},
        ]
    }
    assert items.item_occurrences(
        {"escopo": "pagina", "pagina": 2}, manifest
    ) == [2]
    assert items.item_occurrences(
        {"escopo": "paginas", "pagina": 2, "paginas": "2-3"}, manifest
    ) == [2, 3]
    assert items.item_occurrences(
        {"escopo": "arquivo", "pagina": 0, "componente": "Miolo"},
        manifest,
    ) == [2, 3]


def test_build_lab_consolidated_html_sections() -> None:
    from services import analise_lab_report_service as report

    sessao = {"id": 1, "versaoLabel": "v1 (Original)"}

    class _Fake:
        @staticmethod
        def list_items(_sid):
            return [
                {
                    "componente": "Capa",
                    "titulo": "Sangria",
                    "htmlSnapshot": "<h2>Sangria</h2><p>x</p>",
                    "versaoLabel": "v1 (Original)",
                },
                {
                    "componente": "Miolo",
                    "titulo": "Fonte",
                    "htmlSnapshot": "<h2>Fonte</h2><p>y</p>",
                    "versaoLabel": "v1 (Original)",
                },
            ]

    import services.analise_lab_report_service as mod

    orig = mod.items_svc
    mod.items_svc = _Fake()
    try:
        html = report.build_lab_consolidated_html(2024, 100, sessao)
    finally:
        mod.items_svc = orig
    assert "PROBLEMAS TÉCNICOS" in html
    assert "Capa" in html
    assert "Miolo" in html
    assert "Sangria" in html or "Fonte" in html

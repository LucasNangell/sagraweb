"""Fontes N:N, hierarquia de crop e concatenação do Análise Lab."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services import analise_lab_sources_service as src
from services.prova_web_crop_service import empty_crop


def test_normalize_fontes_order_and_legacy_paths() -> None:
    fontes = src.normalize_fontes(
        [
            {"path": "Original V1/miolo_b.pdf", "componente": "Miolo", "ordem": 1},
            {"path": "Original V1/capa_frente.pdf", "componente": "Capa", "ordem": 0},
            {"path": "Original V1/miolo_a.pdf", "componente": "Miolo", "ordem": 0},
            {"path": "Original V1/capa_verso.pdf", "componente": "Capa", "ordem": 1},
        ],
        modo="capa_miolo",
    )
    assert [f["path"] for f in fontes if f["componente"] == "Capa"] == [
        "Original V1/capa_frente.pdf",
        "Original V1/capa_verso.pdf",
    ]
    assert [f["ordem"] for f in fontes if f["componente"] == "Miolo"] == [0, 1]
    unico, capa, miolo = src.derive_legacy_paths(fontes, "capa_miolo")
    assert unico is None
    assert capa == "Original V1/capa_frente.pdf"
    assert miolo == "Original V1/miolo_a.pdf"


def test_fontes_from_legacy_session() -> None:
    session = {
        "modo": "capa_miolo",
        "arquivoCapa": "a/capa.pdf",
        "arquivoMiolo": "a/miolo.pdf",
        "fontes": None,
    }
    fontes = src.fontes_from_session(session)
    assert [(f["componente"], f["path"]) for f in fontes] == [
        ("Capa", "a/capa.pdf"),
        ("Miolo", "a/miolo.pdf"),
    ]


def test_validate_fontes_requires_both_slots() -> None:
    with pytest.raises(ValueError, match="capa"):
        src.validate_fontes_for_modo(
            [{"path": "m.pdf", "componente": "Miolo", "ordem": 0}],
            "capa_miolo",
        )


def test_resolve_page_crop_hierarchy() -> None:
    crop_json = {
        "miolo": {"top": 1, "right": 1, "bottom": 1, "left": 1, "source": "manual"},
        "capa": {
            "layout": "pages",
            "crop": {"top": 2, "right": 2, "bottom": 2, "left": 2, "source": "manual"},
        },
        "lab": {
            "all": {"top": 9, "right": 9, "bottom": 9, "left": 9, "source": "manual"},
            "files": {
                "m.pdf": {"top": 3, "right": 3, "bottom": 3, "left": 3, "source": "manual"}
            },
            "pages": {
                "m.pdf#2": {
                    "top": 4,
                    "right": 4,
                    "bottom": 4,
                    "left": 4,
                    "source": "manual",
                }
            },
        },
    }
    page = src.resolve_page_crop(
        crop_json, path="m.pdf", source_page=2, componente="Miolo"
    )
    assert page["top"] == 4
    file_c = src.resolve_page_crop(
        crop_json, path="m.pdf", source_page=1, componente="Miolo"
    )
    assert file_c["top"] == 3
    other = src.resolve_page_crop(
        crop_json, path="x.pdf", source_page=1, componente="Miolo"
    )
    assert other["top"] == 1
    capa = src.resolve_page_crop(
        crop_json, path="c.pdf", source_page=1, componente="Capa"
    )
    assert capa["top"] == 2
    all_c = src.resolve_page_crop(
        {"lab": {"all": {"top": 8, "right": 8, "bottom": 8, "left": 8}}},
        path="z.pdf",
        source_page=1,
        componente="Miolo",
    )
    assert all_c["top"] == 8
    ident = src.resolve_page_crop(None, path="z.pdf", source_page=1, componente="Miolo")
    assert ident == empty_crop("manual")


def test_miolo_central_swaps_left_right_on_even_sequence() -> None:
    crop_json = {
        "miolo": {"top": 1, "right": 2, "bottom": 3, "left": 8, "source": "manual"},
        "lab": {"mioloCentral": True},
    }
    odd = src.resolve_page_crop(
        crop_json,
        path="m.pdf",
        source_page=1,
        componente="Miolo",
        sequence_page=1,
    )
    even = src.resolve_page_crop(
        crop_json,
        path="m.pdf",
        source_page=2,
        componente="Miolo",
        sequence_page=2,
    )
    assert odd["left"] == 8
    assert odd["right"] == 2
    assert even["left"] == 2
    assert even["right"] == 8
    assert even["top"] == 1
    third = src.resolve_page_crop(
        crop_json,
        path="b.pdf",
        source_page=1,
        componente="Miolo",
        sequence_page=3,
    )
    assert third["left"] == 8
    assert third["right"] == 2
    page_override = src.resolve_page_crop(
        {
            **crop_json,
            "lab": {
                "mioloCentral": True,
                "pages": {
                    "m.pdf#2": {
                        "top": 0,
                        "right": 9,
                        "bottom": 0,
                        "left": 1,
                        "source": "manual",
                    }
                },
            },
        },
        path="m.pdf",
        source_page=2,
        componente="Miolo",
        sequence_page=2,
    )
    assert page_override["left"] == 1
    assert page_override["right"] == 9


def test_apply_miolo_central_unswaps_even_page_and_sets_flag() -> None:
    next_json = src.apply_crop_scope(
        None,
        scope="miolo_central",
        crop={"top": 0, "right": 8, "bottom": 0, "left": 0},
        sequence_page=2,
        fontes=[{"path": "m.pdf", "componente": "Miolo", "ordem": 0}],
    )
    assert next_json["lab"]["mioloCentral"] is True
    assert next_json["miolo"]["left"] == 8.0
    assert next_json["miolo"]["right"] == 0.0


def test_apply_miolo_component_clears_central_flag() -> None:
    next_json = src.apply_crop_scope(
        {"lab": {"mioloCentral": True}, "miolo": {"top": 1, "right": 1, "bottom": 1, "left": 8}},
        scope="component",
        crop={"top": 0, "right": 0, "bottom": 0, "left": 4},
        componente="Miolo",
        fontes=[{"path": "m.pdf", "componente": "Miolo", "ordem": 0}],
    )
    assert next_json["lab"]["mioloCentral"] is False
    assert next_json["miolo"]["left"] == 4.0


def test_apply_file_scope_clears_page_overrides() -> None:
    crop_json = {
        "lab": {
            "pages": {
                "m.pdf#1": {"top": 4, "right": 4, "bottom": 4, "left": 4},
                "other.pdf#1": {"top": 5, "right": 5, "bottom": 5, "left": 5},
            },
            "files": {},
        }
    }
    next_json = src.apply_crop_scope(
        crop_json,
        scope="file",
        crop={"top": 3, "right": 3, "bottom": 3, "left": 3},
        path="m.pdf",
    )
    assert "m.pdf#1" not in next_json["lab"]["pages"]
    assert "other.pdf#1" in next_json["lab"]["pages"]
    assert next_json["lab"]["files"]["m.pdf"]["top"] == 3.0


def test_apply_all_clears_specific_overrides() -> None:
    crop_json = {
        "miolo": {"top": 1, "right": 1, "bottom": 1, "left": 1},
        "lab": {
            "mioloCentral": True,
            "files": {"m.pdf": {"top": 2, "right": 2, "bottom": 2, "left": 2}},
            "pages": {"m.pdf#1": {"top": 3, "right": 3, "bottom": 3, "left": 3}},
        },
    }
    next_json = src.apply_crop_scope(
        crop_json,
        scope="all",
        crop={"top": 6, "right": 6, "bottom": 6, "left": 6},
    )
    assert next_json["lab"]["files"] == {}
    assert next_json["lab"]["pages"] == {}
    assert next_json["miolo"]["top"] == 6.0
    assert next_json["lab"]["all"]["top"] == 6.0
    assert next_json["lab"]["mioloCentral"] is False


def test_enrich_manifest_maps_miolo_concat_order() -> None:
    page_map = {
        "byComponent": {
            "Capa": [
                {
                    "mergedIndex": 0,
                    "path": "capa.pdf",
                    "sourcePage": 1,
                    "componente": "Capa",
                }
            ],
            "Miolo": [
                {
                    "mergedIndex": 0,
                    "path": "miolo_a.pdf",
                    "sourcePage": 1,
                    "componente": "Miolo",
                },
                {
                    "mergedIndex": 1,
                    "path": "miolo_a.pdf",
                    "sourcePage": 2,
                    "componente": "Miolo",
                },
                {
                    "mergedIndex": 2,
                    "path": "miolo_b.pdf",
                    "sourcePage": 1,
                    "componente": "Miolo",
                },
            ],
            "Arq. Único": [],
        }
    }
    pages = [
        {"page": 1, "role": "cover-front", "blank": False},
        {"page": 2, "role": "cover-front-inside", "blank": True},
        {"page": 3, "role": "page", "blank": False},
        {"page": 4, "role": "page", "blank": False},
        {"page": 5, "role": "page", "blank": False},
        {"page": 6, "role": "cover-back-inside", "blank": True},
        {"page": 7, "role": "cover-back", "blank": True},
    ]
    enriched = src.enrich_manifest_pages(pages, page_map, modo="capa_miolo")
    assert enriched[0]["sourcePath"] == "capa.pdf"
    assert enriched[1].get("sourcePath") is None
    assert enriched[2]["sourcePath"] == "miolo_a.pdf"
    assert enriched[2]["sourcePage"] == 1
    assert enriched[2]["sourceSequence"] == 1
    assert enriched[3]["sourceSequence"] == 2
    assert enriched[4]["sourcePath"] == "miolo_b.pdf"
    assert enriched[4]["sourcePage"] == 1
    assert enriched[4]["sourceSequence"] == 3


def test_concatenate_two_miolo_pdfs(tmp_path: Path) -> None:
    import fitz

    os_folder = tmp_path
    (os_folder / "Original").mkdir()
    a = os_folder / "Original" / "a.pdf"
    b = os_folder / "Original" / "b.pdf"
    doc_a = fitz.open()
    doc_a.new_page(width=200, height=300)
    doc_a.new_page(width=200, height=300)
    doc_a.save(str(a))
    doc_a.close()
    doc_b = fitz.open()
    doc_b.new_page(width=200, height=300)
    doc_b.save(str(b))
    doc_b.close()

    capa = os_folder / "Original" / "capa.pdf"
    doc_c = fitz.open()
    doc_c.new_page(width=200, height=300)
    doc_c.save(str(capa))
    doc_c.close()

    fontes = src.normalize_fontes(
        [
            {"path": "Original/capa.pdf", "componente": "Capa", "ordem": 0},
            {"path": "Original/a.pdf", "componente": "Miolo", "ordem": 0},
            {"path": "Original/b.pdf", "componente": "Miolo", "ordem": 1},
        ],
        modo="capa_miolo",
    )
    dest = tmp_path / "_lab_sources"
    abs_paths, page_map = src.concatenate_component_pdfs(
        fontes, str(os_folder), src.identity_lab_crop_json("capa_miolo"), str(dest)
    )
    miolo_entries = page_map["byComponent"]["Miolo"]
    assert [(e["path"], e["sourcePage"]) for e in miolo_entries] == [
        ("Original/a.pdf", 1),
        ("Original/a.pdf", 2),
        ("Original/b.pdf", 1),
    ]
    with fitz.open(abs_paths["Miolo"]) as merged:
        assert len(merged) == 3


def test_identity_crop_json_has_lab_section() -> None:
    payload = src.identity_lab_crop_json("capa_miolo")
    assert payload["miolo"]["top"] == 0
    assert payload["capa"]["lombadaMm"] == 0
    assert json.dumps(payload["lab"])


def test_normalize_rejects_duplicate_paths() -> None:
    with pytest.raises(ValueError, match="repetido"):
        src.normalize_fontes(
            [
                {"path": "a.pdf", "componente": "Capa", "ordem": 0},
                {"path": "a.pdf", "componente": "Miolo", "ordem": 0},
            ],
            modo="capa_miolo",
        )


def test_merge_capa_config_persists_crop() -> None:
    out = src.merge_capa_config(
        src.identity_lab_crop_json("capa_miolo"),
        {
            "layout": "pages",
            "lombadaMm": 3,
            "crop": {"top": 2, "right": 4, "bottom": 2, "left": 4},
        },
    )
    assert out["capa"]["lombadaMm"] == 3
    assert out["capa"]["crop"]["left"] == 4
    assert out["capa"]["crop"]["right"] == 4


def test_capa_structural_changed_ignores_crop_only() -> None:
    before = {
        "layout": "pages",
        "lombadaMm": 0,
        "crop": {"top": 0, "right": 0, "bottom": 0, "left": 0},
    }
    after = {
        "layout": "pages",
        "lombadaMm": 0,
        "crop": {"top": 5, "right": 5, "bottom": 5, "left": 5},
    }
    assert src.capa_structural_changed(before, after) is False
    after2 = {**after, "lombadaMm": 4}
    assert src.capa_structural_changed(before, after2) is True


def test_resolve_dirty_lab_pages_page_and_file() -> None:
    page_map = {
        "byComponent": {
            "Capa": [],
            "Miolo": [],
            "Arq. Único": [
                {
                    "mergedIndex": 0,
                    "path": "m.pdf",
                    "sourcePage": 1,
                    "componente": "Arq. Único",
                },
                {
                    "mergedIndex": 1,
                    "path": "m.pdf",
                    "sourcePage": 2,
                    "componente": "Arq. Único",
                },
                {
                    "mergedIndex": 2,
                    "path": "n.pdf",
                    "sourcePage": 1,
                    "componente": "Arq. Único",
                },
            ],
        }
    }
    manifest_pages = [
        {"page": 1, "role": "page", "blank": False},
        {"page": 2, "role": "page", "blank": False},
        {"page": 3, "role": "page", "blank": False},
    ]
    dirty = src.resolve_dirty_lab_pages(
        scope="page",
        path="m.pdf",
        source_page=2,
        componente="Arq. Único",
        fontes=[],
        page_map=page_map,
        crop_json=None,
        modo="unico",
        manifest_pages=manifest_pages,
    )
    assert dirty == {2}

    dirty_file = src.resolve_dirty_lab_pages(
        scope="file",
        path="m.pdf",
        source_page=None,
        componente="Arq. Único",
        fontes=[],
        page_map=page_map,
        crop_json=None,
        modo="unico",
        manifest_pages=manifest_pages,
    )
    assert dirty_file == {1, 2}

    assert (
        src.resolve_dirty_lab_pages(
            scope="all",
            path=None,
            source_page=None,
            componente=None,
            fontes=[],
            page_map=page_map,
            crop_json=None,
            modo="unico",
            manifest_pages=manifest_pages,
        )
        is None
    )


def test_progressive_publish_writes_partial_manifest(tmp_path: Path) -> None:
    import fitz

    from services import prova_web_render_service as render_svc

    os_folder = tmp_path / "os"
    pdf = os_folder / "doc.pdf"
    os_folder.mkdir()
    doc = fitz.open()
    for _ in range(3):
        doc.new_page(width=200, height=300)
    doc.save(str(pdf))
    doc.close()

    published: list[int] = []

    def on_page(meta: dict) -> None:
        published.append(int(meta["page"]))
        cache = render_svc.resolve_web_render_dir(str(os_folder), "AnaliseLab")
        man_path = Path(cache) / "manifest.json"
        assert man_path.is_file()
        data = json.loads(man_path.read_text(encoding="utf-8"))
        assert data.get("partial") is True
        assert len(data["pages"]) == len(published)

    manifest = render_svc.ensure_prova_web_pages(
        2026,
        1,
        mode="unico",
        source_paths=[str(pdf)],
        os_folder=str(os_folder),
        pasta_render="AnaliseLab",
        crop_json={"unico": empty_crop()},
        progressive_publish=True,
        page_published_callback=on_page,
    )
    assert published == [1, 2, 3]
    assert manifest.get("partial") is False
    assert manifest["pageCount"] == 3
    cache = render_svc.resolve_web_render_dir(str(os_folder), "AnaliseLab")
    assert (Path(cache) / "page_1.png").is_file()
    assert (Path(cache) / "page_3.png").is_file()

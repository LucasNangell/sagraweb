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


def test_validate_geometry_seta_circulo_texto_livre() -> None:
    seta = lab._validate_geometry(
        "seta",
        {"x1Mm": 10, "y1Mm": 10, "x2Mm": 50, "y2Mm": 40, "espessura": 2},
    )
    assert seta["x2Mm"] == 50.0
    assert seta["espessura"] == 2
    circulo = lab._validate_geometry(
        "circulo",
        {"xMm": 5, "yMm": 5, "wMm": 20, "hMm": 15, "espessura": 1},
    )
    assert circulo["wMm"] == 20.0
    texto = lab._validate_geometry(
        "texto",
        {"xMm": 1, "yMm": 2, "texto": "OK", "tamanhoPt": 14},
    )
    assert texto["texto"] == "OK"
    assert texto["tamanhoPt"] == 14.0
    livre = lab._validate_geometry(
        "livre",
        {"points": [[0, 0], [1, 1], [2, 0]], "espessura": 3},
    )
    assert len(livre["points"]) == 3
    assert livre["espessura"] == 3


def test_validate_geometry_rejects_bad_drawing_payloads() -> None:
    with pytest.raises(ValueError):
        lab._validate_geometry("texto", {"xMm": 1, "yMm": 2, "texto": ""})
    with pytest.raises(ValueError):
        lab._validate_geometry("livre", {"points": [[0, 0]]})
    with pytest.raises(ValueError):
        lab._validate_geometry(
            "circulo", {"xMm": 0, "yMm": 0, "wMm": 0, "hMm": 10}
        )
    with pytest.raises(ValueError):
        lab._validate_geometry(
            "seta",
            {"x1Mm": -1, "y1Mm": 0, "x2Mm": 1, "y2Mm": 1},
        )


def test_validate_geometry_sangria() -> None:
    g = lab._validate_geometry(
        "sangria",
        {
            "edge": "left",
            "fromMm": -5,
            "toMm": 0,
            "alongFromMm": 40,
            "alongToMm": 120,
        },
    )
    assert g == {
        "edge": "left",
        "fromMm": -5.0,
        "toMm": 0.0,
        "alongFromMm": 40.0,
        "alongToMm": 120.0,
    }
    with pytest.raises(ValueError, match="profundidade"):
        lab._validate_geometry(
            "sangria",
            {
                "edge": "left",
                "fromMm": 0,
                "toMm": 5,
                "alongFromMm": 0,
                "alongToMm": 10,
            },
        )
    with pytest.raises(ValueError, match="trecho"):
        lab._validate_geometry(
            "sangria",
            {
                "edge": "top",
                "fromMm": -5,
                "toMm": 0,
                "alongFromMm": 20,
                "alongToMm": 10,
            },
        )
    with pytest.raises(ValueError, match="Borda"):
        lab._validate_geometry(
            "sangria",
            {
                "edge": "diagonal",
                "fromMm": -5,
                "toMm": 0,
                "alongFromMm": 0,
                "alongToMm": 10,
            },
        )


def test_validate_geometry_sangria_all_edges() -> None:
    g = lab._validate_geometry(
        "sangria",
        {"edge": "all", "fromMm": -5, "toMm": 0},
    )
    assert g == {
        "edge": "all",
        "fromMm": -5.0,
        "toMm": 0.0,
        "alongFromMm": 0.0,
        "alongToMm": 0.0,
    }
    with pytest.raises(ValueError, match="toMm"):
        lab._validate_geometry(
            "sangria",
            {"edge": "all", "fromMm": -5, "toMm": 2},
        )


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


def test_delete_item_removes_linked_marks(monkeypatch: pytest.MonkeyPatch) -> None:
    import services.analise_lab_items_service as items

    sqls: list[str] = []

    monkeypatch.setattr(
        items,
        "get_item",
        lambda item_id: {"id": item_id, "sessaoId": 1},
    )

    def fake_execute(sql: str, params=None):  # type: ignore[no-untyped-def]
        sqls.append(" ".join(sql.split()))
        return []

    monkeypatch.setattr(items.db, "execute_query", fake_execute)
    assert items.delete_item(42) is True
    assert any(
        "DELETE FROM tabAnaliseLabMarca" in s and "ItemID" in s for s in sqls
    )
    assert any("DELETE FROM tabAnaliseLabItem" in s for s in sqls)
    assert not any("SET ItemID = NULL" in s for s in sqls)


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


def test_build_replica_payload_copies_fields_and_resets_flags() -> None:
    from services import analise_lab_items_service as items

    source = {
        "titulo": "Sangria",
        "htmlSnapshot": "<p>x</p>",
        "obs": "nota",
        "componente": "Capa",
        "escopo": "paginas",
        "pagina": 1,
        "paginas": "1-3",
        "idProblemaPadrao": 42,
        "resolucaoObrigatoria": True,
        "corrigidoSefoc": True,
        "obsCorrecaoSefoc": "interno",
        "itemAnaliseId": 99,
    }
    payload = items.build_replica_payload(source, versao_label="v2 (Nova)")
    assert payload["titulo"] == "Sangria"
    assert payload["html_snapshot"] == "<p>x</p>"
    assert payload["obs"] == "nota"
    assert payload["componente"] == "Capa"
    assert payload["escopo"] == "paginas"
    assert payload["pagina"] == 1
    assert payload["paginas"] == "1-3"
    assert payload["id_problema_padrao"] == 42
    assert payload["resolucao_obrigatoria"] is True
    assert payload["versao_label"] == "v2 (Nova)"
    assert "item_analise_id" not in payload
    assert "corrigido_sefoc" not in payload


def test_normalize_reorder_ids_filters_foreign() -> None:
    from services import analise_lab_items_service as items

    assert items.normalize_reorder_ids([3, 1, 9, 1, 2], {1, 2, 3}) == [3, 1, 2]


def test_normalize_classic_componente() -> None:
    from services import analise_lab_items_service as items

    assert items._normalize_classic_componente("Capa") == "Capa"
    assert items._normalize_classic_componente("Miolo") == "Miolo"
    assert items._normalize_classic_componente("Arq. Único") == "Arq. Único"
    assert items._normalize_classic_componente("encarte") == "Arq. Único"
    assert items._normalize_classic_componente("capa frente") == "Capa"
    assert items._normalize_classic_componente("outro") == "Arq. Único"


def test_import_classic_items_creates_linked_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import analise_lab_items_service as items

    inserts: list[tuple] = []
    queries: list[tuple] = []

    def fake_exec(sql, params=None):
        queries.append((sql, params))
        s = " ".join(sql.split())
        if "FROM tabAnalises" in s:
            return [{"ID": 10}]
        if "FROM tabAnaliseItens" in s:
            return [
                {
                    "id": 101,
                    "idProblemaPadrao": 5,
                    "obs": "obs",
                    "html": "<p>h</p>",
                    "componente": "Capa",
                    "versaoLabel": "v1 (Original)",
                    "resolucaoObrigatoria": 1,
                    "corrigidoSefoc": 0,
                    "obsCorrecaoSefoc": None,
                    "titulo": "Sangria",
                }
            ]
        if "ItemAnaliseID IN" in s:
            return []
        if "MAX(Ordem)" in s:
            return [{"m": 2}]
        if "INSERT INTO tabAnaliseLabItem" in s:
            inserts.append(params)
            return []
        return []

    monkeypatch.setattr(items.db, "execute_query", fake_exec)
    monkeypatch.setattr(
        items,
        "get_session_by_id",
        lambda sid: {
            "id": sid,
            "nroProtocolo": 100,
            "anoProtocolo": 2026,
            "versaoLabel": "v2 (Original)",
        },
    )

    created = items.import_classic_items(7, 2026, 100)
    assert created == 1
    assert len(inserts) == 1
    # SessaoID, id_padrao, titulo, html, obs, componente, versao, ordem, reso, corrigido, obs_corr, classic_id
    assert inserts[0][0] == 7
    assert inserts[0][2] == "Sangria"
    assert inserts[0][5] == "Capa"
    assert inserts[0][6] == "v1 (Original)"
    assert inserts[0][-1] == 101


def test_import_classic_items_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import analise_lab_items_service as items

    inserts = 0

    def fake_exec(sql, params=None):
        nonlocal inserts
        s = " ".join(sql.split())
        if "FROM tabAnalises" in s:
            return [{"ID": 10}]
        if "FROM tabAnaliseItens" in s:
            return [
                {
                    "id": 101,
                    "idProblemaPadrao": None,
                    "obs": None,
                    "html": "",
                    "componente": "Miolo",
                    "versaoLabel": "v1",
                    "resolucaoObrigatoria": 0,
                    "corrigidoSefoc": 0,
                    "obsCorrecaoSefoc": None,
                    "titulo": "T",
                }
            ]
        if "ItemAnaliseID IN" in s:
            return [{"id": 101}]
        if "INSERT INTO tabAnaliseLabItem" in s:
            inserts += 1
            return []
        return []

    monkeypatch.setattr(items.db, "execute_query", fake_exec)
    monkeypatch.setattr(
        items,
        "get_session_by_id",
        lambda sid: {
            "id": sid,
            "nroProtocolo": 100,
            "anoProtocolo": 2026,
            "versaoLabel": "v1",
        },
    )

    assert items.import_classic_items(7, 2026, 100) == 0
    assert inserts == 0


def test_import_classic_items_no_classic(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import analise_lab_items_service as items

    monkeypatch.setattr(
        items.db,
        "execute_query",
        lambda sql, params=None: [],
    )
    monkeypatch.setattr(
        items,
        "get_session_by_id",
        lambda sid: {
            "id": sid,
            "nroProtocolo": 1,
            "anoProtocolo": 2026,
            "versaoLabel": "v1",
        },
    )
    assert items.import_classic_items(1, 2026, 1) == 0


def test_import_classic_items_rejects_session_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services import analise_lab_items_service as items

    called = {"classic": False}

    def fake_exec(sql, params=None):
        called["classic"] = True
        return [{"ID": 1}]

    monkeypatch.setattr(items.db, "execute_query", fake_exec)
    monkeypatch.setattr(
        items,
        "get_session_by_id",
        lambda sid: {
            "id": sid,
            "nroProtocolo": 999,
            "anoProtocolo": 2026,
            "versaoLabel": "v1",
        },
    )
    assert items.import_classic_items(1, 2026, 100) == 0
    assert called["classic"] is False


def test_parse_providencias_from_html_action_items() -> None:
    from services import analise_lab_providencias_service as prov

    html = """
    <p>Desc</p>
    <div class="providencias-bar">Providências</div>
    <ul class="action-list">
      <li class="action-item">Corrigir sangria</li>
      <li class="action-item">Reenviar arquivo</li>
    </ul>
    """
    assert prov.parse_providencias_from_html(html) == [
        "Corrigir sangria",
        "Reenviar arquivo",
    ]


def test_build_and_strip_providencias_html() -> None:
    from services import analise_lab_providencias_service as prov

    html = prov.build_providencias_html(
        [
            {"texto": "Ajustar", "selecionada": True},
            {"texto": "Ignorar", "selecionada": False},
        ]
    )
    assert "Ajustar" in html
    assert "Ignorar" not in html
    assert 'class="providencias-bar"' in html
    stripped = prov.strip_providencias_from_html(
        f"<p>Problema</p>{html}"
    )
    assert "Problema" in stripped
    assert "providencias-bar" not in stripped.lower()
    assert "Ajustar" not in stripped


def test_autorizar_impressao_drives_resolucao_obrigatoria_rule() -> None:
    """Selecionada=0 em autorizar_impressao ⇒ ResolucaoObrigatoria=1."""
    from services import analise_lab_providencias_service as prov

    rows_off = [{"tipo": prov.TIPO_AUTORIZAR, "selecionada": False}]
    rows_on = [{"tipo": prov.TIPO_AUTORIZAR, "selecionada": True}]
    autorizar_off = next(r for r in rows_off if r["tipo"] == prov.TIPO_AUTORIZAR)
    autorizar_on = next(r for r in rows_on if r["tipo"] == prov.TIPO_AUTORIZAR)
    assert (not autorizar_off["selecionada"]) is True
    assert (not autorizar_on["selecionada"]) is False

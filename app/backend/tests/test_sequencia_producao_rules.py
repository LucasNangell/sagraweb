from __future__ import annotations

from services.sequencia_producao_rules import generate_sequencia_draft


def _sample_os(**overrides):
    row = {
        "NroProtocolo": 123,
        "AnoProtocolo": 2026,
        "Titulo": "Revista de teste",
        "TipoPublicacaoLink": "Revista",
        "FormatoLink": "A5",
        "MaquinaLink": "Offset",
        "Tiragem": 1000,
        "Pags": 20,
        "FrenteVerso": "S",
        "PapelDescricao": "",
        "CoresDescricao": "",
        "DescAcabamento": "Grampo canoa",
        "Observ": "",
    }
    row.update(overrides)
    return row


def test_generate_sequencia_from_techspec_components():
    draft = generate_sequencia_draft(
        _sample_os(),
        [
            {
                "id": 1,
                "nome": "Capa",
                "tipo": "capa",
                "ordem": 1,
                "lotes": [
                    {
                        "paginas": 4,
                        "papel_desc": "Couche Fosco 170g",
                        "cores_desc": "4x4",
                    }
                ],
                "acabamentos": [],
            },
            {
                "id": 2,
                "nome": "Miolo",
                "tipo": "miolo",
                "ordem": 2,
                "lotes": [
                    {
                        "paginas": 16,
                        "papel_desc": "AP 90g",
                        "cores_desc": "4x4",
                    }
                ],
                "acabamentos": [],
            },
        ],
    )

    blocks = draft.sections[0].blocks
    impressao = next(block for block in blocks if block.id == "impressao-formato")
    assert "Capa: 656 x 470mm" in impressao.lines[1]
    assert "Miolo: 656 x 470mm" in impressao.lines[2]
    assert next(block for block in blocks if block.id == "encadernacao-canoa").lines == [
        "2 grampos"
    ]


def test_generate_sequencia_warns_when_only_text_fields_are_available():
    draft = generate_sequencia_draft(
        _sample_os(PapelDescricao="Capa: CF 170g; Miolo: AP 90g"),
        [],
    )

    assert draft.confidence == "review"
    assert any("Componentes técnicos" in warning for warning in draft.warnings)
    assert draft.sections[0].blocks

def test_generated_draft_is_serializable():
    draft = generate_sequencia_draft(_sample_os(), [])
    payload = draft.model_dump(mode="json")

    assert payload["version"] == 1
    assert payload["os"]["numero"] == 123
    assert payload["sections"][0]["blocks"]

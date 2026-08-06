"""Testes — filtro de anexos inline na caixa de entrada."""

from routers.email_routes import _build_inbox_attachment_payload, _normalize_content_id


def test_normalize_content_id_strips_brackets_and_lowercase():
    assert _normalize_content_id("<ABC@123>") == "abc@123"
    assert _normalize_content_id("  CID:XYZ  ") == "cid:xyz"


def test_build_inbox_attachment_payload_filters_inline():
    all_atts = [
        {
            "name": "inline.png",
            "attachment_id": "a1",
            "is_inline": True,
            "content_id": "<img001@test>",
        },
        {
            "name": "documento.pdf",
            "attachment_id": "a2",
            "is_inline": False,
            "content_id": "",
        },
        {
            "name": "inline2.jpg",
            "attachment_id": "a3",
            "is_inline": True,
            "content_id": "img002@test",
        },
    ]

    display, inline = _build_inbox_attachment_payload(all_atts)

    assert display == [
        {"name": "documento.pdf", "index": 2},
    ]
    assert inline == {
        "img001@test": 1,
        "img002@test": 3,
    }

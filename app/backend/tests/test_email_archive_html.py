"""Testes do snapshot HTML autocontido de e-mails."""
from __future__ import annotations

import base64

from services.email_archive_html import (
    build_email_archive_html,
    build_email_archive_html_from_details,
)


def test_build_email_archive_html_embeds_cid_and_escapes_headers() -> None:
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    html = build_email_archive_html(
        subject='Assunto <script>alert(1)</script>',
        sender_name="Remetente",
        sender_email="a@b.c",
        display_to="Destinatário; Outro",
        date="2026-11-16T12:00:00Z",
        body_html='<html><body><p>Olá</p><img src="cid:img001@local"/></body></html>',
        cid_map={"img001@local": ("image/png", png)},
        attachment_names=["prova.pdf"],
    ).decode("utf-8")

    assert "<!DOCTYPE html>" in html
    assert "Assunto &lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "Remetente &lt;a@b.c&gt;" in html
    assert "Destinatário; Outro" in html
    assert "data:image/png;base64," in html
    assert "cid:img001@local" not in html
    assert "prova.pdf" in html
    assert "Olá" in html


def test_build_from_details_downloads_inline_attachments() -> None:
    png = b"\x89PNG\r\n\x1a\n"

    class _Svc:
        def get_attachment_content(self, attachment_id: str):
            assert attachment_id == "att-1"
            return "banner.png", png

    details = {
        "subject": "PT OS 1",
        "sender_name": "Sepim",
        "sender_email": "sepim@camara.leg.br",
        "display_to": "Gabinete",
        "date": "2026-11-16",
        "body": '<img src="cid:banner001">',
        "attachments": [
            {
                "name": "banner.png",
                "attachment_id": "att-1",
                "is_inline": True,
                "content_id": "banner001",
            },
            {
                "name": "arquivo.pdf",
                "attachment_id": "att-2",
                "is_inline": False,
                "content_id": "",
            },
        ],
    }
    html = build_email_archive_html_from_details(_Svc(), details).decode("utf-8")
    assert "data:image/png;base64," in html
    assert "arquivo.pdf" in html
    assert "Gabinete" in html

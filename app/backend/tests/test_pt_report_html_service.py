"""Testes — normalização do relatório PT para e-mail inline."""

from __future__ import annotations



import base64



from services.pt_report_html_service import (

    absolutize_api_media_urls_for_preview,

    embed_indication_images_for_email,

    is_manual_tecnico_label,

    normalize_item_snapshot_for_report,

    prepare_pt_inline_email_inner_html,

    relax_pt_inline_email_wrapper_styles,

    strip_manual_tecnico_labels,

)





class TestManualTecnicoLabelOnly:

    def test_is_manual_tecnico_label_exact(self):

        assert is_manual_tecnico_label("Manual Técnico") is True

        assert is_manual_tecnico_label("<strong>Manual Técnico</strong>") is True

        assert is_manual_tecnico_label("ACABAMENTO - FUROS MUITO PRÓXIMOS") is False

        assert is_manual_tecnico_label("Problemas Técnicos") is False



    def test_strips_only_manual_tecnico_paragraph(self):

        manual = "Manual T\u00e9cnico"

        snapshot = (

            '<div class="document-container">'

            f'<p class="section-title">{manual}</p>'

            '<h2 class="section-title">ACABAMENTO - FUROS MUITO PR\u00d3XIMOS DA \u00c1REA DE CORTE</h2>'

            '<p class="alert-sefoc">A posi\u00e7\u00e3o dos furos est\u00e1 muito pr\u00f3xima da borda</p>'

            "</div>"

        )

        out = strip_manual_tecnico_labels(snapshot)

        assert manual not in out

        assert "ACABAMENTO - FUROS" in out

        assert "furos est\u00e1 muito pr\u00f3xima" in out



    def test_preserves_item_title_matching_titulopt(self):

        snapshot = """

        <h2>Formato de arquivo</h2>

        <p>Corpo do item</p>

        """

        out = normalize_item_snapshot_for_report(

            snapshot,

            item_titulo="Formato de arquivo",

        )

        assert "Formato de arquivo" in out

        assert "Corpo do item" in out



    def test_strips_plain_paragraph_manual_tecnico(self):

        snapshot = """

        <p><strong>Manual Técnico</strong></p>

        <p>Arquivo encaminhado em formato .doc</p>

        """

        out = strip_manual_tecnico_labels(snapshot)

        assert "Manual Técnico" not in out

        assert ".doc" in out





class TestPreparePtInlineEmailInnerHtml:

    def test_injects_pt_document_styles(self):

        inner = "<div class='item-snapshot'><p class='alert-sefoc'>Alerta</p></div>"

        out = prepare_pt_inline_email_inner_html(inner)

        assert "<style" in out

        assert ".section-title" in out

        assert ".alert-sefoc" in out

        assert "pt-email-report" in out

        assert "Alerta" in out



    def test_normalizes_saved_consolidated_snapshots(self):

        inner = (

            "<div class='item-snapshot'>"

            "<p class='section-title'>Manual Técnico</p>"

            "<h2>TÍTULO DO PROBLEMA</h2><p>Item 1</p>"

            "</div>"

        )

        out = prepare_pt_inline_email_inner_html(inner)

        assert "Manual Técnico" not in out

        assert "TÍTULO DO PROBLEMA" in out

        assert "Item 1" in out



    def test_does_not_embed_images_at_render_time(self, tmp_path, monkeypatch):

        item_id = 55

        storage_dir = tmp_path / "storage" / "analise_indications" / str(item_id)

        storage_dir.mkdir(parents=True)

        (storage_dir / "mark.png").write_bytes(b"png-data")

        monkeypatch.chdir(tmp_path)



        inner = (

            "<div class='item-snapshot'>"

            f'<img src="/api/analise/item/{item_id}/indication/mark.png">'

            "</div>"

        )

        out = prepare_pt_inline_email_inner_html(inner)

        assert "/api/analise/item/" in out

        assert "cid:" not in out

        assert "data:image" not in out





class TestRelaxWrapperStyles:

    def test_removes_calibri_override_on_wrapper(self):

        html = (

            '<div style="margin: 0 0 28px 0; font-size: 16px; line-height: 1.45; '

            'color: #000000; font-family: Calibri, sans-serif;">'

            "<p>Corpo</p></div>"

        )

        out = relax_pt_inline_email_wrapper_styles(html)

        assert "font-family: Calibri" not in out

        assert "Corpo" in out





class TestEmbedIndicationImages:

    def test_embeds_api_indication_url_as_cid(self, tmp_path, monkeypatch):

        item_id = 42

        filename = "captura.png"

        storage_dir = tmp_path / "storage" / "analise_indications" / str(item_id)

        storage_dir.mkdir(parents=True)

        image_bytes = b"\x89PNG\r\n\x1a\nfake-png-content"

        (storage_dir / filename).write_bytes(image_bytes)



        monkeypatch.chdir(tmp_path)



        html = (

            "<h3>Indicação do problema no arquivo</h3>"

            f'<img src="/api/analise/item/{item_id}/indication/{filename}" alt="Indicação">'

        )

        out, inline = embed_indication_images_for_email(html)



        assert "/api/analise/item/" not in out

        assert "data:image" not in out

        assert "cid:ind-" in out

        assert len(inline) == 1

        assert inline[0].filename == filename

        assert inline[0].content == image_bytes

        assert inline[0].content_id in out



    def test_embeds_absolute_url_with_query(self, tmp_path, monkeypatch):

        item_id = 7

        filename = "shot.jpg"

        storage_dir = tmp_path / "storage" / "analise_indications" / str(item_id)

        storage_dir.mkdir(parents=True)

        (storage_dir / filename).write_bytes(b"jpeg-bytes")



        monkeypatch.chdir(tmp_path)



        html = (

            '<img src="https://sagra.local/api/analise/item/7/indication/shot.jpg'

            '?token=abc&os=100&ano=2026" alt="">'

        )

        out, inline = embed_indication_images_for_email(html)



        assert "cid:ind-" in out

        assert "sagra.local" not in out

        assert len(inline) == 1

        assert inline[0].mime_type == "image/jpeg"



    def test_embeds_existing_data_url_as_cid(self):

        raw = b"fake-image-bytes"

        data_url = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")

        html = f'<img src="{data_url}" alt="">'

        out, inline = embed_indication_images_for_email(html)



        assert "data:image" not in out

        assert "cid:ind-" in out

        assert len(inline) == 1

        assert inline[0].content == raw



    def test_absolutize_preview_urls(self):

        html = '<img src="/api/analise/item/1/indication/a.png">'

        out = absolutize_api_media_urls_for_preview(html, "https://sagra.camara.leg.br")

        assert 'src="https://sagra.camara.leg.br/api/analise/item/1/indication/a.png"' in out



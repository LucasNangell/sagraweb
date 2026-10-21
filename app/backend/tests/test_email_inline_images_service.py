"""Testes de embutimento de imagens (cid:) no corpo dos e-mails."""
from __future__ import annotations

import base64

import pytest
import requests
from lxml import etree

from services import email_inline_images_service as svc
from services.email_inline_images_service import (
    MAX_IMAGE_BYTES,
    download_image,
    embed_images_for_email,
    is_allowed_image_host,
)

PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-png"


PROOF_DRIVE_HTML = (
    '<img src="https://drive.google.com/uc?export=view&id=1VS_n8YA39TJR6XJBeH7UStcwjloXtZGC">'
    '<img src="https://drive.google.com/uc?export=view&id=1862FeQwKpoYYijvaquofPG7278nAxDHS">'
    '<img src="https://drive.google.com/uc?export=view&id=1U-x8Fxj-vKbFvLfahVx_KNAkI_Ny5L6W">'
    '<img src="https://drive.google.com/uc?export=view&id=1qbGsxjtwomsSl4yWNJ8O4CcVs4njhCgd">'
)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    monkeypatch.delenv("EMAIL_INLINE_IMAGE_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv("EMAIL_IMAGES_DIR", raising=False)
    monkeypatch.setenv("SAGRA_PUBLIC_WEB_BASE", "http://cgrafsysvm")


def _write_email_images(tmp_path, names=("header.png",)):
    for name in names:
        (tmp_path / name).write_bytes(PNG_BYTES)
    return tmp_path


class FakeResponse:
    def __init__(self, status=200, content=PNG_BYTES, content_type="image/png", headers=None):
        self.status_code = status
        self._content = content
        self.headers = {"Content-Type": content_type, **(headers or {})}
        self.closed = False

    def iter_content(self, chunk_size=1):
        for i in range(0, len(self._content), chunk_size):
            yield self._content[i : i + chunk_size]

    def close(self):
        self.closed = True


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.trust_env = True
        self.proxies = {"https": "http://proxy"}

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class TestAllowedHosts:
    @pytest.mark.parametrize(
        "host",
        [
            "cgrafsysvm",
            "CGRAFSYSVM",
            "intranet.camara.leg.br",
            "camara.leg.br",
            "www2.camara.gov.br",
            "cgraf.online",
            "www.cgraf.online",
        ],
    )
    def test_intranet_hosts_allowed(self, host):
        assert is_allowed_image_host(host)

    @pytest.mark.parametrize(
        "host",
        ["", "localhost", "example.com", "camara.leg.br.evil.com", "evilcamara.leg.br", "10.0.0.5"],
    )
    def test_other_hosts_blocked(self, host):
        assert not is_allowed_image_host(host)

    def test_env_extends_allowlist(self, monkeypatch):
        monkeypatch.setenv("EMAIL_INLINE_IMAGE_ALLOWED_HOSTS", "cdn.exemplo.com, *.interno.org")
        assert is_allowed_image_host("cdn.exemplo.com")
        assert is_allowed_image_host("a.interno.org")
        assert not is_allowed_image_host("outro.exemplo.com")


class TestEmbedImagesForEmail:
    def test_data_uri_becomes_cid(self):
        payload = base64.b64encode(PNG_BYTES).decode("ascii")
        html = f'<p><img src="data:image/png;base64,{payload}" alt=""></p>'

        out, images = embed_images_for_email(html, downloader=lambda _u: pytest.fail("sem download"))

        assert len(images) == 1
        filename, raw, cid, mime = images[0]
        assert raw == PNG_BYTES
        assert mime == "image/png"
        assert filename == "imagem.png"
        assert f'src="cid:{cid}"' in out
        assert "data:image" not in out

    def test_allowed_https_becomes_cid(self):
        html = "<img alt='logo' src='https://intranet.camara.leg.br/img/logo.png?v=1&amp;x=2'>"
        requested = []

        def downloader(url):
            requested.append(url)
            return PNG_BYTES, "image/png"

        out, images = embed_images_for_email(html, downloader=downloader)

        assert requested == ["https://intranet.camara.leg.br/img/logo.png?v=1&x=2"]
        assert images[0][0] == "logo.png"
        assert f"src='cid:{images[0][2]}'" in out

    def test_disallowed_host_keeps_url(self):
        html = '<img src="https://example.com/a.png">'
        out, images = embed_images_for_email(html, downloader=lambda _u: pytest.fail("sem download"))
        assert out == html
        assert images == []

    def test_failed_download_keeps_url(self):
        html = '<img src="http://cgrafsysvm/a.png">'
        out, images = embed_images_for_email(html, downloader=lambda _u: None)
        assert out == html
        assert images == []

    def test_duplicate_urls_share_cid(self):
        html = '<img src="http://cgrafsysvm/a.png"><img src="http://cgrafsysvm/a.png">'
        calls = []

        def downloader(url):
            calls.append(url)
            return PNG_BYTES, "image/png"

        out, images = embed_images_for_email(html, downloader=downloader)

        assert len(calls) == 1
        assert len(images) == 1
        assert out.count(f'src="cid:{images[0][2]}"') == 2

    def test_existing_cid_untouched(self):
        html = '<img src="cid:ind-1-abc@sagra">'
        out, images = embed_images_for_email(html)
        assert out == html
        assert images == []

    def test_limit_of_images(self, monkeypatch):
        monkeypatch.setattr(svc, "MAX_IMAGES_PER_EMAIL", 2)
        html = "".join(f'<img src="http://cgrafsysvm/{i}.png">' for i in range(3))
        out, images = embed_images_for_email(html, downloader=lambda _u: (PNG_BYTES, "image/png"))
        assert len(images) == 2
        assert 'src="http://cgrafsysvm/2.png"' in out

    def test_email_images_path_reads_disk(self, tmp_path, monkeypatch):
        monkeypatch.setenv("EMAIL_IMAGES_DIR", str(_write_email_images(tmp_path)))
        html = '<img src="https://cgrafsysvm.camara.leg.br/email_images/header.png">'

        out, images = embed_images_for_email(html, downloader=lambda _u: pytest.fail("sem download"))

        assert len(images) == 1
        assert images[0][0] == "header.png"
        assert images[0][1] == PNG_BYTES
        assert f'src="cid:{images[0][2]}"' in out
        assert "email_images/header.png" not in out

    def test_imagensemail_path_reads_disk(self, tmp_path, monkeypatch):
        monkeypatch.setenv("EMAIL_IMAGES_DIR", str(_write_email_images(tmp_path)))
        html = '<img src="https://cgraf.online/imagensemail/header.png">'

        out, images = embed_images_for_email(html, downloader=lambda _u: pytest.fail("sem download"))

        assert len(images) == 1
        assert f'src="cid:{images[0][2]}"' in out

    def test_drive_id_maps_to_local_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("EMAIL_IMAGES_DIR", str(_write_email_images(tmp_path)))
        html = (
            '<img src="https://drive.google.com/uc?export=view&id='
            '1VS_n8YA39TJR6XJBeH7UStcwjloXtZGC">'
        )

        out, images = embed_images_for_email(html, downloader=lambda _u: pytest.fail("sem download"))

        assert len(images) == 1
        assert images[0][0] == "header.png"
        assert "drive.google.com" not in out

    def test_missing_local_email_image_falls_back_to_download(self, tmp_path, monkeypatch):
        monkeypatch.setenv("EMAIL_IMAGES_DIR", str(tmp_path))
        html = '<img src="https://cgrafsysvm.camara.leg.br/email_images/missing.png">'
        requested = []

        def downloader(url):
            requested.append(url)
            return PNG_BYTES, "image/png"

        out, images = embed_images_for_email(html, downloader=downloader)

        assert requested == ["https://cgrafsysvm.camara.leg.br/email_images/missing.png"]
        assert f'src="cid:{images[0][2]}"' in out

    def test_cgraf_online_http_is_downloaded(self):
        html = '<img src="https://cgraf.online/other/logo.png">'
        out, images = embed_images_for_email(
            html, downloader=lambda _u: (PNG_BYTES, "image/png")
        )
        assert len(images) == 1
        assert "cgraf.online" not in out


class TestDownloadImage:
    def test_success_uses_direct_connection_without_redirects(self):
        session = FakeSession([FakeResponse()])
        result = download_image("http://cgrafsysvm/a.png", verify_ssl=False, session=session)

        assert result == (PNG_BYTES, "image/png")
        assert session.trust_env is False
        assert session.proxies == {}
        _url, kwargs = session.calls[0]
        assert kwargs["allow_redirects"] is False
        assert kwargs["verify"] is False
        assert kwargs["timeout"] == svc.DOWNLOAD_TIMEOUT_SECONDS

    def test_non_image_content_type(self):
        session = FakeSession([FakeResponse(content=b"<html>", content_type="text/html")])
        assert download_image("http://cgrafsysvm/a", verify_ssl=True, session=session) is None

    def test_redirect_is_rejected(self):
        session = FakeSession([FakeResponse(status=302, headers={"Location": "https://example.com"})])
        assert download_image("http://cgrafsysvm/a.png", verify_ssl=True, session=session) is None
        assert len(session.calls) == 1

    def test_redirect_to_allowed_host_is_followed(self):
        session = FakeSession(
            [
                FakeResponse(
                    status=301,
                    headers={"Location": "https://cgrafsysvm.camara.leg.br/email_images/a.png"},
                ),
                FakeResponse(),
            ]
        )
        result = download_image("http://cgrafsysvm/a.png", verify_ssl=True, session=session)
        assert result == (PNG_BYTES, "image/png")
        assert len(session.calls) == 2
        assert session.calls[1][0] == "https://cgrafsysvm.camara.leg.br/email_images/a.png"

    def test_too_large_declared(self):
        session = FakeSession([FakeResponse(headers={"Content-Length": str(MAX_IMAGE_BYTES + 1)})])
        assert download_image("http://cgrafsysvm/a.png", verify_ssl=True, session=session) is None

    def test_too_large_streamed(self, monkeypatch):
        monkeypatch.setattr(svc, "MAX_IMAGE_BYTES", 4)
        session = FakeSession([FakeResponse(content=b"123456")])
        assert download_image("http://cgrafsysvm/a.png", verify_ssl=True, session=session) is None

    def test_timeout(self):
        session = FakeSession([requests.Timeout("lento")])
        assert download_image("http://cgrafsysvm/a.png", verify_ssl=True, session=session) is None

    def test_401_retries_with_negotiate(self, monkeypatch):
        sentinel_auth = object()
        monkeypatch.setattr(svc, "_negotiate_auth", lambda: sentinel_auth)
        session = FakeSession([FakeResponse(status=401), FakeResponse()])

        result = download_image("http://cgrafsysvm/a.png", verify_ssl=True, session=session)

        assert result == (PNG_BYTES, "image/png")
        assert session.calls[0][1]["auth"] is None
        assert session.calls[1][1]["auth"] is sentinel_auth


class TestSendEmailEmbedsImages:
    def _service(self, captured):
        from services.ews_service import EWSService

        service = EWSService(ews_url="https://example.test/EWS/Exchange.asmx")

        def fake_post(envelope: str):
            captured["envelope"] = envelope
            return etree.fromstring(
                b'<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body/></soap:Envelope>'
            )

        service._post = fake_post  # type: ignore[method-assign]
        return service

    def test_intranet_image_sent_as_inline_attachment(self, monkeypatch):
        monkeypatch.setattr(svc, "download_image", lambda url, **_kw: (PNG_BYTES, "image/png"))
        captured: dict = {}

        self._service(captured).send_email(
            to=["dest@test.local"],
            subject="Assunto",
            html_body='<p><img src="http://cgrafsysvm/logo.png"></p>',
        )

        envelope = captured["envelope"]
        assert "<t:IsInline>true</t:IsInline>" in envelope
        cid = etree.fromstring(envelope.encode("utf-8")).findtext(
            ".//{http://schemas.microsoft.com/exchange/services/2006/types}ContentId"
        )
        assert cid and cid.startswith("img-1-")
        assert f"cid:{cid}" in envelope
        assert "http://cgrafsysvm/logo.png" not in envelope
        assert base64.b64encode(PNG_BYTES).decode("ascii") in envelope

    def test_keeps_existing_inline_images(self, monkeypatch):
        monkeypatch.setattr(svc, "download_image", lambda url, **_kw: (PNG_BYTES, "image/png"))
        captured: dict = {}

        self._service(captured).send_email(
            to=["dest@test.local"],
            subject="Assunto",
            html_body='<img src="cid:ind-1@sagra"><img src="http://cgrafsysvm/x.png">',
            inline_images=[("ind.png", b"ind", "ind-1@sagra", "image/png")],
        )

        envelope = captured["envelope"]
        assert envelope.count("<t:IsInline>true</t:IsInline>") == 2
        assert "ind-1@sagra" in envelope

    def test_embed_disabled_preserves_html(self, monkeypatch):
        monkeypatch.setattr(svc, "download_image", lambda url, **_kw: pytest.fail("sem download"))
        captured: dict = {}

        self._service(captured).send_email(
            to=["dest@test.local"],
            subject="Assunto",
            html_body='<img src="http://cgrafsysvm/logo.png">',
            embed_images=False,
        )

        envelope = captured["envelope"]
        assert "http://cgrafsysvm/logo.png" in envelope
        assert "<t:Attachments>" not in envelope

    def test_proof_drive_images_sent_as_inline(self, tmp_path, monkeypatch):
        monkeypatch.setenv(
            "EMAIL_IMAGES_DIR",
            str(
                _write_email_images(
                    tmp_path,
                    ("header.png", "invite_portal.png", "acessar_sagra.png", "footer.png"),
                )
            ),
        )
        monkeypatch.setattr(svc, "download_image", lambda url, **_kw: pytest.fail("sem download"))
        captured: dict = {}

        self._service(captured).send_email(
            to=["dest@test.local"],
            subject="Prova",
            html_body=PROOF_DRIVE_HTML,
        )

        envelope = captured["envelope"]
        assert envelope.count("<t:IsInline>true</t:IsInline>") == 4
        assert "drive.google.com" not in envelope
        assert "https://cgrafsysvm.camara.leg.br/email_images/" not in envelope
        assert envelope.count("cid:img-") == 4


class TestSanitizePreservesCid:
    def test_cid_src_survives_bleach(self):
        from security.html_sanitize import sanitize_html_snapshot

        html = '<p>x</p><img src="cid:ind-1@sagra" alt="a">'
        out = sanitize_html_snapshot(html)
        assert out is not None
        assert "cid:ind-1@sagra" in out

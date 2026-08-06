"""Testes do cliente HTTP do worker."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import api_client  # noqa: E402
from api_client import PapelariaWorkerApiClient, PapelariaWorkerApiError  # noqa: E402


@pytest.fixture(autouse=True)
def reset_inspect_warning_flag():
    api_client._inspect_api_unavailable_logged = False
    yield
    api_client._inspect_api_unavailable_logged = False


def _client() -> PapelariaWorkerApiClient:
    return PapelariaWorkerApiClient(
        "https://example.test/sagra/api",
        "secret",
        "worker-1",
        ssl_verify=False,
    )


class TestClaimInspect:
    def test_403_retorna_none_sem_interromper_loop(self, monkeypatch):
        client = _client()
        calls = {"n": 0}

        def fake_request(method, url, **kwargs):
            calls["n"] += 1
            response = MagicMock()
            response.status_code = 403
            response.text = "Sessão ausente"
            response.json.return_value = {
                "detail": "Sessão ausente ou inválida. Autentique-se em POST /api/auth/session."
            }
            return response

        client.session.request = fake_request  # type: ignore[method-assign]
        assert client.claim_inspect() is None
        assert client.claim_inspect() is None
        assert calls["n"] == 2

    def test_outros_erros_propagam(self, monkeypatch):
        client = _client()

        def fake_request(method, url, **kwargs):
            response = MagicMock()
            response.status_code = 500
            response.text = "erro"
            response.json.side_effect = ValueError()
            return response

        client.session.request = fake_request  # type: ignore[method-assign]
        with pytest.raises(PapelariaWorkerApiError) as exc:
            client.claim_inspect()
        assert exc.value.status_code == 500


class TestDownloadInspectCdr:
    def test_download_salva_arquivo(self, tmp_path):
        client = _client()
        dest = tmp_path / "inspect.cdr"

        def fake_get(url, **kwargs):
            response = MagicMock()
            response.status_code = 200
            response.iter_content = lambda chunk_size: [b"RIFF-data"]
            return response

        client.session.get = fake_get  # type: ignore[method-assign]
        saved = client.download_inspect_cdr("abc123", str(dest))
        assert saved == str(dest)
        assert dest.read_bytes() == b"RIFF-data"

"""Testes HTTP da API Gravação Externa."""

from __future__ import annotations

import os
import tempfile
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from security.session_auth import SESSION_COOKIE_NAME, SessionData, create_session_token


@pytest.fixture
def gravacao_client(monkeypatch):
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setenv("SAGRA_SESSION_SECRET", "test-session-secret-32-chars-minimum!!")

    from routers.api import app

    return TestClient(app)


def _auth_cookies(ponto: int = 918713) -> dict[str, str]:
    token = create_session_token(
        SessionData(
            ponto=ponto,
            nome="Operador Teste",
            ip="127.0.0.1",
            iat=int(time.time()),
        )
    )
    return {SESSION_COOKIE_NAME: token}


def test_detail_reads_sessiondata_from_request_state(gravacao_client):
    detail = {
        "id": 2,
        "os_ano": 2024,
        "os_nro": 1209,
        "cod_status": "012092024-07",
        "lancado_por_ponto": "918.713",
        "lancado_por_nome": "João Lucas",
        "status": "pendente",
        "iniciado_por_ponto": None,
        "iniciado_em": None,
        "criado_em": None,
        "arquivos": [
            {
                "id": 4,
                "relative": "Original/foo.pdf",
                "nome": "foo.pdf",
                "tamanho_bytes": 123,
                "ordem": 0,
            }
        ],
        "mensagens": [],
    }

    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value={
            "id": 2,
            "os_ano": 2024,
            "os_nro": 1209,
            "lancado_por_ponto": "918.713",
            "status": "pendente",
        },
    ), patch(
        "routers.gravacao_externa_routes.build_session_detail",
        return_value=detail,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=True,
    ):
        response = gravacao_client.get(
            "/api/gravacao-externa/2024/1209",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["os_nro"] == 1209
    assert len(payload["arquivos"]) == 1


def test_download_all_arquivos_returns_zip(gravacao_client):
    session = {
        "id": 2,
        "os_ano": 2024,
        "os_nro": 1209,
        "lancado_por_ponto": "918.713",
        "status": "pendente",
    }
    fd, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.write(fd, b"PK\x03\x04fake-zip-content")
    os.close(fd)
    ready = {
        "gravacao_externa_id": 2,
        "assinatura": "abc123",
        "arquivo_path": tmp_path,
        "nome_arquivo": "gravacao_externa_OS_01209_2024.zip",
        "status": "pronto",
    }

    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value=session,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes.iniciar_gravacao",
        return_value={"status": "iniciada"},
    ) as mock_iniciar, patch(
        "routers.gravacao_externa_routes.resolve_ready_zip",
        return_value=ready,
    ), patch(
        "routers.gravacao_externa_routes.mark_zip_downloaded",
    ):
        response = gravacao_client.get(
            "/api/gravacao-externa/2024/1209/arquivos/download-all",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers.get("content-disposition", "")
    assert b"PK\x03\x04fake-zip-content" in response.content
    mock_iniciar.assert_called_once()


def test_download_all_returns_409_when_zip_not_ready(gravacao_client):
    session = {
        "id": 2,
        "os_ano": 2024,
        "os_nro": 1209,
        "status": "iniciada",
    }
    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value=session,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes.resolve_ready_zip",
        return_value=None,
    ), patch(
        "routers.gravacao_externa_routes.enqueue_zip_job",
        return_value={"status": "gerando"},
    ) as enqueue:
        response = gravacao_client.get(
            "/api/gravacao-externa/2024/1209/arquivos/download-all",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 409
    enqueue.assert_called_once()


def test_post_zip_returns_202_when_generating(gravacao_client):
    session = {
        "id": 2,
        "os_ano": 2024,
        "os_nro": 1209,
        "status": "pendente",
    }
    job = {
        "status": "gerando",
        "assinatura": "abc",
        "nome_arquivo": "gravacao_externa_OS_01209_2024.zip",
        "tamanho_bytes": None,
        "total_arquivos": 2,
        "arquivos_prontos": 0,
        "bytes_prontos": 0,
        "erro": None,
        "erro_codigo": None,
        "erro_detalhe": None,
        "etag": None,
    }
    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value=session,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes.iniciar_gravacao",
        return_value={"status": "iniciada"},
    ), patch(
        "routers.gravacao_externa_routes.enqueue_zip_job",
        return_value=job,
    ):
        response = gravacao_client.post(
            "/api/gravacao-externa/2024/1209/arquivos/zip",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 202, response.text
    assert response.json()["status"] == "gerando"
    assert response.json()["total_arquivos"] == 2


def test_zip_download_returns_206_for_range(gravacao_client):
    payload = b"0123456789abcdef"
    fd, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.write(fd, payload)
    os.close(fd)
    ready = {
        "gravacao_externa_id": 2,
        "assinatura": "deadbeef",
        "arquivo_path": tmp_path,
        "nome_arquivo": "pack.zip",
        "status": "pronto",
    }
    session = {"id": 2, "os_ano": 2024, "os_nro": 1209, "status": "iniciada"}

    try:
        with patch(
            "routers.gravacao_externa_routes.get_active_session",
            return_value=session,
        ), patch(
            "routers.gravacao_externa_routes._has_operator_permission",
            return_value=True,
        ), patch(
            "routers.gravacao_externa_routes.resolve_ready_zip",
            return_value=ready,
        ), patch(
            "routers.gravacao_externa_routes.mark_zip_downloaded",
        ):
            response = gravacao_client.get(
                "/api/gravacao-externa/2024/1209/arquivos/zip/download",
                cookies=_auth_cookies(),
                headers={"Range": "bytes=0-3"},
            )

        assert response.status_code == 206, response.text
        assert response.content == b"0123"
        assert "bytes 0-3/" in response.headers.get("content-range", "")
        assert response.headers.get("etag") == '"deadbeef"'
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def test_zip_diagnostico_requires_operator(gravacao_client):
    diag = {
        "cache_dir": "F:\\SagraWeb\\gravacao_externa_zips",
        "volume": "F:",
        "total_bytes": 1000,
        "free_bytes": 500,
        "used_bytes": 500,
        "reserve_bytes": 100,
        "cache_max_bytes": 200000,
        "cache_files": 1,
        "cache_bytes": 10,
        "jobs_ready": 1,
        "jobs_error": 0,
        "recent_errors": [],
    }
    with patch(
        "routers.gravacao_externa_routes._has_view_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes.get_zip_diagnostics",
        return_value=diag,
    ):
        response = gravacao_client.get(
            "/api/gravacao-externa/zip/diagnostico",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cache_dir"] == diag["cache_dir"]
    assert body["volume"] == "F:"


def test_list_os_requires_view_not_operator(gravacao_client):
    with patch(
        "routers.gravacao_externa_routes._has_view_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=False,
    ), patch(
        "routers.gravacao_externa_routes.list_os_gravacao_externa",
        return_value=([], 0),
    ) as list_os:
        response = gravacao_client.get(
            "/api/gravacao-externa/os",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 200, response.text
    list_os.assert_called_once()


def test_iniciar_requires_operator_permission(gravacao_client):
    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value={
            "id": 2,
            "os_ano": 2024,
            "os_nro": 1209,
            "status": "pendente",
            "fornecedor_ponto": "111.111",
        },
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=False,
    ), patch(
        "routers.gravacao_externa_routes.session_allows_operacao_fornecedor",
        return_value=False,
    ):
        response = gravacao_client.post(
            "/api/gravacao-externa/2024/1209/iniciar",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 403
    assert "operador" in response.json()["detail"].lower()


def test_concluir_requires_operator_permission(gravacao_client):
    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value={
            "id": 2,
            "os_ano": 2024,
            "os_nro": 1209,
            "status": "iniciada",
            "fornecedor_ponto": "111.111",
        },
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=False,
    ), patch(
        "routers.gravacao_externa_routes.session_allows_operacao_fornecedor",
        return_value=False,
    ):
        response = gravacao_client.post(
            "/api/gravacao-externa/2024/1209/concluir",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 403
    assert "operador" in response.json()["detail"].lower()


def test_concluir_sem_sessao_requires_operator_permission(gravacao_client):
    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value=None,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=False,
    ):
        response = gravacao_client.post(
            "/api/gravacao-externa/2024/1209/concluir",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 403
    assert "operador" in response.json()["detail"].lower()


def test_concluir_sem_sessao_ok_for_operator(gravacao_client):
    detail = {
        "id": 0,
        "os_ano": 2024,
        "os_nro": 1209,
        "cod_status": "012092024-08",
        "lancado_por_ponto": "",
        "lancado_por_nome": None,
        "status": "concluida",
        "iniciado_por_ponto": None,
        "iniciado_em": None,
        "criado_em": None,
        "origem_pendente_id": None,
        "fornecedor_ponto": None,
        "concluida_em": None,
        "concluida_por_ponto": "918.713",
        "entrega_lancada_em": None,
        "recebido_por_ponto": None,
        "recebido_por_nome": None,
        "pagamento_nf_em": None,
        "arquivos": [],
        "mensagens": [],
    }
    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value=None,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes.concluir_gravacao",
        return_value=detail,
    ) as mock_concluir:
        response = gravacao_client.post(
            "/api/gravacao-externa/2024/1209/concluir",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "concluida"
    assert response.json()["id"] == 0
    mock_concluir.assert_called_once()


def test_entrega_requires_entrega_permission(gravacao_client):
    with patch(
        "routers.gravacao_externa_routes._has_view_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes._has_entrega_permission",
        return_value=False,
    ):
        response = gravacao_client.post(
            "/api/gravacao-externa/2024/1209/entrega-chapas",
            json={"recebido_por_ponto": "918713", "recebido_por_nome": "Fulano"},
            cookies=_auth_cookies(),
        )

    assert response.status_code == 403
    assert "recebimento" in response.json()["detail"].lower()


def test_download_all_skips_iniciar_when_already_iniciada(gravacao_client):
    session = {
        "id": 2,
        "os_ano": 2024,
        "os_nro": 1209,
        "lancado_por_ponto": "918.713",
        "status": "iniciada",
    }
    fd, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.write(fd, b"PK\x03\x04fake-zip-content")
    os.close(fd)

    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value=session,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes.iniciar_gravacao",
    ) as mock_iniciar, patch(
        "routers.gravacao_externa_routes.resolve_ready_zip",
        return_value={
            "gravacao_externa_id": 2,
            "assinatura": "abc",
            "arquivo_path": tmp_path,
            "nome_arquivo": "gravacao_externa_OS_01209_2024.zip",
            "status": "pronto",
        },
    ), patch(
        "routers.gravacao_externa_routes.mark_zip_downloaded",
    ):
        response = gravacao_client.get(
            "/api/gravacao-externa/2024/1209/arquivos/download-all",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 200, response.text
    mock_iniciar.assert_not_called()

def test_detail_allows_view_without_operator(gravacao_client):
    detail = {
        "id": 2,
        "os_ano": 2024,
        "os_nro": 1209,
        "cod_status": "012092024-07",
        "lancado_por_ponto": "111.111",
        "lancado_por_nome": "Outro",
        "status": "pendente",
        "iniciado_por_ponto": None,
        "iniciado_em": None,
        "criado_em": None,
        "arquivos": [],
        "mensagens": [],
    }
    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value={
            "id": 2,
            "os_ano": 2024,
            "os_nro": 1209,
            "lancado_por_ponto": "111.111",
            "status": "pendente",
        },
    ), patch(
        "routers.gravacao_externa_routes.build_session_detail",
        return_value=detail,
    ), patch(
        "routers.gravacao_externa_routes._has_view_permission",
        return_value=True,
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=False,
    ):
        response = gravacao_client.get(
            "/api/gravacao-externa/2024/1209",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 200, response.text


def test_download_all_requires_operator_or_fornecedor(gravacao_client):
    with patch(
        "routers.gravacao_externa_routes.get_active_session",
        return_value={
            "id": 2,
            "os_ano": 2024,
            "os_nro": 1209,
            "lancado_por_ponto": "918.713",
            "status": "pendente",
            "fornecedor_ponto": "111.111",
        },
    ), patch(
        "routers.gravacao_externa_routes._has_operator_permission",
        return_value=False,
    ), patch(
        "routers.gravacao_externa_routes.session_allows_operacao_fornecedor",
        return_value=False,
    ):
        response = gravacao_client.get(
            "/api/gravacao-externa/2024/1209/arquivos/download-all",
            cookies=_auth_cookies(),
        )

    assert response.status_code == 403
    assert "operador" in response.json()["detail"].lower()


def test_preview_allows_view_without_operator(gravacao_client):
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(b"%PDF-1.4")
        tmp_path = tmp.name

    try:
        with patch(
            "routers.gravacao_externa_routes.get_active_session",
            return_value={
                "id": 2,
                "os_ano": 2024,
                "os_nro": 1209,
                "status": "pendente",
            },
        ), patch(
            "routers.gravacao_externa_routes._has_view_permission",
            return_value=True,
        ), patch(
            "routers.gravacao_externa_routes._has_operator_permission",
            return_value=False,
        ), patch(
            "routers.gravacao_externa_routes.get_arquivo_for_session",
            return_value={"id": 4, "nome": "foo.pdf"},
        ), patch(
            "routers.gravacao_externa_routes.resolve_arquivo_absolute_path",
            return_value=tmp_path,
        ):
            response = gravacao_client.get(
                "/api/gravacao-externa/2024/1209/arquivos/4/preview",
                cookies=_auth_cookies(),
            )

        assert response.status_code == 200, response.text
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

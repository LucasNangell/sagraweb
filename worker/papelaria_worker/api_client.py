"""Cliente HTTP para APIs do worker Papelaria."""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

_WORKER_HEADER = "X-Sagra-Worker-Secret"
_inspect_api_unavailable_logged = False


class PapelariaWorkerApiError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class PapelariaWorkerApiClient:
    def __init__(
        self,
        base_url: str,
        worker_secret: str,
        worker_id: str,
        timeout: int = 60,
        *,
        ssl_verify: bool | str = True,
    ):
        self.base_url = base_url.rstrip("/")
        self.worker_id = worker_id
        self.ssl_verify = ssl_verify
        self.session = requests.Session()
        self.session.headers.update(
            {
                _WORKER_HEADER: worker_secret,
                "Content-Type": "application/json",
                "User-Agent": f"SAGRA-Papelaria-Worker/{worker_id}",
            }
        )
        self.timeout = timeout

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = f"/{path}"
        return f"{self.base_url}{path}"

    def _request(self, method: str, path: str, json_body: Optional[dict] = None) -> Any:
        try:
            response = self.session.request(
                method,
                self._url(path),
                json=json_body,
                timeout=self.timeout,
                verify=self.ssl_verify,
            )
        except requests.RequestException as exc:
            raise PapelariaWorkerApiError(f"Falha de rede: {exc}") from exc

        if response.status_code == 401:
            raise PapelariaWorkerApiError("Worker não autorizado (secret inválido).", 401)

        if response.status_code >= 400:
            detail = response.text[:500]
            try:
                payload = response.json()
                detail = payload.get("detail", detail)
            except Exception:
                pass
            raise PapelariaWorkerApiError(
                f"HTTP {response.status_code} {method} {path}: {detail}",
                response.status_code,
            )

        if not response.content:
            return None
        try:
            return response.json()
        except Exception:
            return response.text

    def heartbeat(self, meta: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        return self._request(
            "POST",
            "/papelaria/worker/heartbeat",
            {"worker_id": self.worker_id, "meta": meta or {}},
        )

    def claim(self) -> Optional[dict[str, Any]]:
        data = self._request(
            "POST",
            "/papelaria/jobs/claim",
            {"worker_id": self.worker_id},
        )
        if not data:
            return None
        return data.get("job")

    def complete(
        self,
        job_id: int,
        arquivo_cdr: str,
        arquivo_pdf: str,
        log_resumo: Optional[str] = None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/papelaria/jobs/{job_id}/complete",
            {
                "worker_id": self.worker_id,
                "arquivo_cdr": arquivo_cdr,
                "arquivo_pdf": arquivo_pdf,
                "log_resumo": log_resumo,
            },
        )

    def fail(
        self,
        job_id: int,
        erro: str,
        log_resumo: Optional[str] = None,
        retryable: bool = False,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/papelaria/jobs/{job_id}/fail",
            {
                "worker_id": self.worker_id,
                "erro": erro,
                "log_resumo": log_resumo,
                "retryable": retryable,
            },
        )

    def append_log(
        self,
        job_id: int,
        mensagem: str,
        nivel: str = "info",
        detalhe: Optional[dict[str, Any]] = None,
    ) -> None:
        self._request(
            "POST",
            f"/papelaria/jobs/{job_id}/log",
            {
                "worker_id": self.worker_id,
                "mensagem": mensagem,
                "nivel": nivel,
                "detalhe": detalhe,
            },
        )

    def claim_inspect(self) -> Optional[dict[str, Any]]:
        global _inspect_api_unavailable_logged
        try:
            data = self._request(
                "POST",
                "/papelaria/worker/inspect/claim",
                {"worker_id": self.worker_id},
            )
        except PapelariaWorkerApiError as exc:
            if exc.status_code == 403:
                if not _inspect_api_unavailable_logged:
                    logger.warning(
                        "Inspeção CDR indisponível na API (HTTP 403). "
                        "Jobs de produção continuam; atualize o backend SAGRA."
                    )
                    _inspect_api_unavailable_logged = True
                return None
            raise
        if not data:
            return None
        return data.get("inspect")

    def download_inspect_cdr(self, inspect_id: str, dest_path: str) -> str:
        """Baixa o .cdr da API para inspeção local no worker."""
        path = f"/papelaria/worker/inspect/{inspect_id}/cdr"
        try:
            response = self.session.get(
                self._url(path),
                params={"worker_id": self.worker_id},
                timeout=self.timeout,
                verify=self.ssl_verify,
                stream=True,
            )
        except requests.RequestException as exc:
            raise PapelariaWorkerApiError(f"Falha de rede: {exc}") from exc

        if response.status_code == 401:
            raise PapelariaWorkerApiError("Worker não autorizado (secret inválido).", 401)

        if response.status_code >= 400:
            detail = response.text[:500]
            try:
                payload = response.json()
                detail = payload.get("detail", detail)
            except Exception:
                pass
            raise PapelariaWorkerApiError(
                f"HTTP {response.status_code} GET {path}: {detail}",
                response.status_code,
            )

        os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
        with open(dest_path, "wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if chunk:
                    handle.write(chunk)
        return dest_path

    def complete_inspect(
        self,
        inspect_id: str,
        *,
        campos: dict[str, str],
        variaveis: list[str],
        preview_layout: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "worker_id": self.worker_id,
            "campos": campos,
            "variaveis": variaveis,
        }
        if preview_layout:
            payload["preview_layout"] = preview_layout
        return self._request(
            "POST",
            f"/papelaria/worker/inspect/{inspect_id}/complete",
            payload,
        )

    def fail_inspect(self, inspect_id: str, erro: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/papelaria/worker/inspect/{inspect_id}/fail",
            {
                "worker_id": self.worker_id,
                "erro": erro,
            },
        )

    def test_connection(self) -> dict[str, Any]:
        return self.heartbeat({"test": True})

"""Cliente HTTP do letreiro (sessão cookie + GETs do painel)."""
from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import urlencode

import requests

from board import (
    collect_dashboard_sectors,
    merge_dashboard_queue_sources,
    merge_dashboard_sector_item_lists,
)

logger = logging.getLogger("sagra.letreiro")

GRAVACAO_SITUACOES = frozenset({"Gravação", "Gravação Parcial"})


class LetreiroApiError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class LetreiroApiClient:
    def __init__(
        self,
        base_url: str,
        *,
        ssl_verify: bool = False,
        timeout: int = 20,
    ):
        self.base_url = (base_url or "").rstrip("/")
        self.ssl_verify = ssl_verify
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": "SAGRA-Letreiro/1.0",
            }
        )
        self.logged_in = False
        if not ssl_verify:
            try:
                import urllib3

                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            except Exception:
                pass

    def configure(self, base_url: str, ssl_verify: bool) -> None:
        new_base = (base_url or "").rstrip("/")
        if new_base != self.base_url or ssl_verify != self.ssl_verify:
            self.logged_in = False
        self.base_url = new_base
        self.ssl_verify = ssl_verify

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = f"/{path}"
        return f"{self.base_url}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
    ) -> Any:
        try:
            response = self.session.request(
                method,
                self._url(path),
                json=json_body,
                params=params,
                timeout=self.timeout,
                verify=self.ssl_verify,
            )
        except requests.RequestException as exc:
            raise LetreiroApiError(f"Falha de rede: {exc}") from exc

        if response.status_code in (401, 403):
            self.logged_in = False
            detail = _extract_detail(response) or "Sessão ausente ou inválida."
            raise LetreiroApiError(detail, response.status_code)

        if response.status_code >= 400:
            raise LetreiroApiError(
                f"HTTP {response.status_code}: {_extract_detail(response)}",
                response.status_code,
            )

        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise LetreiroApiError("Resposta inválida da API.") from exc

    def login(self, ponto: str, nome: str = "", password: str = "") -> None:
        if not str(ponto or "").strip():
            return
        body: dict[str, Any] = {"ponto": ponto, "nome": nome or None}
        if password:
            body["password"] = password
        self._request("POST", "/auth/session", json_body=body)
        self.logged_in = True

    def fetch_setores(self) -> list[str]:
        rows = self._request("GET", "/aux/setores") or []
        values = []
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict):
                    value = str(row.get("Setor") or "").strip()
                    if value:
                        values.append(value)
        if "Gravação" not in values:
            values.append("Gravação")
        return sorted(set(values), key=lambda s: s.lower())

    def fetch_andamentos(self) -> list[str]:
        try:
            rows = self._request("GET", "/aux/andamentos") or []
        except LetreiroApiError:
            rows = self._request("GET", "/aux/situacoes") or []
        values: list[str] = []
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict):
                    value = str(row.get("Situacao") or "").strip()
                    if value:
                        values.append(value)
        return values

    def fetch_inbox_os(self) -> list[dict[str, Any]]:
        rows = self._request("GET", "/email/inbox-os") or []
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    def fetch_dashboard(self, board: dict[str, Any]) -> list[dict[str, Any]]:
        sectors = collect_dashboard_sectors(board)
        if not sectors:
            return []
        lists: list[list[dict[str, Any]]] = []
        for sector in sectors:
            search_items = self._fetch_search(sector)
            try:
                pcp_items = self._fetch_pcp(sector)
                lists.append(merge_dashboard_queue_sources(search_items, pcp_items))
            except LetreiroApiError as exc:
                logger.warning("Fila PCP indisponível para %s: %s", sector, exc)
                lists.append(search_items)
        return merge_dashboard_sector_item_lists(lists)

    def _fetch_search(self, sector: str) -> list[dict[str, Any]]:
        is_gravacao = sector == "Gravação"
        params = {
            "setor": "SEFOC" if is_gravacao else sector,
            "include_finished": "false",
            "limit": "200",
            "painel": "1",
        }
        result = self._request("GET", f"/os/search?{urlencode(params)}") or {}
        data = result.get("data") if isinstance(result, dict) else None
        if not isinstance(data, list):
            data = []
        if is_gravacao:
            data = [row for row in data if isinstance(row, dict) and (row.get("situacao") or "") in GRAVACAO_SITUACOES]
        return [map_search_row(row) for row in data if isinstance(row, dict)]

    def _fetch_pcp(self, sector: str) -> list[dict[str, Any]]:
        params = {"setor": sector, "painel": "1"}
        result = self._request("GET", f"/pcp/queue?{urlencode(params)}") or {}
        items = result.get("items") if isinstance(result, dict) else None
        if not isinstance(items, list):
            return []
        return [row for row in items if isinstance(row, dict)]


def map_search_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "nr_os": row.get("nr_os"),
        "ano": row.get("ano"),
        "titulo": row.get("titulo"),
        "produto": row.get("produto"),
        "situacao": row.get("situacao"),
        "setor": row.get("setor"),
        "data_entrega": row.get("data_entrega"),
        "entreg_periodo": row.get("entreg_periodo"),
        "prioridade": row.get("prioridade"),
        "last_update": row.get("last_update"),
        "andamento_usuario": row.get("andamento_usuario"),
        "observacao": row.get("observacao"),
        "pcp_ordem": row.get("pcp_ordem"),
        "pcp_ultima_atualizacao": row.get("pcp_ultima_atualizacao"),
        "fornecedor_ponto": row.get("fornecedor_ponto"),
        "fornecedor_nome": row.get("fornecedor_nome"),
        "fornecedores": row.get("fornecedores"),
    }


def _extract_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
        detail = payload.get("detail", response.text[:300])
        if isinstance(detail, str):
            return detail
        return str(detail)
    except Exception:
        return (response.text or "")[:300]

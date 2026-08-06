"""Rate limit em memória — rotas de auth."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


def _mock_request(method: str, path: str, ip: str = "192.168.1.50"):
    request = MagicMock()
    request.method = method
    request.url.path = path
    request.client = MagicMock()
    request.client.host = ip
    request.headers = {}
    return request


class TestRateLimit:
    def test_allows_requests_within_limit(self, monkeypatch):
        from security import rate_limit

        rate_limit._store.clear()
        monkeypatch.setenv("SAGRA_RATE_LIMIT_ENABLED", "true")

        request = _mock_request("POST", "/api/auth/login")
        for _ in range(5):
            assert rate_limit.check_rate_limit(request) is None

    def test_blocks_when_limit_exceeded(self, monkeypatch):
        from security import rate_limit

        rate_limit._store.clear()
        monkeypatch.setenv("SAGRA_RATE_LIMIT_ENABLED", "true")

        request = _mock_request("POST", "/api/auth/login", ip="10.0.0.99")
        rule_max = rate_limit._RATE_RULES[("POST", "/api/auth/login")][0]

        for _ in range(rule_max):
            assert rate_limit.check_rate_limit(request) is None

        blocked = rate_limit.check_rate_limit(request)
        assert blocked is not None
        assert blocked.status_code == 429

    def test_disabled_when_env_off(self, monkeypatch):
        from security import rate_limit

        rate_limit._store.clear()
        monkeypatch.setenv("SAGRA_RATE_LIMIT_ENABLED", "false")

        request = _mock_request("POST", "/api/auth/login")
        for _ in range(50):
            assert rate_limit.check_rate_limit(request) is None

    def test_unlisted_route_not_limited(self, monkeypatch):
        from security import rate_limit

        rate_limit._store.clear()
        monkeypatch.setenv("SAGRA_RATE_LIMIT_ENABLED", "true")

        request = _mock_request("GET", "/api/os/search")
        for _ in range(100):
            assert rate_limit.check_rate_limit(request) is None

"""Guard de Nr OS / ano contra tabProtocolos."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from services.os_protocolo_guard import (
    OsProtocoloGuardError,
    normalize_ano,
    require_protocolo_mysql,
)


class TestNormalizeAno:
    def test_dois_digitos(self):
        assert normalize_ano(26) == 2026

    def test_quatro_digitos(self):
        assert normalize_ano(2026) == 2026

    def test_tres_digitos_rejeita(self):
        with pytest.raises(OsProtocoloGuardError, match="216"):
            normalize_ano(216)

    def test_fora_da_faixa(self):
        with pytest.raises(OsProtocoloGuardError):
            normalize_ano(1999)
        with pytest.raises(OsProtocoloGuardError):
            normalize_ano(2101)


class TestRequireProtocoloMysql:
    def test_ano_invalido_nao_consulta(self):
        with patch("services.os_protocolo_guard.db") as mock_db:
            with pytest.raises(OsProtocoloGuardError, match="216"):
                require_protocolo_mysql(1396, 216)
            mock_db.execute_query.assert_not_called()

    def test_os_inexistente(self):
        with patch("services.os_protocolo_guard.db") as mock_db:
            mock_db.execute_query.return_value = []
            with pytest.raises(OsProtocoloGuardError, match="1396/2026"):
                require_protocolo_mysql(1396, 2026)

    def test_os_existente_normaliza_ano(self):
        with patch("services.os_protocolo_guard.db") as mock_db:
            mock_db.execute_query.return_value = [{"ok": 1}]
            assert require_protocolo_mysql(1396, 26) == 2026
            mock_db.execute_query.assert_called_once()
            args = mock_db.execute_query.call_args[0]
            assert args[1] == (1396, 2026)

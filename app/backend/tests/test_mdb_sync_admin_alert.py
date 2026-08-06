"""Falhas MDB pós-MySQL: alerta admin sem expor detalhes ao usuário."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from routers.mdb_writer import (
    MdbSyncError,
    format_mdb_failure_detail,
    handle_mdb_sync_failure,
)


class TestFormatMdbFailureDetail:
    def test_includes_resolved_path_when_different(self, monkeypatch):
        exc = MdbSyncError(
            "insert_andamento",
            84,
            r"I:\ControleDeTrabalhos\file.mdb",
            RuntimeError("HY024 invalid path"),
            attempts=1,
        )
        monkeypatch.setattr(
            "routers.mdb_writer.config_manager.resolve_mdb_path",
            lambda path: r"\\server\share\ControleDeTrabalhos\file.mdb",
        )
        text = format_mdb_failure_detail(
            exc,
            task_name="history_add",
            cod_status="000842026-01",
            ano=2026,
        )
        assert "history_add" in text
        assert "000842026-01" in text
        assert r"I:\ControleDeTrabalhos\file.mdb" in text
        assert r"\\server\share" in text
        assert "HY024" in text


class TestHandleMdbSyncFailure:
    def test_notifies_admin_without_raising(self, monkeypatch):
        alerts: list[dict] = []

        def fake_alert(**kwargs):
            alerts.append(kwargs)
            return {"Id": 1}

        monkeypatch.setattr(
            "services.support_message_service.create_system_mdb_alert",
            fake_alert,
        )
        exc = MdbSyncError(
            "insert",
            84,
            r"I:\file.mdb",
            RuntimeError("path invalid"),
            attempts=1,
        )
        handle_mdb_sync_failure(
            "history_add",
            exc,
            cod_status="000842026-01",
            nro=84,
            ano=2026,
        )
        assert len(alerts) == 1
        assert alerts[0]["task_name"] == "history_add"
        assert alerts[0]["cod_status"] == "000842026-01"
        assert alerts[0]["nro"] == 84
        assert alerts[0]["ano"] == 2026


class TestAndamentoAlertContext:
    def test_format_includes_andamento_fields(self):
        exc = MdbSyncError(
            "andamento_010132026-22",
            1013,
            r"I:\file.mdb",
            RuntimeError("locked"),
            attempts=5,
            cod_status="010132026-22",
            ano=2026,
        )
        text = format_mdb_failure_detail(
            exc,
            task_name="history_add",
            cod_status="010132026-22",
            nro=1013,
            ano=2026,
            andamento={
                "cod_status": "010132026-22",
                "nro": 1013,
                "ano": 2026,
                "situacao": "Saída p/",
                "setor": "SIELT",
                "ponto": "882280",
                "obs": "teste obs",
            },
        )
        assert "Situação: Saída p/" in text
        assert "Setor: SIELT" in text
        assert "Ponto: 882280" in text
        assert "Obs: teste obs" in text
        assert "Tentativas: 5" in text


class TestOsRoutesMdbSyncBestEffort:
    def test_dispatch_does_not_raise_on_mdb_failure(self):
        from routers.mdb_writer import dispatch_mdb_sync

        with patch("routers.mdb_writer.config_manager") as mock_cfg:
            mock_cfg.is_mdb_write_enabled.return_value = True
            mock_cfg.get.return_value = False
            with patch("routers.mdb_writer.handle_mdb_sync_failure") as mock_handle:

                def boom():
                    raise MdbSyncError(
                        "x",
                        1,
                        "I:\\a.mdb",
                        RuntimeError("fail"),
                        attempts=1,
                    )

                dispatch_mdb_sync("history_add", boom)
                mock_handle.assert_called_once()

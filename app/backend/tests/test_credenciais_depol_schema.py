"""Schema ensure Credenciais DEPOL — paths e verificação de tabelas."""

from pathlib import Path

import pytest

from credenciais_depol_schema import (
    _sql_dirs,
    ensure_credenciais_depol_schema,
    reset_credenciais_depol_schema_cache,
)


def test_sql_dirs_includes_repo_deploy_sql():
    dirs = _sql_dirs()
    assert dirs
    assert any(d.name == "sql" for d in dirs)


def test_ensure_creates_via_embedded_ddl(monkeypatch):
    reset_credenciais_depol_schema_cache()
    executed: list[str] = []
    existing: set[str] = set()

    def fake_exec(sql, params=None):
        sql_l = " ".join(sql.split()).lower()
        executed.append(sql_l)
        if "information_schema.tables" in sql_l:
            name = (params or {}).get("name")
            return [{"cnt": 1 if name in existing else 0}]
        if sql_l.startswith("create table if not exists"):
            for t in (
                "tabcredenciaisdepolpedidos",
                "tabcredenciaisdepolitens",
                "tabcredenciaisdepolmodelos",
            ):
                if t in sql_l.replace("`", ""):
                    # Preserve canonical casing used by _REQUIRED_TABLES checks
                    mapping = {
                        "tabcredenciaisdepolpedidos": "tabCredenciaisDepolPedidos",
                        "tabcredenciaisdepolitens": "tabCredenciaisDepolItens",
                        "tabcredenciaisdepolmodelos": "tabCredenciaisDepolModelos",
                    }
                    existing.add(mapping[t])
            return []
        return []

    monkeypatch.setattr("credenciais_depol_schema.db.execute_query", fake_exec)
    # Force file path miss so only embedded DDL matters
    monkeypatch.setattr(
        "credenciais_depol_schema._sql_dirs",
        lambda: [Path("/nonexistent/deploy/sql")],
    )

    ensure_credenciais_depol_schema()
    assert "tabCredenciaisDepolModelos" in existing
    assert any("tabcredenciaisdepolmodelos" in s for s in executed)


def test_ensure_fails_if_tables_still_missing(monkeypatch):
    reset_credenciais_depol_schema_cache()

    def fake_exec(sql, params=None):
        sql_l = " ".join(sql.split()).lower()
        if "information_schema.tables" in sql_l:
            return [{"cnt": 0}]
        return []

    monkeypatch.setattr("credenciais_depol_schema.db.execute_query", fake_exec)
    monkeypatch.setattr(
        "credenciais_depol_schema._sql_dirs",
        lambda: [Path("/nonexistent/deploy/sql")],
    )
    with pytest.raises(RuntimeError, match="ausentes"):
        ensure_credenciais_depol_schema()

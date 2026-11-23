"""Mockup 3D por produto (só frente / frente e verso)."""
from __future__ import annotations

import json

import pytest


@pytest.fixture
def banco(monkeypatch):
    """Tabela tabPapelariaProdutoMockup em memória."""
    from services import papelaria_produto_mockup_service as svc

    linhas: list[dict] = []

    def execute_query(sql, params=None):
        sql_n = " ".join(sql.split())
        params = params or {}
        if sql_n.startswith("CREATE TABLE"):
            return []
        if sql_n.startswith("SELECT Produto, Variante"):
            return [dict(r) for r in linhas]
        if sql_n.startswith("SELECT ID, Produto"):
            return [dict(r) for r in linhas if r["Variante"] == params["v"]]
        if sql_n.startswith("INSERT"):
            linhas.append(
                {"ID": len(linhas) + 1, "Produto": params["p"], "Variante": params["v"], "MockupConfigJson": params["j"]}
            )
            return []
        if sql_n.startswith("UPDATE"):
            for r in linhas:
                if r["ID"] == params["id"]:
                    r["MockupConfigJson"] = params["j"]
            return []
        if sql_n.startswith("DELETE"):
            linhas[:] = [r for r in linhas if r["ID"] != params["id"]]
            return []
        raise AssertionError(sql_n)

    monkeypatch.setattr(svc.db, "execute_query", execute_query)
    monkeypatch.setattr(svc, "_tabela_ok", False)
    svc.invalidar_cache()
    yield linhas
    svc.invalidar_cache()


_CFG = {"modo": "folha_simples", "larguraMm": 210, "alturaMm": 297}


def test_salvar_obter_e_remover(banco, monkeypatch):
    from services import papelaria_produto_mockup_service as svc
    from services import papelaria_mockup_config_service as mockup_svc

    monkeypatch.setattr(mockup_svc, "normalize_mockup_config_json", lambda raw: json.dumps(raw) if raw else None)
    r = svc.salvar("Ct Visita", "frente_verso", _CFG)
    assert json.loads(r["frente_verso"]) == _CFG and r["frente"] is None
    # mesmo produto com outra grafia → mesma linha
    svc.salvar("CT VISITA", "frente_verso", {**_CFG, "larguraMm": 90})
    assert len(banco) == 1 and json.loads(svc.obter("ct visita")["frente_verso"])["larguraMm"] == 90
    svc.salvar("Ct Visita", "frente_verso", None)
    assert banco == [] and svc.obter("Ct Visita")["frente_verso"] is None
    with pytest.raises(svc.MockupProdutoError):
        svc.salvar("Ct Visita", "verso", _CFG)


def test_aplicar_no_modelo_por_variacao(banco):
    from services import papelaria_produto_mockup_service as svc

    banco.append({"ID": 1, "Produto": "Ct Visita", "Variante": "frente", "MockupConfigJson": '{"a": 1}'})
    banco.append({"ID": 2, "Produto": "Ct Visita", "Variante": "frente_verso", "MockupConfigJson": '{"b": 2}'})
    svc.invalidar_cache()

    so_frente = svc.aplicar_no_modelo(
        {"produto": "Ct Visita", "frente_versao": "Somente Frente", "mockup_config_json": '{"antigo": 1}'}
    )
    assert so_frente["mockup_config_json"] == '{"a": 1}'
    assert so_frente["mockup_config_json_modelo"] == '{"antigo": 1}'
    assert so_frente["mockup_origem"] == "produto"

    fv = svc.aplicar_no_modelo({"produto": "Ct Visita", "frente_versao": "Frente e Verso"})
    assert fv["mockup_config_json"] == '{"b": 2}'
    assert fv["mockup_produto"] == {"frente": '{"a": 1}', "frente_verso": '{"b": 2}'}

    sem = svc.aplicar_no_modelo({"produto": "Bloco A5", "frente_versao": "Frente", "mockup_config_json": '{"x": 1}'})
    assert sem["mockup_config_json"] == '{"x": 1}' and sem["mockup_origem"] == "modelo"

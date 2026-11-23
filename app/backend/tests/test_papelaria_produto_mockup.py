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


def test_herda_mockup_dos_modelos_inclusive_excluidos(banco, monkeypatch):
    """Produto sem mockup salvo usa o dos modelos — inclusive dos combinados excluídos."""
    from services import papelaria_produto_mockup_service as svc

    giro_180 = json.dumps({"id": "flip", "interacao": {"rotateYVerso": 180}})
    giro_45 = json.dumps({"id": "flip", "interacao": {"rotateYVerso": 45}})
    modelos = [
        {"ID": 12, "Produto": "Ct Visita", "FrenteVerso": "Frente e Verso", "ArquivoModelo": "CtVisitaFV.cdr", "Ativo": 0, "MockupConfigJson": giro_180},
        {"ID": 13, "Produto": "Ct Visita", "FrenteVerso": "Frente e Verso", "ArquivoModelo": "CtVisitaFVA.cdr", "Ativo": 0, "MockupConfigJson": giro_180},
        {"ID": 26, "Produto": "Ct Visita", "FrenteVerso": "Frente e Verso", "ArquivoModelo": "Insta.cdr", "Ativo": 0, "MockupConfigJson": '{"id": "outro"}'},
        {"ID": 15, "Produto": "Ct Visita", "FrenteVerso": "Somente Frente", "ArquivoModelo": "CtVisita.cdr", "Ativo": 1, "MockupConfigJson": giro_45},
    ]
    original = svc.db.execute_query

    def execute_query(sql, params=None):
        if " ".join(sql.split()).startswith("SELECT ID, Produto, FrenteVerso"):
            return [dict(m) for m in modelos]
        return original(sql, params)

    monkeypatch.setattr(svc.db, "execute_query", execute_query)
    svc.invalidar_cache()
    o = svc.obter("Ct Visita")
    assert json.loads(o["frente_verso"])["interacao"]["rotateYVerso"] == 180  # mais comum entre os FV
    assert o["herdado"]["frente_verso"] == {"modelo_id": 12, "arquivo": "CtVisitaFV.cdr", "ativo": False}
    assert json.loads(o["frente"])["interacao"]["rotateYVerso"] == 45
    assert o["salvo"] == {"frente": False, "frente_verso": False}

    # Modelo só frente usado numa prova de 2 páginas recebe as duas variações.
    m = svc.aplicar_no_modelo({"produto": "Ct Visita", "frente_versao": "Somente Frente", "mockup_config_json": giro_45})
    assert json.loads(m["mockup_produto"]["frente_verso"])["interacao"]["rotateYVerso"] == 180

    # Salvo no produto prevalece sobre o herdado.
    banco.append({"ID": 1, "Produto": "Ct Visita", "Variante": "frente_verso", "MockupConfigJson": '{"id": "novo"}'})
    svc.invalidar_cache()
    o = svc.obter("Ct Visita")
    assert json.loads(o["frente_verso"])["id"] == "novo"
    assert o["salvo"]["frente_verso"] is True and o["herdado"]["frente_verso"] is None

"""Testes — prefill Corel com API da Câmara (sem rede)."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


class TestBuildPrefillCorel:
    def test_enriquece_com_api_camara(self, monkeypatch):
        from dataclasses import dataclass

        from services import papelaria_models_service as svc
        from services.deputados_camara_service import DeputadoCamara

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NomeUsuario": "Solicitante",
                    "Titular": "Jonas Donizette",
                    "SiglaOrgao": "",
                    "GabSalaUsuario": "",
                    "Titulo": "",
                }
            ],
        )

        dep = DeputadoCamara(
            id=1,
            nome="JONAS DONIZETTE",
            nome_eleitoral="Jonas Donizette",
            email="dep.jonasdonizette@camara.leg.br",
            partido="PSB",
            uf="SP",
            partido_uf="PSB/SP",
            gabinete="Anexo IV, Gabinete 716",
            andar="7",
            local="Câmara dos Deputados",
            ramal="3215-5716",
            foto="",
            sexo="M",
        )
        api_mock = MagicMock(return_value=dep)
        monkeypatch.setattr(
            "services.deputados_camara_service.buscar_deputado_por_nome",
            api_mock,
        )

        dados = svc.build_prefill_corel(2025, 5024)

        api_mock.assert_called_once_with("Jonas Donizette", local_only=True)
        assert dados["nome_deputado"] == "Jonas Donizette"
        assert dados["genero"] == "Deputado"
        assert dados["partido"] == "PSB"
        assert dados["uf"] == "SP"
        assert dados["anexo"] == "IV"
        assert dados["gabinete"] == "716"
        assert dados["email"] == "dep.jonasdonizette@camara.leg.br"

    def test_api_sobrescreve_os_e_genero_feminino(self, monkeypatch):
        from services import papelaria_models_service as svc
        from services.deputados_camara_service import DeputadoCamara

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NomeUsuario": "Solicitante",
                    "Titular": "Maria do OS",
                    "SiglaOrgao": "PL/MG",
                    "GabSalaUsuario": "123",
                    "Titulo": "",
                }
            ],
        )

        dep = DeputadoCamara(
            id=2,
            nome="MARIA SILVA",
            nome_eleitoral="Maria Silva",
            email="dep.mariasilva@camara.leg.br",
            partido="PT",
            uf="BA",
            partido_uf="PT/BA",
            gabinete="Anexo IV, Gabinete 210",
            andar="2",
            local="Câmara dos Deputados",
            ramal="3215-5210",
            foto="",
            sexo="F",
        )
        monkeypatch.setattr(
            "services.deputados_camara_service.buscar_deputado_por_nome",
            MagicMock(return_value=dep),
        )

        dados = svc.build_prefill_corel(2025, 5024)

        assert dados["nome_deputado"] == "Maria Silva"
        assert dados["genero"] == "Deputada"
        assert dados["partido"] == "PT"
        assert dados["uf"] == "BA"
        assert dados["anexo"] == "IV"
        assert dados["gabinete"] == "210"
        assert dados["email"] == "dep.mariasilva@camara.leg.br"

    def test_cache_local_indisponivel_mantem_heuristica(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NomeUsuario": "Solicitante",
                    "Titular": "Jonas Donizette",
                    "SiglaOrgao": "PSB/SP",
                    "GabSalaUsuario": "716",
                    "Titulo": "",
                }
            ],
        )

        def _local_miss(nome, *, local_only=False):
            assert local_only is True
            return None

        monkeypatch.setattr(
            "services.deputados_camara_service.buscar_deputado_por_nome",
            _local_miss,
        )

        dados = svc.build_prefill_corel(2025, 5024)

        assert dados["nome_deputado"] == "Jonas Donizette"
        assert dados["genero"] == "Deputado Federal"
        assert dados["partido"] == "PSB"
        assert dados["uf"] == "SP"
        assert dados["gabinete"] == "716"
        assert "dep.jonas@camara.leg.br" == dados["email"]

    def test_reutiliza_row_sem_segunda_query(self, monkeypatch):
        from services import papelaria_models_service as svc

        calls = {"n": 0}

        def _query(*_a, **_k):
            calls["n"] += 1
            return []

        monkeypatch.setattr(svc.db, "execute_query", _query)
        monkeypatch.setattr(
            "services.deputados_camara_service.buscar_deputado_por_nome",
            MagicMock(return_value=None),
        )

        row = {
            "NomeUsuario": "Solicitante",
            "Titular": "Jonas Donizette",
            "SiglaOrgao": "PSB/SP",
            "GabSalaUsuario": "716",
            "Titulo": "",
        }
        dados = svc.build_prefill_corel(2025, 5024, row=row)

        assert calls["n"] == 0
        assert dados["nome_deputado"] == "Jonas Donizette"
        assert dados["partido"] == "PSB"


class TestTabelaDeputadosCamara:
    """Prefill lê a tabDeputadosCamara mesmo sem ``deploy/sql`` (release de produção)."""

    _DADOS = {
        "id": 92102,
        "uri": "https://dadosabertos.camara.leg.br/api/v2/deputados/92102",
        "nomeCivil": "Leur Antonio de Britto Lomanto Júnior",
        "sexo": "M",
        "ultimoStatus": {
            "nome": "Leur Lomanto Júnior",
            "nomeEleitoral": "Leur Lomanto Jr.",
            "siglaPartido": "UNIÃO",
            "siglaUf": "BA",
            "email": "dep.leurlomantojunior@camara.leg.br",
            "gabinete": {"predio": "4", "sala": "406", "telefone": "3215-5406"},
        },
    }

    def test_ddl_embutido_igual_ao_arquivo_de_migracao(self):
        from pathlib import Path

        from services import deputados_camara_service as svc

        arquivo = Path(svc.__file__).resolve().parents[3] / "deploy" / "sql" / "create_tab_deputados_camara.sql"
        sql = arquivo.read_text(encoding="utf-8")
        assert svc._DDL_TAB_DEPUTADOS_CAMARA.strip() == sql[sql.index("CREATE TABLE"):].strip()

    def test_ensure_nao_le_arquivo(self, monkeypatch):
        from pathlib import Path

        from services import deputados_camara_service as svc

        def sem_arquivo(*_a, **_k):
            raise FileNotFoundError("deploy/sql ausente na release")

        monkeypatch.setattr(Path, "read_text", sem_arquivo)
        executados: list[str] = []
        svc.ensure_tab_deputados_camara(executados.append)
        assert executados and executados[0].startswith("CREATE TABLE IF NOT EXISTS tabDeputadosCamara")

    def _db_com_tabela(self, monkeypatch, *, ddl_falha: bool):
        import json

        from services import deputados_camara_service as svc

        def execute_query(sql, params=None):
            if sql.lstrip().startswith("CREATE TABLE"):
                if ddl_falha:
                    raise RuntimeError("CREATE command denied")
                return []
            if "DadosJson" in sql:
                return [{"DadosJson": json.dumps(self._DADOS, ensure_ascii=False)}]
            if "tabDeputadosCamara" in sql:
                return [{
                    "IdCamara": 92102,
                    "Nome": "Leur Lomanto Júnior",
                    "NomeEleitoral": "Leur Lomanto Jr.",
                    "NomeCivil": "Leur Antonio de Britto Lomanto Júnior",
                }]
            raise AssertionError(f"não devia cair no cache antigo: {sql}")

        monkeypatch.setattr(svc.db, "execute_query", execute_query)
        monkeypatch.setattr(svc, "_schema_tab_deputados_ok", False)
        return svc

    @pytest.mark.parametrize("ddl_falha", [False, True], ids=["ddl-ok", "ddl-sem-permissao"])
    def test_busca_na_tabela_usa_coluna_nome_e_sexo(self, monkeypatch, ddl_falha):
        svc = self._db_com_tabela(monkeypatch, ddl_falha=ddl_falha)

        dep = svc.buscar_deputado_por_nome("LEUR LOMANTO JUNIOR", local_only=True)

        assert dep is not None and dep.id == 92102
        campos = svc.aplicar_deputado_em_campos_corel({"nome_deputado": "LEUR LOMANTO JUNIOR"}, dep)
        assert campos["nome_deputado"] == "Leur Lomanto Júnior"  # coluna Nome, não a normalizada
        assert campos["genero"] == "Deputado"
        assert campos["partido"] == "UNIÃO" and campos["uf"] == "BA"
        assert campos["anexo"] == "IV" and campos["gabinete"] == "406"
        assert dep.as_lookup_dict()["nome_eleitoral"] == "Leur Lomanto Júnior"

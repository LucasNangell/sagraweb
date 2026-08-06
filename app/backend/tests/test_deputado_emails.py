"""Testes — e-mails dep./gab. de deputados via API da Câmara e cache local."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest


class TestResolverEmailsDeputado:
    def test_deriva_gab_a_partir_de_dep(self):
        from services.deputados_camara_service import resolver_emails_deputado

        dep, gab = resolver_emails_deputado("dep.sargentofahur@camara.leg.br")
        assert dep == "dep.sargentofahur@camara.leg.br"
        assert gab == "gab.sargentofahur@camara.leg.br"

    def test_deriva_dep_a_partir_de_gab(self):
        from services.deputados_camara_service import resolver_emails_deputado

        dep, gab = resolver_emails_deputado("gab.joaosilva@camara.leg.br")
        assert dep == "dep.joaosilva@camara.leg.br"
        assert gab == "gab.joaosilva@camara.leg.br"

    def test_normaliza_maiusculas(self):
        from services.deputados_camara_service import resolver_emails_deputado

        dep, gab = resolver_emails_deputado("DEP.Maria@Camara.LEG.BR")
        assert dep == "dep.maria@camara.leg.br"
        assert gab == "gab.maria@camara.leg.br"

    def test_email_vazio(self):
        from services.deputados_camara_service import resolver_emails_deputado

        assert resolver_emails_deputado("") == ("", "")
        assert resolver_emails_deputado("sem-arroba") == ("", "")


class TestAplicarDeputadoCamposCorel:
    def _dep_fake(self, **kwargs):
        from services.deputados_camara_service import DeputadoCamara

        base = dict(
            id=178957,
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
            situacao="Exercício",
            sexo="M",
        )
        base.update(kwargs)
        return DeputadoCamara(**base)

    def test_preenche_campos_vazios(self):
        from services.deputados_camara_service import aplicar_deputado_em_campos_corel

        dep = self._dep_fake()
        out = aplicar_deputado_em_campos_corel(
            {
                "nome_deputado": "",
                "genero": "",
                "partido": "",
                "uf": "",
                "anexo": "",
                "gabinete": "",
                "email": "",
            },
            dep,
        )
        assert out["nome_deputado"] == "Jonas Donizette"
        assert out["genero"] == "Deputado Federal"
        assert out["partido"] == "PSB"
        assert out["uf"] == "SP"
        assert out["anexo"] == "IV"
        assert out["gabinete"] == "716"
        assert out["email"] == "dep.jonasdonizette@camara.leg.br"
        assert "3215" in out["contato_assessor"]

    def test_nao_sobrescreve_dados_os(self):
        from services.deputados_camara_service import aplicar_deputado_em_campos_corel

        dep = self._dep_fake(partido="PT", uf="DF")
        out = aplicar_deputado_em_campos_corel(
            {
                "nome_deputado": "Nome da OS",
                "partido": "PL",
                "uf": "MG",
                "gabinete": "123",
                "email": "dep.os@camara.leg.br",
            },
            dep,
        )
        assert out["nome_deputado"] == "Nome da OS"
        assert out["partido"] == "PL"
        assert out["uf"] == "MG"
        assert out["gabinete"] == "123"
        assert out["email"] == "dep.os@camara.leg.br"

    def test_substitui_email_inferido(self):
        from services.deputados_camara_service import aplicar_deputado_em_campos_corel

        dep = self._dep_fake()
        out = aplicar_deputado_em_campos_corel(
            {
                "nome_deputado": "Jonas Donizette",
                "email": "dep.jonas@camara.leg.br",
            },
            dep,
        )
        assert out["email"] == "dep.jonasdonizette@camara.leg.br"

    def test_genero_deputada(self):
        from services.deputados_camara_service import aplicar_deputado_em_campos_corel

        dep = self._dep_fake(sexo="F", nome_eleitoral="Maria Silva")
        out = aplicar_deputado_em_campos_corel({"genero": "Deputado Federal"}, dep)
        assert out["genero"] == "Deputada Federal"


class TestObterEmailsDeputado:
    def test_prioriza_tabela_local_sem_chamar_api(self, monkeypatch):
        from services import deputados_camara_service as svc

        monkeypatch.setattr(
            "services.deputados_local_service.buscar_emails_local",
            lambda nome: {
                "email_dep": "dep.sargentofahur@camara.leg.br",
                "email_gab": "gab.sargentofahur@camara.leg.br",
                "ramal": "3215-5623",
                "gabinete": "858",
            },
        )
        api_mock = MagicMock()
        monkeypatch.setattr(svc, "_buscar_deputado_via_api", api_mock)

        result = svc.obter_emails_deputado("Sargento Fahur")

        assert result["email_dep"] == "dep.sargentofahur@camara.leg.br"
        assert result["email_gab"] == "gab.sargentofahur@camara.leg.br"
        api_mock.assert_not_called()

    def test_sem_registro_local_consulta_api_estrita(self, monkeypatch):
        from dataclasses import dataclass

        from services import deputados_camara_service as svc

        @dataclass
        class _DepFake:
            email: str
            ramal: str = "3215-9999"
            gabinete: str = "Anexo IV"

            nome: str = "SARGENTO FAHUR"
            nome_eleitoral: str = "Sargento Fahur"
            id: int = 1
            partido: str = ""
            uf: str = ""
            partido_uf: str = ""
            andar: str = ""
            local: str = "Câmara dos Deputados"
            foto: str = ""
            situacao: str = ""

        monkeypatch.setattr("services.deputados_local_service.buscar_emails_local", lambda nome: None)
        api_mock = MagicMock(return_value=_DepFake(email="dep.sargentofahur@camara.leg.br"))
        monkeypatch.setattr(svc, "_buscar_deputado_via_api", api_mock)
        gravar = MagicMock()
        monkeypatch.setattr(svc, "_gravar_cache", gravar)

        result = svc.obter_emails_deputado("Sargento Fahur")

        assert result["email_dep"] == "dep.sargentofahur@camara.leg.br"
        api_mock.assert_called_once_with("Sargento Fahur", min_score=65)
        gravar.assert_called_once()

    def test_api_indisponivel_usa_cache_api_antigo(self, monkeypatch):
        from services import deputados_camara_service as svc

        monkeypatch.setattr("services.deputados_local_service.buscar_emails_local", lambda nome: None)
        monkeypatch.setattr(svc, "ensure_deputados_cache_email_columns", lambda: None)
        monkeypatch.setattr(
            svc,
            "_ler_cache_row",
            lambda nome: {
                "EmailDep": "dep.sargentofahur@camara.leg.br",
                "EmailGab": "gab.sargentofahur@camara.leg.br",
                "Ramal": "3215-5623",
                "Gabinete": "Gabinete 623",
            },
        )

        def _api_fail(nome, min_score=65):
            raise RuntimeError("API offline")

        monkeypatch.setattr(svc, "_buscar_deputado_via_api", _api_fail)

        result = svc.obter_emails_deputado("Sargento Fahur")

        assert result["email_dep"] == "dep.sargentofahur@camara.leg.br"
        assert result["email_gab"] == "gab.sargentofahur@camara.leg.br"


class TestDeputadosLocalService:
    def test_buscar_emails_local_por_nome_sem_acento(self, monkeypatch):
        from services import deputados_local_service as svc

        monkeypatch.setattr(
            svc,
            "_carregar_deputados_locais",
            lambda: [
                {
                    "nome_parlamentar": "Sargento Fahur",
                    "nome_sem_acento": "Sargento Fahur",
                    "email_dep": "dep.sargentofahur@camara.leg.br",
                    "email_gab": "gab.sargentofahur@camara.leg.br",
                    "telefone_1": "3215-5858",
                    "gabinete": "858",
                }
            ],
        )

        result = svc.buscar_emails_local("SARGENTO FAHUR")
        assert result is not None
        assert result["email_dep"] == "dep.sargentofahur@camara.leg.br"
        assert result["email_gab"] == "gab.sargentofahur@camara.leg.br"

    def test_nao_confunde_deputados_por_sobrenome(self, monkeypatch):
        from services import deputados_local_service as svc

        monkeypatch.setattr(
            svc,
            "_carregar_deputados_locais",
            lambda: [
                {
                    "nome_parlamentar": "Evair Vieira de Melo",
                    "nome_sem_acento": "Evair Vieira de Melo",
                    "email_dep": "dep.evairvieirademelo@camara.leg.br",
                    "email_gab": "gab.evairvieirademelo@camara.leg.br",
                    "telefone_1": "",
                    "gabinete": "",
                }
            ],
        )

        assert svc.buscar_emails_local("Luciano Vieira") is None


class TestDeputadoEmailsEndpoint:
    def test_preenche_emails_da_api(self, monkeypatch):
        from routers.auxiliar_routes import deputado_emails

        monkeypatch.setattr(
            "services.deputados_camara_service.obter_emails_deputado",
            lambda nome: {
                "email_dep": "dep.sargentofahur@camara.leg.br",
                "email_gab": "gab.sargentofahur@camara.leg.br",
                "ramal": "3215-1234",
                "gabinete": "Anexo IV, Gabinete 123",
            },
        )
        monkeypatch.setattr(
            "routers.auxiliar_routes.db.execute_query",
            lambda *args, **kwargs: [{"ContatoTrab": "assessor@exemplo.com"}],
        )

        result = deputado_emails("Sargento Fahur", 886, 2026)

        assert result.email_dep == "dep.sargentofahur@camara.leg.br"
        assert result.email_gab == "gab.sargentofahur@camara.leg.br"
        assert result.email_contato == "assessor@exemplo.com"
        assert result.ramal == "3215-1234"
        assert result.gabinete == "Anexo IV, Gabinete 123"

    def test_nome_curto_retorna_vazio(self):
        from routers.auxiliar_routes import deputado_emails

        result = deputado_emails("AB", 1, 2026)
        assert result.email_dep == ""
        assert result.email_gab == ""

    def test_deputado_nao_encontrado_mantem_contato_protocolo(self, monkeypatch):
        from routers.auxiliar_routes import deputado_emails

        monkeypatch.setattr(
            "services.deputados_camara_service.obter_emails_deputado",
            lambda nome: {
                "email_dep": "",
                "email_gab": "",
                "ramal": "",
                "gabinete": "",
            },
        )
        monkeypatch.setattr(
            "routers.auxiliar_routes.db.execute_query",
            lambda *args, **kwargs: [{"ContatoTrab": "contato@org.br"}],
        )

        result = deputado_emails("Nome Inexistente", 100, 2026)

        assert result.email_dep == ""
        assert result.email_gab == ""
        assert result.email_contato == "contato@org.br"

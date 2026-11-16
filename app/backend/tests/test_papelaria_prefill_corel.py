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

"""Testes — retrato dos textos do .cdr da OS (campos dinâmicos da Papelaria)."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import patch

import pytest


@pytest.fixture
def svc():
    from services import papelaria_os_cdr_campos_service as svc

    svc._table_ready = True
    svc._list_cache.clear()
    return svc


def _obj(static_id, pagina=1, nome="", texto="", camada="Camada 1", ordem=0):
    return {
        "static_id": static_id,
        "pagina": pagina,
        "nome": nome,
        "texto": texto,
        "camada": camada,
        "tipo": "artistico",
        "ordem": ordem,
    }


class TestNormalizacao:
    def test_normalize_descarta_invalidos_e_duplicados(self, svc):
        out = svc.normalize_objetos(
            [
                _obj(10, 1, "Nome", "Fulano", ordem=1),
                _obj(10, 1, "Nome", "Duplicado", ordem=2),
                {"static_id": 0, "pagina": 1, "texto": "sem id"},
                "lixo",
                _obj(11, 2, "", "Texto\r\nsolto\x07", ordem=0),
            ]
        )
        assert [o["static_id"] for o in out] == [10, 11]
        assert out[1]["texto"] == "Texto\nsolto"

    def test_normalize_exige_lista(self, svc):
        with pytest.raises(ValueError):
            svc.normalize_objetos({"a": 1})

    def test_humanizar_nome(self, svc):
        assert svc.humanizar_nome("NomeDeputado") == "Nome Deputado"
        assert svc.humanizar_nome("email_gabinete") == "Email gabinete"


class TestBuildCampos:
    def test_agrupa_nome_repetido_com_mesmo_texto(self, svc):
        campos = svc.build_campos_cdr(
            [
                _obj(1, 1, "Nome", "Fulano"),
                _obj(2, 2, "Nome", "Fulano"),
                _obj(3, 1, "", "Texto livre"),
                _obj(4, 1, "", "   "),
                _obj(5, 1, "OSint", "05000/2026"),
                _obj(6, 1, "Qualquer", "x", camada="ProvaSefoc"),
            ]
        )
        assert [c["key"] for c in campos["campos"]] == ["cdr:Nome"]
        assert len(campos["campos"][0]["alvos"]) == 2
        assert [s["key"] for s in campos["sem_nome"]] == ["cdr#1:3"]

    def test_textos_divergentes_viram_campo_por_pagina(self, svc):
        campos = svc.build_campos_cdr(
            [_obj(1, 1, "Cargo", "Deputado"), _obj(2, 2, "Cargo", "Deputada")]
        )
        keys = [c["key"] for c in campos["campos"]]
        assert keys == ["cdr:Cargo@1", "cdr:Cargo@2"]
        assert campos["campos"][0]["label"].endswith("(Frente)")
        assert campos["campos"][1]["label"].endswith("(Verso)")


class TestResolverAlteracoes:
    def _objetos(self):
        return [
            _obj(1, 1, "Nome", "Fulano"),
            _obj(2, 2, "Nome", "Fulano"),
            _obj(3, 1, "", "Rua A, 10"),
        ]

    def test_texto_de_campo_nomeado_vai_para_todas_as_ocorrencias(self, svc):
        edits = svc.resolver_alteracoes(self._objetos(), textos={"cdr:Nome": "Beltrano"})
        assert sorted((e["pagina"], e["static_id"], e["texto"]) for e in edits) == [
            (1, 1, "Beltrano"),
            (2, 2, "Beltrano"),
        ]
        assert all(e["nome_atual"] == "Nome" for e in edits)

    def test_sem_mudanca_nao_gera_edicao(self, svc):
        assert svc.resolver_alteracoes(self._objetos(), textos={"cdr:Nome": "Fulano"}) == []

    def test_nomear_texto_sem_nome(self, svc):
        edits = svc.resolver_alteracoes(
            self._objetos(),
            sem_nome=[{"static_id": 3, "pagina": 1, "nome": "Endereco", "texto": "Rua B, 20"}],
        )
        assert edits == [
            {
                "static_id": 3,
                "pagina": 1,
                "nome_atual": "",
                "texto": "Rua B, 20",
                "novo_nome": "Endereco",
            }
        ]

    def test_nome_repetido_ou_reservado_e_rejeitado(self, svc):
        with pytest.raises(ValueError, match="Já existe"):
            svc.resolver_alteracoes(
                self._objetos(), sem_nome=[{"static_id": 3, "pagina": 1, "nome": "nome"}]
            )
        with pytest.raises(ValueError, match="reservado"):
            svc.resolver_alteracoes(
                self._objetos(), sem_nome=[{"static_id": 3, "pagina": 1, "nome": "OSint"}]
            )
        with pytest.raises(ValueError, match="inválido"):
            svc.resolver_alteracoes(
                self._objetos(), sem_nome=[{"static_id": 3, "pagina": 1, "nome": "1abc"}]
            )

    def test_campo_ou_objeto_inexistente(self, svc):
        with pytest.raises(ValueError):
            svc.resolver_alteracoes(self._objetos(), textos={"cdr:Outro": "x"})
        with pytest.raises(ValueError):
            svc.resolver_alteracoes(
                self._objetos(), sem_nome=[{"static_id": 99, "pagina": 1, "nome": "X"}]
            )

    def test_sanitize_cdr_textos_aceita_url(self, svc):
        out = svc.sanitize_cdr_textos({"cdr:Site": "https://camara.leg.br", "outro": "x"})
        assert out == {"cdr:Site": "https://camara.leg.br"}


class TestGetOsCdrCampos:
    FILE = {
        "filename": "05000-X-BaseSefoc.cdr",
        "relative_path": "Sefoc/05000-X-BaseSefoc.cdr",
        "absolute_path": r"\\srv\os\05000\Sefoc\05000-X-BaseSefoc.cdr",
        "mtime": 1000.0,
        "size": 2048,
    }

    def test_sem_cdr(self, svc):
        with patch.object(svc, "_list_os_cdrs_cached", return_value=[]):
            out = svc.get_os_cdr_campos(2026, 5000)
        assert out["status"] == svc.SITUACAO_SEM_CDR
        assert out["campos"] == []

    def test_sem_pasta(self, svc):
        with patch.object(svc, "_list_os_cdrs_cached", side_effect=LookupError("x")):
            out = svc.get_os_cdr_campos(2026, 5000)
        assert out["status"] == svc.SITUACAO_SEM_PASTA

    def test_retrato_atual_nao_pede_leitura(self, svc):
        row = {
            "ID": 1,
            "Status": "ready",
            "ObjetosJson": '[{"static_id": 1, "pagina": 1, "nome": "Nome", "texto": "Fulano"}]',
            "ObjetosMtime": 1000.2,
            "ObjetosTamanho": 2048,
            "ArquivoMtime": 1000.0,
            "ArquivoTamanho": 2048,
        }
        with patch.object(svc, "_list_os_cdrs_cached", return_value=[dict(self.FILE)]), patch.object(
            svc, "_get_row", return_value=row
        ), patch.object(svc, "_solicitar_leitura") as solicitar:
            out = svc.get_os_cdr_campos(2026, 5000)
        solicitar.assert_not_called()
        assert out["status"] == "ready"
        assert out["atualizado"] is True
        assert out["campos"][0]["key"] == "cdr:Nome"

    def test_arquivo_alterado_enfileira_e_devolve_ultimo_retrato(self, svc):
        row = {
            "ID": 1,
            "Status": "ready",
            "ObjetosJson": '[{"static_id": 1, "pagina": 1, "nome": "Nome", "texto": "Antigo"}]',
            "ObjetosMtime": 900.0,
            "ObjetosTamanho": 2048,
            "ArquivoMtime": 900.0,
            "ArquivoTamanho": 2048,
        }
        with patch.object(svc, "_list_os_cdrs_cached", return_value=[dict(self.FILE)]), patch.object(
            svc, "_get_row", return_value=row
        ), patch.object(svc, "_solicitar_leitura", return_value="pending") as solicitar:
            out = svc.get_os_cdr_campos(2026, 5000)
        solicitar.assert_called_once()
        assert out["status"] == "pending"
        assert out["atualizado"] is False
        assert out["campos"][0]["texto"] == "Antigo"


class TestSolicitarLeitura:
    def test_falha_recente_nao_reenfileira_sem_mudanca(self, svc):
        row = {
            "ID": 7,
            "Status": "failed",
            "ArquivoMtime": 1000.0,
            "ArquivoTamanho": 10,
            "Tentativas": 1,
            "AtualizadoEm": datetime.now() - timedelta(seconds=10),
        }
        with patch.object(svc.db, "execute_query") as q:
            assert svc._solicitar_leitura(2026, 5000, "a.cdr", 1000.0, 10, row, force=False) is None
        q.assert_not_called()

    def test_processing_recente_mantem(self, svc):
        row = {
            "ID": 7,
            "Status": "processing",
            "ArquivoMtime": 1000.0,
            "ArquivoTamanho": 10,
            "IniciadoEm": datetime.now(),
        }
        with patch.object(svc.db, "execute_query") as q:
            assert svc._solicitar_leitura(2026, 5000, "a.cdr", 1000.0, 10, row, force=False) == "processing"
        q.assert_not_called()

    def test_force_reenfileira(self, svc):
        row = {"ID": 7, "Status": "ready", "ArquivoMtime": 1000.0, "ArquivoTamanho": 10}
        with patch.object(svc.db, "execute_query") as q:
            assert svc._solicitar_leitura(2026, 5000, "a.cdr", 1000.0, 10, row, force=True) == "pending"
        q.assert_called_once()


class TestPreparacaoJob:
    def test_retrato_desatualizado_gera_erro_409(self, svc):
        file = dict(TestGetOsCdrCampos.FILE)
        row = {
            "ID": 1,
            "Status": "ready",
            "ObjetosJson": "[]",
            "ObjetosMtime": 1.0,
            "ObjetosTamanho": 2048,
        }
        with patch.object(svc, "_list_os_cdrs_cached", return_value=[file]), patch.object(
            svc, "_get_row", return_value=row
        ), patch.object(svc, "_solicitar_leitura") as solicitar:
            with pytest.raises(svc.StaleCdrSnapshotError):
                svc.preparar_edicoes_para_job(2026, 5000, None, textos={"cdr:Nome": "x"})
        solicitar.assert_called_once()


class TestWorkerAuth:
    def test_rotas_worker_novas_sao_reconhecidas(self):
        from security.papelaria_worker_auth import is_papelaria_worker_path

        assert is_papelaria_worker_path("/api/papelaria/worker/os-cdr-campos/claim", "POST")
        assert is_papelaria_worker_path("/api/papelaria/worker/os-cdr-campos/push", "POST")
        assert is_papelaria_worker_path("/sagra/api/papelaria/worker/os-cdr-campos/12/complete", "POST")
        assert is_papelaria_worker_path("/api/papelaria/worker/os-cdr-campos/12/fail", "POST")
        assert not is_papelaria_worker_path("/api/papelaria/os/2026/5000/cdr-campos", "GET")

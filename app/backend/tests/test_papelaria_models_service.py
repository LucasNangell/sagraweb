"""Testes — serviço de modelos Corel de papelaria (sem COM)."""
from __future__ import annotations

import pytest


class TestPapelariaUtilitarios:
    def test_extrair_variaveis(self):
        from services.papelaria_models_service import extrair_variaveis

        vars_ = extrair_variaveis("Gabinete {gabinete} — {partido}/{uf}")
        assert vars_ == {"gabinete", "partido", "uf"}

    def test_nome_acessor_corrigido(self):
        from services.papelaria_models_service import extrair_variaveis

        assert "nome_assessor" in extrair_variaveis("{nome_acessor}")

    def test_normalizar_gabinete(self):
        from services.papelaria_models_service import normalizar_gabinete

        assert normalizar_gabinete("Gabinete 123") == "123"
        assert normalizar_gabinete("Anexo IV, Gabinete 45") == "045"
        assert normalizar_gabinete("1234") == "234"

    def test_is_relevo_seco_cores(self):
        from services.papelaria_models_service import is_relevo_seco_cores

        assert is_relevo_seco_cores("Relev Seco") is True
        assert is_relevo_seco_cores("Relevo seco") is True
        assert is_relevo_seco_cores("  relev seco  ") is True
        assert is_relevo_seco_cores("Policromia") is False
        assert is_relevo_seco_cores("Port/Inglês") is False
        assert is_relevo_seco_cores("") is False
        assert is_relevo_seco_cores(None) is False

    def test_substituir_variaveis(self):
        from services.papelaria_models_service import substituir_variaveis

        out = substituir_variaveis(
            "{nome_deputado} — {partido}/{uf}",
            {"nome_deputado": "João", "partido": "PT", "uf": "DF"},
        )
        assert out == "João — PT/DF"

    def test_parse_inline_bold_e_substitui_sem_asteriscos(self):
        from services.papelaria_models_service import (
            extrair_variaveis,
            parse_inline_bold,
            substituir_variaveis,
        )

        plain, ranges = parse_inline_bold("**{nome}**")
        assert plain == "{nome}"
        assert ranges == [(0, 6)]

        plain, ranges = parse_inline_bold("Gabinete **Maria** — PT")
        assert plain == "Gabinete Maria — PT"
        assert ranges == [(9, 14)]

        plain, ranges = parse_inline_bold("hello **world")
        assert plain == "hello **world"
        assert ranges == []

        plain, ranges = parse_inline_bold("")
        assert plain == ""
        assert ranges == []

        out = substituir_variaveis(
            "Gabinete {artigo} {genero_curto}\n**{nome_deputado}**",
            {"genero": "Deputada Federal", "nome_deputado": "Maria Silva"},
        )
        assert out == "Gabinete da Deputada\nMaria Silva"
        assert "**" not in (out or "")
        assert extrair_variaveis("**{nome_deputado}**") == {"nome_deputado"}

    def test_substituir_artigo_genero_curto(self):
        from services.papelaria_models_service import (
            _COREL_CABECALHO,
            extrair_variaveis,
            substituir_variaveis,
        )

        tpl = "Gabinete {artigo} {genero_curto} {nome_deputado}"
        assert extrair_variaveis(tpl) == {"nome_deputado"}
        assert "{artigo}" in _COREL_CABECALHO
        assert "{genero_curto}" in _COREL_CABECALHO

        assert (
            substituir_variaveis(tpl, {"genero": "Deputado Federal", "nome_deputado": "João"})
            == "Gabinete do Deputado João"
        )
        assert (
            substituir_variaveis(tpl, {"genero": "Deputada Federal", "nome_deputado": "Maria"})
            == "Gabinete da Deputada Maria"
        )
        assert (
            substituir_variaveis(tpl, {"genero": "", "nome_deputado": "João"})
            == "Gabinete do Deputado João"
        )
        assert (
            substituir_variaveis(
                tpl,
                {"genero": "Deputada Federal", "artigo": "do", "genero_curto": "Deputado", "nome_deputado": "Maria"},
            )
            == "Gabinete da Deputada Maria"
        )

    def test_campos_formulario_ignora_variaveis_derivadas(self):
        from services.papelaria_models_service import build_campos_formulario

        keys = {f["key"] for f in build_campos_formulario(["nome_deputado", "artigo", "genero_curto"])}
        assert keys == {"nome_deputado"}
        assert "artigo" not in keys
        assert "genero_curto" not in keys

    def test_dividir_frente_verso(self):
        from services.papelaria_models_service import dividir_frente_verso

        texto = "Frente:\nLinha A\nVerso:\nLine B"
        fv = dividir_frente_verso(texto)
        assert fv is not None
        assert "Linha A" in fv[1]
        assert "Line B" in fv[2]

    def test_build_campos_formulario_ordem(self):
        from services.papelaria_models_service import build_campos_formulario

        fields = build_campos_formulario(["email", "nome_deputado", "uf"])
        keys = [f["key"] for f in fields]
        assert keys.index("nome_deputado") < keys.index("uf")
        assert keys.index("uf") < keys.index("email")

    def test_normalize_campos_corel_canonicos_sem_duplicar_contato(self):
        from services.papelaria_models_service import (
            build_campos_formulario,
            normalize_campos_from_inspect,
            resolve_canonical_campo_template,
        )

        assert resolve_canonical_campo_template("Contato", "Fones: (61) 3215-5123") is not None
        assert resolve_canonical_campo_template(
            "Contato",
            "Fones: (61) 3215-5{gabinete}\n{email}",
        ) is None

        raw = {
            "NomeDep": "Maria da Silva",
            "Genero": "Deputada Federal",
            "PartidoDep": "PT/DF",
            "Endereco": "Câmara dos Deputados\nAnexo IV, Gabinete 123",
            "Contato": "Fones: (61) 3215-5123\n3215-3123\ne@camara.leg.br",
        }
        campos, variaveis, labels = normalize_campos_from_inspect(raw)
        assert "Contato" not in variaveis
        assert labels == {}
        form_keys = {f["key"] for f in build_campos_formulario(variaveis)}
        assert "Contato" not in form_keys
        assert "gabinete" in form_keys
        assert "email" in form_keys
        assert "{" in campos["Contato"]

    def test_cabecalho_canonico_nao_expõe_variaveis_derivadas(self):
        from services.papelaria_models_service import (
            _COREL_CABECALHO,
            build_campos_formulario,
            normalize_campos_from_inspect,
            resolve_canonical_campo_template,
        )

        assert resolve_canonical_campo_template("Cabecalho", "Gabinete do Deputado\nFulano") == _COREL_CABECALHO
        campos, variaveis, _labels = normalize_campos_from_inspect(
            {"Cabecalho": "Gabinete do Deputado\nFulano"}
        )
        assert campos["Cabecalho"] == _COREL_CABECALHO
        assert "artigo" not in variaveis
        assert "genero_curto" not in variaveis
        assert "nome_deputado" in variaveis
        form_keys = {f["key"] for f in build_campos_formulario(variaveis)}
        assert form_keys == {"nome_deputado", "partido", "uf"}

    def test_resolve_nome_exibicao_customizado(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(svc, "_table_has_column", lambda col: col == "NomeExibicao")
        row = {
            "ID": 1,
            "Produto": "Ct Visita",
            "FrenteVerso": "Frente e Verso",
            "Cores": "Policromia",
            "ArquivoModelo": "CtVisitaFV.cdr",
            "NomeExibicao": "Cartão clássico F/V",
            "CamposJson": None,
            "VariaveisJson": "[]",
            "Ordem": 10,
        }
        modelo = svc._row_to_modelo(row)
        assert modelo["nome_exibicao"] == "Cartão clássico F/V"

    def test_resolve_nome_exibicao_padrao_sem_custom(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(svc, "_table_has_column", lambda col: col == "NomeExibicao")
        row = {
            "ID": 1,
            "Produto": "Ct Visita",
            "FrenteVerso": "Frente e Verso",
            "Cores": "Policromia",
            "ArquivoModelo": "CtVisitaFV.cdr",
            "NomeExibicao": None,
            "CamposJson": None,
            "VariaveisJson": "[]",
            "Ordem": 10,
        }
        modelo = svc._row_to_modelo(row)
        assert modelo["nome_exibicao"] == "Ct Visita — Frente e Verso — Policromia"

    def test_delete_modelo_admin_soft_delete(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(svc, "ensure_papelaria_modelos_table", lambda: None)
        calls: list[tuple] = []

        def fake_query(sql, params=None):
            sql_norm = " ".join(sql.split())
            calls.append((sql_norm, params))
            if "SELECT ID FROM tabPapelariaModelos" in sql_norm and "Ativo = 1" in sql_norm:
                return [{"ID": 42}]
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)

        svc.delete_modelo_admin(42)

        update_calls = [c for c in calls if "UPDATE tabPapelariaModelos" in c[0]]
        assert len(update_calls) == 1
        assert "Ativo = 0" in update_calls[0][0]
        assert update_calls[0][1] == {"id": 42}

    def test_delete_modelo_admin_nao_encontrado(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(svc, "ensure_papelaria_modelos_table", lambda: None)
        monkeypatch.setattr(svc.db, "execute_query", lambda *a, **k: [])

        with pytest.raises(LookupError):
            svc.delete_modelo_admin(999)


class TestMatchingModelos:
    def _modelos_sample(self):
        return [
            {
                "id": 1,
                "produto": "Ct Visita",
                "frente_versao": "Frente e Verso",
                "cores": "Policromia",
                "arquivo_modelo": "CtVisitaFV.cdr",
                "variaveis": [],
                "nome_exibicao": "Ct Visita — Frente e Verso — Policromia",
                "ordem": 10,
            },
            {
                "id": 2,
                "produto": "Ct Visita",
                "frente_versao": "Somente Frente",
                "cores": "Relev Seco",
                "arquivo_modelo": "CtVisitaRS.cdr",
                "variaveis": [],
                "nome_exibicao": "Ct Visita — Somente Frente — Relev Seco",
                "ordem": 20,
            },
            {
                "id": 3,
                "produto": "Timbrado A4",
                "frente_versao": "Somente Frente",
                "cores": "Policromia",
                "arquivo_modelo": "TimbradoA4.cdr",
                "variaveis": [],
                "nome_exibicao": "Timbrado A4",
                "ordem": 30,
            },
        ]

    def test_match_exato_unico(self):
        from services.papelaria_models_service import match_modelos_para_os

        modelos, warnings, auto_id = match_modelos_para_os(
            "Timbrado A4",
            modelos=self._modelos_sample(),
        )
        assert len(modelos) == 1
        assert auto_id == 3
        assert not any("parcial" in w.lower() for w in warnings)

    def test_match_multiplos_sem_auto(self):
        from services.papelaria_models_service import match_modelos_para_os

        modelos, _warnings, auto_id = match_modelos_para_os(
            "Ct Visita",
            modelos=self._modelos_sample(),
        )
        assert len(modelos) == 2
        assert auto_id is None

    def test_match_com_desempate_cores(self):
        from services.papelaria_models_service import match_modelos_para_os

        modelos, _warnings, auto_id = match_modelos_para_os(
            "Ct Visita",
            cores_os="Relev Seco",
            modelos=self._modelos_sample(),
        )
        assert len(modelos) == 1
        assert auto_id == 2

    def test_match_frente_verso_boolean_mysql(self):
        from services.papelaria_models_service import match_modelos_para_os

        modelos, _warnings, auto_id = match_modelos_para_os(
            "Ct Visita",
            cores_os="Policromia",
            frente_verso_os="1",
            modelos=self._modelos_sample(),
        )
        assert len(modelos) == 1
        assert modelos[0]["id"] == 1
        assert modelos[0]["frente_versao"] == "Frente e Verso"
        assert auto_id == 1

    def test_match_frente_verso_somente_frente_zero(self):
        from services.papelaria_models_service import match_modelos_para_os

        modelos, _warnings, auto_id = match_modelos_para_os(
            "Ct Visita",
            cores_os="Relev Seco",
            frente_verso_os="0",
            modelos=self._modelos_sample(),
        )
        assert len(modelos) == 1
        assert auto_id == 2

    def test_produto_inexistente(self):
        from services.papelaria_models_service import match_modelos_para_os

        modelos, warnings, auto_id = match_modelos_para_os(
            "Produto XYZ",
            modelos=self._modelos_sample(),
        )
        assert modelos == []
        assert auto_id is None
        assert any("Nenhum modelo" in w for w in warnings)


class TestBuildOsContextCoercion:
    def test_build_os_context_com_campos_numericos(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NroProtocolo": 5999,
                    "AnoProtocolo": 2026,
                    "NomeUsuario": "Teste",
                    "Titular": "Nome Teste",
                    "SiglaOrgao": "PL/DF",
                    "GabSalaUsuario": 716,
                    "RamalUsuario": 55716,
                    "Titulo": "Titulo",
                    "TipoPublicacaoLink": "Ct Visita",
                    "Cores": 4,
                    "CoresDescricao": None,
                    "FrenteVerso": 1,
                    "Observ": "Obs teste OS",
                }
            ],
        )
        monkeypatch.setattr(svc, "build_prefill_corel", lambda *_a, **_k: {})
        monkeypatch.setattr(
            svc,
            "list_modelos",
            lambda *a, **k: [
                {
                    "id": 1,
                    "produto": "Ct Visita",
                    "frente_versao": "Somente Frente",
                    "cores": "Policromia",
                    "arquivo_modelo": "Ct.cdr",
                    "variaveis": [],
                    "nome_exibicao": "Ct Visita",
                    "ordem": 1,
                }
            ],
        )

        ctx = svc.build_os_context(2026, 5999)
        assert ctx["os"]["produto"] == "Ct Visita"
        assert ctx["os"]["cores"] == "4"
        assert ctx["os"]["frente_verso"] == "Frente e Verso"
        assert ctx["os"]["observ"] == "Obs teste OS"

    def test_build_os_context_aplica_alteracao_cliente_com_diff(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NroProtocolo": 5024,
                    "AnoProtocolo": 2026,
                    "NomeUsuario": "Teste",
                    "Titular": "Nome Teste",
                    "SiglaOrgao": "PL/DF",
                    "GabSalaUsuario": 716,
                    "RamalUsuario": 55716,
                    "Titulo": "Titulo",
                    "TipoPublicacaoLink": "Ct Visita",
                    "Cores": 4,
                    "CoresDescricao": None,
                    "FrenteVerso": 1,
                    "Observ": "",
                }
            ],
        )
        monkeypatch.setattr(svc, "build_prefill_corel", lambda *_a, **_k: {"email": "antigo@x.com"})
        monkeypatch.setattr(
            svc,
            "list_modelos",
            lambda *a, **k: [
                {
                    "id": 7,
                    "produto": "Ct Visita",
                    "frente_versao": "Somente Frente",
                    "cores": "Policromia",
                    "arquivo_modelo": "Ct.cdr",
                    "variaveis": [],
                    "nome_exibicao": "Ct Visita",
                    "ordem": 1,
                }
            ],
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.load_cliente_alteracao_prova",
            lambda *_a, **_k: {
                "campos": {"email": "novo@x.com", "nome_deputado": "Deputado Novo"},
                "observacao_cliente": "Corrigir e-mail",
                "versao": "2",
                "modelo_id": 7,
                "job_id": 42,
            },
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.get_job",
            lambda _job_id: {
                "id": 42,
                "dados": {
                    "email": "dep.antigo@camara.leg.br",
                    "nome_deputado": "Deputado Antigo",
                    "partido": "PL",
                },
            },
        )

        ctx = svc.build_os_context(2026, 5024)

        assert ctx["prefill"]["email"] == "novo@x.com"
        assert ctx["prefill"]["nome_deputado"] == "Deputado Novo"
        assert ctx["prefill"]["partido"] == "PL"
        assert ctx["autoSelectedModelId"] == 7
        alt = ctx["cliente_alteracao"]
        assert alt is not None
        assert alt["observacao"] == "Corrigir e-mail"
        assert alt["versao"] == "2"
        assert alt["job_id"] == 42
        assert alt["campos_alterados"] == [
            {
                "key": "email",
                "antes": "dep.antigo@camara.leg.br",
                "depois": "novo@x.com",
            },
            {
                "key": "nome_deputado",
                "antes": "dep.antigo@camara.leg.br" if False else "Deputado Antigo",
                "depois": "Deputado Novo",
            },
        ]

    def test_build_os_context_os_menor_5000_com_produto_papelaria(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NroProtocolo": 1234,
                    "AnoProtocolo": 2026,
                    "NomeUsuario": "Teste",
                    "Titular": "Nome Teste",
                    "SiglaOrgao": "PL/DF",
                    "GabSalaUsuario": 716,
                    "RamalUsuario": 55716,
                    "Titulo": "Titulo",
                    "TipoPublicacaoLink": "Ct Visita",
                    "Cores": 4,
                    "CoresDescricao": None,
                    "FrenteVerso": 1,
                    "Observ": "Obs teste",
                }
            ],
        )
        monkeypatch.setattr(svc, "build_prefill_corel", lambda *_a, **_k: {})
        monkeypatch.setattr(
            svc,
            "list_modelos",
            lambda *a, **k: [
                {
                    "id": 1,
                    "produto": "Ct Visita",
                    "frente_versao": "Somente Frente",
                    "cores": "Policromia",
                    "arquivo_modelo": "Ct.cdr",
                    "variaveis": [],
                    "nome_exibicao": "Ct Visita",
                    "ordem": 1,
                }
            ],
        )

        ctx = svc.build_os_context(2026, 1234)
        assert ctx["os"]["nro"] == 1234
        assert ctx["os"]["produto"] == "Ct Visita"

    def test_build_os_context_os_menor_5000_com_produto_nao_papelaria_da_erro(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NroProtocolo": 1234,
                    "AnoProtocolo": 2026,
                    "NomeUsuario": "Teste",
                    "Titular": "Nome Teste",
                    "SiglaOrgao": "PL/DF",
                    "GabSalaUsuario": 716,
                    "RamalUsuario": 55716,
                    "Titulo": "Titulo",
                    "TipoPublicacaoLink": "Folder",
                    "Cores": 4,
                    "CoresDescricao": None,
                    "FrenteVerso": 1,
                    "Observ": "Obs teste",
                }
            ],
        )
        monkeypatch.setattr(
            svc,
            "list_modelos",
            lambda *a, **k: [
                {
                    "id": 1,
                    "produto": "Ct Visita",
                    "frente_versao": "Somente Frente",
                    "cores": "Policromia",
                    "arquivo_modelo": "Ct.cdr",
                    "variaveis": [],
                    "nome_exibicao": "Ct Visita",
                    "ordem": 1,
                }
            ],
        )

        with pytest.raises(ValueError, match="OS de papelaria deve ter número >= 5000 ou possuir produto de papelaria configurado"):
            svc.build_os_context(2026, 1234)

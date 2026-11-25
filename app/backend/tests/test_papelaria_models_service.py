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

    def test_anexar_tem_prova_pdf(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            "services.papelaria_prova_pdf_service.tem_modelo_pdf",
            lambda mid: mid == 20,
        )
        out = svc._anexar_tem_prova_pdf({"id": 20, "produto": "Timbrado A4"})
        assert out["tem_prova_pdf"] is True
        out_sem = svc._anexar_tem_prova_pdf({"id": 99})
        assert out_sem["tem_prova_pdf"] is False

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
    @pytest.fixture(autouse=True)
    def _modo_prova_web(self, monkeypatch):
        monkeypatch.setattr(
            "services.papelaria_prova_modo.get_modo",
            lambda: "prova_web",
        )
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc,
            "get_modelo_by_id",
            lambda modelo_id: {
                "id": modelo_id,
                "produto": "Ct Visita",
                "frente_versao": "Somente Frente",
                "cores": "Policromia",
                "arquivo_modelo": "Ct.cdr",
                "variaveis": ["nome_deputado"],
                "nome_exibicao": "Ct Visita",
                "ordem": 1,
                "campos": {"nome_deputado": ""},
                "campos_formulario": [
                    {"key": "nome_deputado", "label": "Nome", "type": "text"}
                ],
            },
        )

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
        assert ctx["autoSelectedModelId"] == 1
        assert ctx["autoSelectedModel"] is not None
        assert ctx["autoSelectedModel"]["id"] == 1
        assert ctx["autoSelectedModel"]["campos_formulario"]

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
            "services.proof_papelaria_service.cliente_alteracao_ainda_pendente",
            lambda *_a, **_k: True,
        )
        extras_json = (
            '[{"id":"extra_1","tipo":"texto","ancora_chave":"7:1:NOME",'
            '"direcao":"abaixo","texto":"Linha"}]'
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.get_job",
            lambda _job_id: {
                "id": 42,
                "dados": {
                    "email": "dep.antigo@camara.leg.br",
                    "nome_deputado": "Deputado Antigo",
                    "partido": "PL",
                    "__campos_extras": extras_json,
                    "__redes_estilo": "pb",
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
        assert alt["internos"]["__campos_extras"] == extras_json
        assert alt["internos"]["__redes_estilo"] == "pb"
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

    def test_build_os_context_cliente_ganha_sobre_api_sem_job(self, monkeypatch):
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
        monkeypatch.setattr(
            svc,
            "build_prefill_corel",
            lambda *_a, **_k: {
                "email": "dep.api@camara.leg.br",
                "nome_deputado": "Nome da API",
                "partido": "PT",
            },
        )
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
                "observacao_cliente": "",
                "versao": "1",
                "modelo_id": 7,
                "job_id": None,
            },
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.cliente_alteracao_ainda_pendente",
            lambda *_a, **_k: True,
        )

        ctx = svc.build_os_context(2026, 5024)

        assert ctx["prefill"]["email"] == "novo@x.com"
        assert ctx["prefill"]["nome_deputado"] == "Deputado Novo"
        assert ctx["prefill"]["partido"] == "PT"
        assert ctx["cliente_alteracao"]["campos"]["email"] == "novo@x.com"

    def test_build_os_context_overlay_cliente_se_get_job_falhar(self, monkeypatch):
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
        monkeypatch.setattr(
            svc,
            "build_prefill_corel",
            lambda *_a, **_k: {
                "email": "dep.api@camara.leg.br",
                "nome_deputado": "Nome da API",
            },
        )
        monkeypatch.setattr(svc, "list_modelos", lambda *a, **k: [])
        monkeypatch.setattr(
            "services.proof_papelaria_service.load_cliente_alteracao_prova",
            lambda *_a, **_k: {
                "campos": {"email": "novo@x.com"},
                "observacao_cliente": "Corrigir e-mail",
                "versao": "2",
                "modelo_id": None,
                "job_id": 99,
            },
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.cliente_alteracao_ainda_pendente",
            lambda *_a, **_k: True,
        )

        def _job_boom(_job_id):
            raise RuntimeError("db down")

        monkeypatch.setattr("services.papelaria_jobs_service.get_job", _job_boom)

        ctx = svc.build_os_context(2026, 5024)

        assert ctx["prefill"]["email"] == "novo@x.com"
        assert ctx["prefill"]["nome_deputado"] == "Nome da API"
        assert ctx["cliente_alteracao"] is not None
        assert ctx["cliente_alteracao"]["campos"]["email"] == "novo@x.com"

    def test_build_os_context_sem_destaque_apos_nova_prova(self, monkeypatch):
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
        monkeypatch.setattr(
            svc,
            "build_prefill_corel",
            lambda *_a, **_k: {"email": "antigo@x.com", "partido": "PL"},
        )
        monkeypatch.setattr(svc, "list_modelos", lambda *a, **k: [])
        monkeypatch.setattr(
            "services.proof_papelaria_service.load_cliente_alteracao_prova",
            lambda *_a, **_k: {
                "campos": {"email": "novo@x.com"},
                "observacao_cliente": "Corrigir e-mail",
                "versao": "2",
                "modelo_id": None,
                "job_id": 42,
            },
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.cliente_alteracao_ainda_pendente",
            lambda *_a, **_k: False,
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.get_job",
            lambda _job_id: {
                "id": 42,
                "dados": {"email": "antigo@x.com", "partido": "PL"},
            },
        )

        ctx = svc.build_os_context(2026, 5024)

        assert ctx["prefill"]["email"] == "novo@x.com"
        assert ctx["prefill"]["partido"] == "PL"
        assert ctx["cliente_alteracao"] is None

    def test_build_os_context_restaura_ultima_prova(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NroProtocolo": 5100,
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
        monkeypatch.setattr(svc, "build_prefill_corel", lambda *_a, **_k: {})
        monkeypatch.setattr(
            svc,
            "list_modelos",
            lambda *a, **k: [
                {
                    "id": 7,
                    "produto": "Ct Visita",
                    "frente_versao": "Frente e Verso",
                    "cores": "Policromia",
                    "arquivo_modelo": "A.cdr",
                    "variaveis": [],
                    "nome_exibicao": "A",
                    "ordem": 1,
                    "padrao_frente": True,
                },
                {
                    "id": 12,
                    "produto": "Ct Visita",
                    "frente_versao": "Frente e Verso",
                    "cores": "Policromia",
                    "arquivo_modelo": "B.cdr",
                    "variaveis": [],
                    "nome_exibicao": "B",
                    "ordem": 2,
                },
            ],
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.load_cliente_alteracao_prova",
            lambda *_a, **_k: None,
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.list_jobs_for_os",
            lambda *_a, **_k: [
                {
                    "id": 99,
                    "tipo_job": "create",
                    "status": "completed",
                    "tem_arquivo_pdf": True,
                    "modelo_id": 12,
                    "dados": {
                        "__composicao": {
                            "frente": {"modelo_id": 12, "pagina": 1},
                            "verso": {"modelo_id": 30, "pagina": 1},
                        }
                    },
                }
            ],
        )

        ctx = svc.build_os_context(2026, 5100)
        assert ctx["autoSelectedModelId"] == 12
        assert ctx["ultima_prova"] == {
            "job_id": 99,
            "modelo_id": 12,
            "composicao": {
                "frente": {"modelo_id": 12, "pagina": 1},
                "verso": {"modelo_id": 30, "pagina": 1},
            },
            "internos": None,
        }

    def test_build_os_context_ultima_prova_inclui_campos_extras(self, monkeypatch):
        from services import papelaria_models_service as svc

        extras_json = (
            '[{"id":"extra_1","tipo":"texto","ancora_chave":"7:1:NOME",'
            '"direcao":"abaixo","texto":"Cargo"}]'
        )
        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NroProtocolo": 5101,
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
        monkeypatch.setattr(svc, "build_prefill_corel", lambda *_a, **_k: {})
        monkeypatch.setattr(
            svc,
            "list_modelos",
            lambda *a, **k: [
                {
                    "id": 7,
                    "produto": "Ct Visita",
                    "frente_versao": "Somente Frente",
                    "cores": "Policromia",
                    "arquivo_modelo": "A.cdr",
                    "variaveis": [],
                    "nome_exibicao": "A",
                    "ordem": 1,
                }
            ],
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.load_cliente_alteracao_prova",
            lambda *_a, **_k: None,
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.list_jobs_for_os",
            lambda *_a, **_k: [
                {
                    "id": 100,
                    "tipo_job": "create",
                    "status": "completed",
                    "tem_arquivo_pdf": True,
                    "modelo_id": 7,
                    "dados": {
                        "__campos_extras": extras_json,
                        "__campos_estilo": '{"7:1:NOME":{"tamanho_pt":12}}',
                        "__textos": '{"7:1:NOME":"X"}',
                    },
                }
            ],
        )

        ctx = svc.build_os_context(2026, 5101)
        assert ctx["ultima_prova"]["internos"] == {
            "__campos_extras": extras_json,
            "__campos_estilo": '{"7:1:NOME":{"tamanho_pt":12}}',
        }
        # Textos/redes não vão em ultima_prova.internos (só extras/estilo).
        assert "__textos" not in (ctx["ultima_prova"]["internos"] or {})

    def test_build_os_context_alt_pendente_prioriza_modelo_e_job(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NroProtocolo": 5101,
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
        monkeypatch.setattr(svc, "build_prefill_corel", lambda *_a, **_k: {})
        monkeypatch.setattr(
            svc,
            "list_modelos",
            lambda *a, **k: [
                {
                    "id": 7,
                    "produto": "Ct Visita",
                    "frente_versao": "Frente e Verso",
                    "cores": "Policromia",
                    "arquivo_modelo": "A.cdr",
                    "variaveis": [],
                    "nome_exibicao": "A",
                    "ordem": 1,
                    "padrao_frente": True,
                },
                {
                    "id": 12,
                    "produto": "Ct Visita",
                    "frente_versao": "Frente e Verso",
                    "cores": "Policromia",
                    "arquivo_modelo": "B.cdr",
                    "variaveis": [],
                    "nome_exibicao": "B",
                    "ordem": 2,
                },
            ],
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.load_cliente_alteracao_prova",
            lambda *_a, **_k: {
                "campos": {},
                "observacao_cliente": "Ajuste",
                "versao": "1",
                "modelo_id": 12,
                "job_id": 55,
            },
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.cliente_alteracao_ainda_pendente",
            lambda *_a, **_k: True,
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.get_job",
            lambda _job_id: {
                "id": 55,
                "modelo_id": 12,
                "dados": {
                    "__composicao": {
                        "frente": {"modelo_id": 12, "pagina": 1},
                        "verso": {"modelo_id": 7, "pagina": 2},
                    }
                },
            },
        )

        ctx = svc.build_os_context(2026, 5101)
        assert ctx["autoSelectedModelId"] == 12
        assert ctx["cliente_alteracao"]["modelo_id"] == 12
        assert ctx["ultima_prova"]["job_id"] == 55
        assert ctx["ultima_prova"]["composicao"]["verso"]["modelo_id"] == 7

    def test_build_os_context_sem_job_usa_padrao_frente(self, monkeypatch):
        from services import papelaria_models_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: [
                {
                    "NroProtocolo": 5102,
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
        monkeypatch.setattr(svc, "build_prefill_corel", lambda *_a, **_k: {})
        monkeypatch.setattr(
            svc,
            "list_modelos",
            lambda *a, **k: [
                {
                    "id": 7,
                    "produto": "Ct Visita",
                    "frente_versao": "Frente e Verso",
                    "cores": "Policromia",
                    "arquivo_modelo": "A.cdr",
                    "variaveis": [],
                    "nome_exibicao": "A",
                    "ordem": 1,
                    "padrao_frente": True,
                },
                {
                    "id": 12,
                    "produto": "Ct Visita",
                    "frente_versao": "Frente e Verso",
                    "cores": "Policromia",
                    "arquivo_modelo": "B.cdr",
                    "variaveis": [],
                    "nome_exibicao": "B",
                    "ordem": 2,
                },
            ],
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.load_cliente_alteracao_prova",
            lambda *_a, **_k: None,
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.list_jobs_for_os",
            lambda *_a, **_k: [],
        )

        ctx = svc.build_os_context(2026, 5102)
        assert ctx["autoSelectedModelId"] == 7
        assert ctx["ultima_prova"] is None

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


class TestPastaImposicao:
    def test_normalize_vazio_vira_none(self):
        from services.papelaria_models_service import normalize_pasta_imposicao

        assert normalize_pasta_imposicao(None) is None
        assert normalize_pasta_imposicao("") is None
        assert normalize_pasta_imposicao("   ") is None

    def test_normalize_unc_e_drive(self):
        from services.papelaria_models_service import normalize_pasta_imposicao
        import os

        unc = normalize_pasta_imposicao(r"\\redecamara\DfsData\CGraf\Pasta")
        assert unc == os.path.normpath(r"\\redecamara\DfsData\CGraf\Pasta")

        drive = normalize_pasta_imposicao(r"C:\SAGRA\Imposicao")
        assert drive == os.path.normpath(r"C:\SAGRA\Imposicao")

    def test_normalize_rejeita_relativo(self):
        from services.papelaria_models_service import normalize_pasta_imposicao

        with pytest.raises(ValueError, match="absoluto"):
            normalize_pasta_imposicao("Sefoc/Offset")
        with pytest.raises(ValueError, match="absoluto"):
            normalize_pasta_imposicao("pasta")


def test_textos_e_redes_alterados_pelo_cliente_ficam_legiveis(monkeypatch):
    """Pedido do portal: textos editados e redes viram listas «antes → depois»."""
    import json

    from services import papelaria_models_service as svc
    from services import papelaria_prova_pdf_service as pdf_svc

    monkeypatch.setattr(
        pdf_svc,
        "carregar_config",
        lambda mid: {"campos": [{"marcador": "NOME", "pagina": 1, "template": "Dep. {nome_deputado}"}]},
    )
    campos = {
        "__textos": json.dumps({"7:1:NOME": "Deputada Ana Maria", "7:1:FONE": "3215"}),
        "__redes": json.dumps([{"chave": "instagram", "valor": "@ana"}]),
    }
    job = {
        "nome_deputado": "Ana",
        "__textos": json.dumps({"7:1:FONE": "3215"}),
        "__redes": json.dumps([{"chave": "x", "valor": "@velho"}]),
    }
    textos = svc._textos_alterados_cliente(campos, job, 7)
    assert textos == [{"chave": "7:1:NOME", "marcador": "NOME", "antes": "Dep. Ana", "depois": "Deputada Ana Maria"}]
    redes = svc._redes_alteradas_cliente(campos, job)
    assert {r["chave"]: (r["antes"], r["depois"]) for r in redes} == {"instagram": ("", "@ana"), "x": ("@velho", "")}
    assert svc._redes_alteradas_cliente({"nome": "x"}, job) == []


def test_alteracao_so_com_observacao_do_cliente(monkeypatch):
    """Cliente recusou só com texto livre (sem campos): o pedido não some."""
    from services import proof_papelaria_service as svc

    monkeypatch.setattr(
        svc.db,
        "execute_query",
        lambda sql, params=None: [
            {"ID": 9, "AlteracoesJson": None, "Versao": 2, "Observacao": "Trocar a cor", "JobIdPapelaria": 55, "DataResposta": None}
        ],
    )
    alt = svc.load_cliente_alteracao_prova(2026, 6195)
    assert alt["campos"] == {} and alt["observacao_cliente"] == "Trocar a cor"
    assert alt["versao"] == "2" and alt["job_id"] == 55

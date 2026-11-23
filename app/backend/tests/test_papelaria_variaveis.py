"""Variáveis universais da Papelaria: cadastro, fontes e formulário."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.variaveis_reais


@pytest.fixture
def cadastro(monkeypatch):
    from services import papelaria_variaveis_service as svc

    lista = [
        {"chave": "nome_deputado", "rotulo": "Nome no cartão", "fonte": "deputado_nome", "tipo": "text", "obrigatorio": True},
        {"chave": "cargo", "rotulo": "Cargo", "fonte": "deputado_genero_federal", "tipo": "text", "obrigatorio": False},
        {"chave": "recado", "rotulo": "Recado", "fonte": None, "tipo": "textarea", "obrigatorio": False},
    ]
    monkeypatch.setattr(svc, "listar", lambda: [dict(v) for v in lista])
    monkeypatch.setattr(svc, "mapa", lambda: {v["chave"]: dict(v) for v in lista})
    return lista


def test_normalizar_lista_valida():
    from services import papelaria_variaveis_service as svc

    ok = svc.normalizar_lista(
        [{"chave": "{nome_assessor}", "rotulo": " Assessor ", "fonte": "", "tipo": "x", "obrigatorio": 1}]
    )
    assert ok == [{"chave": "nome_assessor", "rotulo": "Assessor", "fonte": None, "tipo": "text", "obrigatorio": True}]
    for ruim, msg in [
        ([{"chave": "Nome", "rotulo": "x"}], "inválido"),
        ([{"chave": "genero_curto", "rotulo": "x"}], "automática"),
        ([{"chave": "abc", "rotulo": "x"}, {"chave": "abc", "rotulo": "y"}], "repetida"),
        ([{"chave": "abc", "rotulo": ""}], "rótulo"),
        ([{"chave": "abc", "rotulo": "x", "fonte": "inexistente"}], "Preenchimento"),
    ]:
        with pytest.raises(svc.VariavelError, match=msg):
            svc.normalizar_lista(ruim)


def test_variaveis_dos_templates():
    from services import papelaria_variaveis_service as svc

    assert svc.variaveis_dos_templates(
        ["Gabinete {artigo} {genero_curto} **{nome_deputado}**", "{partido}/{uf}", "{nome_acessor}"]
    ) == ["genero", "nome_deputado", "partido", "uf", "nome_assessor"]


def test_calcular_fontes_e_aplicar_no_prefill(cadastro):
    from services import papelaria_variaveis_service as svc

    fontes = svc.calcular_fontes(
        ano=2026,
        nro=5954,
        row={"NomeUsuario": "João", "Titular": "Maria da Silva", "RamalUsuario": "5123", "Titulo": "Cartão"},
        dados={
            "nome_deputado": "Maria Silva",
            "genero": "Deputada",
            "partido": "PT",
            "uf": "df",
            "gabinete": "123",
            "anexo": "IV",
            "email": "dep.maria@camara.leg.br",
            "contato_assessor": "Fones: (61) 3215-5123",
        },
    )
    assert fontes["deputado_genero_federal"] == "Deputada Federal"
    assert fontes["deputado_partido_uf"] == "PT/DF"
    assert fontes["gabinete_endereco"] == "Anexo IV, Gabinete 123"
    assert fontes["os_numero"] == "05954/2026"
    assert fontes["os_solicitante"] == "João"

    prefill = svc.aplicar_no_prefill({"nome_deputado": "antigo", "recado": "mantém"}, fontes)
    assert prefill["nome_deputado"] == "Maria Silva"
    assert prefill["cargo"] == "Deputada Federal"  # variável nova recebe a fonte
    assert prefill["recado"] == "mantém"  # informado pelo usuário: intocado


def test_formulario_usa_rotulo_tipo_e_ordem_do_cadastro(cadastro):
    from services import papelaria_models_service as models_svc

    campos = models_svc.build_campos_formulario(["recado", "orgao", "cargo", "nome_deputado", "genero_curto"])
    assert [c["key"] for c in campos] == ["nome_deputado", "cargo", "recado", "orgao"]
    por_chave = {c["key"]: c for c in campos}
    assert por_chave["nome_deputado"]["label"] == "Nome no cartão" and por_chave["nome_deputado"]["required"]
    assert por_chave["recado"]["type"] == "textarea"
    assert por_chave["orgao"]["label"] == "orgao"  # fora do cadastro: nome técnico


def test_campos_do_modelo_com_pdf_sao_as_variaveis_dos_textos(tmp_path, monkeypatch, cadastro):
    from services import papelaria_prova_pdf_service as pdf_svc
    from services import papelaria_variaveis_service as svc

    monkeypatch.setattr(pdf_svc, "RAIZ_MODELOS_PDF", tmp_path)
    assert svc.variaveis_do_pdf_do_modelo(5) is None  # sem PDF: usa o fluxo antigo
    pasta = tmp_path / "5"
    pasta.mkdir()
    (pasta / "modelo.pdf").write_bytes(b"%PDF-1.4")
    (pasta / "config.json").write_text(
        '{"campos": [{"marcador": "A", "pagina": 1, "template": "{cargo} {nome_deputado}"},'
        ' {"marcador": "B", "pagina": 1, "template": ""}]}',
        encoding="utf-8",
    )
    assert svc.variaveis_do_pdf_do_modelo(5) == ["cargo", "nome_deputado"]

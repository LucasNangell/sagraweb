"""Comparação dos dados do Corel da pasta com o formulário (antes de «Criar prova»)."""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest

# Campos do modelo CtVisitaFV (id 12) e textos lidos do 06592 CtVisita antigo.
MODELO = {
    "id": 12,
    "produto": "Ct Visita",
    "arquivo_modelo": "CtVisitaFV.cdr",
    "campos": {
        "Contato": "Fones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}",
        "Endereco": "Câmara dos Deputados\nAnexo {anexo}, Gabinete {gabinete}\nCEP 70160-900 - Brasília/DF",
        "Genero": "{genero}",
        "NomeDep": "{nome_deputado}",
        "PartidoDep": "{partido}/{uf}",
    },
    "campos_formulario": [
        {"key": "nome_deputado", "label": "Nome do deputado/deputada"},
        {"key": "email", "label": "E-mail"},
        {"key": "gabinete", "label": "Gabinete"},
        {"key": "anexo", "label": "Anexo"},
        {"key": "genero", "label": "Gênero"},
        {"key": "partido", "label": "Partido"},
        {"key": "uf", "label": "UF"},
    ],
}
OCORRENCIAS = {
    "Contato": ["dep.sargentogoncalves@camara.leg.br"],
    "Endereco": [
        "Av. das Fronteiras, 1251\rNossa Senhora da Apresentação\rCEP 59114-275 - Natal/RN\rFone: (84) 3113-0944",
        "Câmara dos Deputados\rAnexo III, Gabinete 569\rCEP 70160-900 - Brasília/DF\rFones: (61) 3215-5569/1569",
    ],
    "Genero": ["Deputado Federal"],
    "NomeDep": ["Sargento Gonçalves", "Everton Rocha\rChefe de Gabinete\r\rFone: (84) 3113-0944"],
    "PartidoDep": ["PL/RN"],
    "OSint": ["06592/2025"],
}
DADOS = {
    "nome_deputado": "Sargento Gonçalves",
    "genero": "Deputado Federal",
    "partido": "PL",
    "uf": "rn",
    "gabinete": "Gab. 569",
    "anexo": "III",
    "email": "dep.sargentogoncalves@camara.leg.br",
}


def _comparar(**kw):
    from services.papelaria_corel_dados_service import comparar_dados_corel

    params = {
        "modelo": MODELO,
        "dados": DADOS,
        "campos_cdr": {k: v[0] for k, v in OCORRENCIAS.items()},
        "ocorrencias_cdr": OCORRENCIAS,
    }
    params.update(kw)
    return comparar_dados_corel(**params)


def test_normalizar_texto_do_corel():
    from services.papelaria_corel_dados_service import normalizar_texto

    assert normalizar_texto("  A\r B  \x0bC\r\r") == "A\nB\nC"
    assert normalizar_texto("PL/RN") == normalizar_texto("PL/RN ")


def test_diferencas_do_cartao_antigo():
    dif = {d["campo"]: d for d in _comparar()}
    # Igual ao formulário: não pergunta (gabinete/UF normalizados como no job).
    assert "Genero" not in dif and "PartidoDep" not in dif
    # Objeto fora do modelo não entra.
    assert "OSint" not in dif
    assert set(dif) == {"Contato", "Endereco", "NomeDep"}
    nome = dif["NomeDep"]
    assert nome["rotulo"] == "Nome do deputado/deputada"
    assert "Everton Rocha\nChefe de Gabinete\n\nFone: (84) 3113-0944" in nome["original"]
    assert nome["novo"] == ["Sargento Gonçalves"]
    assert dif["Contato"]["rotulo"] == "E-mail, Gabinete"
    assert dif["Contato"]["novo"] == [
        "Fones: (61) 3215-5569\n3215-3569\ndep.sargentogoncalves@camara.leg.br"
    ]


def test_sem_diferencas_quando_corel_bate_com_formulario():
    ocorr = {"NomeDep": ["Sargento Gonçalves"], "PartidoDep": ["PL/RN"], "Genero": ["Deputado Federal"]}
    assert _comparar(campos_cdr={}, ocorrencias_cdr=ocorr) == []


def test_campo_excluido_e_frente_verso():
    dados = {**DADOS, "__exclusoes": json.dumps(["NomeDep", "Contato", "Endereco"])}
    assert _comparar(dados=dados) == []

    modelo = {**MODELO, "campos": {"NomeDep": "Frente:\n{nome_deputado}\nVerso:\nEverton Rocha"}}
    ocorr = {"NomeDep": ["Sargento Gonçalves", "Everton Rocha"]}
    assert _comparar(modelo=modelo, campos_cdr={}, ocorrencias_cdr=ocorr) == []


def test_sem_ocorrencias_usa_campos_do_inspect_antigo():
    dif = _comparar(campos_cdr={"NomeDep": "Fulano"}, ocorrencias_cdr=None)
    assert [d["campo"] for d in dif] == ["NomeDep"]
    assert dif[0]["original"] == ["Fulano"]


def test_iniciar_sem_corel_na_pasta(monkeypatch):
    from services import papelaria_corel_dados_service as svc

    monkeypatch.setattr("services.papelaria_jobs_service.find_os_base_cdr", lambda ano, nro: None)
    assert svc.iniciar_comparacao(2025, 6592) == {"status": "sem_corel"}


def test_iniciar_envia_corel_para_inspecao(monkeypatch, tmp_path):
    from services import papelaria_corel_dados_service as svc

    cdr = tmp_path / "x_Base.cdr"
    cdr.write_bytes(b"cdr-bytes")
    monkeypatch.setattr(
        "services.papelaria_jobs_service.find_os_base_cdr",
        lambda ano, nro: {"filename": "x_Base.cdr", "relative_path": "Sefoc/x_Base.cdr", "absolute_path": str(cdr)},
    )
    sent = {}

    def fake_create(content, filename):
        sent.update(content=content, filename=filename)
        return {"inspect_id": "tok", "status": "pending"}

    monkeypatch.setattr("services.papelaria_cdr_inspect_service.create_inspect_request", fake_create)
    out = svc.iniciar_comparacao(2025, 6592)
    assert out == {"status": "pending", "inspect_id": "tok", "arquivo": "x_Base.cdr", "relative_path": "Sefoc/x_Base.cdr"}
    assert sent == {"content": b"cdr-bytes", "filename": "x_Base.cdr"}


@pytest.mark.parametrize("status", ["pending", "processing"])
def test_resultado_em_andamento(monkeypatch, status):
    from services import papelaria_corel_dados_service as svc

    monkeypatch.setattr(
        "services.papelaria_cdr_inspect_service.get_inspect_request",
        lambda token: {"status": status, "filename": "x.cdr"},
    )
    out = svc.resultado_comparacao("tok", modelo_id=12, dados=DADOS)
    assert out == {"status": status, "inspect_id": "tok", "arquivo": "x.cdr"}


def test_resultado_concluido_traz_diferencas_e_descarta_copia(monkeypatch):
    from services import papelaria_corel_dados_service as svc

    monkeypatch.setattr(
        "services.papelaria_cdr_inspect_service.get_inspect_request",
        lambda token: {
            "status": "completed",
            "filename": "x.cdr",
            "campos": {"NomeDep": "Fulano"},
            "ocorrencias": {"NomeDep": ["Fulano"]},
        },
    )
    descartados = []
    monkeypatch.setattr(
        "services.papelaria_cdr_inspect_service.discard_inspect_file",
        lambda token: descartados.append(token),
    )
    with patch("services.papelaria_models_service.get_modelo_by_id", return_value=MODELO):
        out = svc.resultado_comparacao("tok", modelo_id=12, dados=DADOS)
    assert out["status"] == "completed"
    assert [d["campo"] for d in out["diferencas"]] == ["NomeDep"]
    assert descartados == ["tok"]


def test_resultado_falha(monkeypatch):
    from services import papelaria_corel_dados_service as svc

    monkeypatch.setattr(
        "services.papelaria_cdr_inspect_service.get_inspect_request",
        lambda token: {"status": "failed", "filename": "x.cdr", "erro": "Corel ocupado"},
    )
    out = svc.resultado_comparacao("tok", modelo_id=12, dados=DADOS)
    assert out["status"] == "failed" and out["erro"] == "Corel ocupado"

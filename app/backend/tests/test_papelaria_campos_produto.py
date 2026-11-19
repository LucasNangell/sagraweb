"""Campos do produto real (Corel da pasta) — definição, formulário, prévia e worker."""
from __future__ import annotations

import json

import pytest

CAMPOS_MODELO = {
    "Contato": "Fones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}",
    "Endereco": "Câmara dos Deputados\nAnexo {anexo}, Gabinete {gabinete}\nCEP 70160-900 - Brasília/DF",
    "Genero": "{genero}",
    "NomeDep": "{nome_deputado}",
    "PartidoDep": "{partido}/{uf}",
}
FORM = [
    {"key": "nome_deputado", "label": "Nome", "required": True},
    {"key": "genero", "label": "Gênero"},
    {"key": "partido", "label": "Partido"},
    {"key": "uf", "label": "UF"},
    {"key": "gabinete", "label": "Gabinete"},
    {"key": "anexo", "label": "Anexo"},
    {"key": "email", "label": "E-mail", "required": True},
]
PRODUTO = {
    "arquivo": "06592-CtVisita_Base.cdr",
    "objetos": {
        "Endereco": [
            {"face": "Frente", "x": 17.69, "y": 12.18, "key": "obj_endereco_1"},
            {"face": "Frente", "x": 65.89, "y": 12.18, "key": "obj_endereco_2"},
        ],
        "NomeDep": [
            {"face": "Frente", "x": 42.22, "y": 28.36, "key": "obj_nomedep_1"},
            {"face": "Verso", "x": 23.46, "y": 25.0, "key": "obj_nomedep_2"},
        ],
    },
    "campos": [
        {"key": "obj_endereco_1", "label": "Endereço — Frente (esquerda)", "rows": 4},
        {"key": "obj_endereco_2", "label": "Endereço — Frente (direita)", "rows": 4},
        {"key": "obj_nomedep_1", "label": "Nome — Frente"},
        {"key": "obj_nomedep_2", "label": "Nome — Verso", "rows": 4},
    ],
}


def test_valida_e_normaliza():
    from services.papelaria_campos_produto import validar_campos_produto

    out = validar_campos_produto(json.dumps(PRODUTO), CAMPOS_MODELO)
    assert set(out["objetos"]) == {"Endereco", "NomeDep"}
    assert [c["key"] for c in out["campos"]] == [
        "obj_endereco_1", "obj_endereco_2", "obj_nomedep_1", "obj_nomedep_2"
    ]
    assert all(c["type"] == "textarea" for c in out["campos"])
    assert validar_campos_produto(None) is None
    # Objeto desconhecido pelo modelo é ignorado.
    so_estranho = {"objetos": {"Xyz": [{"face": "Frente", "x": 1, "y": 1, "key": "obj_x_1"}]}}
    assert validar_campos_produto(so_estranho, CAMPOS_MODELO) is None


@pytest.mark.parametrize(
    "mexe",
    [
        lambda p: p["objetos"]["NomeDep"][0].update(key="__exclusoes"),
        lambda p: p["objetos"]["NomeDep"][0].update(face="Lado B"),
        lambda p: p["objetos"]["NomeDep"][0].update(x="abc"),
        lambda p: p["objetos"]["NomeDep"][1].update(key="obj_endereco_1"),
    ],
)
def test_rejeita_definicao_invalida(mexe):
    from services.papelaria_campos_produto import validar_campos_produto

    p = json.loads(json.dumps(PRODUTO))
    mexe(p)
    with pytest.raises(ValueError):
        validar_campos_produto(p)


def test_formulario_esconde_variaveis_so_dos_objetos_do_produto():
    from services.papelaria_campos_produto import (
        campos_formulario_com_produto,
        campos_modelo_sem_objetos,
        variaveis_ocultas,
    )

    # nome_deputado só aparece em NomeDep; anexo só em Endereco; gabinete continua no Contato.
    assert variaveis_ocultas(CAMPOS_MODELO, PRODUTO) == {"nome_deputado", "anexo"}
    keys = [f["key"] for f in campos_formulario_com_produto(FORM, CAMPOS_MODELO, PRODUTO)]
    assert "nome_deputado" not in keys and "anexo" not in keys
    assert "gabinete" in keys and "email" in keys
    assert keys[-4:] == ["obj_endereco_1", "obj_endereco_2", "obj_nomedep_1", "obj_nomedep_2"]
    assert set(campos_modelo_sem_objetos(CAMPOS_MODELO, PRODUTO)) == {"Contato", "Genero", "PartidoDep"}
    assert campos_formulario_com_produto(FORM, CAMPOS_MODELO, None) == FORM


def test_previa_usa_campo_da_face():
    from services.papelaria_campos_produto import preview_config_com_produto

    cfg = {
        "faces": [
            {"id": "frente", "elementos": [{"id": "NomeDep", "template": "{nome_deputado}"}]},
            {"id": "verso", "elementos": [{"id": "NomeDep", "template": "{nome_deputado}"}, {"id": "Outro", "template": "x"}]},
        ]
    }
    out = json.loads(preview_config_com_produto(json.dumps(cfg), PRODUTO))
    assert out["faces"][0]["elementos"][0]["template"] == "{obj_nomedep_1}"
    assert out["faces"][1]["elementos"][0]["template"] == "{obj_nomedep_2}"
    assert out["faces"][1]["elementos"][1]["template"] == "x"


def test_job_aceita_e_payload_envia_objetos(monkeypatch, tmp_path):
    from unittest.mock import patch

    from services import papelaria_jobs_service as svc

    dados = svc._sanitize_dados(
        {"email": "a@b.c", "__campos_produto": json.dumps(PRODUTO), "obj_nomedep_2": "Everton Rocha"}
    )
    assert json.loads(dados["__campos_produto"])["objetos"]["NomeDep"][1]["key"] == "obj_nomedep_2"
    modelo = {"id": 1, "produto": "Ct Visita", "campos": CAMPOS_MODELO, "campos_formulario": FORM,
              "arquivo_modelo": "CtVisitaFV.cdr", "frente_versao": "FV", "cores": "4x4"}
    # nome_deputado é obrigatório, mas está oculto pelos campos do produto.
    assert svc._validate_required_fields(modelo, dados) == []

    sefoc = tmp_path / "Sefoc"
    sefoc.mkdir()
    job = {"id": 7, "ano_protocolo": 2025, "nro_protocolo": 6592, "tipo_job": svc.TIPO_JOB_CREATE,
           "produto": "Ct Visita", "modelo_id": 1, "arquivo_modelo": "CtVisitaFV.cdr",
           "dados": dict(dados), "tentativas": 0}
    monkeypatch.setattr(svc, "get_job", lambda job_id: job)
    monkeypatch.setattr(svc, "ensure_papelaria_jobs_tables", lambda: None)
    monkeypatch.setattr(svc, "resolve_os_papelaria_dir", lambda ano, nro, create=False: str(sefoc))
    monkeypatch.setattr(svc, "get_os_folder_basename", lambda ano, nro: "06592-X")
    monkeypatch.setattr("services.papelaria_prova_modo.get_modo", lambda: "prova_web")
    monkeypatch.setattr(svc, "build_prova_web_pdf_name", lambda ano, nro: "06592-X-Prova2.pdf")
    monkeypatch.setattr(svc.db, "execute_query", lambda *a, **k: None)
    with patch("services.papelaria_models_service.get_modelo_by_id", return_value=modelo):
        payload = svc.build_worker_job_payload(7)
    assert set(payload["campos"]) == {"Contato", "Genero", "PartidoDep"}
    assert set(payload["campos_produto_objetos"]) == {"Endereco", "NomeDep"}
    assert "__campos_produto" not in payload["dados"]
    assert payload["dados"]["obj_nomedep_2"] == "Everton Rocha"


def test_portal_mostra_campos_do_produto(monkeypatch):
    from services import proof_papelaria_service as svc

    job = {"id": 9, "modelo_id": 1, "dados": {"__campos_produto": json.dumps(PRODUTO), "obj_nomedep_2": "Everton", "email": "a@b"}}
    monkeypatch.setattr(svc, "resolve_papelaria_proof_context", lambda row, ano, os_id: {"proof_id": 1, "job_id": 9, "produto": "Ct Visita"})
    monkeypatch.setattr(svc, "_os_observ", lambda ano, os_id: "")
    monkeypatch.setattr("services.papelaria_jobs_service.get_job", lambda job_id: job)
    monkeypatch.setattr(
        "services.papelaria_models_service.get_modelo_with_preview",
        lambda modelo_id: {"campos": CAMPOS_MODELO, "campos_formulario": FORM, "preview_config_json": None},
    )
    out = svc.build_portal_papelaria_edit_payload({"ID": 1}, 2025, 6592)
    keys = [c["key"] for c in out["campos_formulario"]]
    assert "obj_nomedep_2" in keys and "nome_deputado" not in keys
    assert out["job_dados"] == {"obj_nomedep_2": "Everton", "email": "a@b"}

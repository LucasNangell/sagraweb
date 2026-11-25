"""Estilo tipográfico de campos do modelo (__campos_estilo)."""
from __future__ import annotations

import json


def test_normalizar_campos_estilo_ok():
    from services.papelaria_campos_estilo_service import normalizar_campos_estilo

    out = normalizar_campos_estilo(
        {
            "7:1:NOME": {
                "tamanho_pt": 14,
                "align_h": "centro",
                "align_v": "meio",
                "x_pt": 100,
                "y_pt": 50.5,
            }
        }
    )
    assert out["7:1:NOME"]["tamanho_pt"] == 14.0
    assert out["7:1:NOME"]["align_h"] == "centro"
    assert out["7:1:NOME"]["align_v"] == "meio"
    assert out["7:1:NOME"]["x_pt"] == 100.0
    assert out["7:1:NOME"]["y_pt"] == 50.5


def test_normalizar_campos_estilo_rejeita_invalido():
    from services.papelaria_campos_estilo_service import (
        CamposEstiloError,
        normalizar_campos_estilo,
    )
    import pytest

    with pytest.raises(CamposEstiloError):
        normalizar_campos_estilo({"x": {"tamanho_pt": 12}})
    with pytest.raises(CamposEstiloError):
        normalizar_campos_estilo({"7:1:NOME": {"tamanho_pt": 200}})
    with pytest.raises(CamposEstiloError):
        normalizar_campos_estilo({"7:1:NOME": {"align_h": "justify"}})


def test_sanitize_dados_campos_estilo():
    from services import papelaria_jobs_service as jobs_svc

    limpo = jobs_svc._sanitize_dados(
        {
            "__campos_estilo": json.dumps(
                {"7:1:NOME": {"tamanho_pt": 16, "align_h": "direita", "align_v": "base"}}
            ),
            "nome": "x",
        }
    )
    assert json.loads(limpo["__campos_estilo"])["7:1:NOME"]["tamanho_pt"] == 16.0
    import pytest

    with pytest.raises(ValueError):
        jobs_svc._sanitize_dados({"__campos_estilo": "{"})


def test_previa_pdf_rota_encaminha_campos_estilo(monkeypatch):
    from routers.papelaria_routes import (
        PapelariaProvaPdfPreviaPayload,
        previa_pdf_ao_vivo,
    )
    from security.session_auth import SessionData

    capturado: dict = {}

    monkeypatch.setattr(
        "services.papelaria_models_service.get_modelo_by_id",
        lambda *_a, **_k: {"id": 15, "produto": "Cartão"},
    )
    monkeypatch.setattr(
        "services.papelaria_faces_service.validar_composicao",
        lambda *_a, **_k: None,
    )

    def _previa(modelo_id, dados, **_kw):
        capturado["dados"] = dict(dados or {})
        return {"paginas": [], "ms": 1, "avisos": [], "regioes": []}

    monkeypatch.setattr(
        "services.papelaria_prova_pdf_service.previa_png",
        _previa,
    )

    estilos = json.dumps({"15:1:NOME": {"tamanho_pt": 18, "align_h": "centro", "align_v": "meio"}})
    previa_pdf_ao_vivo(
        15,
        PapelariaProvaPdfPreviaPayload(
            dados={"nome": "Ana", "__campos_estilo": estilos, "__segredo": "nao"}
        ),
        _session=SessionData(ponto=1, nome="t", ip="127.0.0.1", iat=0),
    )
    assert capturado["dados"]["__campos_estilo"] == estilos
    assert "__segredo" not in capturado["dados"]


def test_ancora_de_align_v():
    from services.papelaria_campos_estilo_service import (
        align_v_de_ancora,
        ancora_de_align_v,
    )

    assert ancora_de_align_v("meio") == "centro"
    assert ancora_de_align_v("topo") == "topo"
    assert align_v_de_ancora("centro") == "meio"

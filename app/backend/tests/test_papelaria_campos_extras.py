"""Campos extras (__campos_extras) na prévia PDF."""
from __future__ import annotations

import json

import fitz
import pytest


def test_normalizar_campos_extras_ok():
    from services.papelaria_campos_extras_service import normalizar_campos_extras

    raw = [
        {
            "id": "extra_1",
            "tipo": "texto",
            "ancora_chave": "7:1:NOME",
            "direcao": "abaixo",
            "texto": "Cargo",
            "align_h": "centro",
            "tamanho_pt": 12,
            "negrito": [[0, 5]],
            "x_pt": 10,
            "y_pt": 20,
        },
        {
            "id": "extra_2",
            "tipo": "rede",
            "ancora_chave": "7:1:NOME",
            "direcao": "direita",
            "rede_chave": "instagram",
            "rede_valor": "@ana",
        },
    ]
    out = normalizar_campos_extras(raw)
    assert len(out) == 2
    assert out[0]["texto"] == "Cargo"
    assert out[0]["align_h"] == "centro"
    assert out[0]["tamanho_pt"] == 12.0
    assert out[0]["negrito"] == [[0, 5]]
    assert out[1]["rede_chave"] == "instagram"


def test_normalizar_campos_extras_rejeita_invalido():
    from services.papelaria_campos_extras_service import (
        CamposExtrasError,
        normalizar_campos_extras,
    )

    with pytest.raises(CamposExtrasError):
        normalizar_campos_extras([{"id": "x", "tipo": "foo", "ancora_chave": "7:1:A", "direcao": "acima"}])
    with pytest.raises(CamposExtrasError):
        normalizar_campos_extras(
            [{"id": "x", "tipo": "texto", "ancora_chave": "ruim", "direcao": "acima"}]
        )
    with pytest.raises(CamposExtrasError):
        normalizar_campos_extras(
            [
                {
                    "id": "x",
                    "tipo": "texto",
                    "ancora_chave": "7:1:A",
                    "direcao": "acima",
                    "tamanho_pt": 200,
                }
            ]
        )


def test_sanitize_dados_campos_extras():
    from services import papelaria_jobs_service as jobs_svc

    payload = [
        {
            "id": "extra_1",
            "tipo": "texto",
            "ancora_chave": "7:1:NOME",
            "direcao": "acima",
            "texto": "Linha",
            "align_h": "esquerda",
            "offset_x_pt": 2,
        }
    ]
    limpo = jobs_svc._sanitize_dados({"__campos_extras": json.dumps(payload), "nome": "x"})
    assert json.loads(limpo["__campos_extras"])[0]["id"] == "extra_1"
    with pytest.raises(ValueError):
        jobs_svc._sanitize_dados({"__campos_extras": "[{"})


def test_bbox_relativo_altura_de_linha():
    from services.papelaria_campos_extras_service import _bbox_relativo

    ancora = fitz.Rect(100, 100, 200, 180)  # âncora alta
    abaixo = _bbox_relativo(
        ancora,
        "abaixo",
        400,
        600,
        linha_h=14.0,
        largura_conteudo=80.0,
        align_h="esquerda",
    )
    assert abaixo.height == pytest.approx(14.0, abs=0.5)
    assert abaixo.y0 >= ancora.y1
    acima = _bbox_relativo(
        ancora, "acima", 400, 600, linha_h=14.0, largura_conteudo=80.0, align_h="centro"
    )
    assert acima.y1 <= ancora.y0
    # centro: caixa centrada na âncora
    assert abs((acima.x0 + acima.x1) / 2 - (ancora.x0 + ancora.x1) / 2) < 1.0


def test_aplicar_campos_extras_texto_emite_regiao():
    from services import papelaria_campos_extras_service as extras_svc

    doc = fitz.open()
    page = doc.new_page(width=300, height=400)
    page.insert_text((50, 80), "ANCORA", fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()

    regioes = [
        {
            "chave": "7:1:ANCORA",
            "modelo_id": 7,
            "pagina": 1,
            "pagina_saida": 0,
            "marcador": "ANCORA",
            "area": [50 / 300, 60 / 400, 150 / 300, 90 / 400],
            "texto": "ANCORA",
        }
    ]
    extras = [
        {
            "id": "extra_1",
            "tipo": "texto",
            "ancora_chave": "7:1:ANCORA",
            "direcao": "abaixo",
            "texto": "Extra",
            "rede_chave": "",
            "rede_valor": "",
            "x_pt": None,
            "y_pt": None,
            "offset_x_pt": 0,
            "offset_y_pt": 0,
            "align_h": "esquerda",
            "align_v": "topo",
            "tamanho_pt": 12,
            "negrito": [],
        }
    ]
    avisos: list[str] = []
    out = extras_svc.aplicar_campos_extras(
        pdf_bytes, extras, regioes, modelo_id=7, avisos=avisos
    )
    assert isinstance(out, (bytes, bytearray))
    extras_regs = [r for r in regioes if r.get("tipo") == "campo_extra"]
    # Sem fonte embutida editável, ainda emite região clicável
    assert extras_regs
    assert extras_regs[0]["chave"] == "extra:extra_1"
    assert extras_regs[0].get("page_w")


def test_previa_pdf_rota_encaminha_campos_extras(monkeypatch):
    """A prévia ao vivo não pode filtrar ``__campos_extras`` (bug 0.120.x)."""
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

    extras = json.dumps(
        [
            {
                "id": "extra_1",
                "tipo": "texto",
                "ancora_chave": "15:1:LEB",
                "direcao": "abaixo",
                "texto": "X",
            }
        ]
    )
    previa_pdf_ao_vivo(
        15,
        PapelariaProvaPdfPreviaPayload(
            dados={"nome": "Ana", "__campos_extras": extras, "__segredo": "nao"}
        ),
        _session=SessionData(ponto=1, nome="t", ip="127.0.0.1", iat=0),
    )
    assert "__campos_extras" in capturado["dados"]
    assert capturado["dados"]["__campos_extras"] == extras
    assert "__segredo" not in capturado["dados"]

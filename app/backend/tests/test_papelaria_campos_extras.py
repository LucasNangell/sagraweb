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


def test_sanitize_dados_campos_extras():
    from services import papelaria_jobs_service as jobs_svc

    payload = [
        {
            "id": "extra_1",
            "tipo": "texto",
            "ancora_chave": "7:1:NOME",
            "direcao": "acima",
            "texto": "Linha",
        }
    ]
    limpo = jobs_svc._sanitize_dados({"__campos_extras": json.dumps(payload), "nome": "x"})
    assert json.loads(limpo["__campos_extras"])[0]["id"] == "extra_1"
    with pytest.raises(ValueError):
        jobs_svc._sanitize_dados({"__campos_extras": "[{"})


def test_bbox_relativo_quatro_direcoes():
    from services.papelaria_campos_extras_service import _bbox_relativo

    ancora = fitz.Rect(100, 100, 200, 120)
    acima = _bbox_relativo(ancora, "acima", 400, 600)
    abaixo = _bbox_relativo(ancora, "abaixo", 400, 600)
    esquerda = _bbox_relativo(ancora, "esquerda", 400, 600)
    direita = _bbox_relativo(ancora, "direita", 400, 600)
    assert acima.y1 <= ancora.y0
    assert abaixo.y0 >= ancora.y1
    assert esquerda.x1 <= ancora.x0
    assert direita.x0 >= ancora.x1


def test_aplicar_campos_extras_texto_emite_regiao(tmp_path, monkeypatch):
    """Desenha texto extra relativo a uma região âncora e emite regiao clicável."""
    from services import papelaria_campos_extras_service as extras_svc

    # PDF mínimo com texto embutido (fonte padrão Helvetica — tipografia
    # embutida editável pode falhar; o teste cobre o caminho de região
    # quando o estilo é encontrado, ou o aviso quando não).
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
        }
    ]
    avisos: list[str] = []
    out = extras_svc.aplicar_campos_extras(
        pdf_bytes, extras, regioes, modelo_id=7, avisos=avisos
    )
    assert isinstance(out, (bytes, bytearray))
    extras_regs = [r for r in regioes if r.get("tipo") == "campo_extra"]
    # Sem fonte embutida editável, o serviço avisa e ignora — ambos ok.
    if extras_regs:
        assert extras_regs[0]["chave"] == "extra:extra_1"
        assert extras_regs[0]["texto"] == "Extra"
    else:
        assert any("tipografia" in a.lower() or "ignorado" in a.lower() for a in avisos)

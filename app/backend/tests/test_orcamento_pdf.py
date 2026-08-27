"""PDF do ofício e textos auxiliares do orçamento, sem I/O de OS."""
from __future__ import annotations

import re
import zlib

from services.orcamento_os_service import (
    montar_especificacao,
    montar_especificacao_grupos,
    montar_oficio_preview,
)
from services.orcamento_pdf_service import build_orcamento_pdf

P26 = {
    "codigo": "p26",
    "categoria": "papel",
    "especificacao": "Papel Couchê fosco 300gr (66x96cm)",
    "ativo": True,
}


def _pdf_streams(pdf: bytes) -> str:
    chunks: list[str] = []
    for match in re.finditer(rb"stream\r?\n(.+?)\r?\nendstream", pdf, re.S):
        raw = match.group(1)
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            pass
        chunks.append(raw.decode("latin-1", "replace"))
    return "\n".join(chunks)


def _payload_marcador():
    return {
        "os": {
            "produto": "Marcador",
            "titulo": "Marcador de página — Leonardo da Vinci",
            "papel_os": "Couchê fosco 300g",
        },
        "tiragem": 100,
        "tecnologia": "digital",
        "componentes": [
            {
                "nome": "Marcador",
                "tipo": "UNICO",
                "menor_mm": 55,
                "maior_mm": 200,
                "papel_codigo": "p26",
                "papel_nome_os": "Couchê fosco 300g",
                "cor": True,
                "frente_verso": True,
                "paginas": 2,
                "laminacao": True,
                "laminacao_fv": False,
            }
        ],
    }


def test_montar_especificacao_usa_descricao_nao_codigo():
    payload = _payload_marcador()
    text = montar_especificacao(payload, insumos=[P26])
    assert "55×200 mm" in text
    assert "Papel Couchê fosco 300gr" in text
    assert "p26" not in text
    assert "laminação fosca somente na frente" in text
    assert "Tiragem: 100" in text


def test_grupos_produto_material_impressao_acabamento():
    grupos = montar_especificacao_grupos(_payload_marcador(), insumos=[P26])
    titulos = [g["titulo"] for g in grupos]
    assert titulos == ["Produto", "Material", "Impressão", "Acabamento"]
    material = next(g for g in grupos if g["titulo"] == "Material")
    papéis = [l["valor"] for l in material["linhas"] if l["label"].startswith("Papel")]
    assert any("Couchê fosco 300gr" in v for v in papéis)
    assert not any("p26" in v for v in papéis)
    os_row = next((l for l in material["linhas"] if "OS" in l["label"]), None)
    assert os_row is not None
    assert "Couchê fosco 300g" in os_row["valor"]


def test_oficio_preview_usa_os_nao_numero_de_orcamento():
    payload = {
        "os": {
            "solicitante": "Leonardo",
            "titulo": "Marcador",
            "processo": "123",
            "nro_protocolo": 1365,
            "ano_protocolo": 2026,
        },
        "tiragem": 100,
        "componentes": [{"paginas": 2, "menor_mm": 55, "maior_mm": 200}],
    }
    resultado = {
        "tecnologia_escolhida": "digital",
        "escolhido": {"total": 124.9},
        "total": 124.9,
    }
    oficio = montar_oficio_preview(
        payload,
        resultado,
        {
            "validade_dias": 180,
            "prazo_entrega_dias": 7,
            "pdf_clausula_validade": "Este orçamento tem validade de {validade_dias} dias.",
            "pdf_clausula_entrega": "Impressão em equipamento {tecnologia}. Entrega em {prazo_entrega_dias} ({prazo_extenso}) dias úteis.",
            "pdf_signatario": "Diretor Teste",
            "pdf_cargo": "Diretor",
            "pdf_endereco": "Via N3",
            "pdf_telefone": "3216-2701",
        },
    )
    assert oficio["os_numero"] == 1365
    assert oficio["numero"] is None
    assert "180" in oficio["clausula_validade"]
    assert "Digital" in oficio["clausula_entrega"]
    assert oficio["especificacao_grupos"]
    assert oficio["especificacao_grupos"][0]["titulo"] == "Produto"


def test_pdf_oficio_contem_numero_proprio_e_os():
    pdf = build_orcamento_pdf(
        {
            "numero": 132,
            "ano": 2026,
            "nro_protocolo": 1365,
            "ano_protocolo": 2026,
            "snapshot": {
                "oficio": {
                    "solicitante": "Leonardo",
                    "titulo": "Marcador de página",
                    "processo": "PROC-1",
                    "especificacao": "Publicação no formato 55x200mm.",
                    "especificacao_grupos": [
                        {
                            "titulo": "Produto",
                            "linhas": [
                                {"label": "Publicação", "valor": "Marcador"},
                                {"label": "Formato", "valor": "55×200 mm"},
                            ],
                        },
                        {
                            "titulo": "Material",
                            "linhas": [
                                {
                                    "label": "Papel",
                                    "valor": "Papel Couchê fosco 300gr (66x96cm)",
                                }
                            ],
                        },
                    ],
                    "paginas": 2,
                    "tiragem": 100,
                    "valor_total": 124.9,
                    "clausula_validade": "Este orçamento tem validade de 180 dias.",
                    "clausula_entrega": "Impressão em equipamento Digital. Entrega em 07 (sete) dias úteis.",
                    "signatario": "Jorge Luiz",
                    "cargo": "Diretor",
                    "endereco": "Via N3, Projeção L",
                    "telefone": "3216-2701",
                },
                "entrada": {"os": {"data_entrada": "2026-06-10"}},
            },
        }
    )
    assert pdf.startswith(b"%PDF")
    text = _pdf_streams(pdf)
    assert "132/2026" in text
    assert "1365/2026" in text
    assert "Jorge Luiz" in text
    assert "Couch" in text
    assert "Papel p26" not in text
    assert "Especifica" in text


def test_pdf_snapshot_antigo_sem_grupos_usa_texto():
    pdf = build_orcamento_pdf(
        {
            "numero": 1,
            "ano": 2026,
            "nro_protocolo": 10,
            "ano_protocolo": 2026,
            "snapshot": {
                "oficio": {
                    "solicitante": "A",
                    "titulo": "B",
                    "especificacao": "Publicação no formato 55x200mm.",
                    "valor_total": 10,
                    "clausula_validade": "val",
                    "clausula_entrega": "ent",
                    "signatario": "X",
                    "cargo": "Y",
                    "endereco": "Z",
                    "telefone": "1",
                },
                "entrada": {"os": {"data_entrada": "2026-06-10"}},
            },
        }
    )
    text = _pdf_streams(pdf)
    assert "55x200mm" in text

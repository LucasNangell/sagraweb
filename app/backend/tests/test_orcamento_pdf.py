"""PDF do ofício e textos auxiliares do orçamento, sem I/O de OS."""
from __future__ import annotations

import re
import zlib

from services.orcamento_os_service import montar_especificacao, montar_oficio_preview
from services.orcamento_pdf_service import build_orcamento_pdf


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


def test_montar_especificacao_marcador():
  payload = {
      "os": {
          "produto": "Marcador",
          "titulo": "Marcador de página — Leonardo da Vinci",
          "papel_os": "Couchê fosco 300g",
      },
      "tiragem": 100,
      "componentes": [
          {
              "menor_mm": 55,
              "maior_mm": 200,
              "papel_codigo": "p26",
              "cor": True,
              "frente_verso": True,
              "paginas": 2,
              "laminacao": True,
              "laminacao_fv": False,
          }
      ],
  }
  text = montar_especificacao(payload)
  assert "55x200mm" in text
  assert "p26" in text
  assert "laminação fosca somente na frente" in text
  assert "Tiragem: 100" in text


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
  oficio = montar_oficio_preview(payload, resultado, {
      "validade_dias": 180,
      "prazo_entrega_dias": 7,
      "pdf_clausula_validade": "Este orçamento tem validade de {validade_dias} dias.",
      "pdf_clausula_entrega": "Impressão em equipamento {tecnologia}. Entrega em {prazo_entrega_dias} ({prazo_extenso}) dias úteis.",
      "pdf_signatario": "Diretor Teste",
      "pdf_cargo": "Diretor",
      "pdf_endereco": "Via N3",
      "pdf_telefone": "3216-2701",
  })
  assert oficio["os_numero"] == 1365
  assert oficio["numero"] is None
  assert "180" in oficio["clausula_validade"]
  assert "Digital" in oficio["clausula_entrega"]


def test_pdf_oficio_contem_numero_proprio_e_os():
  pdf = build_orcamento_pdf({
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
  })
  assert pdf.startswith(b"%PDF")
  text = _pdf_streams(pdf)
  assert "132/2026" in text
  assert "1365/2026" in text
  assert "Jorge Luiz" in text

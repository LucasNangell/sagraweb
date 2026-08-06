"""Testes do importador de consumo Gráfica Rápida."""
from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest

from services.cota_grafica_rapida_import_service import (
    ORIGEM_GRAFICA_RAPIDA,
    ClienteDeputadoIdentity,
    _parse_pa_referencia,
    _resolver_deputado,
    parse_grafica_rapida_xls,
)


def test_parse_pa_referencia():
    ref = _parse_pa_referencia("PA-000.000.485/2026")
    assert ref == "PA-000.000.485/2026"

    ref_b = _parse_pa_referencia("PA-000.002.381/2026")
    ref_a = _parse_pa_referencia("PA-000.001.381/2026")
    assert ref_a != ref_b


def test_parse_grafica_rapida_xls_deduplica_por_pa():
    path = r"c:\Users\P_918713\Downloads\exportConsumoGeral.xls"
    try:
        with open(path, "rb") as fh:
            content = fh.read()
    except OSError:
        pytest.skip("Arquivo exportConsumoGeral.xls não disponível")

    rows = parse_grafica_rapida_xls(content)
    assert len(rows) >= 650
    refs = {row.referencia_pa for row in rows}
    assert len(refs) == len(rows)
    sample = next(row for row in rows if row.referencia_pa == "PA-000.000.485/2026")
    assert sample.cota == 1324


def test_resolver_deputado_via_protocolo_index():
    ident = ClienteDeputadoIdentity(
        cod_usuario="123",
        categoria="Deputado Federal",
        nome_usuario="AUREO RIBEIRO",
        solicitante="AUREO RIBEIRO",
        nome_deputado_api="",
    )
    index = {"AUREO RIBEIRO": ident}
    resolved, erro = _resolver_deputado(
        "AUREO",
        deputados_api=[{"nome": "Aureo Ribeiro"}],
        nomes_em_exercicio=frozenset({"AUREO RIBEIRO"}),
        protocolo_index=index,
    )
    assert erro is None
    assert resolved is not None
    assert resolved.cod_usuario == "123"


def test_resolver_deputado_rejeita_ambiguidade():
    deps = [{"nome": "João Silva"}, {"nome": "João Santos"}]
    with patch(
        "services.cota_grafica_rapida_import_service._score_nome",
        side_effect=lambda busca, cand: 80,
    ):
        resolved, erro = _resolver_deputado(
            "JOAO",
            deputados_api=deps,
            nomes_em_exercicio=frozenset(),
            protocolo_index={},
        )
    assert resolved is None
    assert erro is not None
    assert "Ambiguidade" in erro


def test_importar_consumo_grafica_rapida_insere_movimento():
    path = r"c:\Users\P_918713\Downloads\exportConsumoGeral.xls"
    try:
        with open(path, "rb") as fh:
            content = fh.read()
    except OSError:
        pytest.skip("Arquivo exportConsumoGeral.xls não disponível")

    ident = ClienteDeputadoIdentity(
        cod_usuario="dep1",
        categoria="Deputado Federal",
        nome_usuario="AUREO RIBEIRO",
        solicitante="AUREO RIBEIRO",
        nome_deputado_api="Aureo Ribeiro",
    )

    with patch(
        "cliente_cota_schema.ensure_cliente_cota_schema"
    ), patch(
        "services.cota_grafica_rapida_import_service._arquivo_ja_importado",
        return_value=False,
    ), patch(
        "services.cota_grafica_rapida_import_service._id_semestre_por_data",
        return_value=1,
    ), patch(
        "services.cota_grafica_rapida_import_service._movimento_existe",
        return_value=False,
    ), patch(
        "services.cota_grafica_rapida_import_service._build_deputado_api_index",
        return_value=([{"nome": "Aureo Ribeiro"}], {"AUREO RIBEIRO": "Aureo Ribeiro"}),
    ), patch(
        "services.cota_grafica_rapida_import_service.obter_nomes_deputados_em_exercicio",
        return_value=frozenset({"AUREO RIBEIRO"}),
    ), patch(
        "services.cota_grafica_rapida_import_service._build_protocolo_deputado_index",
        return_value={"AUREO RIBEIRO": ident},
    ), patch(
        "services.cota_grafica_rapida_import_service._resolver_deputado",
        side_effect=lambda raw, **kw: (ident, None)
        if raw == "AUREO"
        else (None, "Deputado não identificado"),
    ), patch("services.cota_grafica_rapida_import_service.db.execute_query") as exec_q, patch(
        "services.cota_grafica_rapida_import_service.rebuild_cliente_agregados"
    ):
        from services.cota_grafica_rapida_import_service import importar_consumo_grafica_rapida

        result = importar_consumo_grafica_rapida(
            content=content,
            arquivo_nome="exportConsumoGeral.xls",
            force=True,
        )

    assert result.pa_unicos >= 650
    assert result.inseridos >= 1
    insert_calls = [
        call
        for call in exec_q.call_args_list
        if call.args and "INSERT INTO tabCotaMovimento" in str(call.args[0])
    ]
    assert insert_calls
    params = insert_calls[0].args[1]
    assert ORIGEM_GRAFICA_RAPIDA in params
    assert "PA-000.000.485/2026" in params
    assert 0 in params  # NroProtocolo e AnoProtocolo externos

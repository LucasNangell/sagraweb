"""Testes de gravação em tabProtocolos ao lançar andamento Entregue/Cancelado."""

from datetime import date
from unittest.mock import MagicMock

import pytest

from services.os_protocolo_andamento_service import (
    ProtocoloEntregaInput,
    apply_protocolo_on_andamento,
    is_protocolo_andamento_situacao,
    requires_protocolo_entrega_payload,
)


def test_is_protocolo_andamento_situacao():
    assert is_protocolo_andamento_situacao("Entregue")
    assert is_protocolo_andamento_situacao("Cancelado")
    assert is_protocolo_andamento_situacao("Cancelada")
    assert not is_protocolo_andamento_situacao("Em Execução")


def test_requires_protocolo_entrega_payload():
    assert requires_protocolo_entrega_payload("Entregue")
    assert not requires_protocolo_entrega_payload("Cancelado")


def test_apply_cancelamento_updates_protocolo():
    cursor = MagicMock()
    apply_protocolo_on_andamento(
        cursor,
        123,
        2026,
        "Cancelado",
        obs="Motivo teste",
        ponto="918.713",
        setor="Expedição",
    )
    cursor.execute.assert_called_once()
    sql = cursor.execute.call_args[0][0]
    assert "CancelamentoMotivo" in sql
    assert "CancelamentoPonto" in sql
    assert "CancelamentoSetor" in sql
    params = cursor.execute.call_args[0][1]
    assert params[0] == "Motivo teste"
    assert params[1] == "918.713"
    assert params[2] == "Expedição"


def test_apply_entregue_requires_payload():
    with pytest.raises(ValueError, match="protocolo_entrega"):
        apply_protocolo_on_andamento(
            MagicMock(),
            1,
            2026,
            "Entregue",
        )


def test_apply_entregue_maps_fields():
    cursor = MagicMock()
    apply_protocolo_on_andamento(
        cursor,
        50,
        2026,
        "Entregue",
        setor="Expedição",
        entrega=ProtocoloEntregaInput(
            data="2026-06-12",
            armazenado_em="Armário A",
            recado_com="Maria",
            entregue_para="João Silva",
            nr_ponto="918713",
            data_entrega="2026-06-13",
            entregue_por="123456",
            setor="Gabinete",
        ),
    )
    sql = cursor.execute.call_args[0][0]
    assert "DataConclusao" in sql
    assert "ArmazenadoEm" in sql
    assert "ContatoRecebim" in sql
    assert "RetiradaNome" in sql
    assert "RetiradaPonto" in sql
    assert "RecebimData" in sql
    assert "PontoEntrega" in sql
    assert "SetorEntrega" in sql
    params = cursor.execute.call_args[0][1]
    assert params[0] == date(2026, 6, 12)
    assert params[1] == "Armário A"
    assert params[2] == "Maria"
    assert params[3] == "João Silva"
    assert params[4] == "918.713"
    assert params[5] == date(2026, 6, 13)
    assert params[6] == "123.456"
    assert params[7] == "Gabinete"

"""Testes do serviço de cotas por cliente."""

from datetime import date
from unittest.mock import patch

from services.cliente_cota_service import (
    BACKFILL_DATA_INICIO,
    is_deputado_categoria,
    limites_para_categoria,
    obter_saldo_cota_atual,
    semestre_from_date,
    valor_cota_protocolo,
)


def test_is_deputado_categoria():
    assert is_deputado_categoria("Deputado")
    assert is_deputado_categoria("DEPUTADO")
    assert not is_deputado_categoria("Orgao")
    assert not is_deputado_categoria("")


def test_limites_deputado():
    os_lim, sp_lim = limites_para_categoria("Deputado")
    assert os_lim == 120_000
    assert sp_lim == 10_000


def test_limites_outras_categorias():
    os_lim, sp_lim = limites_para_categoria("Orgao")
    assert os_lim is None
    assert sp_lim is None


def test_valor_cota_protocolo_os():
    tipo, valor = valor_cota_protocolo(
        {"NroProtocolo": 1234, "CotaRepro": 1500.5, "CotaCartao": "999"}
    )
    assert tipo == "os"
    assert valor == 1501


def test_valor_cota_protocolo_sp():
    tipo, valor = valor_cota_protocolo(
        {"NroProtocolo": 6000, "CotaRepro": 250.2, "CotaCartao": "99999"}
    )
    assert tipo == "sp"
    assert valor == 251


def test_semestre_from_date():
    assert semestre_from_date(date(2026, 3, 15)) == (2026, 1)
    assert semestre_from_date(date(2026, 9, 1)) == (2026, 2)


def test_backfill_data_inicio():
    assert BACKFILL_DATA_INICIO == date(2026, 1, 1)


def test_obter_saldo_cota_atual_deputado_sem_registro():
    with patch("services.cliente_cota_service.resolver_semestre_ativo_id", return_value=1), patch(
        "services.cliente_cota_service.db"
    ) as mock_db:
        mock_db.execute_query.side_effect = [
            [],
            [{"LimiteOsDeputado": 120000, "LimiteSpDeputado": 10000}],
        ]
        saldo = obter_saldo_cota_atual(
            categoria="Deputado",
            nome_usuario="João",
            nro_protocolo=100,
        )
    assert saldo == 120000


def test_obter_saldo_cota_atual_com_consumo():
    with patch("services.cliente_cota_service.resolver_semestre_ativo_id", return_value=1), patch(
        "services.cliente_cota_service.db"
    ) as mock_db:
        mock_db.execute_query.return_value = [
            {
                "ConsumoOs": 5000,
                "ConsumoSp": 100,
                "LimiteOs": 120000,
                "LimiteSp": 10000,
                "LimiteOsDeputado": 120000,
                "LimiteSpDeputado": 10000,
            }
        ]
        saldo = obter_saldo_cota_atual(
            cod_usuario="Dep-1",
            categoria="Deputado",
            nome_usuario="João",
            nro_protocolo=6000,
        )
    assert saldo == 9900

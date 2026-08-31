"""Lookups de acabamento, JSON de componentes e CalcPgs do Arquivo."""
from __future__ import annotations

from unittest.mock import patch

from os_calc_fields import classify_cores_kind, compute_detalhes_calc_fields, printed_pages_for_cota
from routers.auxiliar_routes import get_acabamentos
from routers.os_routes import (
    TechSpecAcabamentoPayload,
    TechSpecComponentePayload,
    TechSpecLotePayload,
    TechSpecPayload,
)
from schemas.auxiliar import AcabamentoCatalogRow
from services.os_componentes_service import sync_componentes_from_techspec


class _FakeResponse:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


class TestAuxAcabamentos:
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    @patch("services.system_catalog_service.db")
    def test_lista_ativos_com_variacoes(self, mock_db, _schema):
        mock_db.execute_query.side_effect = [
            [{"ID": 1, "Rotulo": "Laminação", "Ordem": 10}, {"ID": 2, "Rotulo": "Grampo", "Ordem": 20}],
            [{"ID": 11, "Rotulo": "Fosca", "Ordem": 1}, {"ID": 12, "Rotulo": "Brilho", "Ordem": 2}],
            [],
        ]
        response = _FakeResponse()
        rows = get_acabamentos(response)  # type: ignore[arg-type]
        assert response.headers.get("Cache-Control") == "private, max-age=60"
        assert rows[0] == AcabamentoCatalogRow.model_validate(
            {
                "id": 1,
                "label": "Laminação",
                "variacoes": [
                    {"id": 11, "label": "Fosca"},
                    {"id": 12, "label": "Brilho"},
                ],
            }
        )
        assert rows[1].label == "Grampo"
        assert rows[1].variacoes == []


class TestSyncAcabamentosJson:
    def test_persiste_acabamentos_no_techspec_json(self):
        cursor = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
        cursor.fetchall.return_value = []
        cursor.fetchone.return_value = None
        cursor.lastrowid = 7
        techspec = TechSpecPayload(
            componentes=[
                TechSpecComponentePayload(
                    nome="Arquivo",
                    lotes=[
                        TechSpecLotePayload(
                            id="l1",
                            paginas=8,
                            maquina_link="Digital",
                            papel_link="Sulfite",
                            cores_link="P/B",
                        )
                    ],
                    acabamentos=[
                        TechSpecAcabamentoPayload(
                            catalog_id=1,
                            label="Laminação",
                            variacao_id=11,
                            variacao_label="Fosca",
                            obs="só na capa",
                        )
                    ],
                )
            ]
        )
        sync_componentes_from_techspec(
            cursor, nro=10, ano=2026, techspec=techspec, ponto="123"
        )
        insert_calls = [
            c
            for c in cursor.execute.call_args_list
            if "INSERT INTO tab_os_componentes" in str(c[0][0])
        ]
        assert insert_calls
        import json

        parsed = json.loads(insert_calls[0][0][1][6])
        assert parsed["acabamentos"][0]["label"] == "Laminação"
        assert parsed["acabamentos"][0]["variacao_label"] == "Fosca"
        assert parsed["acabamentos"][0]["obs"] == "só na capa"
        assert parsed["lotes"][0]["paginas"] == 8
        assert parsed["lotes"][0]["frente_verso"] is False
        assert parsed["lotes"][0]["acabamentos"] == []

    def test_persiste_acabamentos_gerais_no_json(self):
        cursor = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
        cursor.fetchall.return_value = []
        cursor.fetchone.return_value = None
        cursor.lastrowid = 8
        techspec = TechSpecPayload(
            acabamentosGerais=[TechSpecAcabamentoPayload(label="Verniz UV")],
            componentes=[
                TechSpecComponentePayload(
                    nome="Miolo",
                    tipo="MIOLO",
                    lotes=[TechSpecLotePayload(id="l1", paginas=16)],
                )
            ],
        )
        sync_componentes_from_techspec(
            cursor, nro=11, ano=2026, techspec=techspec, ponto="123"
        )
        insert_calls = [
            c
            for c in cursor.execute.call_args_list
            if "INSERT INTO tab_os_componentes" in str(c[0][0])
        ]
        import json

        parsed = json.loads(insert_calls[0][0][1][6])
        assert parsed["acabamentos_gerais"][0]["label"] == "Verniz UV"


class TestCalcFieldsGenerico:
    def test_generico_preenche_slot_miolo(self):
        fields = compute_detalhes_calc_fields(
            calculos={"coef_a4": 1, "altura_mm": 210, "largura_mm": 297},
            techspec={
                "version": 1,
                "componentes": [
                    {
                        "nome": "Arquivo",
                        "lotes": [
                            {"paginas": 12, "cores_link": "4x4"},
                        ],
                    }
                ],
            },
        )
        assert fields["CalcPgs2"] == 1
        assert fields["CalcCor2"] == "4x4"
        assert fields["CalcPgs1"] is None
        assert fields["CalcPgs3"] is None


class TestImpressaoNm:
    def test_classify_1_1_is_pb(self):
        assert classify_cores_kind("1/1") == "PB"
        assert classify_cores_kind("1/0") == "PB"
        assert classify_cores_kind("4/0") == "COLOR"
        assert classify_cores_kind("2/3") is None

    def test_printed_pages_halves_verso_zero(self):
        assert printed_pages_for_cota(4, impressao="4/0") == 2
        assert printed_pages_for_cota(4, impressao="4/4") == 4
        assert printed_pages_for_cota(4, cores_link="4x0") == 2
        assert printed_pages_for_cota(4, verso_em_branco=True) == 2

    def test_capa_4x0_counts_half_pages_in_techspec(self):
        fields = compute_detalhes_calc_fields(
            calculos={"coef_a4": 1, "altura_mm": 210, "largura_mm": 297},
            techspec={
                "version": 1,
                "componentes": [
                    {
                        "nome": "Capa",
                        "tipo": "CAPA",
                        "lotes": [
                            {"paginas": 4, "cores_link": "4x4", "impressao": "4/0"},
                        ],
                    }
                ],
            },
        )
        assert fields["CalcQtdCores1"] == 4
        assert fields["CalcCor1"] == "4x4"

    def test_parse_cores_descricao_com_quebra_de_linha(self):
        fields = compute_detalhes_calc_fields(
            calculos={
                "coef_a4": 1,
                "altura_mm": 210,
                "largura_mm": 297,
                "capa_color": 4,
                "miolo_pb": 12,
            },
            cores_descricao="Capa: 4x4\nMiolo: 1x1",
        )
        assert fields["CalcCor1"] == "4x4"
        assert fields["CalcCor2"] == "1x1"

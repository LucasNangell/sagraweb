"""Regras do letreiro espelham o painel/setor clássico."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from board import (  # noqa: E402
    collect_dashboard_sectors,
    flatten_ticker_cards,
    format_os_number,
    format_queue_display_label,
    format_queue_display_situacao,
    get_visible_dashboard_columns,
    matches_column_status,
    merge_dashboard_queue_sources,
    os_belongs_to_dashboard_sector,
    process_dashboard_data,
    resolve_column_sector,
    resolve_priority_type,
    ticker_content_overflows,
    ticker_op_key,
)
from config_store import PRODUCTION_API_BASE, normalize_api_base_url, normalize_config  # noqa: E402

SUB_OS = {
    "nr_os": 568,
    "ano": 2026,
    "row_kind": "sub_os",
    "sub_os_id": 1,
    "parent_nr_os": 568,
    "parent_ano": 2026,
    "componente_nome": "Miolo",
    "situacao": "Em Execução",
}


def test_format_os_number_os_vs_sp():
    assert format_os_number(1234, 2026) == "OS 1234/26"
    assert format_os_number(5123, 2026) == "SP 5123/26"


def test_format_queue_display_label_sub_os_uses_parent():
    assert format_queue_display_label(SUB_OS) == "OS 568/26"
    assert format_queue_display_label({"nr_os": 568, "ano": 2026, "situacao": "Em Execução"}) == "OS 568/26"


def test_format_queue_display_situacao():
    assert format_queue_display_situacao(SUB_OS) == "[Miolo] Em Execução"
    assert format_queue_display_situacao({**SUB_OS, "situacao": "[Miolo] Em Execução"}) == "[Miolo] Em Execução"
    assert format_queue_display_situacao({"nr_os": 1, "ano": 2026, "situacao": "Recebido"}) == "Recebido"


def test_analisar_arquivo_override():
    item = {
        "nr_os": 10,
        "ano": 2026,
        "situacao": "Em Execução",
        "observacao": "Analisar PDF enviado",
    }
    assert format_queue_display_situacao(item) == "Analisar arquivo"


def test_matches_column_status_exact_and_prefix():
    assert matches_column_status("Gravação", "Gravação") is True
    assert matches_column_status("Gravação Pendente", "Gravação") is False
    assert matches_column_status("Gravação Externa", "Gravação") is False
    assert matches_column_status("Gravação Parcial", "Gravação") is False
    assert matches_column_status("Saída p/", "Saída p/") is True
    assert matches_column_status("Saída p/ SEFOC", "Saída p/") is True
    assert matches_column_status("Recebido", "Saída p/") is False
    assert matches_column_status("Em Execução", "Em") is False


def test_os_belongs_to_dashboard_sector():
    assert (
        os_belongs_to_dashboard_sector(
            {"nr_os": 1, "ano": 2026, "situacao": "Entregue", "setor": "SEFOC"},
            "SEFOC",
        )
        is False
    )
    assert (
        os_belongs_to_dashboard_sector(
            {"nr_os": 1, "ano": 2026, "situacao": "Gravação", "setor": "SEFOC"},
            "Gravação",
        )
        is True
    )
    assert (
        os_belongs_to_dashboard_sector(
            {"nr_os": 1, "ano": 2026, "situacao": "Em Execução", "setor": "SEFOC"},
            "Gravação",
        )
        is False
    )


def test_resolve_and_collect_sectors():
    assert resolve_column_sector({}, "SEFOC") == "SEFOC"
    assert resolve_column_sector({"sector": "  "}, "SEFOC") == "SEFOC"
    assert resolve_column_sector({"sector": "Papelaria"}, "SEFOC") == "Papelaria"
    config = {
        "sector": "SEFOC",
        "columnCount": 3,
        "columns": [
            {"id": "a", "title": "A", "statuses": ["Recebido"]},
            {"id": "b", "title": "B", "statuses": ["Em Execução"], "sector": "Papelaria"},
            {"id": "c", "title": "C", "statuses": ["Pronto"], "sector": "SEFOC"},
            {"id": "inbox", "title": "Novo e-mail", "statuses": [], "source": "inbox", "sector": "Papelaria"},
        ],
    }
    assert collect_dashboard_sectors(config) == ["SEFOC", "Papelaria"]


def test_merge_search_wins_and_keeps_sub_os():
    search = [
        {"nr_os": 100, "ano": 2026, "situacao": "Recebido", "setor": "SEFOC"},
        {"nr_os": 200, "ano": 2026, "situacao": "Em Execução", "setor": "SEFOC"},
    ]
    pcp = [
        {"nr_os": 100, "ano": 2026, "situacao": "Recebido", "setor": "SEFOC", "pcp_ordem": 2},
        {**SUB_OS, "pcp_ordem": 1},
    ]
    merged = merge_dashboard_queue_sources(search, pcp)
    assert len(merged) == 3
    assert merged[0]["pcp_ordem"] == 2
    assert merged[2]["row_kind"] == "sub_os"


def test_process_assigns_columns_by_sector_override():
    config = {
        "sector": "SEFOC",
        "columnCount": 2,
        "columns": [
            {"id": "sefoca", "title": "Execução SEFOC", "statuses": ["Em Execução"]},
            {
                "id": "papelaria",
                "title": "Execução Papelaria",
                "statuses": ["Em Execução"],
                "sector": "Papelaria",
            },
        ],
    }
    raw = [
        {"nr_os": 1, "ano": 2026, "situacao": "Em Execução", "setor": "SEFOC"},
        {"nr_os": 2, "ano": 2026, "situacao": "Em Execução", "setor": "Papelaria"},
    ]
    processed = process_dashboard_data(raw, config, {}, is_initial_load=True)
    assert [i["nr_os"] for i in processed["columns"][0]["items"]] == [1]
    assert [i["nr_os"] for i in processed["columns"][1]["items"]] == [2]


def test_os_before_sp_even_with_pcp_and_priority():
    config = {
        "sector": "SEFOC",
        "columnCount": 1,
        "columns": [{"id": "exec", "title": "Execução", "statuses": ["Em Execução"]}],
    }
    raw = [
        {
            "nr_os": 5100,
            "ano": 2026,
            "situacao": "Em Execução",
            "setor": "SEFOC",
            "pcp_ordem": 0,
            "prioridade": "Prometido p/ 10/10",
        },
        {"nr_os": 200, "ano": 2026, "situacao": "Em Execução", "setor": "SEFOC", "pcp_ordem": 2},
        {
            "nr_os": 5300,
            "ano": 2026,
            "situacao": "Em Execução",
            "setor": "SEFOC",
            "prioridade": "Solicitado p/ 12/10",
        },
        {"nr_os": 100, "ano": 2026, "situacao": "Em Execução", "setor": "SEFOC", "pcp_ordem": 1},
        {
            "nr_os": 5400,
            "ano": 2026,
            "situacao": "Em Execução",
            "setor": "SEFOC",
            "prioridade": "Prometido p/ 11/10",
        },
    ]
    processed = process_dashboard_data(raw, config, {}, is_initial_load=True)
    assert [i["nr_os"] for i in processed["columns"][0]["items"]] == [100, 200, 5100, 5400, 5300]


def test_priority_type_and_hide_when_empty_flatten_order():
    config = {
        "sector": "SEFOC",
        "columnCount": 2,
        "columns": [
            {"id": "tri", "title": "p/ Triagem", "statuses": ["Saída p/"]},
            {
                "id": "exec",
                "title": "p/ Execução",
                "statuses": ["Em Execução"],
                "hideWhenEmpty": True,
            },
        ],
    }
    raw = [
        {
            "nr_os": 11,
            "ano": 2026,
            "situacao": "Saída p/ SEFOC",
            "setor": "SEFOC",
            "prioridade": "Prometido p/ 01/01",
        },
        {
            "nr_os": 22,
            "ano": 2026,
            "situacao": "Saída p/ PAPELARIA",
            "setor": "SEFOC",
            "prioridade": "Solicitado p/ 01/01",
        },
    ]
    processed = process_dashboard_data(raw, config, {}, is_initial_load=True)
    visible = get_visible_dashboard_columns(processed["columns"])
    assert [c["id"] for c in visible] == ["tri"]
    cards = flatten_ticker_cards(processed["columns"])
    assert [c["label"] for c in cards] == ["OS 11/26", "OS 22/26"]
    assert cards[0]["priority"] == "priority-high"
    assert cards[1]["priority"] == "priority-medium"
    assert cards[0]["column_index"] == 0
    assert "SEFOC" in cards[0]["situacao"]


def test_flatten_dedupes_same_op_across_inbox_and_sub_os():
    columns = [
        {
            "id": "exec",
            "title": "Execução",
            "statuses": ["Em Execução"],
            "items": [
                {
                    "nr_os": 77,
                    "ano": 2026,
                    "uniqueKey": "77-2026",
                    "displaySituacao": "Em Execução",
                    "priorityType": None,
                    "isNew": False,
                    "row_kind": "main_os",
                }
            ],
        },
        {
            "id": "inbox",
            "title": "Novo e-mail",
            "statuses": [],
            "source": "inbox",
            "items": [
                {
                    "nr_os": 77,
                    "ano": 2026,
                    "uniqueKey": "inbox:77-2026",
                    "displaySituacao": "Novo e-mail",
                    "priorityType": None,
                    "isNew": False,
                    "row_kind": "main_os",
                }
            ],
        },
        {
            "id": "sub",
            "title": "Sub",
            "statuses": ["Em Execução"],
            "items": [
                {
                    **SUB_OS,
                    "uniqueKey": "568-2026-sub-1",
                    "displaySituacao": "[Miolo] Em Execução",
                    "priorityType": None,
                    "isNew": False,
                    "parent_nr_os": 77,
                    "parent_ano": 2026,
                    "nr_os": 77,
                    "ano": 2026,
                }
            ],
        },
    ]
    cards = flatten_ticker_cards(columns)
    assert [c["label"] for c in cards] == ["OS 77/26"]
    assert ticker_op_key(columns[0]["items"][0]) == "77-2026"


def test_ticker_content_overflows_only_when_cards_do_not_fit():
    assert ticker_content_overflows([80, 80], 8, 720) is False
    assert ticker_content_overflows([400, 400], 8, 720) is True
    assert ticker_content_overflows([], 8, 720) is False


def test_flatten_keeps_original_column_index_when_first_hidden():
    config = {
        "sector": "SEFOC",
        "columnCount": 2,
        "columns": [
            {"id": "empty", "title": "Vazia", "statuses": ["Recebido"], "hideWhenEmpty": True},
            {"id": "exec", "title": "Execução", "statuses": ["Em Execução"]},
        ],
    }
    raw = [{"nr_os": 9, "ano": 2026, "situacao": "Em Execução", "setor": "SEFOC"}]
    processed = process_dashboard_data(raw, config, {}, is_initial_load=True)
    cards = flatten_ticker_cards(processed["columns"])
    assert len(cards) == 1
    assert cards[0]["column_index"] == 1
    assert cards[0]["column_title"] == "Execução"


def test_resolve_priority_type_none():
    assert resolve_priority_type(None) is None
    assert resolve_priority_type("Normal") is None


def test_normalize_config_defaults_and_inbox():
    cfg = normalize_config(
        {
            "board": {
                "sector": "Papelaria",
                "columns": [
                    {"title": "Inbox", "source": "inbox", "sector": "SEFOC", "statuses": []},
                ],
            }
        }
    )
    assert cfg["board"]["sector"] == "Papelaria"
    assert cfg["board"]["columnCount"] == 1
    assert cfg["board"]["columns"][0]["source"] == "inbox"
    assert "sector" not in cfg["board"]["columns"][0]
    assert cfg["window"]["width"] == 720
    assert cfg["api_base_url"] == PRODUCTION_API_BASE


def test_normalize_api_base_url_accepts_site_root():
    assert normalize_api_base_url("") == PRODUCTION_API_BASE
    assert (
        normalize_api_base_url("https://cgrafsysvm.redecamara.camara.gov.br/sagra")
        == PRODUCTION_API_BASE
    )
    assert (
        normalize_api_base_url("https://cgrafsysvm.redecamara.camara.gov.br/sagra/")
        == PRODUCTION_API_BASE
    )
    assert (
        normalize_api_base_url("https://cgrafsysvm.redecamara.camara.gov.br/sagra/api/")
        == PRODUCTION_API_BASE
    )
    assert normalize_api_base_url("http://127.0.0.1:8001/api") == "http://127.0.0.1:8001/api"

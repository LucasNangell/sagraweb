"""Testes do serviço de movimentação de pastas entre OSs."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from services.os_folder_move_service import (
    _normalize_ano,
    execute_folder_move,
    format_os_short_label,
    format_repeticao_observ,
    is_origem_concluida,
    list_move_candidate_folders,
    merge_observ,
    planned_target_name,
    prefixed_folder_name,
    preview_folder_move,
    transfer_suffix,
    write_repeticao_observ,
)


def _path_map_getter(paths: dict[tuple[int, int], str]):
    def getter(ano: int, os_id: int):
        path = paths.get((ano, os_id))
        if path and os.path.isdir(path):
            return path
        return None

    return getter


_CONCLUDED_ANDAMENTO = {
    "origem_situacao": "Entregue",
    "origem_concluida": True,
    "origem_andamentos": [],
}


@pytest.fixture(autouse=True)
def mock_origem_andamento_concluded(monkeypatch):
    monkeypatch.setattr(
        "services.os_folder_move_service.fetch_origem_andamento",
        lambda *_args, **_kwargs: dict(_CONCLUDED_ANDAMENTO),
    )


def test_prefixed_folder_name_and_transfer_suffix():
    assert prefixed_folder_name(5024, 2026, "Original") == "26 05024 Original"
    assert transfer_suffix(5232, 2026) == "(Transf CS 05232 26)"


def test_normalize_ano_expands_two_digit_year():
    assert _normalize_ano(26) == 2026
    assert _normalize_ano(2026) == 2026


def test_list_move_candidate_folders(tmp_path):
    os.makedirs(tmp_path / "Original")
    os.makedirs(tmp_path / "Original V2")
    os.makedirs(tmp_path / "Sefoc")
    os.makedirs(tmp_path / "Outra")

    names = list_move_candidate_folders(str(tmp_path))
    assert names == ["Original", "Original V2", "Sefoc", "Outra"]


def test_planned_target_name_renames_only_original_and_sefoc():
    assert planned_target_name(5024, 2026, "Original") == "26 05024 Original"
    assert planned_target_name(5024, 2026, "Original V2") == "26 05024 Original V2"
    assert planned_target_name(5024, 2026, "Sefoc") == "26 05024 Sefoc"
    assert planned_target_name(5024, 2026, "Outra") == "Outra"
    assert planned_target_name(5024, 2026, "Anexos") == "Anexos"


@patch("services.os_folder_move_service.ensure_os_folder_on_network")
@patch("services.os_folder_move_service._fetch_os_meta")
def test_execute_folder_move_renames_and_transfers(
    mock_meta, mock_ensure, tmp_path
):
    dest_root = tmp_path / "2026" / "06000-Dest-Produto"
    origem_root = tmp_path / "2025" / "05024-Origem-Produto"
    os.makedirs(origem_root / "Original")
    os.makedirs(origem_root / "Sefoc")
    (origem_root / "Original" / "arquivo.pdf").write_text("x", encoding="utf-8")
    (origem_root / "Sefoc" / "prova.pdf").write_text("y", encoding="utf-8")

    mock_meta.side_effect = [
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
        {"solicitante": "Origem", "produto": "Produto"},
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
    ]
    mock_ensure.return_value = (str(dest_root), "06000-Dest-Produto")
    os.makedirs(dest_root, exist_ok=True)

    getter = _path_map_getter({
        (2025, 5024): str(origem_root),
    })
    result = execute_folder_move(
        dest_ano=2026,
        dest_id=6000,
        origem_ano=2025,
        origem_id=5024,
        confirm_meta_mismatch=True,
        get_os_folder_path=getter,
    )

    assert result["dest_folder_created"] is True
    assert os.path.isdir(dest_root / "25 05024 Original")
    assert os.path.isfile(dest_root / "25 05024 Original" / "arquivo.pdf")
    assert os.path.isdir(dest_root / "25 05024 Sefoc")
    assert not os.path.exists(origem_root / "Original")
    assert "(Transf CS 06000 26)" in result["origem_folder_path"]


@patch("services.os_folder_move_service._fetch_os_meta")
def test_preview_keeps_other_folder_names(mock_meta, tmp_path):
    origem_root = tmp_path / "2026" / "05001-A-ProdA"
    os.makedirs(origem_root / "Original")
    os.makedirs(origem_root / "Sefoc")
    os.makedirs(origem_root / "Outra")

    mock_meta.side_effect = [
        {"solicitante": "A", "produto": "ProdA"},
        {"solicitante": "A", "produto": "ProdA"},
    ]

    getter = _path_map_getter({
        (2026, 5001): str(origem_root),
    })

    preview = preview_folder_move(
        dest_ano=2026,
        dest_id=5002,
        origem_ano=2026,
        origem_id=5001,
        get_os_folder_path=getter,
    )

    moves = {item["from_name"]: item["to_name"] for item in preview["folders_to_move"]}
    assert moves["Original"] == "26 05001 Original"
    assert moves["Sefoc"] == "26 05001 Sefoc"
    assert moves["Outra"] == "Outra"


@patch("services.os_folder_move_service.ensure_os_folder_on_network")
@patch("services.os_folder_move_service._fetch_os_meta")
def test_execute_folder_move_transfers_other_folders_without_rename(
    mock_meta, mock_ensure, tmp_path
):
    dest_root = tmp_path / "2026" / "06000-Dest-Produto"
    origem_root = tmp_path / "2025" / "05024-Origem-Produto"
    os.makedirs(origem_root / "Original")
    os.makedirs(origem_root / "Sefoc")
    os.makedirs(origem_root / "Outra")
    (origem_root / "Original" / "arquivo.pdf").write_text("x", encoding="utf-8")
    (origem_root / "Sefoc" / "prova.pdf").write_text("y", encoding="utf-8")
    (origem_root / "Outra" / "extra.pdf").write_text("z", encoding="utf-8")

    mock_meta.side_effect = [
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
        {"solicitante": "Origem", "produto": "Produto"},
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
    ]
    mock_ensure.return_value = (str(dest_root), "06000-Dest-Produto")
    os.makedirs(dest_root, exist_ok=True)

    getter = _path_map_getter({
        (2025, 5024): str(origem_root),
    })
    result = execute_folder_move(
        dest_ano=2026,
        dest_id=6000,
        origem_ano=2025,
        origem_id=5024,
        confirm_meta_mismatch=True,
        get_os_folder_path=getter,
    )

    assert os.path.isdir(dest_root / "25 05024 Original")
    assert os.path.isdir(dest_root / "25 05024 Sefoc")
    assert os.path.isdir(dest_root / "Outra")
    assert os.path.isfile(dest_root / "Outra" / "extra.pdf")
    assert not os.path.exists(origem_root / "Outra")
    assert "(Transf CS 06000 26)" in result["origem_folder_path"]


@patch("services.os_folder_move_service._fetch_os_meta")
def test_preview_detects_meta_mismatch(mock_meta, tmp_path):
    origem_root = tmp_path / "2026" / "05001-A-ProdA"
    os.makedirs(origem_root / "Original")

    mock_meta.side_effect = [
        {"solicitante": "A", "produto": "ProdA"},
        {"solicitante": "B", "produto": "ProdB"},
    ]

    getter = _path_map_getter({
        (2026, 5001): str(origem_root),
    })

    preview = preview_folder_move(
        dest_ano=2026,
        dest_id=5002,
        origem_ano=2026,
        origem_id=5001,
        get_os_folder_path=getter,
    )

    assert preview["meta_mismatch"] is True
    assert preview["same_solicitante"] is False
    assert preview["folders_to_move"][0]["to_name"] == "26 05001 Original"


@patch("services.os_folder_move_service._fetch_os_meta")
def test_preview_accepts_two_digit_origem_year(mock_meta, tmp_path):
    origem_root = tmp_path / "2026" / "05001-A-ProdA"
    os.makedirs(origem_root / "Original")

    mock_meta.side_effect = [
        {"solicitante": "A", "produto": "ProdA"},
        {"solicitante": "A", "produto": "ProdA"},
    ]

    getter = _path_map_getter({
        (2026, 5001): str(origem_root),
    })

    preview = preview_folder_move(
        dest_ano=2026,
        dest_id=5002,
        origem_ano=26,
        origem_id=5001,
        get_os_folder_path=getter,
    )

    assert preview["origem_folder_exists"] is True
    assert preview["folders_to_move"][0]["to_name"] == "26 05001 Original"


@patch("services.os_folder_move_service._fetch_os_meta")
def test_execute_rejects_same_os(mock_meta):
    with pytest.raises(ValueError, match="igual"):
        preview_folder_move(
            dest_ano=2026,
            dest_id=5001,
            origem_ano=2026,
            origem_id=5001,
            get_os_folder_path=lambda *_: None,
        )


def test_format_repeticao_observ_matches_exact_lines():
    text = format_repeticao_observ(2282, 2025)
    assert text == (
        "---- Repetição da OS 2282/25 ----\n"
        "      Arquivos movidos pra pasta\n"
        "----------------------------------"
    )
    assert format_os_short_label(2282, 25) == "2282/25"
    assert format_os_short_label(5024, 2026) == "5024/26"


def test_merge_observ_appends_with_newline():
    block = format_repeticao_observ(2282, 2025)
    assert merge_observ(None, block) == block
    assert merge_observ("", block) == block
    assert merge_observ("Obs anterior", block) == f"Obs anterior\n{block}"


def test_is_origem_concluida_accepts_entregue_and_cancelada():
    assert is_origem_concluida("Entregue") is True
    assert is_origem_concluida("Cancelado") is True
    assert is_origem_concluida("Cancelada") is True
    assert is_origem_concluida("Em Execução") is False
    assert is_origem_concluida(None) is False


@patch("services.os_folder_move_service._fetch_os_meta")
def test_preview_includes_origem_andamento(mock_meta, tmp_path, monkeypatch):
    origem_root = tmp_path / "2026" / "05001-A-ProdA"
    os.makedirs(origem_root / "Original")
    mock_meta.side_effect = [
        {"solicitante": "A", "produto": "ProdA"},
        {"solicitante": "A", "produto": "ProdA"},
    ]
    monkeypatch.setattr(
        "services.os_folder_move_service.fetch_origem_andamento",
        lambda *_a, **_k: {
            "origem_situacao": "Em Execução",
            "origem_concluida": False,
            "origem_andamentos": [
                {
                    "situacao": "Entrada Inicial",
                    "setor": "SEFOC",
                    "data": "2026-01-10",
                    "ponto": "123",
                    "observacao": None,
                },
                {
                    "situacao": "Em Execução",
                    "setor": "SEFOC",
                    "data": "2026-01-12",
                    "ponto": "123",
                    "observacao": None,
                },
            ],
        },
    )
    preview = preview_folder_move(
        dest_ano=2026,
        dest_id=5002,
        origem_ano=2026,
        origem_id=5001,
        get_os_folder_path=_path_map_getter({(2026, 5001): str(origem_root)}),
    )
    assert preview["origem_concluida"] is False
    assert preview["origem_situacao"] == "Em Execução"
    assert len(preview["origem_andamentos"]) == 2


@patch("services.os_folder_move_service.write_repeticao_observ")
@patch("services.os_folder_move_service.ensure_os_folder_on_network")
@patch("services.os_folder_move_service._fetch_os_meta")
def test_execute_repeticao_rejects_incomplete_origem_without_confirm(
    mock_meta, mock_ensure, mock_write, tmp_path, monkeypatch
):
    dest_root = tmp_path / "2026" / "06000-Dest-Produto"
    origem_root = tmp_path / "2025" / "05024-Origem-Produto"
    os.makedirs(origem_root / "Original")
    os.makedirs(dest_root, exist_ok=True)
    mock_meta.side_effect = [
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
        {"solicitante": "Origem", "produto": "Produto"},
    ]
    monkeypatch.setattr(
        "services.os_folder_move_service.fetch_origem_andamento",
        lambda *_a, **_k: {
            "origem_situacao": "Em Execução",
            "origem_concluida": False,
            "origem_andamentos": [{"situacao": "Em Execução"}],
        },
    )
    with pytest.raises(ValueError, match="ainda não foi concluída"):
        execute_folder_move(
            dest_ano=2026,
            dest_id=6000,
            origem_ano=2025,
            origem_id=5024,
            confirm_meta_mismatch=True,
            append_repeticao_observ=True,
            confirm_origem_nao_concluida=False,
            get_os_folder_path=_path_map_getter({(2025, 5024): str(origem_root)}),
        )
    mock_write.assert_not_called()
    mock_ensure.assert_not_called()


@patch("services.os_folder_move_service.write_repeticao_observ")
@patch("services.os_folder_move_service.ensure_os_folder_on_network")
@patch("services.os_folder_move_service._fetch_os_meta")
def test_execute_repeticao_appends_observ_when_confirmed(
    mock_meta, mock_ensure, mock_write, tmp_path, monkeypatch
):
    dest_root = tmp_path / "2026" / "06000-Dest-Produto"
    origem_root = tmp_path / "2025" / "05024-Origem-Produto"
    os.makedirs(origem_root / "Original")
    os.makedirs(dest_root, exist_ok=True)
    mock_meta.side_effect = [
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
        {"solicitante": "Origem", "produto": "Produto"},
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
    ]
    mock_ensure.return_value = (str(dest_root), "06000-Dest-Produto")
    monkeypatch.setattr(
        "services.os_folder_move_service.fetch_origem_andamento",
        lambda *_a, **_k: {
            "origem_situacao": "Em Execução",
            "origem_concluida": False,
            "origem_andamentos": [{"situacao": "Em Execução"}],
        },
    )
    result = execute_folder_move(
        dest_ano=2026,
        dest_id=6000,
        origem_ano=2025,
        origem_id=5024,
        confirm_meta_mismatch=True,
        append_repeticao_observ=True,
        confirm_origem_nao_concluida=True,
        get_os_folder_path=_path_map_getter({(2025, 5024): str(origem_root)}),
    )
    assert result["status"] == "ok"
    mock_write.assert_called_once_with(
        dest_ano=2026,
        dest_id=6000,
        origem_id=5024,
        origem_ano=2025,
    )


@patch("services.os_folder_move_service.write_repeticao_observ")
@patch("services.os_folder_move_service.ensure_os_folder_on_network")
@patch("services.os_folder_move_service._fetch_os_meta")
def test_execute_mover_pastas_ignores_incomplete_origem(
    mock_meta, mock_ensure, mock_write, tmp_path, monkeypatch
):
    dest_root = tmp_path / "2026" / "06000-Dest-Produto"
    origem_root = tmp_path / "2025" / "05024-Origem-Produto"
    os.makedirs(origem_root / "Original")
    os.makedirs(dest_root, exist_ok=True)
    mock_meta.side_effect = [
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
        {"solicitante": "Origem", "produto": "Produto"},
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
    ]
    mock_ensure.return_value = (str(dest_root), "06000-Dest-Produto")
    monkeypatch.setattr(
        "services.os_folder_move_service.fetch_origem_andamento",
        lambda *_a, **_k: {
            "origem_situacao": "Em Execução",
            "origem_concluida": False,
            "origem_andamentos": [{"situacao": "Em Execução"}],
        },
    )
    result = execute_folder_move(
        dest_ano=2026,
        dest_id=6000,
        origem_ano=2025,
        origem_id=5024,
        confirm_meta_mismatch=True,
        get_os_folder_path=_path_map_getter({(2025, 5024): str(origem_root)}),
    )
    assert result["status"] == "ok"
    mock_write.assert_not_called()


@patch("services.os_folder_move_service.write_repeticao_observ")
@patch("services.os_folder_move_service.ensure_os_folder_on_network")
@patch("services.os_folder_move_service._fetch_os_meta")
def test_execute_repeticao_when_entregue_appends_without_incomplete_confirm(
    mock_meta, mock_ensure, mock_write, tmp_path
):
    dest_root = tmp_path / "2026" / "06000-Dest-Produto"
    origem_root = tmp_path / "2025" / "02282-Origem-Produto"
    os.makedirs(origem_root / "Original")
    os.makedirs(dest_root, exist_ok=True)
    mock_meta.side_effect = [
        {"solicitante": "A", "produto": "Produto"},
        {"solicitante": "A", "produto": "Produto"},
        {"solicitante": "Destino", "folder_solicitante": "Destino", "produto": "Produto"},
    ]
    mock_ensure.return_value = (str(dest_root), "06000-Dest-Produto")
    result = execute_folder_move(
        dest_ano=2026,
        dest_id=6000,
        origem_ano=2025,
        origem_id=2282,
        append_repeticao_observ=True,
        get_os_folder_path=_path_map_getter({(2025, 2282): str(origem_root)}),
    )
    assert result["status"] == "ok"
    mock_write.assert_called_once_with(
        dest_ano=2026,
        dest_id=6000,
        origem_id=2282,
        origem_ano=2025,
    )


@patch("services.os_folder_move_service.db")
def test_write_repeticao_observ_appends_to_existing(mock_db):
    mock_db.execute_query.side_effect = [
        [{"Observ": "Já tinha obs"}],
        [],
    ]
    merged = write_repeticao_observ(
        dest_ano=2026,
        dest_id=6000,
        origem_id=2282,
        origem_ano=2025,
    )
    expected = (
        "Já tinha obs\n"
        "---- Repetição da OS 2282/25 ----\n"
        "      Arquivos movidos pra pasta\n"
        "----------------------------------"
    )
    assert merged == expected
    update_sql = mock_db.execute_query.call_args_list[1].args[0]
    assert "UPDATE tabDetalhesServico" in update_sql
    assert mock_db.execute_query.call_args_list[1].args[1] == (expected, 6000, 2026)


@patch("services.os_folder_move_service.db")
def test_write_repeticao_observ_inserts_when_missing(mock_db):
    mock_db.execute_query.side_effect = [[], []]
    merged = write_repeticao_observ(
        dest_ano=2026,
        dest_id=6000,
        origem_id=2282,
        origem_ano=2025,
    )
    assert merged.startswith("---- Repetição da OS 2282/25 ----")
    insert_sql = mock_db.execute_query.call_args_list[1].args[0]
    assert "INSERT INTO tabDetalhesServico" in insert_sql

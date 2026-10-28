"""O autor exibido no painel é o usuário do andamento, não o solicitante da OS."""
from unittest.mock import MagicMock, patch

from services.os_search_service import _enrich_operacional_from_live
from services.os_ultimo_andamento_service import fetch_operacional_rows_batch


def test_panel_author_is_resolved_from_current_andamento_ponto():
    cursor = MagicMock()
    cursor.fetchall.return_value = [{"nro_protocolo": 1428, "ano_protocolo": 2026, "andamento_usuario": "Ana Silva"}]
    result = fetch_operacional_rows_batch([(1428, 2026)], cursor=cursor, include_user=True)
    assert result[(1428, 2026)]["andamento_usuario"] == "Ana Silva"
    sql, params = cursor.execute.call_args.args
    assert "u.Nome AS andamento_usuario" in sql
    assert "COALESCE(a.Ponto" in sql
    assert "a.UltimoStatus = 1" in sql
    assert "NomeUsuario" not in sql
    assert params == (1428, 2026)


def test_default_operational_query_keeps_existing_shape():
    cursor = MagicMock()
    cursor.fetchall.return_value = []
    fetch_operacional_rows_batch([(1428, 2026)], cursor=cursor)
    assert "tabUsuarios" not in cursor.execute.call_args.args[0]


def test_search_preserves_requester_separately_from_andamento_author():
    rows = [{"nr_os": 1428, "ano": 2026, "solicitante": "Solicitante"}]
    with patch("services.os_ultimo_andamento_service.fetch_operacional_rows_batch", return_value={
        (1428, 2026): {"situacao": "Em Execução", "setor": "SEFOC", "data": "2026-10-21 12:00:00", "andamento_usuario": "Ana Silva"}
    }) as fetch:
        result = _enrich_operacional_from_live(rows, include_user=True)
    assert result[0]["andamento_usuario"] == "Ana Silva"
    assert result[0]["solicitante"] == "Solicitante"
    fetch.assert_called_once_with([(1428, 2026)], include_user=True)


def test_missing_andamento_author_remains_optional():
    with patch("services.os_ultimo_andamento_service.fetch_operacional_rows_batch", return_value={
        (1428, 2026): {"situacao": "Em Execução"}
    }):
        result = _enrich_operacional_from_live([{"nr_os": 1428, "ano": 2026}], include_user=True)
    assert result[0]["andamento_usuario"] is None


def test_search_copies_andamento_ponto_from_live():
    rows = [{"nr_os": 1428, "ano": 2026}]
    with patch("services.os_ultimo_andamento_service.fetch_operacional_rows_batch", return_value={
        (1428, 2026): {
            "situacao": "Em Execução",
            "setor": "SEFOC",
            "data": "2026-10-21 12:00:00",
            "ponto": "12.345",
            "observacao": "urgente na gráfica",
        }
    }):
        result = _enrich_operacional_from_live(rows, include_user=True)
    assert result[0]["andamento_ponto"] == "12.345"
    assert result[0]["observacao"] == "urgente na gráfica"


def test_slim_enrich_skips_andamento_ponto():
    rows = [{"nr_os": 1428, "ano": 2026}]
    with patch("services.os_ultimo_andamento_service.fetch_operacional_rows_batch", return_value={
        (1428, 2026): {"situacao": "Em Execução", "ponto": "12345", "observacao": "x"}
    }):
        result = _enrich_operacional_from_live(rows, slim=True)
    assert "andamento_ponto" not in result[0]
    assert "observacao" not in result[0]

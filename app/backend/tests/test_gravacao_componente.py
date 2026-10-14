from unittest.mock import MagicMock

import pytest


def test_component_prefix_is_first_only_for_partial_shipments():
    from services.gravacao_componente import with_gravacao_componente_obs_prefix

    assert with_gravacao_componente_obs_prefix("Arquivos enviados", "todos") == "Arquivos enviados"
    assert with_gravacao_componente_obs_prefix("Arquivos enviados", "capa") == (
        "Componente: Capa\n\nArquivos enviados"
    )
    assert with_gravacao_componente_obs_prefix("", "miolo") == "Componente: Miolo"


def test_invalid_component_is_rejected():
    from services.gravacao_componente import normalize_gravacao_componente

    with pytest.raises(ValueError, match="todos, capa ou miolo"):
        normalize_gravacao_componente("contracapa")


def test_external_insert_preserves_other_partial_component():
    from services.gravacao_externa_service import insert_session_with_arquivos_cursor

    cursor = MagicMock()
    cursor.lastrowid = 22
    cursor.fetchall.return_value = [{"Id": 11, "Componente": "capa"}]
    statements: list[str] = []

    def execute(sql, params=None):
        statements.append(" ".join(str(sql).split()))

    cursor.execute.side_effect = execute

    session_id = insert_session_with_arquivos_cursor(
        cursor,
        ano=2026,
        os_id=100,
        cod_status="001002026-02",
        ponto_fmt="918.713",
        lancado_por_nome="Operador",
        validated_arquivos=[
            {
                "absolute_path": r"\\server\miolo.pdf",
                "relative": "",
                "nome": "miolo.pdf",
                "tamanho_bytes": 10,
                "ordem": 0,
                "maquina": "SM74",
            }
        ],
        componente="miolo",
        allow_replace_active=False,
    )

    assert session_id == 22
    assert not any("SET Status = 'cancelada'" in sql for sql in statements)
    assert any("INSERT INTO tab_os_gravacao_externa" in sql for sql in statements)


def test_external_insert_rejects_duplicate_partial_component():
    from services.gravacao_externa_service import insert_session_with_arquivos_cursor

    cursor = MagicMock()
    cursor.fetchall.return_value = [{"Id": 11, "Componente": "capa"}]

    with pytest.raises(ValueError, match="Capa"):
        insert_session_with_arquivos_cursor(
            cursor,
            ano=2026,
            os_id=100,
            cod_status="001002026-02",
            ponto_fmt="918.713",
            lancado_por_nome="Operador",
            validated_arquivos=[],
            componente="capa",
            allow_replace_active=False,
        )


def test_exact_session_resolution_never_falls_back_to_another_component(monkeypatch):
    from services import gravacao_externa_service as service

    monkeypatch.setattr(
        service,
        "get_session_by_id",
        lambda _session_id: {
            "id": 12,
            "os_ano": 2026,
            "os_nro": 100,
            "status": "pendente",
            "componente": "miolo",
        },
    )

    assert service.resolve_active_session(2026, 100, 12)["componente"] == "miolo"
    assert service.resolve_active_session(2026, 999, 12) is None

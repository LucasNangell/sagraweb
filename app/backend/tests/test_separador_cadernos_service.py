from datetime import datetime

from services.separador_cadernos_service import (
    lookup_gravacao_caderno_until,
    until_from_arquivo_rows,
)


def test_until_from_latest_session_with_cad_tiffs():
    rows = [
        {
            "origem": "externa",
            "session_id": 2,
            "criado_em": datetime(2026, 10, 1),
            "nome": "job (Cad 3 A) (C).tif",
        },
        {
            "origem": "pendente",
            "session_id": 1,
            "criado_em": datetime(2026, 9, 1),
            "nome": "job (Cad 1 A) (C).tif",
        },
    ]
    assert until_from_arquivo_rows(rows) == 3


def test_until_skips_session_without_cad_tiffs():
    rows = [
        {
            "origem": "externa",
            "session_id": 2,
            "criado_em": datetime(2026, 10, 1),
            "nome": "arte.pdf",
        },
        {
            "origem": "pendente",
            "session_id": 1,
            "criado_em": datetime(2026, 9, 1),
            "nome": "job (Cad 4 B) (K).tiff",
        },
    ]
    assert until_from_arquivo_rows(rows) == 4


def test_until_empty_without_cadernos():
    assert until_from_arquivo_rows([]) is None
    assert (
        until_from_arquivo_rows(
            [
                {
                    "origem": "pendente",
                    "session_id": 1,
                    "criado_em": datetime(2026, 9, 1),
                    "nome": "simples.tif",
                }
            ]
        )
        is None
    )


def test_lookup_returns_none_on_query_error(monkeypatch):
    from services import separador_cadernos_service as svc

    def boom(*_args, **_kwargs):
        raise RuntimeError("tabela ausente")

    monkeypatch.setattr(svc.db, "execute_query", boom)
    assert lookup_gravacao_caderno_until(2026, 2532) is None

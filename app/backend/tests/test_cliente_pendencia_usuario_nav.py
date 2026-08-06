"""Pendência usuário no dashboard do portal cliente + flag DEPOL."""
from routers.cliente_gabinete_routes import (
    _classify_pendencia,
    _nav_credencial_depol_from_row,
)


def test_classify_pendencia_usuario_ptv():
    assert (
        _classify_pendencia("Pendência Usuário", "Arquivo PTV rejeitado")
        == "problema_tecnico"
    )


def test_classify_pendencia_usuario_envio_arquivo():
    assert (
        _classify_pendencia(
            "Pendência Usuário",
            "Fica pendente o envio de arquivo pelo gabinete",
        )
        == "envio_arquivo"
    )


def test_nav_credencial_depol_defaults_off():
    assert _nav_credencial_depol_from_row({}) is False
    assert _nav_credencial_depol_from_row({"NavCredencialDepol": 0}) is False
    assert _nav_credencial_depol_from_row({"NavCredencialDepol": None}) is False


def test_nav_credencial_depol_enabled():
    assert _nav_credencial_depol_from_row({"NavCredencialDepol": 1}) is True
    assert _nav_credencial_depol_from_row({"NavCredencialDepol": True}) is True


def test_pendencia_usuario_bucket_filter_logic():
    """Espelha a regra do dashboard: situacao exata Pendência Usuário."""
    rows = [
        {"situacao": "Pendência Usuário"},
        {"situacao": "Problemas Técnicos"},
        {"situacao": "Pendência Usuário "},
        {"situacao": "Em Andamento"},
    ]
    filtered = [
        r for r in rows if str(r.get("situacao") or "").strip() == "Pendência Usuário"
    ]
    assert len(filtered) == 2

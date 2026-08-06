"""Preferência de Web Push do Painel OS (tablet) por ponto + setor."""
from __future__ import annotations

from typing import Any

from database import db


def _clean_ponto(value: str | None) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def get_painel_tablet_push_pref(ponto: str) -> dict[str, Any]:
    clean = _clean_ponto(ponto) or str(ponto).strip()
    rows = db.execute_query(
        """
        SELECT Ponto, Setor, Enabled
        FROM tabPainelTabletPush
        WHERE Ponto = %s OR REPLACE(REPLACE(Ponto, '.', ''), '-', '') = %s
        LIMIT 1
        """,
        (ponto, clean),
    )
    if not rows:
        return {"enabled": False, "setor": None}
    row = rows[0]
    return {
        "enabled": bool(row.get("Enabled")),
        "setor": (row.get("Setor") or "").strip() or None,
    }


def upsert_painel_tablet_push_pref(
    *,
    ponto: str,
    enabled: bool,
    setor: str | None,
) -> dict[str, Any]:
    clean = _clean_ponto(ponto) or str(ponto).strip()
    setor_norm = (setor or "").strip()
    if enabled and not setor_norm:
        raise ValueError("Setor é obrigatório para habilitar notificações do painel.")

    if not enabled:
        existing = get_painel_tablet_push_pref(clean)
        setor_to_store = setor_norm or (existing.get("setor") or "")
        if not setor_to_store:
            setor_to_store = ""
        db.execute_query(
            """
            INSERT INTO tabPainelTabletPush (Ponto, Setor, Enabled)
            VALUES (%s, %s, 0)
            ON DUPLICATE KEY UPDATE
                Setor = IF(VALUES(Setor) = '', Setor, VALUES(Setor)),
                Enabled = 0
            """,
            (clean, setor_to_store),
        )
        return get_painel_tablet_push_pref(clean)

    db.execute_query(
        """
        INSERT INTO tabPainelTabletPush (Ponto, Setor, Enabled)
        VALUES (%s, %s, 1)
        ON DUPLICATE KEY UPDATE
            Setor = VALUES(Setor),
            Enabled = 1
        """,
        (clean, setor_norm),
    )
    return get_painel_tablet_push_pref(clean)


def list_pontos_for_setores(setores: list[str]) -> list[str]:
    cleaned = sorted({(s or "").strip() for s in setores if (s or "").strip()})
    if not cleaned:
        return []
    placeholders = ", ".join(["%s"] * len(cleaned))
    rows = db.execute_query(
        f"""
        SELECT DISTINCT Ponto
        FROM tabPainelTabletPush
        WHERE Enabled = 1 AND Setor IN ({placeholders})
        """,
        tuple(cleaned),
    )
    return [str(r["Ponto"]) for r in rows if r.get("Ponto")]

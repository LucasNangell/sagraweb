"""CRUD das etapas de produção por produto (tabSystemCatalog categoria produto)."""
from __future__ import annotations

import logging
from typing import Any, Optional

from database import db
from services.orcamento_engine import normalize_text

logger = logging.getLogger(__name__)

_TIPOS = frozenset({"produtiva", "espera_cliente", "fim"})
_TECS = frozenset({"qualquer", "digital", "offset"})


def _f(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _i(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def ensure_produto_catalog_id(label: str, *, ponto: str | None = None) -> dict:
    """Materializa o produto em tabSystemCatalog e devolve o item."""
    from services.system_catalog_service import get_or_create_catalog_item

    return get_or_create_catalog_item("produto", label, updated_by_ponto=ponto)


def require_catalog_category(catalog_id: int, category: str) -> dict:
    """Garante que o item existe na categoria; ValueError se não."""
    from services.system_catalog_service import get_catalog_item

    try:
        return get_catalog_item(category, catalog_id)
    except KeyError as exc:
        raise ValueError(f"Item {catalog_id} não encontrado em {category}.") from exc


def _passo_row(row: dict, funcoes: list[dict] | None = None) -> dict:
    learned = {
        "n": _i(row.get("n_aprendido")),
        "mediana_horas": _f(row.get("mediana_horas")) if row.get("mediana_horas") is not None else None,
        "ewma_horas": _f(row.get("ewma_horas")) if row.get("ewma_horas") is not None else None,
        "p25_horas": _f(row.get("p25_horas")) if row.get("p25_horas") is not None else None,
        "p75_horas": _f(row.get("p75_horas")) if row.get("p75_horas") is not None else None,
    }
    return {
        "id": int(row["id"]),
        "catalog_id": int(row["catalog_id"]),
        "produto_rotulo": row.get("produto_rotulo") or "",
        "ordem": _i(row.get("ordem")),
        "nome": row.get("nome") or "",
        "setor_link": row.get("setor_link") or "",
        "tipo": row.get("tipo") or "produtiva",
        "cobra_pessoal": bool(row.get("cobra_pessoal", 1)),
        "tecnologia": row.get("tecnologia") or "qualquer",
        "setup_min": _f(row.get("setup_min")),
        "min_por_un": _f(row.get("min_por_un")),
        "min_por_pag": _f(row.get("min_por_pag")),
        "min_por_folha": _f(row.get("min_por_folha")),
        "ativo": bool(row.get("ativo", 1)),
        "funcoes": funcoes or [],
        "aprendido": learned,
    }


def list_passos(catalog_id: int) -> list[dict]:
    rows = db.execute_query(
        """
        SELECT p.*, t.n AS n_aprendido, t.mediana_horas, t.ewma_horas, t.p25_horas, t.p75_horas
        FROM tab_orcamento_produto_passo p
        LEFT JOIN tab_orcamento_tempo_aprendido t ON t.passo_id = p.id
        WHERE p.catalog_id = %s AND p.ativo = 1
        ORDER BY p.ordem ASC, p.id ASC
        """,
        (catalog_id,),
    ) or []
    if not rows:
        return []
    ids = [int(r["id"]) for r in rows]
    placeholders = ",".join(["%s"] * len(ids))
    crew_rows = db.execute_query(
        f"""
        SELECT pf.passo_id, pf.funcao_id, pf.quantidade, f.nome, f.codigo, f.custo_hora
        FROM tab_orcamento_passo_funcao pf
        LEFT JOIN tab_custo_funcao f ON f.id = pf.funcao_id
        WHERE pf.passo_id IN ({placeholders})
        """,
        tuple(ids),
    ) or []
    by_passo: dict[int, list[dict]] = {i: [] for i in ids}
    for cr in crew_rows:
        by_passo[int(cr["passo_id"])].append(
            {
                "funcao_id": int(cr["funcao_id"]),
                "quantidade": _f(cr.get("quantidade"), 1),
                "nome": cr.get("nome"),
                "codigo": cr.get("codigo"),
                "custo_hora": _f(cr.get("custo_hora")) if cr.get("custo_hora") is not None else None,
            }
        )
    return [_passo_row(r, by_passo.get(int(r["id"]), [])) for r in rows]


def list_passos_por_produto(rotulo: str) -> list[dict]:
    wanted = normalize_text(rotulo)
    if not wanted:
        return []
    rows = db.execute_query(
        """
        SELECT p.*, t.n AS n_aprendido, t.mediana_horas, t.ewma_horas, t.p25_horas, t.p75_horas
        FROM tab_orcamento_produto_passo p
        LEFT JOIN tab_orcamento_tempo_aprendido t ON t.passo_id = p.id
        WHERE p.ativo = 1
        ORDER BY p.ordem ASC, p.id ASC
        """,
    ) or []
    matched_catalog: Optional[int] = None
    for r in rows:
        if normalize_text(r.get("produto_rotulo")) == wanted:
            matched_catalog = int(r["catalog_id"])
            break
    if matched_catalog is None:
        return []
    return list_passos(matched_catalog)


def replace_passos(catalog_id: int, passos: list[dict], *, rotulo: str) -> list[dict]:
    rotulo_clean = (rotulo or "").strip()
    if not rotulo_clean:
        raise ValueError("Rótulo do produto é obrigatório.")

    def _tx(cursor):
        cursor.execute(
            "SELECT id FROM tab_orcamento_produto_passo WHERE catalog_id = %s",
            (catalog_id,),
        )
        old_ids = [int(r["id"]) for r in (cursor.fetchall() or [])]
        if old_ids:
            ph = ",".join(["%s"] * len(old_ids))
            cursor.execute(
                f"DELETE FROM tab_orcamento_passo_funcao WHERE passo_id IN ({ph})",
                tuple(old_ids),
            )
            cursor.execute(
                f"DELETE FROM tab_orcamento_tempo_aprendido WHERE passo_id IN ({ph})",
                tuple(old_ids),
            )
            cursor.execute(
                "DELETE FROM tab_orcamento_produto_passo WHERE catalog_id = %s",
                (catalog_id,),
            )
        for idx, raw in enumerate(passos):
            tipo = str(raw.get("tipo") or "produtiva").strip().lower()
            if tipo not in _TIPOS:
                tipo = "produtiva"
            tec = str(raw.get("tecnologia") or "qualquer").strip().lower()
            if tec not in _TECS:
                tec = "qualquer"
            cobra = 0 if tipo in {"espera_cliente", "fim"} else (1 if raw.get("cobra_pessoal", True) else 0)
            nome = str(raw.get("nome") or "").strip() or str(raw.get("setor_link") or "Etapa")
            setor = str(raw.get("setor_link") or "").strip()
            if not setor:
                raise ValueError(f"Etapa '{nome}' sem setor.")
            cursor.execute(
                """
                INSERT INTO tab_orcamento_produto_passo (
                    catalog_id, produto_rotulo, ordem, nome, setor_link, tipo,
                    cobra_pessoal, tecnologia, setup_min, min_por_un, min_por_pag,
                    min_por_folha, ativo
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1)
                """,
                (
                    catalog_id,
                    rotulo_clean,
                    _i(raw.get("ordem"), (idx + 1) * 10),
                    nome,
                    setor,
                    tipo,
                    cobra,
                    tec,
                    _f(raw.get("setup_min")),
                    _f(raw.get("min_por_un")),
                    _f(raw.get("min_por_pag")),
                    _f(raw.get("min_por_folha")),
                ),
            )
            passo_id = int(cursor.lastrowid)
            seen: set[int] = set()
            for crew in raw.get("funcoes") or []:
                fid = _i(crew.get("funcao_id") or crew.get("id"))
                if fid <= 0 or fid in seen:
                    continue
                seen.add(fid)
                cursor.execute(
                    """
                    INSERT INTO tab_orcamento_passo_funcao (passo_id, funcao_id, quantidade)
                    VALUES (%s, %s, %s)
                    """,
                    (passo_id, fid, max(_f(crew.get("quantidade"), 1), 0.01)),
                )

    db.execute_transaction([_tx])
    return list_passos(catalog_id)


def copiar_passos(destino_id: int, origem_id: int, *, rotulo: str) -> list[dict]:
    origem = list_passos(origem_id)
    payload = []
    for p in origem:
        payload.append(
            {
                "ordem": p["ordem"],
                "nome": p["nome"],
                "setor_link": p["setor_link"],
                "tipo": p["tipo"],
                "cobra_pessoal": p["cobra_pessoal"],
                "tecnologia": p["tecnologia"],
                "setup_min": p["setup_min"],
                "min_por_un": p["min_por_un"],
                "min_por_pag": p["min_por_pag"],
                "min_por_folha": p["min_por_folha"],
                "funcoes": [
                    {"funcao_id": c["funcao_id"], "quantidade": c["quantidade"]}
                    for c in p.get("funcoes") or []
                ],
            }
        )
    return replace_passos(destino_id, payload, rotulo=rotulo)


def list_learned() -> list[dict]:
    rows = db.execute_query(
        """
        SELECT passo_id, catalog_id, setor_link, n, mediana_horas, ewma_horas,
               p25_horas, p75_horas
        FROM tab_orcamento_tempo_aprendido
        """
    ) or []
    return [
        {
            "passo_id": int(r["passo_id"]),
            "catalog_id": int(r["catalog_id"]),
            "setor_link": r.get("setor_link"),
            "n": _i(r.get("n")),
            "mediana_horas": _f(r.get("mediana_horas")),
            "ewma_horas": _f(r.get("ewma_horas")),
            "p25_horas": _f(r.get("p25_horas")) if r.get("p25_horas") is not None else None,
            "p75_horas": _f(r.get("p75_horas")) if r.get("p75_horas") is not None else None,
        }
        for r in rows
    ]

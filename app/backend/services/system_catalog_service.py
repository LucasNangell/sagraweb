"""Catálogo administrável de listas do sistema (setores, produtos, papel, etc.)."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

from database import db
from lookup_sync import sync_lookup_tables_from_mdb_if_empty
from system_catalog_schema import ensure_system_catalog_schema

logger = logging.getLogger(__name__)

VALID_CATEGORIES: Dict[str, Dict[str, str]] = {
    "setor": {
        "label": "Setores",
        "description": "Setores de andamento das ordens de serviço.",
    },
    "situacao": {
        "label": "Situações",
        "description": "Situações de andamento registradas nas OSs.",
    },
    "cliente": {
        "label": "Clientes",
        "description": "Solicitantes (NomeUsuario) vinculados às OSs.",
    },
    "produto": {
        "label": "Produtos",
        "description": "Tipos de publicação / produtos nos detalhes de serviço.",
    },
    "papel": {
        "label": "Papel",
        "description": "Tipos de papel disponíveis para seleção.",
    },
    "maquina": {
        "label": "Máquinas",
        "description": "Máquinas vinculadas aos detalhes de serviço.",
    },
    "categoria": {
        "label": "Categorias",
        "description": "Categorias de protocolo.",
    },
    "cor": {
        "label": "Cores",
        "description": "Cores de impressão disponíveis.",
    },
    "formato": {
        "label": "Formatos",
        "description": "Formatos de impressão cadastrados.",
    },
    "acabamento": {
        "label": "Acabamentos",
        "description": "Tipos de acabamento de produto. Cada acabamento pode ter variações (ex.: Laminação → Fosca, Brilho).",
    },
}


def _normalize_label(value: str) -> str:
    return " ".join((value or "").strip().split())


def _validate_category(category: str) -> str:
    key = (category or "").strip().lower()
    if key not in VALID_CATEGORIES:
        raise ValueError(f"Categoria inválida: {category}")
    return key


def _fetch_dynamic_labels(category: str) -> List[str]:
    """Valores já usados no sistema (descobertos nas tabelas operacionais)."""
    key = _validate_category(category)

    # Catálogo tipado sem fonte operacional ainda (não lê DescAcabamento).
    if key == "acabamento":
        return []

    if key in ("papel", "categoria", "cor", "formato"):
        sync_lookup_tables_from_mdb_if_empty()

    queries: Dict[str, str] = {
        "setor": """
            SELECT DISTINCT SetorLink AS v
            FROM tabAndamento
            WHERE SetorLink IS NOT NULL AND TRIM(SetorLink) <> ''
        """,
        "situacao": """
            SELECT DISTINCT SituacaoLink AS v
            FROM tabAndamento
            WHERE SituacaoLink IS NOT NULL AND TRIM(SituacaoLink) <> ''
        """,
        "cliente": """
            SELECT DISTINCT NomeUsuario AS v
            FROM tabProtocolos
            WHERE NomeUsuario IS NOT NULL AND TRIM(NomeUsuario) <> ''
        """,
        "produto": """
            SELECT DISTINCT TipoPublicacaoLink AS v
            FROM tabDetalhesServico
            WHERE TipoPublicacaoLink IS NOT NULL AND TRIM(TipoPublicacaoLink) <> ''
        """,
        "maquina": """
            SELECT DISTINCT MaquinaLink AS v
            FROM tabDetalhesServico
            WHERE MaquinaLink IS NOT NULL AND TRIM(MaquinaLink) <> ''
        """,
        "papel": """
            SELECT DISTINCT Papel AS v
            FROM tabPapel
            WHERE Papel IS NOT NULL AND TRIM(Papel) <> ''
        """,
        "categoria": """
            SELECT DISTINCT Categoria AS v
            FROM tabcategorias
            WHERE Categoria IS NOT NULL AND TRIM(Categoria) <> ''
        """,
        "cor": """
            SELECT DISTINCT Cor AS v
            FROM tabCores
            WHERE Cor IS NOT NULL AND TRIM(Cor) <> ''
        """,
        "formato": """
            SELECT DISTINCT Formato AS v
            FROM tabFormatos
            WHERE Formato IS NOT NULL AND TRIM(Formato) <> ''
        """,
    }

    rows = db.execute_query(queries[key])
    labels: List[str] = []
    seen: Set[str] = set()
    for row in rows or []:
        label = _normalize_label(str(row.get("v") or ""))
        if not label:
            continue
        folded = label.casefold()
        if folded in seen:
            continue
        seen.add(folded)
        labels.append(label)

    if key == "cor" and not labels:
        fallback = db.execute_query(
            """
            SELECT DISTINCT Cores AS v
            FROM tabDetalhesServico
            WHERE Cores IS NOT NULL AND TRIM(Cores) <> ''
            """
        )
        for row in fallback or []:
            label = _normalize_label(str(row.get("v") or ""))
            if label and label.casefold() not in seen:
                seen.add(label.casefold())
                labels.append(label)

    return sorted(labels, key=lambda s: s.casefold())


def _fetch_catalog_rows(category: str) -> List[Dict[str, Any]]:
    ensure_system_catalog_schema()
    rows = db.execute_query(
        """
        SELECT ID, Categoria, Rotulo, Ativo, Ordem, Origem,
               CriadoEm, AtualizadoEm, AtualizadoPorPonto
        FROM tabSystemCatalog
        WHERE Categoria = %s
        ORDER BY Ordem ASC, Rotulo ASC
        """,
        (category,),
    )
    return list(rows or [])


def _serialize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    created = row.get("CriadoEm")
    updated = row.get("AtualizadoEm")
    return {
        "id": int(row["ID"]),
        "category": row["Categoria"],
        "label": row["Rotulo"],
        "active": bool(row.get("Ativo")),
        "ordem": int(row.get("Ordem") or 50),
        "source": row.get("Origem") or "catalog",
        "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
        "updated_at": updated.isoformat() if hasattr(updated, "isoformat") else updated,
        "updated_by_ponto": row.get("AtualizadoPorPonto"),
    }


def merge_catalog_labels(category: str, dynamic_labels: List[str]) -> List[str]:
    """
    Mescla valores dinâmicos com o catálogo administrável.

    - Itens em uso permanecem visíveis, salvo desativação explícita no catálogo.
    - Itens cadastrados apenas no catálogo (ativos) aparecem nas listas auxiliares.
    """
    key = _validate_category(category)
    catalog_rows = _fetch_catalog_rows(key)
    catalog_by_label = {str(r["Rotulo"]): r for r in catalog_rows}

    result: Set[str] = set()
    for raw in dynamic_labels:
        label = _normalize_label(raw)
        if not label:
            continue
        cat = catalog_by_label.get(label)
        if cat is None or bool(cat.get("Ativo")):
            result.add(label)

    for row in catalog_rows:
        label = _normalize_label(str(row.get("Rotulo") or ""))
        if label and bool(row.get("Ativo")):
            result.add(label)

    if key == "setor":
        result.add("Gravação")

    return sorted(result, key=lambda s: s.casefold())


def apply_catalog_to_filter_rows(
    category: str,
    rows: List[Dict[str, Any]],
    *,
    value_key: str = "value",
    q: Optional[str] = None,
    limit: int = 50,
    inject_missing: bool = True,
) -> List[Dict[str, Any]]:
    """Aplica regras do catálogo às opções de filtro (produtos / solicitantes)."""
    dynamic = [str(r.get(value_key) or "").strip() for r in rows if r.get(value_key)]
    allowed = set(merge_catalog_labels(category, dynamic))
    result = [r for r in rows if str(r.get(value_key) or "").strip() in allowed]

    prefix = (q or "").strip().casefold()
    seen = {str(r.get(value_key) or "").strip().casefold() for r in result}
    if inject_missing:
        for label in allowed:
            folded = label.casefold()
            if folded in seen:
                continue
            if prefix and not folded.startswith(prefix):
                continue
            result.append({value_key: label, "label": label, "count": None})
            seen.add(folded)

    result.sort(key=lambda r: str(r.get(value_key) or "").casefold())
    return result[:limit]


def list_categories_meta() -> List[Dict[str, str]]:
    return [
        {"key": key, **meta}
        for key, meta in VALID_CATEGORIES.items()
    ]


def get_category_meta(category: str) -> Dict[str, str]:
    key = _validate_category(category)
    return {"key": key, **VALID_CATEGORIES[key]}


def list_admin_items(category: str) -> List[Dict[str, Any]]:
    """Lista unificada para o painel admin (uso + catálogo)."""
    key = _validate_category(category)
    dynamic = _fetch_dynamic_labels(key)
    catalog_rows = _fetch_catalog_rows(key)
    catalog_map = {str(r["Rotulo"]): r for r in catalog_rows}
    dynamic_set = {label.casefold() for label in dynamic}

    items: List[Dict[str, Any]] = []
    seen: Set[str] = set()

    for label in dynamic:
        seen.add(label.casefold())
        cat = catalog_map.get(label)
        in_use = True
        if cat:
            items.append(
                {
                    "id": int(cat["ID"]),
                    "label": label,
                    "active": bool(cat.get("Ativo")),
                    "ordem": int(cat.get("Ordem") or 50),
                    "source": str(cat.get("Origem") or "usage"),
                    "in_use": in_use,
                }
            )
        else:
            items.append(
                {
                    "id": None,
                    "label": label,
                    "active": True,
                    "ordem": 50,
                    "source": "usage",
                    "in_use": in_use,
                }
            )

    for row in catalog_rows:
        label = _normalize_label(str(row.get("Rotulo") or ""))
        if not label or label.casefold() in seen:
            continue
        items.append(
            {
                "id": int(row["ID"]),
                "label": label,
                "active": bool(row.get("Ativo")),
                "ordem": int(row.get("Ordem") or 50),
                "source": str(row.get("Origem") or "catalog"),
                "in_use": label.casefold() in dynamic_set,
            }
        )

    items.sort(key=lambda x: (not x["active"], x["ordem"], x["label"].casefold()))
    return items


def _get_catalog_row(category: str, item_id: int) -> Dict[str, Any]:
    rows = db.execute_query(
        """
        SELECT ID, Categoria, Rotulo, Ativo, Ordem, Origem,
               CriadoEm, AtualizadoEm, AtualizadoPorPonto
        FROM tabSystemCatalog
        WHERE ID = %s AND Categoria = %s
        LIMIT 1
        """,
        (item_id, category),
    )
    if not rows:
        raise KeyError(f"Item {item_id} não encontrado em {category}")
    return rows[0]


def get_catalog_item(category: str, item_id: int) -> Dict[str, Any]:
    """Item do catálogo serializado; KeyError se não existir."""
    return _serialize_row(_get_catalog_row(category, item_id))


def create_catalog_item(
    category: str,
    *,
    label: str,
    ordem: int = 50,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    key = _validate_category(category)
    normalized = _normalize_label(label)
    if not normalized:
        raise ValueError("Informe um nome válido.")

    existing = db.execute_query(
        """
        SELECT ID FROM tabSystemCatalog
        WHERE Categoria = %s AND Rotulo = %s
        LIMIT 1
        """,
        (key, normalized),
    )
    if existing:
        raise ValueError(f'"{normalized}" já está cadastrado nesta lista.')

    db.execute_query(
        """
        INSERT INTO tabSystemCatalog (
            Categoria, Rotulo, Ativo, Ordem, Origem, AtualizadoPorPonto
        ) VALUES (%s, %s, 1, %s, 'catalog', %s)
        """,
        (key, normalized, ordem, updated_by_ponto),
    )
    rows = db.execute_query(
        """
        SELECT ID FROM tabSystemCatalog
        WHERE Categoria = %s AND Rotulo = %s
        ORDER BY ID DESC LIMIT 1
        """,
        (key, normalized),
    )
    if not rows:
        raise RuntimeError("Falha ao criar item do catálogo.")
    return _serialize_row(_get_catalog_row(key, int(rows[0]["ID"])))


def get_or_create_catalog_item(
    category: str,
    label: str,
    *,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    """Devolve o item do catálogo, criando-o se só existia 'em uso'."""
    key = _validate_category(category)
    normalized = _normalize_label(label)
    if not normalized:
        raise ValueError("Informe um nome válido.")
    existing = db.execute_query(
        """
        SELECT ID FROM tabSystemCatalog
        WHERE Categoria = %s AND Rotulo = %s
        LIMIT 1
        """,
        (key, normalized),
    )
    if existing:
        return _serialize_row(_get_catalog_row(key, int(existing[0]["ID"])))
    return create_catalog_item(
        key, label=normalized, updated_by_ponto=updated_by_ponto
    )


def _upsert_usage_override(
    category: str,
    label: str,
    *,
    active: bool,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    key = _validate_category(category)
    normalized = _normalize_label(label)
    if not normalized:
        raise ValueError("Informe um nome válido.")

    existing = db.execute_query(
        """
        SELECT ID FROM tabSystemCatalog
        WHERE Categoria = %s AND Rotulo = %s
        LIMIT 1
        """,
        (key, normalized),
    )
    if existing:
        item_id = int(existing[0]["ID"])
        db.execute_query(
            """
            UPDATE tabSystemCatalog
            SET Ativo = %s, AtualizadoPorPonto = %s
            WHERE ID = %s
            """,
            (1 if active else 0, updated_by_ponto, item_id),
        )
        return _serialize_row(_get_catalog_row(key, item_id))

    db.execute_query(
        """
        INSERT INTO tabSystemCatalog (
            Categoria, Rotulo, Ativo, Ordem, Origem, AtualizadoPorPonto
        ) VALUES (%s, %s, %s, 50, 'usage', %s)
        """,
        (key, normalized, 1 if active else 0, updated_by_ponto),
    )
    rows = db.execute_query(
        """
        SELECT ID FROM tabSystemCatalog
        WHERE Categoria = %s AND Rotulo = %s
        ORDER BY ID DESC LIMIT 1
        """,
        (key, normalized),
    )
    return _serialize_row(_get_catalog_row(key, int(rows[0]["ID"])))


def update_catalog_item(
    category: str,
    item_id: int,
    *,
    label: Optional[str] = None,
    ordem: Optional[int] = None,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    key = _validate_category(category)
    row = _get_catalog_row(key, item_id)
    new_label = _normalize_label(label) if label is not None else str(row["Rotulo"])
    if not new_label:
        raise ValueError("Informe um nome válido.")

    if label is not None and new_label != str(row["Rotulo"]):
        dup = db.execute_query(
            """
            SELECT ID FROM tabSystemCatalog
            WHERE Categoria = %s AND Rotulo = %s AND ID <> %s
            LIMIT 1
            """,
            (key, new_label, item_id),
        )
        if dup:
            raise ValueError(f'"{new_label}" já está cadastrado nesta lista.')

    fields: List[str] = []
    params: List[Any] = []
    if label is not None:
        fields.append("Rotulo = %s")
        params.append(new_label)
    if ordem is not None:
        fields.append("Ordem = %s")
        params.append(ordem)
    if updated_by_ponto is not None:
        fields.append("AtualizadoPorPonto = %s")
        params.append(updated_by_ponto)

    if fields:
        params.append(item_id)
        db.execute_query(
            f"UPDATE tabSystemCatalog SET {', '.join(fields)} WHERE ID = %s",
            tuple(params),
        )

    return _serialize_row(_get_catalog_row(key, item_id))


def set_catalog_item_active(
    category: str,
    item_id: int,
    *,
    active: bool,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    key = _validate_category(category)
    _get_catalog_row(key, item_id)
    db.execute_query(
        """
        UPDATE tabSystemCatalog
        SET Ativo = %s, AtualizadoPorPonto = %s
        WHERE ID = %s AND Categoria = %s
        """,
        (1 if active else 0, updated_by_ponto, item_id, key),
    )
    return _serialize_row(_get_catalog_row(key, item_id))


def activate_by_label(
    category: str,
    label: str,
    *,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    key = _validate_category(category)
    normalized = _normalize_label(label)
    rows = db.execute_query(
        """
        SELECT ID FROM tabSystemCatalog
        WHERE Categoria = %s AND Rotulo = %s
        LIMIT 1
        """,
        (key, normalized),
    )
    if rows:
        return set_catalog_item_active(
            key,
            int(rows[0]["ID"]),
            active=True,
            updated_by_ponto=updated_by_ponto,
        )
    return _upsert_usage_override(
        key, normalized, active=True, updated_by_ponto=updated_by_ponto
    )


def deactivate_by_label(
    category: str,
    label: str,
    *,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    key = _validate_category(category)
    normalized = _normalize_label(label)
    rows = db.execute_query(
        """
        SELECT ID FROM tabSystemCatalog
        WHERE Categoria = %s AND Rotulo = %s
        LIMIT 1
        """,
        (key, normalized),
    )
    if rows:
        return set_catalog_item_active(
            key,
            int(rows[0]["ID"]),
            active=False,
            updated_by_ponto=updated_by_ponto,
        )
    return _upsert_usage_override(
        key, normalized, active=False, updated_by_ponto=updated_by_ponto
    )


def delete_catalog_item(category: str, item_id: int) -> None:
    key = _validate_category(category)
    row = _get_catalog_row(key, item_id)
    label = str(row["Rotulo"])
    dynamic = {v.casefold() for v in _fetch_dynamic_labels(key)}

    if label.casefold() in dynamic:
        raise ValueError(
            "Este item já foi usado no sistema. Desative-o em vez de excluir — "
            "os registros históricos permanecem intactos."
        )

    db.execute_query(
        "DELETE FROM tabSystemCatalog WHERE ID = %s AND Categoria = %s",
        (item_id, key),
    )


# ---------------------------------------------------------------------------
# Variações — somente para itens da categoria "acabamento"
# ---------------------------------------------------------------------------

def _require_acabamento_item(item_id: int) -> Dict[str, Any]:
    """Garante que o item pertence à categoria acabamento."""
    ensure_system_catalog_schema()
    rows = db.execute_query(
        """
        SELECT ID, Categoria, Rotulo
        FROM tabSystemCatalog
        WHERE ID = %s
        LIMIT 1
        """,
        (item_id,),
    )
    if not rows:
        raise KeyError(f"Item {item_id} não encontrado.")
    row = rows[0]
    if str(row.get("Categoria") or "").lower() != "acabamento":
        raise ValueError("Variações são suportadas apenas para itens da categoria Acabamentos.")
    return row


def _serialize_variacao(row: Dict[str, Any]) -> Dict[str, Any]:
    created = row.get("CriadoEm")
    updated = row.get("AtualizadoEm")
    return {
        "id": int(row["ID"]),
        "catalog_id": int(row["CatalogID"]),
        "label": row["Rotulo"],
        "active": bool(row.get("Ativo")),
        "ordem": int(row.get("Ordem") or 50),
        "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
        "updated_at": updated.isoformat() if hasattr(updated, "isoformat") else updated,
        "updated_by_ponto": row.get("AtualizadoPorPonto"),
    }


def list_variacoes(catalog_id: int) -> List[Dict[str, Any]]:
    _require_acabamento_item(catalog_id)
    rows = db.execute_query(
        """
        SELECT ID, CatalogID, Rotulo, Ativo, Ordem,
               CriadoEm, AtualizadoEm, AtualizadoPorPonto
        FROM tabSystemCatalogVariacao
        WHERE CatalogID = %s
        ORDER BY Ordem ASC, Rotulo ASC
        """,
        (catalog_id,),
    )
    return [_serialize_variacao(r) for r in (rows or [])]


def create_variacao(
    catalog_id: int,
    *,
    label: str,
    ordem: int = 50,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    _require_acabamento_item(catalog_id)
    normalized = _normalize_label(label)
    if not normalized:
        raise ValueError("Informe um nome válido para a variação.")

    existing = db.execute_query(
        """
        SELECT ID FROM tabSystemCatalogVariacao
        WHERE CatalogID = %s AND Rotulo = %s
        LIMIT 1
        """,
        (catalog_id, normalized),
    )
    if existing:
        raise ValueError(f'"{normalized}" já está cadastrado neste acabamento.')

    db.execute_query(
        """
        INSERT INTO tabSystemCatalogVariacao (CatalogID, Rotulo, Ativo, Ordem, AtualizadoPorPonto)
        VALUES (%s, %s, 1, %s, %s)
        """,
        (catalog_id, normalized, ordem, updated_by_ponto),
    )
    rows = db.execute_query(
        """
        SELECT ID, CatalogID, Rotulo, Ativo, Ordem,
               CriadoEm, AtualizadoEm, AtualizadoPorPonto
        FROM tabSystemCatalogVariacao
        WHERE CatalogID = %s AND Rotulo = %s
        ORDER BY ID DESC LIMIT 1
        """,
        (catalog_id, normalized),
    )
    if not rows:
        raise RuntimeError("Falha ao criar variação.")
    return _serialize_variacao(rows[0])


def set_variacao_active(
    catalog_id: int,
    variacao_id: int,
    *,
    active: bool,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    _require_acabamento_item(catalog_id)
    rows = db.execute_query(
        """
        SELECT ID, CatalogID, Rotulo, Ativo, Ordem,
               CriadoEm, AtualizadoEm, AtualizadoPorPonto
        FROM tabSystemCatalogVariacao
        WHERE ID = %s AND CatalogID = %s
        LIMIT 1
        """,
        (variacao_id, catalog_id),
    )
    if not rows:
        raise KeyError(f"Variação {variacao_id} não encontrada.")
    db.execute_query(
        """
        UPDATE tabSystemCatalogVariacao
        SET Ativo = %s, AtualizadoPorPonto = %s
        WHERE ID = %s AND CatalogID = %s
        """,
        (1 if active else 0, updated_by_ponto, variacao_id, catalog_id),
    )
    updated = db.execute_query(
        """
        SELECT ID, CatalogID, Rotulo, Ativo, Ordem,
               CriadoEm, AtualizadoEm, AtualizadoPorPonto
        FROM tabSystemCatalogVariacao
        WHERE ID = %s
        LIMIT 1
        """,
        (variacao_id,),
    )
    return _serialize_variacao(updated[0])


def delete_variacao(catalog_id: int, variacao_id: int) -> None:
    _require_acabamento_item(catalog_id)
    rows = db.execute_query(
        "SELECT ID FROM tabSystemCatalogVariacao WHERE ID = %s AND CatalogID = %s LIMIT 1",
        (variacao_id, catalog_id),
    )
    if not rows:
        raise KeyError(f"Variação {variacao_id} não encontrada.")
    db.execute_query(
        "DELETE FROM tabSystemCatalogVariacao WHERE ID = %s AND CatalogID = %s",
        (variacao_id, catalog_id),
    )


def list_acabamentos_operacionais() -> List[Dict[str, Any]]:
    """Itens ativos de acabamento com variações ativas (uso na Gerência)."""
    ensure_system_catalog_schema()
    rows = db.execute_query(
        """
        SELECT ID, Rotulo, Ordem
        FROM tabSystemCatalog
        WHERE Categoria = 'acabamento' AND Ativo = 1
        ORDER BY Ordem ASC, Rotulo ASC
        """
    )
    items: List[Dict[str, Any]] = []
    for row in rows or []:
        catalog_id = int(row["ID"])
        variacao_rows = db.execute_query(
            """
            SELECT ID, Rotulo, Ordem
            FROM tabSystemCatalogVariacao
            WHERE CatalogID = %s AND Ativo = 1
            ORDER BY Ordem ASC, Rotulo ASC
            """,
            (catalog_id,),
        )
        items.append(
            {
                "id": catalog_id,
                "label": str(row.get("Rotulo") or "").strip(),
                "variacoes": [
                    {
                        "id": int(v["ID"]),
                        "label": str(v.get("Rotulo") or "").strip(),
                    }
                    for v in (variacao_rows or [])
                    if str(v.get("Rotulo") or "").strip()
                ],
            }
        )
    return [item for item in items if item["label"]]

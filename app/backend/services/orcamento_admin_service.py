"""CRUD e leitura do cadastro de orçamento (insumos, parâmetros, formatos, faixas)."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)


def _json_load(raw: Any, default: Any) -> Any:
    if raw is None or raw == "":
        return default
    if isinstance(raw, (list, dict)):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return default


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    return text or None


def _f(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _insumo_row(row: dict) -> dict:
    qtd = _f(row.get("qtd_embalagem"), 1) or 1
    bruto = _f(row.get("preco_bruto"))
    unit = _f(row.get("preco_unitario"))
    bruto_d = _f(row.get("preco_bruto_digital"))
    unit_d = _f(row.get("preco_unitario_digital"))
    sku_id = row.get("estoque_sku_id")
    custo_est = row.get("custo_estoque")
    return {
        "id": int(row["id"]),
        "codigo": row["codigo"],
        "categoria": row["categoria"],
        "especificacao": row["especificacao"],
        "unidade": row.get("unidade"),
        "qtd_embalagem": qtd,
        "preco_bruto": bruto,
        "preco_unitario": unit,
        "preco_cadastro": unit,
        "preco_bruto_digital": bruto_d,
        "preco_unitario_digital": unit_d if unit_d > 0 else unit,
        "rendimento_a4": _f(row.get("rendimento_a4")) if row.get("rendimento_a4") is not None else None,
        "formato_folha": row.get("formato_folha"),
        "aliases": _json_load(row.get("aliases_json"), []),
        "atualizado_em": _iso(row.get("atualizado_em")),
        "ativo": bool(row.get("ativo", 1)),
        "estoque_sku_id": int(sku_id) if sku_id else None,
        "estoque_sku_codigo": row.get("estoque_sku_codigo"),
        "custo_estoque": _f(custo_est) if custo_est is not None else None,
    }


_INSUMO_SELECT = """
SELECT i.*,
       s.codigo AS estoque_sku_codigo,
       s.custo_medio AS custo_estoque
FROM tab_orcamento_insumo i
LEFT JOIN tab_estoque_sku s ON s.id = i.estoque_sku_id
"""


def tinta_policromia_custo(skus: list[dict]) -> Optional[float]:
    """Média ponderada pelo saldo das tintas CMY; None se algum custo estiver zerado."""
    if len(skus) != 3:
        return None
    medios: list[float] = []
    pesos: list[float] = []
    for sku in skus:
        custo = _f(sku.get("custo_medio"))
        if custo <= 0:
            return None
        qtd = _f(sku.get("quantidade"))
        medios.append(custo)
        pesos.append(qtd if qtd > 0 else 0.0)
    total = sum(pesos)
    if total > 0:
        return sum(m * p for m, p in zip(medios, pesos)) / total
    return sum(medios) / 3.0


def overlay_estoque_precos(
    insumos: list[dict],
    t5_skus: Optional[list[dict]] = None,
) -> list[dict]:
    """Substitui preco_unitario pelo custo_medio do SKU ligado quando > 0."""
    t5_custo = tinta_policromia_custo(t5_skus or [])
    out: list[dict] = []
    for item in insumos:
        row = dict(item)
        cadastro = _f(row.get("preco_cadastro") if row.get("preco_cadastro") is not None else row.get("preco_unitario"))
        row["preco_cadastro"] = cadastro
        custo_est = _f(row.get("custo_estoque")) if row.get("custo_estoque") is not None else 0.0
        if custo_est > 0:
            row["custo_estoque"] = custo_est
            row["preco_unitario"] = custo_est
        else:
            row["custo_estoque"] = None
            row["preco_unitario"] = cadastro
        if row.get("codigo") == "t5" and t5_custo is not None:
            row["custo_estoque"] = t5_custo
            row["preco_unitario"] = t5_custo
            if not row.get("estoque_sku_codigo"):
                row["estoque_sku_codigo"] = "MAT-144/145/146"
        out.append(row)
    return out


def _t5_skus() -> list[dict]:
    try:
        from estoque_import_licitacoes import T5_INK_CODIGOS
        from services.estoque_service import get_sku_by_codigo
    except Exception:
        return []
    found: list[dict] = []
    for codigo in T5_INK_CODIGOS:
        sku = get_sku_by_codigo(codigo, include_cost=True)
        if sku:
            found.append(sku)
    return found


def list_insumos(*, include_inactive: bool = True, overlay: bool = True) -> list[dict]:
    sql = _INSUMO_SELECT
    if not include_inactive:
        sql += " WHERE i.ativo = 1"
    sql += " ORDER BY i.categoria ASC, i.codigo ASC"
    rows = [_insumo_row(r) for r in (db.execute_query(sql) or [])]
    if overlay:
        return overlay_estoque_precos(rows, t5_skus=_t5_skus())
    return rows


def get_insumo(insumo_id: int) -> Optional[dict]:
    rows = db.execute_query(
        _INSUMO_SELECT + " WHERE i.id = %s",
        (insumo_id,),
    )
    if not rows:
        return None
    overlaid = overlay_estoque_precos([_insumo_row(rows[0])], t5_skus=_t5_skus())
    return overlaid[0]


def _unit_from(bruto: float, qtd: float, categoria: str) -> float:
    qtd = qtd or 1
    if categoria == "tinta":
        return bruto * qtd
    if categoria in {"bopp", "capa_pvc"}:
        return bruto
    return bruto / qtd if qtd else 0.0


def upsert_insumo(
    *,
    insumo_id: Optional[int] = None,
    codigo: str,
    categoria: str,
    especificacao: str,
    unidade: Optional[str] = None,
    qtd_embalagem: float = 1,
    preco_bruto: float = 0,
    preco_bruto_digital: Optional[float] = None,
    rendimento_a4: Optional[float] = None,
    formato_folha: Optional[str] = None,
    aliases: Optional[list[str]] = None,
    atualizado_em: Optional[str] = None,
    ativo: bool = True,
    ponto: Optional[str] = None,
) -> dict:
    codigo = (codigo or "").strip()
    categoria = (categoria or "").strip().lower()
    especificacao = (especificacao or "").strip()
    if not codigo:
        raise ValueError("Código é obrigatório.")
    if not categoria:
        raise ValueError("Categoria é obrigatória.")
    if not especificacao:
        raise ValueError("Especificação é obrigatória.")
    unit = _unit_from(float(preco_bruto), float(qtd_embalagem or 1), categoria)
    aliases_json = json.dumps(aliases or [], ensure_ascii=False)
    has_digital = preco_bruto_digital is not None
    bruto_d = float(preco_bruto_digital) if has_digital else float(preco_bruto)
    unit_d = _unit_from(bruto_d, float(qtd_embalagem or 1), categoria)
    if insumo_id:
        if has_digital:
            db.execute_query(
                """
                UPDATE tab_orcamento_insumo SET
                    codigo=%s, categoria=%s, especificacao=%s, unidade=%s,
                    qtd_embalagem=%s, preco_bruto=%s, preco_unitario=%s,
                    preco_bruto_digital=%s, preco_unitario_digital=%s,
                    rendimento_a4=%s, formato_folha=%s, aliases_json=%s,
                    atualizado_em=%s, ativo=%s, atualizado_por=%s
                WHERE id=%s
                """,
                (
                    codigo, categoria, especificacao, unidade,
                    qtd_embalagem, preco_bruto, unit, bruto_d, unit_d,
                    rendimento_a4, formato_folha, aliases_json,
                    atualizado_em or date.today().isoformat(),
                    1 if ativo else 0, ponto, insumo_id,
                ),
            )
        else:
            db.execute_query(
                """
                UPDATE tab_orcamento_insumo SET
                    codigo=%s, categoria=%s, especificacao=%s, unidade=%s,
                    qtd_embalagem=%s, preco_bruto=%s, preco_unitario=%s,
                    rendimento_a4=%s, formato_folha=%s, aliases_json=%s,
                    atualizado_em=%s, ativo=%s, atualizado_por=%s
                WHERE id=%s
                """,
                (
                    codigo, categoria, especificacao, unidade,
                    qtd_embalagem, preco_bruto, unit,
                    rendimento_a4, formato_folha, aliases_json,
                    atualizado_em or date.today().isoformat(),
                    1 if ativo else 0, ponto, insumo_id,
                ),
            )
        item = get_insumo(insumo_id)
        if not item:
            raise KeyError("Insumo não encontrado.")
        return item
    dup = db.execute_query(
        "SELECT id FROM tab_orcamento_insumo WHERE codigo = %s LIMIT 1",
        (codigo,),
    )
    if dup:
        raise ValueError(f"Já existe insumo com código {codigo}.")

    def _tx(cursor):
        cursor.execute(
            """
            INSERT INTO tab_orcamento_insumo (
                codigo, categoria, especificacao, unidade, qtd_embalagem,
                preco_bruto, preco_unitario, preco_bruto_digital, preco_unitario_digital,
                rendimento_a4, formato_folha,
                aliases_json, atualizado_em, ativo, atualizado_por
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                codigo, categoria, especificacao, unidade, qtd_embalagem,
                preco_bruto, unit, bruto_d, unit_d, rendimento_a4, formato_folha,
                aliases_json, atualizado_em or date.today().isoformat(),
                1 if ativo else 0, ponto,
            ),
        )
        return int(cursor.lastrowid)

    new_id = int(db.execute_transaction([_tx])[0])
    created = get_insumo(new_id)
    if not created:
        raise RuntimeError("Falha ao criar insumo.")
    return created


def set_insumo_ativo(insumo_id: int, ativo: bool, ponto: Optional[str] = None) -> dict:
    db.execute_query(
        "UPDATE tab_orcamento_insumo SET ativo=%s, atualizado_por=%s WHERE id=%s",
        (1 if ativo else 0, ponto, insumo_id),
    )
    item = get_insumo(insumo_id)
    if not item:
        raise KeyError("Insumo não encontrado.")
    return item


def list_parametros() -> list[dict]:
    rows = db.execute_query(
        "SELECT chave, valor, tipo, descricao, atualizado_em, atualizado_por "
        "FROM tab_orcamento_parametro ORDER BY chave"
    ) or []
    return [
        {
            "chave": r["chave"],
            "valor": r["valor"],
            "tipo": r.get("tipo") or "number",
            "descricao": r.get("descricao"),
            "atualizado_em": _iso(r.get("atualizado_em")),
            "atualizado_por": r.get("atualizado_por"),
        }
        for r in rows
    ]


def parametros_map() -> dict[str, str]:
    return {p["chave"]: p["valor"] for p in list_parametros()}


def update_parametros(values: dict[str, Any], ponto: Optional[str] = None) -> list[dict]:
    for chave, valor in values.items():
        db.execute_query(
            """
            UPDATE tab_orcamento_parametro
            SET valor=%s, atualizado_por=%s
            WHERE chave=%s
            """,
            (str(valor), ponto, chave),
        )
    return list_parametros()


def list_formatos(*, include_inactive: bool = True) -> list[dict]:
    sql = "SELECT * FROM tab_orcamento_formato"
    if not include_inactive:
        sql += " WHERE ativo = 1"
    sql += " ORDER BY ordem ASC, id ASC"
    rows = db.execute_query(sql) or []
    return [
        {
            "id": int(r["id"]),
            "codigo": r["codigo"],
            "menor_mm": _f(r.get("menor_mm")),
            "maior_mm": _f(r.get("maior_mm")),
            "fator_a4": _f(r.get("fator_a4")),
            "ordem": int(r.get("ordem") or 0),
            "ativo": bool(r.get("ativo", 1)),
        }
        for r in rows
    ]


def update_formato(formato_id: int, data: dict) -> dict:
    sets = []
    vals: list[Any] = []
    for key in ("codigo", "menor_mm", "maior_mm", "fator_a4", "ordem", "ativo"):
        if key in data and data[key] is not None:
            sets.append(f"{key}=%s")
            vals.append(int(data[key]) if key in {"ordem", "ativo"} else data[key])
    if not sets:
        raise ValueError("Nenhum campo para atualizar.")
    vals.append(formato_id)
    db.execute_query(
        f"UPDATE tab_orcamento_formato SET {', '.join(sets)} WHERE id=%s",
        tuple(vals),
    )
    rows = db.execute_query("SELECT * FROM tab_orcamento_formato WHERE id=%s", (formato_id,))
    if not rows:
        raise KeyError("Formato não encontrado.")
    return list_formatos()


def list_faixas(*, include_inactive: bool = True) -> list[dict]:
    sql = "SELECT * FROM tab_orcamento_faixa_pessoal"
    if not include_inactive:
        sql += " WHERE ativo = 1"
    sql += " ORDER BY ordem ASC, limite_inf ASC"
    rows = db.execute_query(sql) or []
    return [
        {
            "id": int(r["id"]),
            "limite_inf": int(r["limite_inf"]),
            "limite_sup": int(r["limite_sup"]) if r.get("limite_sup") is not None else None,
            "percentual": _f(r.get("percentual")),
            "ordem": int(r.get("ordem") or 0),
            "ativo": bool(r.get("ativo", 1)),
        }
        for r in rows
    ]


def update_faixa(faixa_id: int, data: dict) -> list[dict]:
    sets = []
    vals: list[Any] = []
    for key in ("limite_inf", "limite_sup", "percentual", "ordem", "ativo"):
        if key in data:
            sets.append(f"{key}=%s")
            vals.append(data[key])
    if not sets:
        raise ValueError("Nenhum campo para atualizar.")
    vals.append(faixa_id)
    db.execute_query(
        f"UPDATE tab_orcamento_faixa_pessoal SET {', '.join(sets)} WHERE id=%s",
        tuple(vals),
    )
    return list_faixas()


def load_catalog() -> dict:
    params_raw = parametros_map()
    params: dict[str, Any] = {}
    meta = {p["chave"]: p for p in list_parametros()}
    for chave, valor in params_raw.items():
        tipo = (meta.get(chave) or {}).get("tipo") or "number"
        if tipo == "bool":
            params[chave] = str(valor).strip() in {"1", "true", "True", "sim"}
        elif tipo in {"number", "percent"}:
            try:
                params[chave] = float(str(valor).replace(",", "."))
            except (TypeError, ValueError):
                params[chave] = valor
        else:
            params[chave] = valor
    funcoes: list[dict] = []
    passos: list[dict] = []
    learned: list[dict] = []
    try:
        from services import custo_funcao_service as custo_svc

        funcoes = custo_svc.list_funcoes(include_inactive=False)
    except Exception:
        logger.exception("Orçamento: falha ao carregar funções de custo")
    try:
        from services import orcamento_produto_passos_service as passos_svc

        rows = db.execute_query(
            """
            SELECT DISTINCT catalog_id FROM tab_orcamento_produto_passo WHERE ativo = 1
            """
        ) or []
        for row in rows:
            passos.extend(passos_svc.list_passos(int(row["catalog_id"])))
        learned = passos_svc.list_learned()
    except Exception:
        logger.exception("Orçamento: falha ao carregar etapas de produto")
    return {
        "insumos": list_insumos(include_inactive=False, overlay=False),
        "parametros": params,
        "formatos": list_formatos(include_inactive=False),
        "faixas": list_faixas(include_inactive=False),
        "funcoes": funcoes,
        "passos": passos,
        "learned": learned,
    }

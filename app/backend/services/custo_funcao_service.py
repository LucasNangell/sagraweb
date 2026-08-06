"""
Cadastro de funções da gráfica com custo de mão de obra.
custo_hora = custo_mensal / HORAS_MES_PADRAO (176).
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

HORAS_MES_PADRAO = Decimal("176")
D = Decimal
_QUANT = D("0.0001")


def _dec(value: Any) -> Decimal:
    if value is None:
        return D("0")
    if isinstance(value, Decimal):
        return value
    return D(str(value))


def _f(value: Decimal) -> float:
    return float(value.quantize(_QUANT, rounding=ROUND_HALF_UP))


def compute_custo_hora(custo_mensal: Any, *, horas_mes: Any = HORAS_MES_PADRAO) -> Decimal:
    mensal = _dec(custo_mensal)
    horas = _dec(horas_mes)
    if horas <= 0:
        raise ValueError("horas_mes deve ser maior que zero")
    return (mensal / horas).quantize(_QUANT, rounding=ROUND_HALF_UP)


def _normalize_codigo(codigo: str | None) -> str | None:
    if codigo is None:
        return None
    cleaned = str(codigo).strip()
    return cleaned or None


def _row_to_dict(row: dict) -> dict:
    return {
        "id": int(row["id"]),
        "nome": row["nome"],
        "codigo": row.get("codigo"),
        "descricao": row.get("descricao"),
        "custo_mensal": _f(_dec(row.get("custo_mensal"))),
        "custo_hora": _f(_dec(row.get("custo_hora"))),
        "horas_mes": _f(_dec(row.get("horas_mes") or HORAS_MES_PADRAO)),
        "moeda": row.get("moeda") or "BRL",
        "ativo": bool(row.get("ativo", 1)),
        "criado_em": row.get("criado_em"),
        "criado_por": row.get("criado_por"),
        "atualizado_em": row.get("atualizado_em"),
        "atualizado_por": row.get("atualizado_por"),
    }


def list_funcoes(*, include_inactive: bool = True) -> list[dict]:
    sql = """
        SELECT id, nome, codigo, descricao, custo_mensal, custo_hora, horas_mes,
               moeda, ativo, criado_em, criado_por, atualizado_em, atualizado_por
        FROM tab_custo_funcao
    """
    if not include_inactive:
        sql += " WHERE ativo = 1"
    sql += " ORDER BY nome ASC, id ASC"
    rows = db.execute_query(sql) or []
    return [_row_to_dict(r) for r in rows]


def get_funcao(funcao_id: int) -> Optional[dict]:
    rows = db.execute_query(
        """
        SELECT id, nome, codigo, descricao, custo_mensal, custo_hora, horas_mes,
               moeda, ativo, criado_em, criado_por, atualizado_em, atualizado_por
        FROM tab_custo_funcao
        WHERE id = %s
        """,
        (funcao_id,),
    ) or []
    if not rows:
        return None
    return _row_to_dict(rows[0])


def _assert_codigo_unique(codigo: str | None, *, exclude_id: int | None = None) -> None:
    if not codigo:
        return
    if exclude_id is None:
        rows = db.execute_query(
            "SELECT id FROM tab_custo_funcao WHERE codigo = %s LIMIT 1",
            (codigo,),
        ) or []
    else:
        rows = db.execute_query(
            "SELECT id FROM tab_custo_funcao WHERE codigo = %s AND id <> %s LIMIT 1",
            (codigo, exclude_id),
        ) or []
    if rows:
        raise ValueError(f"Já existe uma função com o código '{codigo}'.")


def create_funcao(
    *,
    nome: str,
    custo_mensal: float,
    ponto: str,
    codigo: str | None = None,
    descricao: str | None = None,
) -> dict:
    nome_clean = (nome or "").strip()
    if not nome_clean:
        raise ValueError("Nome é obrigatório.")
    mensal = _dec(custo_mensal)
    if mensal < 0:
        raise ValueError("custo_mensal deve ser maior ou igual a zero.")
    codigo_clean = _normalize_codigo(codigo)
    _assert_codigo_unique(codigo_clean)
    custo_hora = compute_custo_hora(mensal)
    horas = HORAS_MES_PADRAO
    ponto_str = str(ponto or "").strip() or None

    def _tx(cursor):
        cursor.execute(
            """
            INSERT INTO tab_custo_funcao (
                nome, codigo, descricao, custo_mensal, custo_hora, horas_mes,
                moeda, ativo, criado_por, atualizado_por
            ) VALUES (%s, %s, %s, %s, %s, %s, 'BRL', 1, %s, %s)
            """,
            (
                nome_clean,
                codigo_clean,
                (descricao or None),
                _f(mensal),
                _f(custo_hora),
                _f(horas),
                ponto_str,
                ponto_str,
            ),
        )
        return int(cursor.lastrowid)

    funcao_id = int(db.execute_transaction([_tx])[0])
    created = get_funcao(funcao_id)
    assert created is not None
    return created


def update_funcao(
    funcao_id: int,
    *,
    ponto: str,
    nome: str | None = None,
    codigo: str | None = None,
    clear_codigo: bool = False,
    descricao: str | None = None,
    custo_mensal: float | None = None,
) -> dict:
    existing = get_funcao(funcao_id)
    if not existing:
        raise KeyError("Função não encontrada.")

    ponto_str = str(ponto or "").strip() or None
    sets = ["atualizado_por = %s"]
    params: list[Any] = [ponto_str]

    if nome is not None:
        nome_clean = nome.strip()
        if not nome_clean:
            raise ValueError("Nome é obrigatório.")
        sets.append("nome = %s")
        params.append(nome_clean)

    if clear_codigo:
        sets.append("codigo = NULL")
    elif codigo is not None:
        codigo_clean = _normalize_codigo(codigo)
        _assert_codigo_unique(codigo_clean, exclude_id=funcao_id)
        sets.append("codigo = %s")
        params.append(codigo_clean)

    if descricao is not None:
        sets.append("descricao = %s")
        params.append(descricao)

    if custo_mensal is not None:
        mensal = _dec(custo_mensal)
        if mensal < 0:
            raise ValueError("custo_mensal deve ser maior ou igual a zero.")
        custo_hora = compute_custo_hora(mensal)
        sets.append("custo_mensal = %s")
        params.append(_f(mensal))
        sets.append("custo_hora = %s")
        params.append(_f(custo_hora))
        sets.append("horas_mes = %s")
        params.append(_f(HORAS_MES_PADRAO))

    params.append(funcao_id)

    def _tx(cursor):
        cursor.execute(
            f"UPDATE tab_custo_funcao SET {', '.join(sets)} WHERE id = %s",
            params,
        )

    db.execute_transaction([_tx])
    updated = get_funcao(funcao_id)
    assert updated is not None
    return updated


def set_funcao_active(funcao_id: int, *, active: bool, ponto: str) -> dict:
    existing = get_funcao(funcao_id)
    if not existing:
        raise KeyError("Função não encontrada.")
    ponto_str = str(ponto or "").strip() or None

    def _tx(cursor):
        cursor.execute(
            """
            UPDATE tab_custo_funcao
            SET ativo = %s, atualizado_por = %s
            WHERE id = %s
            """,
            (1 if active else 0, ponto_str, funcao_id),
        )

    db.execute_transaction([_tx])
    updated = get_funcao(funcao_id)
    assert updated is not None
    return updated

"""
Serviço de domínio do módulo Estoque (MySQL-only).
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

D = Decimal


def _dec(value: Any) -> Decimal:
    if value is None:
        return D("0")
    if isinstance(value, Decimal):
        return value
    return D(str(value))


def _f(value: Decimal) -> float:
    return float(value.quantize(D("0.0001")))


def _ponto_str(ponto: Any) -> str:
    return str(ponto or "").strip()


def _lock_saldo(cursor, sku_id: int) -> dict:
    cursor.execute(
        """
        SELECT sku_id, quantidade, reservado
        FROM tab_estoque_saldo
        WHERE sku_id = %s
        FOR UPDATE
        """,
        (sku_id,),
    )
    row = cursor.fetchone()
    if row:
        return row
    cursor.execute(
        """
        INSERT INTO tab_estoque_saldo (sku_id, quantidade, reservado)
        VALUES (%s, 0, 0)
        """,
        (sku_id,),
    )
    cursor.execute(
        """
        SELECT sku_id, quantidade, reservado
        FROM tab_estoque_saldo
        WHERE sku_id = %s
        FOR UPDATE
        """,
        (sku_id,),
    )
    row = cursor.fetchone()
    if not row:
        raise RuntimeError(f"Falha ao criar saldo do SKU {sku_id}")
    return row


def _insert_movimento(
    cursor,
    *,
    sku_id: int,
    tipo: str,
    quantidade: Decimal,
    custo_unitario: Decimal,
    saldo_apos: Decimal,
    motivo: str | None,
    ponto: str | None,
    pedido_id: int | None = None,
    os_nro: int | None = None,
    os_ano: int | None = None,
) -> int:
    custo_total = (quantidade.copy_abs() * custo_unitario).quantize(D("0.0001"))
    cursor.execute(
        """
        INSERT INTO tab_estoque_movimento (
            sku_id, tipo, quantidade, custo_unitario, custo_total, saldo_apos,
            motivo, pedido_id, referencia_os_nro, referencia_os_ano, ponto
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            sku_id,
            tipo,
            _f(quantidade),
            _f(custo_unitario),
            _f(custo_total),
            _f(saldo_apos),
            motivo,
            pedido_id,
            os_nro,
            os_ano,
            ponto,
        ),
    )
    return int(cursor.lastrowid)


def _sku_row_to_dict(row: dict, *, include_cost: bool) -> dict:
    qtd = _dec(row.get("quantidade"))
    reservado = _dec(row.get("reservado"))
    disponivel = qtd - reservado
    if disponivel < 0:
        disponivel = D("0")
    out = {
        "id": int(row["id"]),
        "codigo": row["codigo"],
        "nome": row["nome"],
        "descricao": row.get("descricao"),
        "categoria_id": int(row["categoria_id"]) if row.get("categoria_id") else None,
        "categoria_nome": row.get("categoria_nome"),
        "unidade": row.get("unidade") or "un",
        "papel_link": row.get("papel_link"),
        "estoque_minimo": _f(_dec(row.get("estoque_minimo"))),
        "ativo": bool(row.get("ativo", 1)),
        "quantidade": _f(qtd),
        "reservado": _f(reservado),
        "disponivel": _f(disponivel),
        "alerta_baixo": qtd <= _dec(row.get("estoque_minimo")),
    }
    if include_cost:
        out["custo_medio"] = _f(_dec(row.get("custo_medio")))
        out["ultimo_custo"] = _f(_dec(row.get("ultimo_custo")))
        out["moeda"] = row.get("moeda") or "BRL"
        out["valor_estoque"] = _f(qtd * _dec(row.get("custo_medio")))
    return out


def list_categorias(*, only_active: bool = True) -> list[dict]:
    sql = "SELECT id, nome, ativo FROM tab_estoque_categoria"
    if only_active:
        sql += " WHERE ativo = 1"
    sql += " ORDER BY nome"
    rows = db.execute_query(sql) or []
    return [
        {"id": int(r["id"]), "nome": r["nome"], "ativo": bool(r["ativo"])}
        for r in rows
    ]


def list_skus(
    *,
    q: str | None = None,
    categoria_id: int | None = None,
    only_active: bool = True,
    include_inactive: bool = False,
    include_cost: bool = False,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict], int]:
    where = ["1=1"]
    params: dict[str, Any] = {"limit": int(limit), "offset": int(offset)}
    if only_active and not include_inactive:
        where.append("s.ativo = 1")
    if categoria_id:
        where.append("s.categoria_id = %(categoria_id)s")
        params["categoria_id"] = int(categoria_id)
    if q and q.strip():
        where.append("(s.codigo LIKE %(q)s OR s.nome LIKE %(q)s OR s.descricao LIKE %(q)s)")
        params["q"] = f"%{q.strip()}%"
    where_sql = " AND ".join(where)
    count_rows = db.execute_query(
        f"""
        SELECT COUNT(*) AS cnt
        FROM tab_estoque_sku s
        WHERE {where_sql}
        """,
        params,
    )
    total = int((count_rows or [{}])[0].get("cnt") or 0)
    rows = db.execute_query(
        f"""
        SELECT s.*, c.nome AS categoria_nome,
               COALESCE(sal.quantidade, 0) AS quantidade,
               COALESCE(sal.reservado, 0) AS reservado
        FROM tab_estoque_sku s
        LEFT JOIN tab_estoque_categoria c ON c.id = s.categoria_id
        LEFT JOIN tab_estoque_saldo sal ON sal.sku_id = s.id
        WHERE {where_sql}
        ORDER BY s.nome
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        params,
    ) or []
    return [_sku_row_to_dict(r, include_cost=include_cost) for r in rows], total


def get_sku(sku_id: int, *, include_cost: bool = False) -> Optional[dict]:
    rows = db.execute_query(
        """
        SELECT s.*, c.nome AS categoria_nome,
               COALESCE(sal.quantidade, 0) AS quantidade,
               COALESCE(sal.reservado, 0) AS reservado
        FROM tab_estoque_sku s
        LEFT JOIN tab_estoque_categoria c ON c.id = s.categoria_id
        LEFT JOIN tab_estoque_saldo sal ON sal.sku_id = s.id
        WHERE s.id = %s
        """,
        (sku_id,),
    )
    if not rows:
        return None
    return _sku_row_to_dict(rows[0], include_cost=include_cost)


def create_sku(
    *,
    codigo: str,
    nome: str,
    descricao: str | None,
    categoria_id: int | None,
    unidade: str,
    papel_link: str | None,
    estoque_minimo: float,
    ponto: str,
) -> dict:
    codigo = codigo.strip()
    nome = nome.strip()
    if not codigo or not nome:
        raise ValueError("Código e nome são obrigatórios")

    def _tx(cursor):
        cursor.execute(
            """
            INSERT INTO tab_estoque_sku (
                codigo, nome, descricao, categoria_id, unidade, papel_link,
                estoque_minimo, ativo, criado_por, atualizado_por
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 1, %s, %s)
            """,
            (
                codigo,
                nome,
                descricao,
                categoria_id,
                (unidade or "un").strip() or "un",
                papel_link,
                float(estoque_minimo or 0),
                ponto,
                ponto,
            ),
        )
        sku_id = int(cursor.lastrowid)
        cursor.execute(
            "INSERT INTO tab_estoque_saldo (sku_id, quantidade, reservado) VALUES (%s, 0, 0)",
            (sku_id,),
        )
        return sku_id

    sku_id = int(db.execute_transaction([_tx])[0])
    sku = get_sku(sku_id, include_cost=True)
    assert sku is not None
    return sku


def update_sku(
    sku_id: int,
    *,
    ponto: str,
    codigo: str | None = None,
    nome: str | None = None,
    descricao: str | None = None,
    categoria_id: int | None = None,
    unidade: str | None = None,
    papel_link: str | None = None,
    estoque_minimo: float | None = None,
    ativo: bool | None = None,
    clear_categoria: bool = False,
) -> dict:
    existing = get_sku(sku_id, include_cost=True)
    if not existing:
        raise ValueError("SKU não encontrado")

    def _tx(cursor):
        sets = ["atualizado_por = %s"]
        params: list[Any] = [ponto]
        if codigo is not None:
            sets.append("codigo = %s")
            params.append(codigo.strip())
        if nome is not None:
            sets.append("nome = %s")
            params.append(nome.strip())
        if descricao is not None:
            sets.append("descricao = %s")
            params.append(descricao)
        if clear_categoria:
            sets.append("categoria_id = NULL")
        elif categoria_id is not None:
            sets.append("categoria_id = %s")
            params.append(categoria_id)
        if unidade is not None:
            sets.append("unidade = %s")
            params.append(unidade.strip() or "un")
        if papel_link is not None:
            sets.append("papel_link = %s")
            params.append(papel_link)
        if estoque_minimo is not None:
            sets.append("estoque_minimo = %s")
            params.append(float(estoque_minimo))
        if ativo is not None:
            sets.append("ativo = %s")
            params.append(1 if ativo else 0)
        params.append(sku_id)
        cursor.execute(
            f"UPDATE tab_estoque_sku SET {', '.join(sets)} WHERE id = %s",
            params,
        )
        return sku_id

    db.execute_transaction([_tx])
    if estoque_minimo is not None:
        _maybe_notify_low_stock(sku_id)
    sku = get_sku(sku_id, include_cost=True)
    assert sku is not None
    return sku


def registrar_entrada(
    *,
    sku_id: int,
    quantidade: float,
    custo_unitario: float | None,
    motivo: str | None,
    ponto: str,
    os_nro: int | None = None,
    os_ano: int | None = None,
) -> dict:
    qtd = _dec(quantidade)
    if qtd <= 0:
        raise ValueError("Quantidade de entrada deve ser positiva")
    custo = _dec(custo_unitario) if custo_unitario is not None else None

    def _tx(cursor):
        cursor.execute("SELECT id, custo_medio FROM tab_estoque_sku WHERE id = %s FOR UPDATE", (sku_id,))
        sku = cursor.fetchone()
        if not sku:
            raise ValueError("SKU não encontrado")
        saldo = _lock_saldo(cursor, sku_id)
        qtd_antes = _dec(saldo["quantidade"])
        unit = custo if custo is not None else _dec(sku["custo_medio"])
        if custo is not None and custo >= 0:
            if qtd_antes <= 0:
                novo_medio = unit
            else:
                novo_medio = ((qtd_antes * _dec(sku["custo_medio"])) + (qtd * unit)) / (qtd_antes + qtd)
            cursor.execute(
                "UPDATE tab_estoque_sku SET custo_medio = %s, ultimo_custo = %s WHERE id = %s",
                (_f(novo_medio), _f(unit), sku_id),
            )
        nova_qtd = qtd_antes + qtd
        cursor.execute(
            "UPDATE tab_estoque_saldo SET quantidade = %s WHERE sku_id = %s",
            (_f(nova_qtd), sku_id),
        )
        mov_id = _insert_movimento(
            cursor,
            sku_id=sku_id,
            tipo="entrada",
            quantidade=qtd,
            custo_unitario=unit,
            saldo_apos=nova_qtd,
            motivo=motivo,
            ponto=ponto,
            os_nro=os_nro,
            os_ano=os_ano,
        )
        return mov_id

    mov_id = int(db.execute_transaction([_tx])[0])
    _maybe_notify_low_stock(sku_id)
    return {"movimento_id": mov_id, "sku": get_sku(sku_id, include_cost=True)}


def registrar_saida(
    *,
    sku_id: int,
    quantidade: float,
    motivo: str | None,
    ponto: str,
    os_nro: int | None = None,
    os_ano: int | None = None,
) -> dict:
    qtd = _dec(quantidade)
    if qtd <= 0:
        raise ValueError("Quantidade de saída deve ser positiva")

    def _tx(cursor):
        cursor.execute("SELECT id, custo_medio FROM tab_estoque_sku WHERE id = %s FOR UPDATE", (sku_id,))
        sku = cursor.fetchone()
        if not sku:
            raise ValueError("SKU não encontrado")
        saldo = _lock_saldo(cursor, sku_id)
        qtd_antes = _dec(saldo["quantidade"])
        reservado = _dec(saldo["reservado"])
        disponivel = qtd_antes - reservado
        if qtd > disponivel:
            raise ValueError(
                f"Disponível insuficiente ({_f(disponivel)}); solicitado {_f(qtd)}"
            )
        nova_qtd = qtd_antes - qtd
        unit = _dec(sku["custo_medio"])
        cursor.execute(
            "UPDATE tab_estoque_saldo SET quantidade = %s WHERE sku_id = %s",
            (_f(nova_qtd), sku_id),
        )
        mov_id = _insert_movimento(
            cursor,
            sku_id=sku_id,
            tipo="saida",
            quantidade=-qtd,
            custo_unitario=unit,
            saldo_apos=nova_qtd,
            motivo=motivo,
            ponto=ponto,
            os_nro=os_nro,
            os_ano=os_ano,
        )
        return mov_id

    mov_id = int(db.execute_transaction([_tx])[0])
    _maybe_notify_low_stock(sku_id)
    return {"movimento_id": mov_id, "sku": get_sku(sku_id, include_cost=True)}


def registrar_ajuste(
    *,
    sku_id: int,
    quantidade_nova: float,
    motivo: str,
    ponto: str,
) -> dict:
    if not (motivo or "").strip():
        raise ValueError("Motivo do ajuste é obrigatório")
    nova = _dec(quantidade_nova)
    if nova < 0:
        raise ValueError("Quantidade não pode ser negativa")

    def _tx(cursor):
        cursor.execute("SELECT id, custo_medio FROM tab_estoque_sku WHERE id = %s FOR UPDATE", (sku_id,))
        sku = cursor.fetchone()
        if not sku:
            raise ValueError("SKU não encontrado")
        saldo = _lock_saldo(cursor, sku_id)
        qtd_antes = _dec(saldo["quantidade"])
        reservado = _dec(saldo["reservado"])
        if nova < reservado:
            raise ValueError(
                f"Quantidade ({_f(nova)}) não pode ser menor que o reservado ({_f(reservado)})"
            )
        delta = nova - qtd_antes
        cursor.execute(
            "UPDATE tab_estoque_saldo SET quantidade = %s WHERE sku_id = %s",
            (_f(nova), sku_id),
        )
        mov_id = _insert_movimento(
            cursor,
            sku_id=sku_id,
            tipo="ajuste",
            quantidade=delta,
            custo_unitario=_dec(sku["custo_medio"]),
            saldo_apos=nova,
            motivo=motivo.strip(),
            ponto=ponto,
        )
        return mov_id

    mov_id = int(db.execute_transaction([_tx])[0])
    _maybe_notify_low_stock(sku_id)
    return {"movimento_id": mov_id, "sku": get_sku(sku_id, include_cost=True)}


def list_movimentos(
    *,
    sku_id: int | None = None,
    tipo: str | None = None,
    pedido_id: int | None = None,
    solicitante_ponto: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    where = ["1=1"]
    params: dict[str, Any] = {"limit": int(limit), "offset": int(offset)}
    if sku_id:
        where.append("m.sku_id = %(sku_id)s")
        params["sku_id"] = int(sku_id)
    if tipo:
        where.append("m.tipo = %(tipo)s")
        params["tipo"] = tipo
    if pedido_id:
        where.append("m.pedido_id = %(pedido_id)s")
        params["pedido_id"] = int(pedido_id)
    if solicitante_ponto:
        where.append(
            """
            m.pedido_id IN (
                SELECT id FROM tab_estoque_pedido WHERE solicitante_ponto = %(solicitante)s
            )
            """
        )
        params["solicitante"] = _ponto_str(solicitante_ponto)
    where_sql = " AND ".join(where)
    count_rows = db.execute_query(
        f"SELECT COUNT(*) AS cnt FROM tab_estoque_movimento m WHERE {where_sql}",
        params,
    )
    total = int((count_rows or [{}])[0].get("cnt") or 0)
    rows = db.execute_query(
        f"""
        SELECT m.*, s.codigo AS sku_codigo, s.nome AS sku_nome
        FROM tab_estoque_movimento m
        INNER JOIN tab_estoque_sku s ON s.id = m.sku_id
        WHERE {where_sql}
        ORDER BY m.criado_em DESC, m.id DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        params,
    ) or []
    items = []
    for r in rows:
        items.append(
            {
                "id": int(r["id"]),
                "sku_id": int(r["sku_id"]),
                "sku_codigo": r.get("sku_codigo"),
                "sku_nome": r.get("sku_nome"),
                "tipo": r["tipo"],
                "quantidade": _f(_dec(r["quantidade"])),
                "custo_unitario": _f(_dec(r["custo_unitario"])),
                "custo_total": _f(_dec(r["custo_total"])),
                "saldo_apos": _f(_dec(r["saldo_apos"])),
                "motivo": r.get("motivo"),
                "pedido_id": int(r["pedido_id"]) if r.get("pedido_id") else None,
                "referencia_os_nro": r.get("referencia_os_nro"),
                "referencia_os_ano": r.get("referencia_os_ano"),
                "ponto": r.get("ponto"),
                "criado_em": r["criado_em"].isoformat(sep=" ") if r.get("criado_em") else None,
            }
        )
    return items, total


def _pedido_items(pedido_id: int) -> list[dict]:
    rows = db.execute_query(
        """
        SELECT i.*, s.codigo AS sku_codigo, s.nome AS sku_nome, s.unidade
        FROM tab_estoque_pedido_item i
        INNER JOIN tab_estoque_sku s ON s.id = i.sku_id
        WHERE i.pedido_id = %s
        ORDER BY i.id
        """,
        (pedido_id,),
    ) or []
    return [
        {
            "id": int(r["id"]),
            "sku_id": int(r["sku_id"]),
            "sku_codigo": r.get("sku_codigo"),
            "sku_nome": r.get("sku_nome"),
            "unidade": r.get("unidade"),
            "qtd_solicitada": _f(_dec(r["qtd_solicitada"])),
            "qtd_atendida": _f(_dec(r["qtd_atendida"])),
            "custo_unitario_snapshot": (
                _f(_dec(r["custo_unitario_snapshot"]))
                if r.get("custo_unitario_snapshot") is not None
                else None
            ),
        }
        for r in rows
    ]


def _pedido_dict(row: dict) -> dict:
    pid = int(row["id"])
    return {
        "id": pid,
        "status": row["status"],
        "solicitante_ponto": row["solicitante_ponto"],
        "observacao": row.get("observacao"),
        "os_nro": row.get("os_nro"),
        "os_ano": row.get("os_ano"),
        "atendido_por": row.get("atendido_por"),
        "atendido_em": row["atendido_em"].isoformat(sep=" ") if row.get("atendido_em") else None,
        "motivo_recusa": row.get("motivo_recusa"),
        "criado_em": row["criado_em"].isoformat(sep=" ") if row.get("criado_em") else None,
        "itens": _pedido_items(pid),
    }


def get_pedido(pedido_id: int) -> Optional[dict]:
    rows = db.execute_query(
        "SELECT * FROM tab_estoque_pedido WHERE id = %s",
        (pedido_id,),
    )
    if not rows:
        return None
    return _pedido_dict(rows[0])


def list_pedidos(
    *,
    status: str | None = None,
    solicitante_ponto: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    where = ["1=1"]
    params: dict[str, Any] = {"limit": int(limit), "offset": int(offset)}
    if status:
        where.append("status = %(status)s")
        params["status"] = status
    if solicitante_ponto:
        where.append("solicitante_ponto = %(solicitante)s")
        params["solicitante"] = _ponto_str(solicitante_ponto)
    where_sql = " AND ".join(where)
    count_rows = db.execute_query(
        f"SELECT COUNT(*) AS cnt FROM tab_estoque_pedido WHERE {where_sql}",
        params,
    )
    total = int((count_rows or [{}])[0].get("cnt") or 0)
    rows = db.execute_query(
        f"""
        SELECT * FROM tab_estoque_pedido
        WHERE {where_sql}
        ORDER BY criado_em DESC, id DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        params,
    ) or []
    return [_pedido_dict(r) for r in rows], total


def criar_pedido(
    *,
    solicitante_ponto: str,
    itens: list[dict],
    observacao: str | None = None,
    os_nro: int | None = None,
    os_ano: int | None = None,
) -> dict:
    if not itens:
        raise ValueError("Pedido precisa de ao menos um item")
    ponto = _ponto_str(solicitante_ponto)
    if not ponto:
        raise ValueError("Solicitante inválido")

    normalized: list[tuple[int, Decimal]] = []
    for item in itens:
        sku_id = int(item["sku_id"])
        qtd = _dec(item.get("quantidade") or item.get("qtd_solicitada"))
        if qtd <= 0:
            raise ValueError("Quantidade do item deve ser positiva")
        normalized.append((sku_id, qtd))

    # Aggregate same SKU
    merged: dict[int, Decimal] = {}
    for sku_id, qtd in normalized:
        merged[sku_id] = merged.get(sku_id, D("0")) + qtd

    def _tx(cursor):
        for sku_id, qtd in merged.items():
            cursor.execute(
                "SELECT id, ativo FROM tab_estoque_sku WHERE id = %s FOR UPDATE",
                (sku_id,),
            )
            sku = cursor.fetchone()
            if not sku or not sku.get("ativo"):
                raise ValueError(f"SKU {sku_id} indisponível")
            saldo = _lock_saldo(cursor, sku_id)
            disponivel = _dec(saldo["quantidade"]) - _dec(saldo["reservado"])
            if qtd > disponivel:
                raise ValueError(
                    f"SKU {sku_id}: disponível {_f(disponivel)}, solicitado {_f(qtd)}"
                )

        cursor.execute(
            """
            INSERT INTO tab_estoque_pedido (
                status, solicitante_ponto, observacao, os_nro, os_ano
            ) VALUES ('pendente', %s, %s, %s, %s)
            """,
            (ponto, observacao, os_nro, os_ano),
        )
        pedido_id = int(cursor.lastrowid)

        for sku_id, qtd in merged.items():
            cursor.execute(
                """
                INSERT INTO tab_estoque_pedido_item (
                    pedido_id, sku_id, qtd_solicitada, qtd_atendida
                ) VALUES (%s, %s, %s, 0)
                """,
                (pedido_id, sku_id, _f(qtd)),
            )
            saldo = _lock_saldo(cursor, sku_id)
            novo_res = _dec(saldo["reservado"]) + qtd
            cursor.execute(
                "UPDATE tab_estoque_saldo SET reservado = %s WHERE sku_id = %s",
                (_f(novo_res), sku_id),
            )
            _insert_movimento(
                cursor,
                sku_id=sku_id,
                tipo="reserva",
                quantidade=qtd,
                custo_unitario=D("0"),
                saldo_apos=_dec(saldo["quantidade"]),
                motivo=f"Reserva pedido #{pedido_id}",
                ponto=ponto,
                pedido_id=pedido_id,
                os_nro=os_nro,
                os_ano=os_ano,
            )
        return pedido_id

    pedido_id = int(db.execute_transaction([_tx])[0])
    pedido = get_pedido(pedido_id)
    assert pedido is not None
    return pedido


def cancelar_pedido(*, pedido_id: int, ponto: str, is_gerente: bool) -> dict:
    def _tx(cursor):
        cursor.execute(
            "SELECT * FROM tab_estoque_pedido WHERE id = %s FOR UPDATE",
            (pedido_id,),
        )
        pedido = cursor.fetchone()
        if not pedido:
            raise ValueError("Pedido não encontrado")
        if pedido["status"] != "pendente":
            raise ValueError("Só é possível cancelar pedidos pendentes")
        if not is_gerente and _ponto_str(pedido["solicitante_ponto"]) != _ponto_str(ponto):
            raise PermissionError("Só o solicitante ou o gerente pode cancelar")
        cursor.execute(
            "SELECT * FROM tab_estoque_pedido_item WHERE pedido_id = %s",
            (pedido_id,),
        )
        items = cursor.fetchall() or []
        for item in items:
            sku_id = int(item["sku_id"])
            qtd = _dec(item["qtd_solicitada"])
            saldo = _lock_saldo(cursor, sku_id)
            novo_res = _dec(saldo["reservado"]) - qtd
            if novo_res < 0:
                novo_res = D("0")
            cursor.execute(
                "UPDATE tab_estoque_saldo SET reservado = %s WHERE sku_id = %s",
                (_f(novo_res), sku_id),
            )
            _insert_movimento(
                cursor,
                sku_id=sku_id,
                tipo="estorno_reserva",
                quantidade=-qtd,
                custo_unitario=D("0"),
                saldo_apos=_dec(saldo["quantidade"]),
                motivo=f"Cancelamento pedido #{pedido_id}",
                ponto=_ponto_str(ponto),
                pedido_id=pedido_id,
            )
        cursor.execute(
            "UPDATE tab_estoque_pedido SET status = 'cancelado' WHERE id = %s",
            (pedido_id,),
        )
        return pedido_id

    try:
        db.execute_transaction([_tx])
    except PermissionError:
        raise
    pedido = get_pedido(pedido_id)
    assert pedido is not None
    return pedido


def recusar_pedido(*, pedido_id: int, ponto: str, motivo: str | None) -> dict:
    def _tx(cursor):
        cursor.execute(
            "SELECT * FROM tab_estoque_pedido WHERE id = %s FOR UPDATE",
            (pedido_id,),
        )
        pedido = cursor.fetchone()
        if not pedido:
            raise ValueError("Pedido não encontrado")
        if pedido["status"] != "pendente":
            raise ValueError("Só é possível recusar pedidos pendentes")
        cursor.execute(
            "SELECT * FROM tab_estoque_pedido_item WHERE pedido_id = %s",
            (pedido_id,),
        )
        items = cursor.fetchall() or []
        for item in items:
            sku_id = int(item["sku_id"])
            qtd = _dec(item["qtd_solicitada"])
            saldo = _lock_saldo(cursor, sku_id)
            novo_res = _dec(saldo["reservado"]) - qtd
            if novo_res < 0:
                novo_res = D("0")
            cursor.execute(
                "UPDATE tab_estoque_saldo SET reservado = %s WHERE sku_id = %s",
                (_f(novo_res), sku_id),
            )
            _insert_movimento(
                cursor,
                sku_id=sku_id,
                tipo="estorno_reserva",
                quantidade=-qtd,
                custo_unitario=D("0"),
                saldo_apos=_dec(saldo["quantidade"]),
                motivo=f"Recusa pedido #{pedido_id}",
                ponto=_ponto_str(ponto),
                pedido_id=pedido_id,
            )
        cursor.execute(
            """
            UPDATE tab_estoque_pedido
            SET status = 'recusado', motivo_recusa = %s, atendido_por = %s, atendido_em = NOW()
            WHERE id = %s
            """,
            (motivo, _ponto_str(ponto), pedido_id),
        )
        return pedido_id

    db.execute_transaction([_tx])
    pedido = get_pedido(pedido_id)
    assert pedido is not None
    return pedido


def atender_pedido(*, pedido_id: int, ponto: str) -> dict:
    affected_skus: list[int] = []

    def _tx(cursor):
        cursor.execute(
            "SELECT * FROM tab_estoque_pedido WHERE id = %s FOR UPDATE",
            (pedido_id,),
        )
        pedido = cursor.fetchone()
        if not pedido:
            raise ValueError("Pedido não encontrado")
        if pedido["status"] != "pendente":
            raise ValueError("Só é possível atender pedidos pendentes")
        cursor.execute(
            "SELECT * FROM tab_estoque_pedido_item WHERE pedido_id = %s",
            (pedido_id,),
        )
        items = cursor.fetchall() or []
        os_nro = pedido.get("os_nro")
        os_ano = pedido.get("os_ano")
        for item in items:
            sku_id = int(item["sku_id"])
            qtd = _dec(item["qtd_solicitada"])
            cursor.execute(
                "SELECT id, custo_medio FROM tab_estoque_sku WHERE id = %s FOR UPDATE",
                (sku_id,),
            )
            sku = cursor.fetchone()
            if not sku:
                raise ValueError(f"SKU {sku_id} não encontrado")
            saldo = _lock_saldo(cursor, sku_id)
            qtd_antes = _dec(saldo["quantidade"])
            reservado = _dec(saldo["reservado"])
            if qtd > qtd_antes:
                raise ValueError(
                    f"Saldo físico insuficiente no SKU {sku_id} ({_f(qtd_antes)})"
                )
            nova_qtd = qtd_antes - qtd
            novo_res = reservado - qtd
            if novo_res < 0:
                novo_res = D("0")
            unit = _dec(sku["custo_medio"])
            cursor.execute(
                "UPDATE tab_estoque_saldo SET quantidade = %s, reservado = %s WHERE sku_id = %s",
                (_f(nova_qtd), _f(novo_res), sku_id),
            )
            cursor.execute(
                """
                UPDATE tab_estoque_pedido_item
                SET qtd_atendida = %s, custo_unitario_snapshot = %s
                WHERE id = %s
                """,
                (_f(qtd), _f(unit), int(item["id"])),
            )
            _insert_movimento(
                cursor,
                sku_id=sku_id,
                tipo="consumo",
                quantidade=-qtd,
                custo_unitario=unit,
                saldo_apos=nova_qtd,
                motivo=f"Atendimento pedido #{pedido_id}",
                ponto=_ponto_str(ponto),
                pedido_id=pedido_id,
                os_nro=os_nro,
                os_ano=os_ano,
            )
            affected_skus.append(sku_id)
        cursor.execute(
            """
            UPDATE tab_estoque_pedido
            SET status = 'atendido', atendido_por = %s, atendido_em = NOW()
            WHERE id = %s
            """,
            (_ponto_str(ponto), pedido_id),
        )
        return pedido_id

    db.execute_transaction([_tx])
    for sku_id in affected_skus:
        _maybe_notify_low_stock(sku_id)
    pedido = get_pedido(pedido_id)
    assert pedido is not None
    return pedido


def list_alertas() -> list[dict]:
    rows = db.execute_query(
        """
        SELECT s.*, c.nome AS categoria_nome,
               COALESCE(sal.quantidade, 0) AS quantidade,
               COALESCE(sal.reservado, 0) AS reservado
        FROM tab_estoque_sku s
        LEFT JOIN tab_estoque_categoria c ON c.id = s.categoria_id
        LEFT JOIN tab_estoque_saldo sal ON sal.sku_id = s.id
        WHERE s.ativo = 1
          AND COALESCE(sal.quantidade, 0) <= s.estoque_minimo
        ORDER BY s.nome
        """
    ) or []
    return [_sku_row_to_dict(r, include_cost=True) for r in rows]


def get_resumo() -> dict:
    rows = db.execute_query(
        """
        SELECT
            COUNT(*) AS total_skus,
            SUM(CASE WHEN s.ativo = 1 THEN 1 ELSE 0 END) AS skus_ativos,
            SUM(
                CASE
                    WHEN s.ativo = 1 AND COALESCE(sal.quantidade, 0) <= s.estoque_minimo
                    THEN 1 ELSE 0
                END
            ) AS alertas,
            COALESCE(SUM(
                CASE WHEN s.ativo = 1
                THEN COALESCE(sal.quantidade, 0) * s.custo_medio ELSE 0 END
            ), 0) AS valor_estoque
        FROM tab_estoque_sku s
        LEFT JOIN tab_estoque_saldo sal ON sal.sku_id = s.id
        """
    )
    pend = db.execute_query(
        "SELECT COUNT(*) AS cnt FROM tab_estoque_pedido WHERE status = 'pendente'"
    )
    row = (rows or [{}])[0]
    return {
        "total_skus": int(row.get("total_skus") or 0),
        "skus_ativos": int(row.get("skus_ativos") or 0),
        "alertas": int(row.get("alertas") or 0),
        "pedidos_pendentes": int((pend or [{}])[0].get("cnt") or 0),
        "valor_estoque": _f(_dec(row.get("valor_estoque"))),
    }


def _list_gerente_pontos() -> list[str]:
    """Pontos com sb_estoque_gerente na overlay de usuário (quando existir)."""
    try:
        rows = db.execute_query(
            """
            SELECT Ponto FROM user_permissions
            WHERE sb_estoque_gerente = 1
            """
        ) or []
        return [_ponto_str(r["Ponto"]) for r in rows if r.get("Ponto") is not None]
    except Exception as exc:
        logger.debug("list gerente pontos: %s", exc)
        return []


def _maybe_notify_low_stock(sku_id: int) -> None:
    sku = get_sku(sku_id, include_cost=True)
    if not sku or not sku.get("alerta_baixo"):
        return
    mensagem = (
        f"Estoque baixo: {sku['codigo']} — {sku['nome']} "
        f"(saldo {sku['quantidade']} / mín. {sku['estoque_minimo']})"
    )
    try:
        from services.notification_push_service import (
            insert_user_notification,
            push_user_notification,
        )

        for ponto in _list_gerente_pontos():
            if not ponto:
                continue
            nid = insert_user_notification(
                ponto=ponto,
                nro=0,
                ano=0,
                mensagem=mensagem,
                detalhes_json=None,
            )
            push_user_notification(
                target_ponto=ponto,
                mensagem=mensagem,
                nro=0,
                ano=0,
                notification_id=nid,
            )
    except Exception as exc:
        logger.warning("Falha ao notificar estoque baixo SKU %s: %s", sku_id, exc)

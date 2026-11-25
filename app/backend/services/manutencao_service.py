"""
Módulo Manutenção — máquinas da Gráfica, manutenções recorrentes e pedidos.

Fluxo do pedido: fila → em_execucao ⇄ pausado → concluido (ou cancelado).
A fila é ordenada por `posicao_fila` (gerência reordena); novos pedidos entram
após o último pedido de prioridade igual ou maior.
MySQL-only (sem dual-write MDB).
"""
from __future__ import annotations

import json
import logging
import threading
import re
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

from database import db
from manutencao_schema import ensure_manutencao_schema, format_codigo_maquina

logger = logging.getLogger(__name__)

PRIORIDADES: tuple[str, ...] = ("urgente", "alta", "normal", "baixa")
PRIORIDADE_RANK: dict[str, int] = {p: i for i, p in enumerate(PRIORIDADES)}
PRIORIDADE_LABEL: dict[str, str] = {
    "urgente": "Urgente",
    "alta": "Alta",
    "normal": "Normal",
    "baixa": "Baixa",
}

STATUS_FILA = "fila"
STATUS_EXECUCAO = "em_execucao"
STATUS_PAUSADO = "pausado"
STATUS_CONCLUIDO = "concluido"
STATUS_CANCELADO = "cancelado"
STATUS_ABERTOS: tuple[str, ...] = (STATUS_FILA, STATUS_EXECUCAO, STATUS_PAUSADO)
STATUS_TODOS: tuple[str, ...] = STATUS_ABERTOS + (STATUS_CONCLUIDO, STATUS_CANCELADO)

MAX_PASSOS = 60
MAX_PASSO_LEN = 1000
VENCE_EM_BREVE_DIAS = 7
_CODIGO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")


class ManutencaoConflict(Exception):
    """Estado mudou (ex.: outro operador iniciou o mesmo pedido)."""


class ManutencaoNotFound(Exception):
    pass


# --------------------------------------------------------------------- utils


def _ensure() -> None:
    ensure_manutencao_schema()


def _clean_text(value: Any, max_len: int | None = None) -> str:
    text = str(value or "").strip()
    if max_len is not None:
        text = text[:max_len]
    return text


def _opt_text(value: Any, max_len: int | None = None) -> Optional[str]:
    text = _clean_text(value, max_len)
    return text or None


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _ponto_str(value: Any) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def normalize_prioridade(value: Any) -> str:
    p = _clean_text(value).lower()
    if p not in PRIORIDADE_RANK:
        raise ValueError("Prioridade inválida (use urgente, alta, normal ou baixa)")
    return p


def parse_passos(raw: Any) -> list[str]:
    """Lê passos (JSON list[str] no banco ou lista vinda da API)."""
    if raw is None or raw == "":
        return []
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return [raw.strip()] if raw.strip() else []
    if not isinstance(data, list):
        return []
    out: list[str] = []
    for item in data:
        if isinstance(item, dict):
            item = item.get("texto")
        text = _clean_text(item, MAX_PASSO_LEN)
        if text:
            out.append(text)
    return out[:MAX_PASSOS]


def _dump_passos(passos: Iterable[Any] | None) -> Optional[str]:
    if passos is None:
        return None
    clean = parse_passos(list(passos))
    return json.dumps(clean, ensure_ascii=False)


def _nomes_por_ponto(pontos: Iterable[Any]) -> dict[str, str]:
    keys = sorted({p for p in (_ponto_str(x) for x in pontos) if p})
    if not keys:
        return {}
    try:
        placeholders = ", ".join(["%s"] * len(keys))
        rows = db.execute_query(
            f"SELECT Ponto, Nome FROM tabUsuarios WHERE Ponto IN ({placeholders})",
            tuple(keys),
        ) or []
    except Exception as exc:  # pragma: no cover - lookup é cosmético
        logger.debug("Manutenção: lookup nomes falhou: %s", exc)
        return {}
    return {
        _ponto_str(r.get("Ponto")): _clean_text(r.get("Nome"))
        for r in rows
        if r.get("Ponto") is not None
    }


def _with_names(items: list[dict[str, Any]], fields: tuple[str, ...]) -> None:
    pontos = [it.get(f) for it in items for f in fields]
    names = _nomes_por_ponto(pontos)
    for it in items:
        for f in fields:
            it[f"{f}_nome"] = names.get(_ponto_str(it.get(f))) or None


# ------------------------------------------------------------------ máquinas


def _serialize_maquina(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "codigo": str(row.get("codigo") or ""),
        "nome": str(row.get("nome") or ""),
        "setor": row.get("setor"),
        "fabricante": row.get("fabricante"),
        "modelo": row.get("modelo"),
        "numero_serie": row.get("numero_serie"),
        "observacoes": row.get("observacoes"),
        "ativo": bool(row.get("ativo")),
        "ordem": int(row.get("ordem") or 0),
        "atualizado_em": _iso(row.get("atualizado_em")),
        "pedidos_abertos": int(row.get("pedidos_abertos") or 0),
        "em_execucao": int(row.get("em_execucao") or 0),
        "parada": bool(int(row.get("parada") or 0)),
        "ultima_manutencao": _iso(row.get("ultima_manutencao")),
        "total_concluidas": int(row.get("total_concluidas") or 0),
    }


_MAQUINA_SELECT = """
    SELECT m.*,
        (SELECT COUNT(*) FROM tab_manutencao_pedido p
            WHERE p.maquina_id = m.id AND p.status IN ('fila','em_execucao','pausado')) AS pedidos_abertos,
        (SELECT COUNT(*) FROM tab_manutencao_pedido p
            WHERE p.maquina_id = m.id AND p.status IN ('em_execucao','pausado')) AS em_execucao,
        (SELECT COUNT(*) FROM tab_manutencao_pedido p
            WHERE p.maquina_id = m.id AND p.maquina_parada = 1
              AND p.status IN ('fila','em_execucao','pausado')) AS parada,
        (SELECT MAX(p.concluido_em) FROM tab_manutencao_pedido p
            WHERE p.maquina_id = m.id AND p.status = 'concluido') AS ultima_manutencao,
        (SELECT COUNT(*) FROM tab_manutencao_pedido p
            WHERE p.maquina_id = m.id AND p.status = 'concluido') AS total_concluidas
    FROM tab_manutencao_maquina m
"""


def list_maquinas(include_inactive: bool = False) -> list[dict[str, Any]]:
    _ensure()
    where = "" if include_inactive else "WHERE m.ativo = 1"
    rows = db.execute_query(
        f"{_MAQUINA_SELECT} {where} ORDER BY m.nome ASC, m.codigo ASC"
    ) or []
    return [_serialize_maquina(r) for r in rows]


def get_maquina(maquina_id: int) -> dict[str, Any]:
    _ensure()
    rows = db.execute_query(f"{_MAQUINA_SELECT} WHERE m.id = %s", (int(maquina_id),)) or []
    if not rows:
        raise ManutencaoNotFound("Máquina não encontrada")
    return _serialize_maquina(rows[0])


def get_maquina_por_codigo(codigo: str) -> dict[str, Any]:
    _ensure()
    rows = db.execute_query(
        f"{_MAQUINA_SELECT} WHERE m.codigo = %s", (_clean_text(codigo).upper(),)
    ) or []
    if not rows:
        raise ManutencaoNotFound("Máquina não encontrada")
    return _serialize_maquina(rows[0])


def _next_codigo() -> str:
    rows = db.execute_query("SELECT codigo FROM tab_manutencao_maquina") or []
    max_seq = 0
    for r in rows:
        m = re.match(r"^MAQ-(\d+)$", str(r.get("codigo") or ""))
        if m:
            max_seq = max(max_seq, int(m.group(1)))
    return format_codigo_maquina(max_seq + 1)


def _validate_codigo(codigo: str, exclude_id: Optional[int] = None) -> str:
    code = _clean_text(codigo).upper()
    if not _CODIGO_RE.match(code):
        raise ValueError("Código inválido: use letras, números, ponto, hífen ou _ (até 32)")
    rows = db.execute_query(
        "SELECT id FROM tab_manutencao_maquina WHERE codigo = %s", (code,)
    ) or []
    if any(int(r["id"]) != int(exclude_id or 0) for r in rows):
        raise ValueError(f"Já existe máquina com o código {code}")
    return code


_MAQUINA_FIELDS = ("setor", "fabricante", "modelo", "numero_serie", "observacoes")


def create_maquina(data: dict[str, Any], ponto: str) -> dict[str, Any]:
    _ensure()
    nome = _clean_text(data.get("nome"), 160)
    if not nome:
        raise ValueError("Informe o nome da máquina")
    codigo = data.get("codigo")
    codigo = _validate_codigo(codigo) if _clean_text(codigo) else _next_codigo()
    ordem = data.get("ordem")
    if ordem is None:
        rows = db.execute_query("SELECT COALESCE(MAX(ordem), 0) AS m FROM tab_manutencao_maquina") or [{}]
        ordem = int(rows[0].get("m") or 0) + 10
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tab_manutencao_maquina
                (codigo, nome, setor, fabricante, modelo, numero_serie, observacoes, ativo, ordem, atualizado_por)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                codigo,
                nome,
                _opt_text(data.get("setor"), 80),
                _opt_text(data.get("fabricante"), 120),
                _opt_text(data.get("modelo"), 120),
                _opt_text(data.get("numero_serie"), 120),
                _opt_text(data.get("observacoes")),
                1 if data.get("ativo", True) else 0,
                int(ordem),
                ponto,
            ),
        )
        new_id = int(cursor.lastrowid)
    _broadcast("maquina_criada")
    return get_maquina(new_id)


def update_maquina(maquina_id: int, data: dict[str, Any], ponto: str) -> dict[str, Any]:
    _ensure()
    get_maquina(maquina_id)
    sets: list[str] = []
    vals: list[Any] = []
    if "nome" in data and data["nome"] is not None:
        nome = _clean_text(data["nome"], 160)
        if not nome:
            raise ValueError("Informe o nome da máquina")
        sets.append("nome = %s")
        vals.append(nome)
    if "codigo" in data and data["codigo"] is not None:
        sets.append("codigo = %s")
        vals.append(_validate_codigo(data["codigo"], exclude_id=maquina_id))
    limits = {"setor": 80, "fabricante": 120, "modelo": 120, "numero_serie": 120, "observacoes": None}
    for f in _MAQUINA_FIELDS:
        if f in data and data[f] is not None:
            sets.append(f"{f} = %s")
            vals.append(_opt_text(data[f], limits[f]))
    if "ativo" in data and data["ativo"] is not None:
        sets.append("ativo = %s")
        vals.append(1 if data["ativo"] else 0)
    if "ordem" in data and data["ordem"] is not None:
        sets.append("ordem = %s")
        vals.append(int(data["ordem"]))
    if sets:
        sets.append("atualizado_por = %s")
        vals.append(ponto)
        vals.append(int(maquina_id))
        db.execute_query(
            f"UPDATE tab_manutencao_maquina SET {', '.join(sets)} WHERE id = %s",
            tuple(vals),
        )
        _broadcast("maquina_atualizada")
    return get_maquina(maquina_id)


# ---------------------------------------------------------------- recorrentes


def _situacao_recorrente(
    periodicidade: Optional[int],
    maquina_id: Optional[int],
    ultima: Optional[datetime],
    em_aberto: bool,
    hoje: Optional[date] = None,
) -> tuple[Optional[str], Optional[str], Optional[int]]:
    """(situacao, proxima_em ISO, dias_restantes) para preventivas periódicas."""
    if not periodicidade or not maquina_id:
        return None, None, None
    if em_aberto:
        return "em_aberto", None, None
    if ultima is None:
        return "sem_historico", None, None
    hoje = hoje or date.today()
    base = ultima.date() if isinstance(ultima, datetime) else ultima
    proxima = base + timedelta(days=int(periodicidade))
    dias = (proxima - hoje).days
    if dias < 0:
        situacao = "vencida"
    elif dias <= VENCE_EM_BREVE_DIAS:
        situacao = "vence_em_breve"
    else:
        situacao = "em_dia"
    return situacao, proxima.isoformat(), dias


def _serialize_recorrente(row: dict[str, Any]) -> dict[str, Any]:
    periodicidade = int(row["periodicidade_dias"]) if row.get("periodicidade_dias") else None
    maquina_id = int(row["maquina_id"]) if row.get("maquina_id") is not None else None
    ultima = row.get("ultima_execucao")
    situacao, proxima, dias = _situacao_recorrente(
        periodicidade, maquina_id, ultima, bool(int(row.get("abertos") or 0))
    )
    return {
        "id": int(row["id"]),
        "titulo": str(row.get("titulo") or ""),
        "descricao": row.get("descricao"),
        "maquina_id": maquina_id,
        "maquina_nome": row.get("maquina_nome"),
        "maquina_codigo": row.get("maquina_codigo"),
        "periodicidade_dias": periodicidade,
        "prioridade_padrao": str(row.get("prioridade_padrao") or "normal"),
        "ativo": bool(row.get("ativo")),
        "ultima_execucao": _iso(ultima),
        "proxima_em": proxima,
        "dias_restantes": dias,
        "situacao": situacao,
        "total_execucoes": int(row.get("total_execucoes") or 0),
    }


_RECORRENTE_SELECT = """
    SELECT r.*, m.nome AS maquina_nome, m.codigo AS maquina_codigo,
        (SELECT MAX(p.concluido_em) FROM tab_manutencao_pedido p
            WHERE p.recorrente_id = r.id AND p.status = 'concluido'
              AND (r.maquina_id IS NULL OR p.maquina_id = r.maquina_id)) AS ultima_execucao,
        (SELECT COUNT(*) FROM tab_manutencao_pedido p
            WHERE p.recorrente_id = r.id AND p.status = 'concluido') AS total_execucoes,
        (SELECT COUNT(*) FROM tab_manutencao_pedido p
            WHERE p.recorrente_id = r.id AND p.status IN ('fila','em_execucao','pausado')
              AND (r.maquina_id IS NULL OR p.maquina_id = r.maquina_id)) AS abertos
    FROM tab_manutencao_recorrente r
    LEFT JOIN tab_manutencao_maquina m ON m.id = r.maquina_id
"""


def list_recorrentes(include_inactive: bool = False) -> list[dict[str, Any]]:
    _ensure()
    where = "" if include_inactive else "WHERE r.ativo = 1"
    rows = db.execute_query(
        f"{_RECORRENTE_SELECT} {where} ORDER BY r.titulo ASC"
    ) or []
    return [_serialize_recorrente(r) for r in rows]


def get_recorrente(rec_id: int) -> dict[str, Any]:
    _ensure()
    rows = db.execute_query(f"{_RECORRENTE_SELECT} WHERE r.id = %s", (int(rec_id),)) or []
    if not rows:
        raise ManutencaoNotFound("Manutenção recorrente não encontrada")
    return _serialize_recorrente(rows[0])


def _validate_periodicidade(value: Any) -> Optional[int]:
    if value in (None, "", 0):
        return None
    dias = int(value)
    if dias < 1 or dias > 3650:
        raise ValueError("Periodicidade deve estar entre 1 e 3650 dias")
    return dias


def create_recorrente(data: dict[str, Any], ponto: str) -> dict[str, Any]:
    _ensure()
    titulo = _clean_text(data.get("titulo"), 200)
    if not titulo:
        raise ValueError("Informe o título da manutenção recorrente")
    maquina_id = data.get("maquina_id")
    if maquina_id:
        get_maquina(int(maquina_id))
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO tab_manutencao_recorrente
                (titulo, descricao, maquina_id, periodicidade_dias, prioridade_padrao, ativo, criado_por)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                titulo,
                _opt_text(data.get("descricao")),
                int(maquina_id) if maquina_id else None,
                _validate_periodicidade(data.get("periodicidade_dias")),
                normalize_prioridade(data.get("prioridade_padrao") or "normal"),
                1 if data.get("ativo", True) else 0,
                ponto,
            ),
        )
        new_id = int(cursor.lastrowid)
    _broadcast("recorrente_criada")
    return get_recorrente(new_id)


def update_recorrente(rec_id: int, data: dict[str, Any], ponto: str) -> dict[str, Any]:
    _ensure()
    get_recorrente(rec_id)
    sets: list[str] = []
    vals: list[Any] = []
    if data.get("titulo") is not None:
        titulo = _clean_text(data["titulo"], 200)
        if not titulo:
            raise ValueError("Informe o título da manutenção recorrente")
        sets.append("titulo = %s")
        vals.append(titulo)
    if data.get("descricao") is not None:
        sets.append("descricao = %s")
        vals.append(_opt_text(data["descricao"]))
    if data.get("clear_maquina"):
        sets.append("maquina_id = NULL")
    elif data.get("maquina_id") is not None:
        get_maquina(int(data["maquina_id"]))
        sets.append("maquina_id = %s")
        vals.append(int(data["maquina_id"]))
    if data.get("clear_periodicidade"):
        sets.append("periodicidade_dias = NULL")
    elif data.get("periodicidade_dias") is not None:
        sets.append("periodicidade_dias = %s")
        vals.append(_validate_periodicidade(data["periodicidade_dias"]))
    if data.get("prioridade_padrao") is not None:
        sets.append("prioridade_padrao = %s")
        vals.append(normalize_prioridade(data["prioridade_padrao"]))
    if data.get("ativo") is not None:
        sets.append("ativo = %s")
        vals.append(1 if data["ativo"] else 0)
    if sets:
        sets.append("atualizado_por = %s")
        vals.append(ponto)
        vals.append(int(rec_id))
        db.execute_query(
            f"UPDATE tab_manutencao_recorrente SET {', '.join(sets)} WHERE id = %s",
            tuple(vals),
        )
        _broadcast("recorrente_atualizada")
    return get_recorrente(rec_id)


# -------------------------------------------------------------------- pedidos


_PEDIDO_SELECT = """
    SELECT p.*, m.nome AS maquina_nome, m.codigo AS maquina_codigo, m.setor AS maquina_setor,
        r.titulo AS recorrente_titulo
    FROM tab_manutencao_pedido p
    JOIN tab_manutencao_maquina m ON m.id = p.maquina_id
    LEFT JOIN tab_manutencao_recorrente r ON r.id = p.recorrente_id
"""

_PONTO_FIELDS = ("solicitado_por", "iniciado_por", "concluido_por", "cancelado_por")


def _serialize_pedido(row: dict[str, Any]) -> dict[str, Any]:
    status = str(row.get("status") or STATUS_FILA)
    return {
        "id": int(row["id"]),
        "maquina_id": int(row["maquina_id"]),
        "maquina_nome": row.get("maquina_nome"),
        "maquina_codigo": row.get("maquina_codigo"),
        "maquina_setor": row.get("maquina_setor"),
        "recorrente_id": int(row["recorrente_id"]) if row.get("recorrente_id") else None,
        "recorrente_titulo": row.get("recorrente_titulo"),
        "titulo": str(row.get("titulo") or ""),
        "descricao": row.get("descricao"),
        "prioridade": str(row.get("prioridade") or "normal"),
        "status": status,
        "posicao_fila": int(row.get("posicao_fila") or 0) if status == STATUS_FILA else None,
        "maquina_parada": bool(row.get("maquina_parada")),
        "solicitado_por": _ponto_str(row.get("solicitado_por")) or None,
        "solicitado_em": _iso(row.get("solicitado_em")),
        "iniciado_por": _ponto_str(row.get("iniciado_por")) or None,
        "iniciado_em": _iso(row.get("iniciado_em")),
        "diagnostico": row.get("diagnostico"),
        "solucao_passos": parse_passos(row.get("solucao_passos")),
        "pausa_motivo": row.get("pausa_motivo"),
        "concluido_por": _ponto_str(row.get("concluido_por")) or None,
        "concluido_em": _iso(row.get("concluido_em")),
        "conclusao": row.get("conclusao"),
        "cancelado_por": _ponto_str(row.get("cancelado_por")) or None,
        "cancelado_em": _iso(row.get("cancelado_em")),
        "motivo_cancelamento": row.get("motivo_cancelamento"),
        "atualizado_em": _iso(row.get("atualizado_em")),
    }


def list_pedidos(
    *,
    status: Optional[Iterable[str]] = None,
    maquina_id: Optional[int] = None,
    finalizados_dias: int = 30,
    limit_finalizados: int = 100,
    incluir_similares: bool = False,
) -> list[dict[str, Any]]:
    """Pedidos abertos (todos) + finalizados recentes (concluídos/cancelados)."""
    _ensure()
    wanted = [s for s in (status or STATUS_TODOS) if s in STATUS_TODOS]
    if not wanted:
        return []
    abertos = [s for s in wanted if s in STATUS_ABERTOS]
    finalizados = [s for s in wanted if s not in STATUS_ABERTOS]
    out_rows: list[dict[str, Any]] = []
    maq_sql = " AND p.maquina_id = %s" if maquina_id else ""
    maq_params: tuple[Any, ...] = (int(maquina_id),) if maquina_id else ()

    if abertos:
        ph = ", ".join(["%s"] * len(abertos))
        out_rows.extend(
            db.execute_query(
                f"""{_PEDIDO_SELECT}
                WHERE p.status IN ({ph}){maq_sql}
                ORDER BY p.posicao_fila ASC, p.solicitado_em ASC""",
                (*abertos, *maq_params),
            )
            or []
        )
    if finalizados:
        ph = ", ".join(["%s"] * len(finalizados))
        dias = max(1, min(int(finalizados_dias or 30), 3650))
        limit = max(1, min(int(limit_finalizados or 100), 1000))
        out_rows.extend(
            db.execute_query(
                f"""{_PEDIDO_SELECT}
                WHERE p.status IN ({ph}){maq_sql}
                  AND COALESCE(p.concluido_em, p.cancelado_em, p.solicitado_em)
                      >= (NOW() - INTERVAL %s DAY)
                ORDER BY COALESCE(p.concluido_em, p.cancelado_em) DESC
                LIMIT %s""",
                (*finalizados, *maq_params, dias, limit),
            )
            or []
        )
    items = [_serialize_pedido(r) for r in out_rows]
    _with_names(items, _PONTO_FIELDS)
    if incluir_similares:
        try:
            contagem = contar_similares(items)
        except Exception as exc:  # pragma: no cover - indicador auxiliar
            logger.warning("Manutenção: falha ao calcular semelhantes: %s", exc)
            contagem = {}
        for it in items:
            if it["status"] in STATUS_ABERTOS:
                it["similares_count"] = contagem.get(it["id"], 0)
    return items


def list_eventos(pedido_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT id, pedido_id, tipo, ponto, texto, criado_em
        FROM tab_manutencao_evento
        WHERE pedido_id = %s
        ORDER BY criado_em ASC, id ASC
        """,
        (int(pedido_id),),
    ) or []
    items = [
        {
            "id": int(r["id"]),
            "tipo": str(r.get("tipo") or ""),
            "ponto": _ponto_str(r.get("ponto")) or None,
            "texto": r.get("texto"),
            "criado_em": _iso(r.get("criado_em")),
        }
        for r in rows
    ]
    _with_names(items, ("ponto",))
    return items


def get_pedido(pedido_id: int, include_eventos: bool = False) -> dict[str, Any]:
    _ensure()
    rows = db.execute_query(f"{_PEDIDO_SELECT} WHERE p.id = %s", (int(pedido_id),)) or []
    if not rows:
        raise ManutencaoNotFound("Pedido de manutenção não encontrado")
    item = _serialize_pedido(rows[0])
    _with_names([item], _PONTO_FIELDS)
    if include_eventos:
        item["eventos"] = list_eventos(pedido_id)
    return item


def _evento(cursor, pedido_id: int, tipo: str, ponto: str, texto: Optional[str] = None) -> None:
    cursor.execute(
        "INSERT INTO tab_manutencao_evento (pedido_id, tipo, ponto, texto) VALUES (%s, %s, %s, %s)",
        (int(pedido_id), tipo, ponto or None, texto),
    )


def _registrar_evento(pedido_id: int, tipo: str, ponto: str, texto: Optional[str] = None) -> None:
    with db.cursor() as cursor:
        _evento(cursor, pedido_id, tipo, ponto, texto)


def calcular_posicao_insercao(fila: list[dict[str, Any]], prioridade: str) -> int:
    """Índice (0-based) onde um novo pedido entra: após o último de prioridade >= à sua."""
    rank = PRIORIDADE_RANK.get(prioridade, PRIORIDADE_RANK["normal"])
    idx = 0
    for i, item in enumerate(fila):
        if PRIORIDADE_RANK.get(str(item.get("prioridade")), 2) <= rank:
            idx = i + 1
    return idx


def _fila_ids(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT id, prioridade FROM tab_manutencao_pedido
        WHERE status = 'fila'
        ORDER BY posicao_fila ASC, solicitado_em ASC, id ASC
        FOR UPDATE
        """
    )
    return list(cursor.fetchall() or [])


def _gravar_posicoes(cursor, ids: list[int]) -> None:
    for pos, pid in enumerate(ids, start=1):
        cursor.execute(
            "UPDATE tab_manutencao_pedido SET posicao_fila = %s WHERE id = %s",
            (pos, int(pid)),
        )


def _compactar_fila(cursor) -> None:
    _gravar_posicoes(cursor, [int(r["id"]) for r in _fila_ids(cursor)])


def criar_pedido(
    data: dict[str, Any], ponto: str, *, origem: Optional[str] = None
) -> dict[str, Any]:
    _ensure()
    maquina_id = int(data.get("maquina_id") or 0)
    if maquina_id <= 0:
        raise ValueError("Selecione a máquina")
    maquina = get_maquina(maquina_id)
    if not maquina["ativo"]:
        raise ValueError("Máquina inativa — reative-a no cadastro para solicitar manutenção")

    recorrente: Optional[dict[str, Any]] = None
    if data.get("recorrente_id"):
        recorrente = get_recorrente(int(data["recorrente_id"]))

    titulo = _clean_text(data.get("titulo"), 200) or (recorrente or {}).get("titulo") or ""
    if not titulo:
        raise ValueError("Descreva o que deve ser feito (título)")
    descricao = _opt_text(data.get("descricao"))
    if descricao is None and recorrente:
        descricao = _opt_text(recorrente.get("descricao"))
    prioridade = normalize_prioridade(
        data.get("prioridade") or (recorrente or {}).get("prioridade_padrao") or "normal"
    )
    maquina_parada = bool(data.get("maquina_parada"))

    def _op(cursor) -> int:
        fila = _fila_ids(cursor)
        idx = calcular_posicao_insercao(fila, prioridade)
        cursor.execute(
            """
            INSERT INTO tab_manutencao_pedido
                (maquina_id, recorrente_id, titulo, descricao, prioridade, status,
                 posicao_fila, maquina_parada, solicitado_por)
            VALUES (%s, %s, %s, %s, %s, 'fila', 0, %s, %s)
            """,
            (
                maquina_id,
                int(recorrente["id"]) if recorrente else None,
                titulo,
                descricao,
                prioridade,
                1 if maquina_parada else 0,
                ponto,
            ),
        )
        new_id = int(cursor.lastrowid)
        ids = [int(r["id"]) for r in fila]
        ids.insert(idx, new_id)
        _gravar_posicoes(cursor, ids)
        _evento(
            cursor,
            new_id,
            "criado",
            ponto,
            f"Solicitado com prioridade {PRIORIDADE_LABEL[prioridade]}"
            + (" — máquina parada" if maquina_parada else "")
            + (f" — aberto via {origem}" if origem else ""),
        )
        return new_id

    new_id = int(db.execute_transaction([_op])[0])
    pedido = get_pedido(new_id)
    _notificar_operadores(pedido, exclude_ponto=ponto)
    _broadcast("pedido_criado", new_id)
    return pedido


def atualizar_pedido_gerencia(pedido_id: int, data: dict[str, Any], ponto: str) -> dict[str, Any]:
    """Gerência ajusta título/descrição/máquina parada/prioridade de pedido aberto."""
    atual = get_pedido(pedido_id)
    if atual["status"] not in STATUS_ABERTOS:
        raise ManutencaoConflict("Pedido já finalizado")
    sets: list[str] = []
    vals: list[Any] = []
    notas: list[str] = []
    if data.get("titulo") is not None:
        titulo = _clean_text(data["titulo"], 200)
        if not titulo:
            raise ValueError("Título não pode ficar vazio")
        sets.append("titulo = %s")
        vals.append(titulo)
        if titulo != atual["titulo"]:
            notas.append("Título alterado")
    if data.get("descricao") is not None:
        sets.append("descricao = %s")
        vals.append(_opt_text(data["descricao"]))
        if (_opt_text(data["descricao"]) or None) != (atual.get("descricao") or None):
            notas.append("Descrição alterada")
    if data.get("maquina_parada") is not None:
        sets.append("maquina_parada = %s")
        vals.append(1 if data["maquina_parada"] else 0)
        if bool(data["maquina_parada"]) != atual["maquina_parada"]:
            notas.append("Máquina parada" if data["maquina_parada"] else "Máquina voltou a operar")
    nova_prioridade: Optional[str] = None
    if data.get("prioridade") is not None:
        nova_prioridade = normalize_prioridade(data["prioridade"])
        sets.append("prioridade = %s")
        vals.append(nova_prioridade)
        if nova_prioridade != atual["prioridade"]:
            notas.append(
                f"Prioridade {PRIORIDADE_LABEL[atual['prioridade']]} → {PRIORIDADE_LABEL[nova_prioridade]}"
            )
    if not sets:
        return get_pedido(pedido_id, include_eventos=True)

    def _op(cursor) -> None:
        cursor.execute(
            f"UPDATE tab_manutencao_pedido SET {', '.join(sets)} WHERE id = %s",
            (*vals, int(pedido_id)),
        )
        if notas:
            _evento(cursor, pedido_id, "atualizado", ponto, "; ".join(notas))

    db.execute_transaction([_op])
    pedido = get_pedido(pedido_id, include_eventos=True)
    if nova_prioridade == "urgente" and atual["prioridade"] != "urgente" and pedido["status"] == STATUS_FILA:
        _notificar_operadores(pedido, exclude_ponto=ponto, urgente_elevado=True)
    _broadcast("pedido_atualizado", pedido_id)
    return pedido


def reordenar_fila(ids: list[int], ponto: str) -> list[dict[str, Any]]:
    """Define a ordem da fila. IDs ausentes mantêm ordem relativa ao final."""
    _ensure()
    wanted = []
    seen: set[int] = set()
    for raw in ids or []:
        pid = int(raw)
        if pid not in seen:
            wanted.append(pid)
            seen.add(pid)

    def _op(cursor) -> None:
        fila = _fila_ids(cursor)
        atuais = [int(r["id"]) for r in fila]
        atual_set = set(atuais)
        nova = [pid for pid in wanted if pid in atual_set]
        nova.extend(pid for pid in atuais if pid not in seen)
        antes = {pid: i + 1 for i, pid in enumerate(atuais)}
        _gravar_posicoes(cursor, nova)
        for i, pid in enumerate(nova, start=1):
            if antes.get(pid) != i:
                _evento(cursor, pid, "reordenado", ponto, f"Posição na fila: {antes.get(pid)}º → {i}º")

    db.execute_transaction([_op])
    _broadcast("fila_reordenada")
    return list_pedidos(status=[STATUS_FILA])


def cancelar_pedido(pedido_id: int, motivo: Optional[str], ponto: str) -> dict[str, Any]:
    motivo_txt = _opt_text(motivo, 500)
    if not motivo_txt:
        raise ValueError("Informe o motivo do cancelamento")

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tab_manutencao_pedido
            SET status = 'cancelado', cancelado_por = %s, cancelado_em = NOW(),
                motivo_cancelamento = %s
            WHERE id = %s AND status IN ('fila','em_execucao','pausado')
            """,
            (ponto, motivo_txt, int(pedido_id)),
        )
        if cursor.rowcount == 0:
            raise ManutencaoConflict("Pedido não está mais em aberto")
        _evento(cursor, pedido_id, "cancelado", ponto, motivo_txt)
        _compactar_fila(cursor)

    get_pedido(pedido_id)
    db.execute_transaction([_op])
    _broadcast("pedido_cancelado", pedido_id)
    return get_pedido(pedido_id, include_eventos=True)


def iniciar_pedido(pedido_id: int, ponto: str) -> dict[str, Any]:
    """Operador assume o pedido da fila (ou retoma um pausado)."""
    atual = get_pedido(pedido_id)

    def _op(cursor) -> None:
        if atual["status"] == STATUS_PAUSADO:
            cursor.execute(
                """
                UPDATE tab_manutencao_pedido SET status = 'em_execucao', pausa_motivo = NULL
                WHERE id = %s AND status = 'pausado'
                """,
                (int(pedido_id),),
            )
            if cursor.rowcount == 0:
                raise ManutencaoConflict("Pedido mudou de situação — atualize a tela")
            _evento(cursor, pedido_id, "retomado", ponto, None)
            return
        cursor.execute(
            """
            UPDATE tab_manutencao_pedido
            SET status = 'em_execucao', iniciado_por = %s, iniciado_em = NOW(), posicao_fila = 0
            WHERE id = %s AND status = 'fila'
            """,
            (ponto, int(pedido_id)),
        )
        if cursor.rowcount == 0:
            raise ManutencaoConflict("Este pedido já foi iniciado por outro operador")
        _evento(cursor, pedido_id, "iniciado", ponto, None)
        _compactar_fila(cursor)

    if atual["status"] not in (STATUS_FILA, STATUS_PAUSADO):
        raise ManutencaoConflict("Pedido não está disponível para iniciar")
    db.execute_transaction([_op])
    _broadcast("pedido_iniciado", pedido_id)
    return get_pedido(pedido_id, include_eventos=True)


def registrar_progresso(
    pedido_id: int,
    *,
    diagnostico: Optional[str],
    passos: Optional[list[Any]],
    ponto: str,
) -> dict[str, Any]:
    atual = get_pedido(pedido_id)
    if atual["status"] not in (STATUS_EXECUCAO, STATUS_PAUSADO):
        raise ManutencaoConflict("Só é possível registrar progresso de pedido em execução")
    sets: list[str] = []
    vals: list[Any] = []
    if diagnostico is not None:
        sets.append("diagnostico = %s")
        vals.append(_opt_text(diagnostico))
    if passos is not None:
        sets.append("solucao_passos = %s")
        vals.append(_dump_passos(passos))
    if not sets:
        return get_pedido(pedido_id, include_eventos=True)

    def _op(cursor) -> None:
        cursor.execute(
            f"UPDATE tab_manutencao_pedido SET {', '.join(sets)} WHERE id = %s",
            (*vals, int(pedido_id)),
        )
        _evento(cursor, pedido_id, "progresso", ponto, "Diagnóstico/passos atualizados")

    db.execute_transaction([_op])
    _broadcast("pedido_progresso", pedido_id)
    return get_pedido(pedido_id, include_eventos=True)


def pausar_pedido(pedido_id: int, motivo: Optional[str], ponto: str) -> dict[str, Any]:
    motivo_txt = _opt_text(motivo, 500)
    if not motivo_txt:
        raise ValueError("Informe o motivo da pausa (ex.: aguardando peça)")

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tab_manutencao_pedido SET status = 'pausado', pausa_motivo = %s
            WHERE id = %s AND status = 'em_execucao'
            """,
            (motivo_txt, int(pedido_id)),
        )
        if cursor.rowcount == 0:
            raise ManutencaoConflict("Pedido não está em execução")
        _evento(cursor, pedido_id, "pausado", ponto, motivo_txt)

    get_pedido(pedido_id)
    db.execute_transaction([_op])
    _broadcast("pedido_pausado", pedido_id)
    return get_pedido(pedido_id, include_eventos=True)


def devolver_para_fila(pedido_id: int, motivo: Optional[str], ponto: str) -> dict[str, Any]:
    """Operador libera o pedido de volta para o topo da fila."""

    def _op(cursor) -> None:
        cursor.execute(
            """
            UPDATE tab_manutencao_pedido
            SET status = 'fila', iniciado_por = NULL, iniciado_em = NULL, pausa_motivo = NULL
            WHERE id = %s AND status IN ('em_execucao','pausado')
            """,
            (int(pedido_id),),
        )
        if cursor.rowcount == 0:
            raise ManutencaoConflict("Pedido não está em execução")
        fila = [int(r["id"]) for r in _fila_ids(cursor) if int(r["id"]) != int(pedido_id)]
        _gravar_posicoes(cursor, [int(pedido_id), *fila])
        _evento(cursor, pedido_id, "devolvido", ponto, _opt_text(motivo, 500))

    get_pedido(pedido_id)
    db.execute_transaction([_op])
    _broadcast("pedido_devolvido", pedido_id)
    return get_pedido(pedido_id, include_eventos=True)


def concluir_pedido(
    pedido_id: int,
    *,
    conclusao: Optional[str],
    diagnostico: Optional[str],
    passos: Optional[list[Any]],
    ponto: str,
) -> dict[str, Any]:
    conclusao_txt = _opt_text(conclusao)
    if not conclusao_txt:
        raise ValueError("Descreva a conclusão do serviço")
    atual = get_pedido(pedido_id)
    passos_final = parse_passos(passos) if passos is not None else atual["solucao_passos"]
    if not passos_final:
        raise ValueError("Registre ao menos um passo da solução antes de concluir")
    sets = [
        "status = 'concluido'",
        "concluido_por = %s",
        "concluido_em = NOW()",
        "conclusao = %s",
        "pausa_motivo = NULL",
        "maquina_parada = 0",
        "solucao_passos = %s",
    ]
    vals: list[Any] = [ponto, conclusao_txt, _dump_passos(passos_final)]
    if diagnostico is not None:
        sets.append("diagnostico = %s")
        vals.append(_opt_text(diagnostico))

    def _op(cursor) -> None:
        cursor.execute(
            f"""UPDATE tab_manutencao_pedido SET {', '.join(sets)}
            WHERE id = %s AND status IN ('em_execucao','pausado')""",
            (*vals, int(pedido_id)),
        )
        if cursor.rowcount == 0:
            raise ManutencaoConflict("Pedido não está em execução")
        _evento(cursor, pedido_id, "concluido", ponto, conclusao_txt)

    db.execute_transaction([_op])
    pedido = get_pedido(pedido_id, include_eventos=True)
    _notificar_solicitante(pedido, ponto)
    _broadcast("pedido_concluido", pedido_id)
    return pedido


def comentar_pedido(pedido_id: int, texto: str, ponto: str) -> dict[str, Any]:
    msg = _opt_text(texto, 2000)
    if not msg:
        raise ValueError("Comentário vazio")
    get_pedido(pedido_id)
    _registrar_evento(pedido_id, "comentario", ponto, msg)
    _broadcast("pedido_comentado", pedido_id)
    return get_pedido(pedido_id, include_eventos=True)


# ------------------------------------------------- histórico e semelhantes

_STOPWORDS = frozenset(
    """
    a o e de da do das dos em no na nos nas um uma uns umas para por com sem que se ao aos
    as os ou mas mais muito pouco ja nao sim esta este isso isto essa esse foi ser ter tem
    sua seu suas seus pela pelo pelas pelos entre sobre apos ate quando como onde qual
    maquina favor verificar fazer feito realizar necessario precisa preciso problema
    """.split()
)
SIMILAR_MIN_SCORE = 0.34
SIMILAR_LIMIT = 5
_CANDIDATOS_LIMIT = 800


def _normalizar(texto: Any) -> str:
    import unicodedata

    t = unicodedata.normalize("NFD", str(texto or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def tokenizar(texto: Any) -> set[str]:
    """Termos significativos (sem acento, sem stopwords, plural simples removido)."""
    out: set[str] = set()
    for tok in re.split(r"[^a-z0-9]+", _normalizar(texto)):
        if len(tok) < 3 or tok in _STOPWORDS:
            continue
        if not tok.isdigit() and len(tok) > 4:
            if tok.endswith("oes"):
                tok = tok[:-3] + "ao"
            elif tok.endswith("es") and len(tok) > 5:
                tok = tok[:-2]
            elif tok.endswith("s"):
                tok = tok[:-1]
        out.add(tok)
    return out


def _texto_solucao(p: dict[str, Any]) -> str:
    return " ".join(
        [str(p.get("diagnostico") or ""), str(p.get("conclusao") or ""), *(p.get("solucao_passos") or [])]
    )


def pontuar_semelhanca(alvo: dict[str, Any], candidato: dict[str, Any]) -> tuple[float, list[str]]:
    """Score entre um pedido (título/descrição) e um concluído + termos em comum."""
    q = tokenizar(f"{alvo.get('titulo') or ''} {alvo.get('descricao') or ''}")
    if not q:
        return 0.0, []
    principal = tokenizar(f"{candidato.get('titulo') or ''} {candidato.get('descricao') or ''}")
    solucao = tokenizar(_texto_solucao(candidato))
    comuns_principal = q & principal
    comuns_solucao = (q & solucao) - comuns_principal
    if not comuns_principal and len(comuns_solucao) < 2:
        return 0.0, []
    score = (len(comuns_principal) + 0.5 * len(comuns_solucao)) / len(q)
    if alvo.get("maquina_id") and alvo.get("maquina_id") == candidato.get("maquina_id"):
        score += 0.15
    if alvo.get("recorrente_id") and alvo.get("recorrente_id") == candidato.get("recorrente_id"):
        score += 0.5
    return round(score, 3), sorted(comuns_principal | comuns_solucao)


def _candidatos_concluidos(maquina_id: Optional[int] = None) -> list[dict[str, Any]]:
    maq_sql = " AND p.maquina_id = %s" if maquina_id else ""
    params: tuple[Any, ...] = (int(maquina_id),) if maquina_id else ()
    rows = db.execute_query(
        f"""{_PEDIDO_SELECT}
        WHERE p.status = 'concluido'{maq_sql}
        ORDER BY p.concluido_em DESC
        LIMIT {_CANDIDATOS_LIMIT}""",
        params,
    ) or []
    return [_serialize_pedido(r) for r in rows]


def _resumo_historico(p: dict[str, Any], score: float, termos: list[str]) -> dict[str, Any]:
    return {
        "id": p["id"],
        "maquina_id": p["maquina_id"],
        "maquina_nome": p.get("maquina_nome"),
        "maquina_codigo": p.get("maquina_codigo"),
        "titulo": p["titulo"],
        "descricao": p.get("descricao"),
        "diagnostico": p.get("diagnostico"),
        "solucao_passos": p.get("solucao_passos") or [],
        "conclusao": p.get("conclusao"),
        "concluido_em": p.get("concluido_em"),
        "concluido_por": p.get("concluido_por"),
        "concluido_por_nome": p.get("concluido_por_nome"),
        "mesma_maquina": False,
        "score": score,
        "termos": termos,
    }


def ranquear_semelhantes(
    alvo: dict[str, Any],
    candidatos: list[dict[str, Any]],
    limit: int = SIMILAR_LIMIT,
) -> list[dict[str, Any]]:
    achados: list[dict[str, Any]] = []
    for c in candidatos:
        if c["id"] == alvo.get("id"):
            continue
        score, termos = pontuar_semelhanca(alvo, c)
        if score < SIMILAR_MIN_SCORE:
            continue
        item = _resumo_historico(c, score, termos)
        item["mesma_maquina"] = c["maquina_id"] == alvo.get("maquina_id")
        achados.append(item)
    # Candidatos já vêm do mais recente ao mais antigo; sort estável mantém isso no empate.
    achados.sort(key=lambda x: -x["score"])
    return achados[: max(1, int(limit))]


def similares_do_pedido(pedido_id: int, limit: int = SIMILAR_LIMIT) -> list[dict[str, Any]]:
    alvo = get_pedido(pedido_id)
    itens = ranquear_semelhantes(alvo, _candidatos_concluidos(), limit)
    _with_names(itens, ("concluido_por",))
    return itens


def contar_similares(pedidos: list[dict[str, Any]]) -> dict[int, int]:
    """Quantidade de soluções semelhantes de cada pedido aberto (uma leitura do histórico)."""
    abertos = [p for p in pedidos if p.get("status") in STATUS_ABERTOS]
    if not abertos:
        return {}
    candidatos = _candidatos_concluidos()
    return {p["id"]: len(ranquear_semelhantes(p, candidatos)) for p in abertos}


def buscar_historico(
    termo: str, maquina_id: Optional[int] = None, limit: int = 40
) -> list[dict[str, Any]]:
    """Busca em manutenções concluídas (título, descrição, diagnóstico, passos e conclusão)."""
    _ensure()
    limit = max(1, min(int(limit or 40), 200))
    q = tokenizar(termo)
    candidatos = _candidatos_concluidos(maquina_id)
    if not q:
        itens = [_resumo_historico(c, 0.0, []) for c in candidatos[:limit]]
    else:
        itens = []
        for c in candidatos:
            principal = tokenizar(f"{c['titulo']} {c.get('descricao') or ''}")
            todos = principal | tokenizar(_texto_solucao(c))
            # Prefixo: "lubrif" encontra "lubrificacao".
            if not all(any(x.startswith(t) for x in todos) for t in q):
                continue
            score = sum(1.0 if any(x.startswith(t) for x in principal) else 0.6 for t in q) / len(q)
            termos = sorted(x for x in todos if any(x.startswith(t) for t in q))
            itens.append(_resumo_historico(c, round(score, 3), termos))
        itens.sort(key=lambda x: -x["score"])
        itens = itens[:limit]
    _with_names(itens, ("concluido_por",))
    for it in itens:
        it["mesma_maquina"] = bool(maquina_id and it["maquina_id"] == int(maquina_id))
    return itens


# --------------------------------------------------------------------- resumo


def resumo() -> dict[str, Any]:
    _ensure()
    rows = db.execute_query(
        """
        SELECT
            SUM(status = 'fila') AS fila,
            SUM(status = 'em_execucao') AS em_execucao,
            SUM(status = 'pausado') AS pausado,
            SUM(status = 'fila' AND prioridade = 'urgente') AS urgentes,
            SUM(status IN ('fila','em_execucao','pausado') AND maquina_parada = 1) AS maquinas_paradas,
            SUM(status = 'concluido' AND concluido_em >= (NOW() - INTERVAL 30 DAY)) AS concluidos_30d,
            AVG(CASE WHEN status = 'concluido' AND concluido_em >= (NOW() - INTERVAL 30 DAY)
                     AND iniciado_em IS NOT NULL
                THEN TIMESTAMPDIFF(MINUTE, iniciado_em, concluido_em) END) AS tempo_medio_execucao_min,
            AVG(CASE WHEN iniciado_em IS NOT NULL AND iniciado_em >= (NOW() - INTERVAL 30 DAY)
                THEN TIMESTAMPDIFF(MINUTE, solicitado_em, iniciado_em) END) AS tempo_medio_espera_min
        FROM tab_manutencao_pedido
        """
    ) or [{}]
    r = rows[0] or {}
    preventivas = [
        rec for rec in list_recorrentes()
        if rec.get("situacao") in ("vencida", "vence_em_breve")
    ]

    def _num(key: str) -> int:
        return int(r.get(key) or 0)

    def _avg(key: str) -> Optional[int]:
        v = r.get(key)
        return int(round(float(v))) if v is not None else None

    return {
        "fila": _num("fila"),
        "em_execucao": _num("em_execucao"),
        "pausado": _num("pausado"),
        "urgentes": _num("urgentes"),
        "maquinas_paradas": _num("maquinas_paradas"),
        "concluidos_30d": _num("concluidos_30d"),
        "tempo_medio_execucao_min": _avg("tempo_medio_execucao_min"),
        "tempo_medio_espera_min": _avg("tempo_medio_espera_min"),
        "preventivas_vencidas": sum(1 for p in preventivas if p["situacao"] == "vencida"),
        "preventivas_em_breve": sum(1 for p in preventivas if p["situacao"] == "vence_em_breve"),
    }


# -------------------------------------------------------------- notificações


def _broadcast(acao: str, pedido_id: Optional[int] = None) -> None:
    payload: dict[str, Any] = {"type": "manutencao_changed", "acao": acao}
    if pedido_id is not None:
        payload["pedido_id"] = int(pedido_id)
    try:
        from services.notification_push_service import broadcast_ws_payload

        broadcast_ws_payload(payload)
    except Exception as exc:  # pragma: no cover - realtime é best-effort
        logger.debug("Manutenção: broadcast falhou: %s", exc)


def _list_operador_pontos() -> list[str]:
    try:
        rows = db.execute_query(
            "SELECT Ponto FROM user_permissions WHERE sb_manutencao_operador = 1"
        ) or []
        return [p for p in (_ponto_str(r.get("Ponto")) for r in rows) if p]
    except Exception as exc:
        logger.debug("Manutenção: lista operadores falhou: %s", exc)
        return []


PUSH_ICON = "icons/manutencao-192.png"
PUSH_BADGE = "icons/manutencao-badge-96.png"


def _spa_url(path_and_query: str) -> str:
    """URL absoluta da SPA (produção em /sagra/) para abrir ao tocar na notificação."""
    try:
        from services.os_notificacao_dispatch_service import _spa_public_base

        base = _spa_public_base()
    except Exception:  # pragma: no cover - fallback relativo
        base = ""
    return f"{base}/{path_and_query.lstrip('/')}" if base else f"/{path_and_query.lstrip('/')}"


def url_pedido(pedido_id: int, aba: str = "operador") -> str:
    return _spa_url(f"manutencao?aba={aba}&pedido={int(pedido_id)}")


def _enviar_web_push(
    pontos: list[str],
    *,
    titulo: str,
    mensagem: str,
    url: str,
    tag: str,
    urgent: bool,
    notification_ids: dict[str, Optional[int]],
) -> int:
    """Web Push (celular/desktop) — chega mesmo com o app fechado."""
    try:
        from services.web_push_service import send_web_push_to_ponto
    except Exception as exc:  # pragma: no cover
        logger.debug("Manutenção: web push indisponível: %s", exc)
        return 0
    enviados = 0
    for ponto in pontos:
        try:
            enviados += send_web_push_to_ponto(
                ponto=ponto,
                title=titulo,
                body=mensagem,
                url=url,
                tag=tag,
                notification_id=notification_ids.get(ponto),
                urgent=urgent,
                icon=PUSH_ICON,
                badge=PUSH_BADGE,
            )
        except Exception as exc:
            logger.warning("Manutenção: web push falhou ponto %s: %s", ponto, exc)
    return enviados


def _notify(
    pontos: Iterable[str],
    mensagem: str,
    *,
    urgent: bool = False,
    titulo: str = "Manutenção",
    url: Optional[str] = None,
    tag: Optional[str] = None,
    background: bool = True,
    pedido_id: Optional[int] = None,
) -> None:
    try:
        from services.notification_push_service import (
            insert_user_notification,
            push_user_notification,
        )
    except Exception as exc:  # pragma: no cover
        logger.debug("Manutenção: push indisponível: %s", exc)
        return
    alvos = [p for p in dict.fromkeys(pontos) if p]
    ids: dict[str, Optional[int]] = {}
    for ponto in alvos:
        try:
            nid = insert_user_notification(
                ponto=ponto,
                nro=0,
                ano=0,
                mensagem=mensagem,
                # Tipo próprio: o SPA não abre o modal genérico de "Notificação de OS".
                detalhes_json=json.dumps(
                    {"type": "manutencao", "pedido_id": pedido_id, "url": url, "urgent": urgent},
                    ensure_ascii=False,
                ),
            )
            ids[ponto] = nid
            push_user_notification(
                target_ponto=ponto,
                mensagem=mensagem,
                nro=0,
                ano=0,
                notification_id=nid,
                action="manutencao",
                browser_notify=True,
                urgent=urgent,
            )
        except Exception as exc:
            logger.warning("Manutenção: falha ao notificar ponto %s: %s", ponto, exc)
    if not alvos:
        return
    # App Android: fila lida pelo serviço em segundo plano (chega com o app fechado).
    try:
        from services.manutencao_app_service import enfileirar_notificacao

        enfileirar_notificacao(
            alvos,
            titulo=titulo,
            mensagem=mensagem,
            url=url,
            urgente=urgent,
            pedido_id=pedido_id,
        )
    except Exception as exc:
        logger.warning("Manutenção: fila do app falhou: %s", exc)
    kwargs = dict(
        titulo=titulo,
        mensagem=mensagem,
        url=url or _spa_url("manutencao"),
        tag=tag or "sagra-manutencao",
        urgent=urgent,
        notification_ids=ids,
    )
    if not background:
        _enviar_web_push(alvos, **kwargs)
        return
    # Envio HTTP aos serviços de push fora da requisição (não atrasa a resposta).
    threading.Thread(
        target=_enviar_web_push, args=(alvos,), kwargs=kwargs, daemon=True,
        name="manutencao-webpush",
    ).start()


def enviar_push_teste(ponto: str) -> dict[str, int]:
    from services.web_push_service import count_push_subscriptions_for_ponto

    alvo = _ponto_str(ponto)
    inscricoes = count_push_subscriptions_for_ponto(alvo) if alvo else 0
    enviados = _enviar_web_push(
        [alvo] if alvo else [],
        titulo="Manutenção — teste",
        mensagem="Tudo certo! Você será avisado aqui quando chegar um novo pedido de manutenção.",
        url=_spa_url("manutencao?aba=operador"),
        tag="sagra-manutencao-teste",
        urgent=False,
        notification_ids={},
    )
    return {"enviados": enviados, "inscricoes": inscricoes}


def _notificar_operadores(
    pedido: dict[str, Any], *, exclude_ponto: str, urgente_elevado: bool = False
) -> None:
    prioridade = PRIORIDADE_LABEL.get(pedido["prioridade"], pedido["prioridade"])
    prefixo = "Manutenção URGENTE" if pedido["prioridade"] == "urgente" else "Nova manutenção"
    if urgente_elevado:
        prefixo = "Manutenção elevada para URGENTE"
    parada = " · máquina parada" if pedido.get("maquina_parada") else ""
    mensagem = f"{prefixo}: {pedido['maquina_nome']} — {pedido['titulo']} (prioridade {prioridade}{parada})"
    try:
        n_similares = len(ranquear_semelhantes(pedido, _candidatos_concluidos()))
    except Exception:  # pragma: no cover - indicador auxiliar
        n_similares = 0
    if n_similares:
        mensagem += (
            f" — {n_similares} solução(ões) semelhante(s) no histórico para consultar"
        )
    excl = _ponto_str(exclude_ponto)
    alvos = [p for p in _list_operador_pontos() if p != excl]
    urgente = pedido["prioridade"] == "urgente"
    titulo = f"{'🚨 ' if urgente else '🔧 '}{prefixo} · {pedido['maquina_nome']}"
    _notify(
        alvos,
        mensagem,
        urgent=urgente,
        titulo=titulo,
        url=url_pedido(pedido["id"], "operador"),
        tag=f"sagra-manutencao-{pedido['id']}",
        pedido_id=pedido["id"],
    )


def _notificar_solicitante(pedido: dict[str, Any], ponto: str) -> None:
    alvo = _ponto_str(pedido.get("solicitado_por"))
    if not alvo or alvo == _ponto_str(ponto):
        return
    mensagem = f"Manutenção concluída: {pedido['maquina_nome']} — {pedido['titulo']}"
    _notify(
        [alvo],
        mensagem,
        titulo=f"✅ Manutenção concluída · {pedido['maquina_nome']}",
        url=url_pedido(pedido["id"], "gerencia"),
        tag=f"sagra-manutencao-{pedido['id']}",
        pedido_id=pedido["id"],
    )

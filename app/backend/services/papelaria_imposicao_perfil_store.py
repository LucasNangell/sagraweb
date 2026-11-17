"""Persistência dos perfis de imposição v2 e dos modelos de perfil."""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Optional

from database import db
from services import papelaria_imposicao_perfil_service as perfil_svc

logger = logging.getLogger(__name__)

_tables_ready = False
_ativos_cache: dict[str, Any] = {"ts": 0.0, "valor": None}
_ativos_lock = threading.Lock()
_ATIVOS_TTL_S = 10.0


def _invalidate_cache() -> None:
    with _ativos_lock:
        _ativos_cache["ts"] = 0.0
        _ativos_cache["valor"] = None


def produtos_com_perfil_ativo() -> set[str]:
    """Produtos (minúsculos) com ao menos uma variante aprovada. Cache de 10 s."""
    now = time.monotonic()
    with _ativos_lock:
        if _ativos_cache["valor"] is not None and now - _ativos_cache["ts"] < _ATIVOS_TTL_S:
            return set(_ativos_cache["valor"])
    try:
        ensure_perfil_tables()
        rows = db.execute_query(
            "SELECT DISTINCT Produto FROM tabPapelariaImposicaoPerfis WHERE AtivoV2 = 1"
        )
        valor = {str(r.get("Produto") or "").strip().lower() for r in rows or []}
        valor.discard("")
    except Exception as exc:
        # Sem tabela/banco: nenhum perfil ativo (fluxo antigo). Cacheia para
        # não repetir a falha a cada modelo de uma listagem.
        logger.warning("Perfis de imposição ativos indisponíveis: %s", exc)
        valor = set()
    with _ativos_lock:
        _ativos_cache["ts"] = now
        _ativos_cache["valor"] = set(valor)
    return valor


_TABLES = ("tabPapelariaImposicaoPerfis", "tabPapelariaImposicaoPerfilModelos")
_DDL = (
    """
    CREATE TABLE IF NOT EXISTS tabPapelariaImposicaoPerfis (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        Produto VARCHAR(120) NOT NULL,
        Variante VARCHAR(16) NOT NULL,
        PerfilJson JSON NOT NULL,
        AtivoV2 TINYINT(1) NOT NULL DEFAULT 0,
        AprovadoEm DATETIME NULL,
        AprovadoPor VARCHAR(32) NULL,
        AtualizadoPor VARCHAR(32) NULL,
        AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_papelaria_imposicao_perfil (Produto, Variante),
        CONSTRAINT chk_papelaria_imposicao_perfil_variante
            CHECK (Variante IN ('digital', 'offset'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS tabPapelariaImposicaoPerfilModelos (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        Nome VARCHAR(120) NOT NULL,
        PerfilJson JSON NOT NULL,
        AtualizadoPor VARCHAR(32) NULL,
        AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_papelaria_imposicao_perfil_modelo (Nome)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
)


def ensure_perfil_tables() -> None:
    """
    Cria as tabelas se faltarem (DDL embutido: o pacote de release não leva
    deploy/sql no mesmo caminho). Mesmo DDL de deploy/sql/
    create_papelaria_imposicao_perfis.sql, aplicável à mão por
    deploy/scripts/apply_imposicao_perfis_dev_prod.py.
    """
    global _tables_ready
    if _tables_ready:
        return
    ok = True
    for table, stmt in zip(_TABLES, _DDL):
        try:
            rows = db.execute_query(
                """
                SELECT COUNT(*) AS n FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
                """,
                (table,),
            )
            if rows and int(rows[0].get("n") or 0) > 0:
                continue
            db.execute_query(stmt)
            logger.info("Schema: tabela %s criada", table)
        except Exception as exc:
            ok = False
            logger.warning("ensure perfil imposicao tables (%s): %s", table, exc)
    # Só memoriza sucesso: se o banco estava fora, tenta de novo depois.
    _tables_ready = ok


def normalize_produto(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("Produto é obrigatório.")
    if len(text) > 120:
        raise ValueError("Produto excede 120 caracteres.")
    return text


def normalize_variante(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text not in perfil_svc.VARIANTES:
        raise ValueError("Variante inválida. Use digital ou offset.")
    return text


def _json_value(raw: Any) -> Optional[dict[str, Any]]:
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(str(raw))
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _row_to_payload(row: dict[str, Any]) -> dict[str, Any]:
    raw = _json_value(row.get("PerfilJson"))
    try:
        perfil = perfil_svc.normalize_perfil(raw) if raw else None
    except ValueError as exc:
        logger.warning("Perfil de imposição inválido no banco (ID %s): %s", row.get("ID"), exc)
        perfil = None
    return {
        "id": int(row["ID"]),
        "produto": row.get("Produto") or "",
        "variante": row.get("Variante") or "",
        "perfil": perfil,
        "ativo": bool(row.get("AtivoV2")),
        "aprovado_em": str(row["AprovadoEm"]) if row.get("AprovadoEm") else None,
        "aprovado_por": row.get("AprovadoPor") or None,
        "atualizado_por": row.get("AtualizadoPor") or None,
        "atualizado_em": str(row["AtualizadoEm"]) if row.get("AtualizadoEm") else None,
    }


def get_perfis_produto(produto: str) -> dict[str, Optional[dict[str, Any]]]:
    """{digital: registro|None, offset: registro|None} do produto."""
    ensure_perfil_tables()
    nome = normalize_produto(produto)
    rows = db.execute_query(
        """
        SELECT ID, Produto, Variante, PerfilJson, AtivoV2, AprovadoEm, AprovadoPor,
               AtualizadoPor, AtualizadoEm
        FROM tabPapelariaImposicaoPerfis
        WHERE Produto = %(produto)s
        """,
        {"produto": nome},
    )
    out: dict[str, Optional[dict[str, Any]]] = {"digital": None, "offset": None}
    for row in rows or []:
        var = str(row.get("Variante") or "").lower()
        if var in out:
            out[var] = _row_to_payload(row)
    return out


def get_perfil(produto: str, variante: str) -> Optional[dict[str, Any]]:
    return get_perfis_produto(produto).get(normalize_variante(variante))


def get_perfil_ativo(produto: str, variante: str) -> Optional[dict[str, Any]]:
    """Perfil v2 aprovado (AtivoV2) e válido, ou None (usa fluxo antigo)."""
    try:
        reg = get_perfil(produto, variante)
    except Exception as exc:
        logger.warning("Leitura do perfil v2 %s/%s falhou: %s", produto, variante, exc)
        return None
    if not reg or not reg.get("ativo") or not reg.get("perfil"):
        return None
    return reg


def list_status_todos() -> dict[str, dict[str, Any]]:
    """Mapa produto → {digital|offset: {existe, ativo}} para a lista lateral."""
    ensure_perfil_tables()
    rows = db.execute_query(
        "SELECT Produto, Variante, AtivoV2 FROM tabPapelariaImposicaoPerfis"
    )
    out: dict[str, dict[str, Any]] = {}
    for row in rows or []:
        prod = str(row.get("Produto") or "")
        var = str(row.get("Variante") or "").lower()
        if not prod or var not in perfil_svc.VARIANTES:
            continue
        out.setdefault(prod, {})[var] = {"existe": True, "ativo": bool(row.get("AtivoV2"))}
    return out


def save_perfil(
    *,
    produto: str,
    variante: str,
    perfil: Any,
    ponto: str = "",
) -> dict[str, Any]:
    """
    Grava o perfil (rascunho ou ativo). Se o perfil já estiver ativo, só
    aceita salvar sem erros de validação (o fluxo de produção usa ele).
    """
    ensure_perfil_tables()
    nome = normalize_produto(produto)
    var = normalize_variante(variante)
    result = perfil_svc.validar_perfil(perfil)
    normalizado = result["perfil"]
    if normalizado is None:
        raise ValueError(result["erros"][0]["mensagem"] if result["erros"] else "Perfil inválido.")
    atual = get_perfil(nome, var)
    if atual and atual.get("ativo") and not result["completo"]:
        msgs = "; ".join(e["mensagem"] for e in result["erros"][:3])
        raise ValueError(
            "Este perfil está em uso na produção; corrija antes de salvar: " + msgs
        )
    db.execute_query(
        """
        INSERT INTO tabPapelariaImposicaoPerfis
            (Produto, Variante, PerfilJson, AtivoV2, AtualizadoPor)
        VALUES (%(produto)s, %(variante)s, %(perfil)s, 0, %(ponto)s)
        ON DUPLICATE KEY UPDATE
            PerfilJson = VALUES(PerfilJson),
            AtualizadoPor = VALUES(AtualizadoPor)
        """,
        {
            "produto": nome,
            "variante": var,
            "perfil": json.dumps(normalizado, ensure_ascii=False),
            "ponto": str(ponto or "")[:32] or None,
        },
    )
    _invalidate_cache()
    reg = get_perfil(nome, var)
    if not reg:
        raise RuntimeError("Falha ao gravar o perfil de imposição.")
    return {**reg, "validacao": {k: result[k] for k in ("erros", "avisos", "completo")}}


def set_ativo(
    *,
    produto: str,
    variante: str,
    ativo: bool,
    ponto: str = "",
) -> dict[str, Any]:
    """Aprova/ativa (usa o perfil na geração) ou volta ao fluxo antigo."""
    ensure_perfil_tables()
    nome = normalize_produto(produto)
    var = normalize_variante(variante)
    reg = get_perfil(nome, var)
    if not reg or not reg.get("perfil"):
        raise LookupError("Salve o perfil antes de ativá-lo.")
    if ativo:
        result = perfil_svc.validar_perfil(reg["perfil"])
        if not result["completo"]:
            msgs = "; ".join(e["mensagem"] for e in result["erros"][:3])
            raise ValueError("O perfil tem erros e não pode ser ativado: " + msgs)
        db.execute_query(
            """
            UPDATE tabPapelariaImposicaoPerfis
            SET AtivoV2 = 1, AprovadoEm = NOW(), AprovadoPor = %(ponto)s
            WHERE Produto = %(produto)s AND Variante = %(variante)s
            """,
            {"produto": nome, "variante": var, "ponto": str(ponto or "")[:32] or None},
        )
    else:
        db.execute_query(
            """
            UPDATE tabPapelariaImposicaoPerfis
            SET AtivoV2 = 0
            WHERE Produto = %(produto)s AND Variante = %(variante)s
            """,
            {"produto": nome, "variante": var},
        )
    _invalidate_cache()
    out = get_perfil(nome, var)
    if not out:
        raise RuntimeError("Falha ao atualizar o perfil.")
    return out


def delete_perfil(*, produto: str, variante: str) -> dict[str, Any]:
    ensure_perfil_tables()
    nome = normalize_produto(produto)
    var = normalize_variante(variante)
    db.execute_query(
        """
        DELETE FROM tabPapelariaImposicaoPerfis
        WHERE Produto = %(produto)s AND Variante = %(variante)s
        """,
        {"produto": nome, "variante": var},
    )
    _invalidate_cache()
    return {"produto": nome, "variante": var, "deleted": True}


# --- Modelos de perfil -------------------------------------------------------


def list_modelos() -> list[dict[str, Any]]:
    ensure_perfil_tables()
    rows = db.execute_query(
        """
        SELECT ID, Nome, PerfilJson, AtualizadoPor, AtualizadoEm
        FROM tabPapelariaImposicaoPerfilModelos
        ORDER BY Nome
        """
    )
    out = []
    for row in rows or []:
        raw = _json_value(row.get("PerfilJson"))
        try:
            perfil = perfil_svc.normalize_perfil(raw) if raw else None
        except ValueError:
            perfil = None
        if perfil is None:
            continue
        out.append(
            {
                "id": int(row["ID"]),
                "nome": row.get("Nome") or "",
                "perfil": perfil,
                "resumo": perfil_svc.resumo_perfil(perfil),
                "atualizado_em": str(row["AtualizadoEm"]) if row.get("AtualizadoEm") else None,
            }
        )
    return out


def save_modelo(*, nome: str, perfil: Any, ponto: str = "") -> dict[str, Any]:
    ensure_perfil_tables()
    nome_n = str(nome or "").strip()
    if not nome_n:
        raise ValueError("Informe o nome do modelo de perfil.")
    if len(nome_n) > 120:
        raise ValueError("Nome do modelo excede 120 caracteres.")
    normalizado = perfil_svc.normalize_perfil(perfil)
    db.execute_query(
        """
        INSERT INTO tabPapelariaImposicaoPerfilModelos (Nome, PerfilJson, AtualizadoPor)
        VALUES (%(nome)s, %(perfil)s, %(ponto)s)
        ON DUPLICATE KEY UPDATE
            PerfilJson = VALUES(PerfilJson),
            AtualizadoPor = VALUES(AtualizadoPor)
        """,
        {
            "nome": nome_n,
            "perfil": json.dumps(normalizado, ensure_ascii=False),
            "ponto": str(ponto or "")[:32] or None,
        },
    )
    for item in list_modelos():
        if item["nome"] == nome_n:
            return item
    raise RuntimeError("Falha ao gravar o modelo de perfil.")


def delete_modelo(modelo_id: int) -> dict[str, Any]:
    ensure_perfil_tables()
    db.execute_query(
        "DELETE FROM tabPapelariaImposicaoPerfilModelos WHERE ID = %(id)s",
        {"id": int(modelo_id)},
    )
    return {"id": int(modelo_id), "deleted": True}

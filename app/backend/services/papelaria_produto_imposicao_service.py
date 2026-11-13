"""Imposição padrão por produto × variante (digital | offset)."""
from __future__ import annotations

import json
import logging
from typing import Any, Literal, Optional

from database import db

logger = logging.getLogger(__name__)

Variante = Literal["digital", "offset"]
VALID_VARIANTES = frozenset({"digital", "offset"})

_table_ready = False


def ensure_produto_imposicao_table() -> None:
    global _table_ready
    if _table_ready:
        return
    from config_manager import PROJECT_ROOT

    sql_path = PROJECT_ROOT / "deploy" / "sql" / "create_papelaria_produto_imposicao_configs.sql"
    if sql_path.is_file():
        raw = sql_path.read_text(encoding="utf-8")
        for stmt in raw.split(";"):
            s = stmt.strip()
            if s:
                try:
                    db.execute_query(s)
                except Exception as exc:
                    logger.warning("ensure produto imposicao table: %s", exc)
    _table_ready = True


def normalize_variante(value: Any) -> Variante:
    text = str(value or "").strip().lower()
    if text not in VALID_VARIANTES:
        raise ValueError("Variante inválida. Use digital ou offset.")
    return text  # type: ignore[return-value]


def normalize_produto(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("Produto é obrigatório.")
    if len(text) > 120:
        raise ValueError("Produto excede 120 caracteres.")
    return text


def _row_to_payload(row: dict[str, Any]) -> dict[str, Any]:
    raw = row.get("ImposicaoConfigJson")
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, dict):
        cfg_json = json.dumps(raw, ensure_ascii=False)
    else:
        cfg_json = str(raw) if raw is not None else None
    pasta = row.get("PastaImposicao")
    return {
        "id": int(row["ID"]),
        "produto": row.get("Produto") or "",
        "variante": row.get("Variante") or "",
        "imposicao_config_json": cfg_json,
        "pasta_imposicao": (str(pasta).strip() if pasta else None) or None,
        "atualizado_em": str(row["AtualizadoEm"]) if row.get("AtualizadoEm") else None,
    }


def list_produto_imposicao_configs(produto: str) -> list[dict[str, Any]]:
    ensure_produto_imposicao_table()
    nome = normalize_produto(produto)
    rows = db.execute_query(
        """
        SELECT ID, Produto, Variante, ImposicaoConfigJson, PastaImposicao, AtualizadoEm
        FROM tabPapelariaProdutoImposicaoConfigs
        WHERE Produto = %(produto)s
        ORDER BY FIELD(Variante, 'digital', 'offset'), ID
        """,
        {"produto": nome},
    )
    return [_row_to_payload(r) for r in rows or []]


def get_produto_imposicao_map(produto: str) -> dict[str, Optional[dict[str, Any]]]:
    """Retorna {digital: config_dict|None, offset: config_dict|None}."""
    from services import papelaria_imposicao_config_service as cfg_svc

    out: dict[str, Optional[dict[str, Any]]] = {"digital": None, "offset": None}
    for row in list_produto_imposicao_configs(produto):
        variante = row["variante"]
        parsed = cfg_svc.parse_imposicao_config_json(row.get("imposicao_config_json"))
        if parsed and variante in out:
            # Leitura permissiva: PDF de marcas pode ser completado no modal da OS.
            out[variante] = cfg_svc.validate_imposicao_config_payload(
                parsed,
                require_marcas_pdf=False,
            )
    return out


def upsert_produto_imposicao_config(
    *,
    produto: str,
    variante: str,
    imposicao_config_json: Any,
    pasta_imposicao: Optional[str] = None,
) -> dict[str, Any]:
    ensure_produto_imposicao_table()
    from services import papelaria_imposicao_config_service as cfg_svc
    from services.papelaria_models_service import normalize_pasta_imposicao

    nome = normalize_produto(produto)
    var = normalize_variante(variante)
    normalized = cfg_svc.normalize_imposicao_config_json(imposicao_config_json)
    if not normalized:
        raise ValueError("Configuração de imposição vazia.")
    pasta = normalize_pasta_imposicao(pasta_imposicao)

    db.execute_query(
        """
        INSERT INTO tabPapelariaProdutoImposicaoConfigs
            (Produto, Variante, ImposicaoConfigJson, PastaImposicao)
        VALUES (%(produto)s, %(variante)s, %(cfg)s, %(pasta)s)
        ON DUPLICATE KEY UPDATE
            ImposicaoConfigJson = VALUES(ImposicaoConfigJson),
            PastaImposicao = VALUES(PastaImposicao)
        """,
        {
            "produto": nome,
            "variante": var,
            "cfg": normalized,
            "pasta": pasta,
        },
    )
    rows = list_produto_imposicao_configs(nome)
    for row in rows:
        if row["variante"] == var:
            return row
    raise RuntimeError("Falha ao gravar configuração de imposição do produto.")


def delete_produto_imposicao_config(*, produto: str, variante: str) -> dict[str, Any]:
    ensure_produto_imposicao_table()
    nome = normalize_produto(produto)
    var = normalize_variante(variante)
    db.execute_query(
        """
        DELETE FROM tabPapelariaProdutoImposicaoConfigs
        WHERE Produto = %(produto)s AND Variante = %(variante)s
        """,
        {"produto": nome, "variante": var},
    )
    return {"produto": nome, "variante": var, "deleted": True}


def parse_modelo_variants_override(raw: Any) -> dict[str, Optional[dict[str, Any]]]:
    """
    Lê ImposicaoConfigJson do modelo.
    - Legado (objeto com folha_mm): override para digital e offset.
    - Novo {digital, offset}: override por variante (null = sem override).
    """
    from services import papelaria_imposicao_config_service as cfg_svc

    empty: dict[str, Optional[dict[str, Any]]] = {"digital": None, "offset": None}
    if raw is None or raw == "":
        return empty
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return empty
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("ImposicaoConfigJson do modelo inválido.") from exc
    elif isinstance(raw, dict):
        data = raw
    else:
        raise ValueError("ImposicaoConfigJson do modelo inválido.")

    if not isinstance(data, dict):
        raise ValueError("ImposicaoConfigJson do modelo deve ser um objeto JSON.")

    # Novo formato por variante
    if "digital" in data or "offset" in data:
        out = dict(empty)
        for key in ("digital", "offset"):
            if key not in data or data[key] is None:
                continue
            out[key] = cfg_svc.validate_imposicao_config_payload(
                data[key],
                require_marcas_pdf=False,
            )
        return out

    # Legado: um único bloco → override nas duas variantes
    single = cfg_svc.validate_imposicao_config_payload(
        data,
        require_marcas_pdf=False,
    )
    return {"digital": single, "offset": single}


def normalize_modelo_variants_json(raw: Any) -> Optional[str]:
    """Normaliza override do modelo para JSON {digital, offset} ou None."""
    from services import papelaria_imposicao_config_service as cfg_svc

    if raw is None or raw == "":
        return None
    parsed = parse_modelo_variants_override(raw)
    if not parsed["digital"] and not parsed["offset"]:
        return None
    # Ao gravar, PDF de marcas é obrigatório se marcas_corte estiver ativo.
    strict = {
        key: (
            cfg_svc.validate_imposicao_config_payload(cfg, require_marcas_pdf=True)
            if cfg is not None
            else None
        )
        for key, cfg in parsed.items()
    }
    return json.dumps(
        {"digital": strict["digital"], "offset": strict["offset"]},
        ensure_ascii=False,
    )


def _merge_imposicao_override(
    override: Optional[dict[str, Any]],
    base: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """
    Override do modelo sobre o padrão do produto.
    Se o modelo liga marcas_corte mas não traz marcas_pdf_path (legado),
    herda o caminho do produto — evita pedir de novo no modal da OS.
    """
    if not override:
        return base
    if not base:
        return override
    merged = dict(override)
    if merged.get("marcas_corte") and not merged.get("marcas_pdf_path"):
        path = base.get("marcas_pdf_path")
        if path:
            merged["marcas_pdf_path"] = path
    return merged


def resolve_imposicao_opcoes(
    *,
    produto: str,
    modelo_imposicao_config_json: Any = None,
) -> dict[str, Any]:
    """
    Resolve opções Digital/Offset: override do modelo > padrão do produto.
    """
    produto_nome = str(produto or "").strip()
    produto_map: dict[str, Optional[dict[str, Any]]] = {
        "digital": None,
        "offset": None,
    }
    if produto_nome:
        try:
            produto_map = get_produto_imposicao_map(produto_nome)
        except Exception as exc:
            logger.warning("resolve imposicao produto map: %s", exc)
    modelo_map = parse_modelo_variants_override(modelo_imposicao_config_json)
    digital = _merge_imposicao_override(modelo_map["digital"], produto_map["digital"])
    offset = _merge_imposicao_override(modelo_map["offset"], produto_map["offset"])
    fontes = {
        "digital": (
            "modelo"
            if modelo_map["digital"]
            else ("produto" if produto_map["digital"] else None)
        ),
        "offset": (
            "modelo"
            if modelo_map["offset"]
            else ("produto" if produto_map["offset"] else None)
        ),
    }
    return {
        "produto": produto_nome,
        "digital": digital,
        "offset": offset,
        "fontes": fontes,
        "variantes_disponiveis": [
            v for v in ("digital", "offset") if (digital if v == "digital" else offset)
        ],
    }

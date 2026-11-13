"""Validação de ImposicaoConfigJson para modelos Papelaria."""
from __future__ import annotations

import json
from typing import Any

_VALID_ORIGENS = {"borda"}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _require_positive_number(obj: dict[str, Any], key: str, *, allow_zero: bool = False) -> float:
    if key not in obj:
        raise ValueError(f"Campo obrigatório ausente: {key}.")
    value = obj.get(key)
    if not _is_number(value):
        raise ValueError(f"{key} deve ser numérico.")
    num = float(value)
    if allow_zero:
        if num < 0:
            raise ValueError(f"{key} deve ser >= 0.")
    elif num <= 0:
        raise ValueError(f"{key} deve ser > 0.")
    return num


def _require_positive_int(obj: dict[str, Any], key: str) -> int:
    if key not in obj:
        raise ValueError(f"Campo obrigatório ausente: {key}.")
    value = obj.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{key} deve ser inteiro >= 1.")
    num = int(value)
    if num != value or num < 1:
        raise ValueError(f"{key} deve ser inteiro >= 1.")
    return num


def _require_bool(obj: dict[str, Any], key: str) -> bool:
    if key not in obj:
        raise ValueError(f"Campo obrigatório ausente: {key}.")
    value = obj.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{key} deve ser booleano.")
    return value


def validate_imposicao_config_payload(data: Any) -> dict[str, Any]:
    """Valida e retorna dict normalizado da config de imposição."""
    if data is None:
        raise ValueError("Configuração de imposição vazia.")
    if not isinstance(data, dict):
        raise ValueError("Configuração de imposição deve ser um objeto JSON.")

    folha = data.get("folha")
    if not isinstance(folha, dict):
        raise ValueError("Campo obrigatório ausente: folha.")
    folha_out = {
        "largura_mm": _require_positive_number(folha, "largura_mm"),
        "altura_mm": _require_positive_number(folha, "altura_mm"),
    }

    pagina = data.get("pagina")
    if not isinstance(pagina, dict):
        raise ValueError("Campo obrigatório ausente: pagina.")
    origem = pagina.get("origem")
    if not isinstance(origem, str) or origem not in _VALID_ORIGENS:
        raise ValueError(
            f"pagina.origem inválido. Valores: {', '.join(sorted(_VALID_ORIGENS))}."
        )
    rotacao = pagina.get("rotacao_graus", 0)
    if not _is_number(rotacao):
        raise ValueError("pagina.rotacao_graus deve ser numérico.")
    pagina_out = {
        "origem": origem,
        "rotacao_graus": float(rotacao),
    }

    grid = data.get("grid")
    if not isinstance(grid, dict):
        raise ValueError("Campo obrigatório ausente: grid.")
    grid_out = {
        "colunas": _require_positive_int(grid, "colunas"),
        "linhas": _require_positive_int(grid, "linhas"),
        "repeticoes": _require_positive_int(grid, "repeticoes"),
    }

    espacamento = data.get("espacamento_mm")
    if not isinstance(espacamento, dict):
        raise ValueError("Campo obrigatório ausente: espacamento_mm.")
    espacamento_out = {
        "horizontal": _require_positive_number(espacamento, "horizontal", allow_zero=True),
        "vertical": _require_positive_number(espacamento, "vertical", allow_zero=True),
    }

    margens = data.get("margens_mm")
    if not isinstance(margens, dict):
        raise ValueError("Campo obrigatório ausente: margens_mm.")
    margens_out = {
        "esquerda": _require_positive_number(margens, "esquerda", allow_zero=True),
        "direita": _require_positive_number(margens, "direita", allow_zero=True),
        "superior": _require_positive_number(margens, "superior", allow_zero=True),
        "inferior": _require_positive_number(margens, "inferior", allow_zero=True),
    }

    return {
        "folha": folha_out,
        "pagina": pagina_out,
        "grid": grid_out,
        "espacamento_mm": espacamento_out,
        "margens_mm": margens_out,
        "marcas_corte": _require_bool(data, "marcas_corte"),
        "separacao_paginas": _require_bool(data, "separacao_paginas"),
        "incluir_verso": _require_bool(data, "incluir_verso"),
    }


def parse_imposicao_config_json(raw: Any) -> dict[str, Any] | None:
    """Parse JSON do banco; None se vazio."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON inválido: {exc.msg}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("ImposicaoConfigJson deve ser um objeto JSON.")
        return parsed
    raise ValueError("ImposicaoConfigJson em formato não suportado.")


def normalize_imposicao_config_json(raw: Any) -> str | None:
    """Valida e retorna string JSON compactada para persistência."""
    parsed = parse_imposicao_config_json(raw)
    if parsed is None:
        return None
    normalized = validate_imposicao_config_payload(parsed)
    return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))

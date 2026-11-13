"""Validação de ImposicaoConfigJson para modelos Papelaria (campos para JDF Apogee)."""
from __future__ import annotations

import json
from typing import Any

_VALID_ORIGENS = {"borda", "fixixa"}
_VALID_WORK_STYLES = {"Simplex"}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _require_positive_number(
    obj: dict[str, Any],
    key: str,
    *,
    allow_zero: bool = False,
    label: str | None = None,
) -> float:
    name = label or key
    if key not in obj:
        raise ValueError(f"Campo obrigatório ausente: {name}.")
    value = obj.get(key)
    if not _is_number(value):
        raise ValueError(f"{name} deve ser numérico.")
    num = float(value)
    if allow_zero:
        if num < 0:
            raise ValueError(f"{name} deve ser >= 0.")
    elif num <= 0:
        raise ValueError(f"{name} deve ser > 0.")
    return num


def _require_positive_int(obj: dict[str, Any], key: str, *, label: str | None = None) -> int:
    name = label or key
    if key not in obj:
        raise ValueError(f"Campo obrigatório ausente: {name}.")
    value = obj.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} deve ser inteiro >= 1.")
    num = int(value)
    if num != value or num < 1:
        raise ValueError(f"{name} deve ser inteiro >= 1.")
    return num


def _require_bool(obj: dict[str, Any], key: str) -> bool:
    if key not in obj:
        raise ValueError(f"Campo obrigatório ausente: {key}.")
    value = obj.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{key} deve ser booleano.")
    return value


def validate_imposicao_config_payload(data: Any) -> dict[str, Any]:
    """
    Valida e retorna dict normalizado da config de imposição.

    Campos alinhados ao JDF Apogee (Media, TrimSize, Layout NxM step&repeat,
    marcas, sangria/gap, centralização e WorkStyle).
    """
    if data is None:
        raise ValueError("Configuração de imposição vazia.")
    if not isinstance(data, dict):
        raise ValueError("Configuração de imposição deve ser um objeto JSON.")

    # Compat: aceitar legado "folha.largura_mm" → "folha_mm.largura"
    folha = data.get("folha_mm")
    if not isinstance(folha, dict):
        legado = data.get("folha")
        if isinstance(legado, dict):
            folha = {
                "largura": legado.get("largura_mm", legado.get("largura")),
                "altura": legado.get("altura_mm", legado.get("altura")),
            }
        else:
            raise ValueError("Campo obrigatório ausente: folha_mm.")
    folha_out = {
        "largura": _require_positive_number(folha, "largura", label="folha_mm.largura"),
        "altura": _require_positive_number(folha, "altura", label="folha_mm.altura"),
    }

    pagina = data.get("pagina")
    if not isinstance(pagina, dict):
        raise ValueError("Campo obrigatório ausente: pagina.")
    origem = pagina.get("origem")
    if not isinstance(origem, str) or origem not in _VALID_ORIGENS:
        raise ValueError(
            f"pagina.origem inválido. Valores: {', '.join(sorted(_VALID_ORIGENS))}."
        )
    pagina_out: dict[str, Any] = {"origem": origem}
    if origem == "fixixa":
        pagina_out["largura_mm"] = _require_positive_number(
            pagina, "largura_mm", label="pagina.largura_mm"
        )
        pagina_out["altura_mm"] = _require_positive_number(
            pagina, "altura_mm", label="pagina.altura_mm"
        )

    grid = data.get("grid")
    if not isinstance(grid, dict):
        raise ValueError("Campo obrigatório ausente: grid.")
    grid_out = {
        "colunas": _require_positive_int(grid, "colunas", label="grid.colunas"),
        "linhas": _require_positive_int(grid, "linhas", label="grid.linhas"),
    }

    espacamento = data.get("espacamento_mm")
    if not isinstance(espacamento, dict):
        # legado: separacao_paginas false → gap 0
        espacamento = {"horizontal": 0, "vertical": 0}
    espacamento_out = {
        "horizontal": _require_positive_number(
            espacamento, "horizontal", allow_zero=True, label="espacamento_mm.horizontal"
        ),
        "vertical": _require_positive_number(
            espacamento, "vertical", allow_zero=True, label="espacamento_mm.vertical"
        ),
    }

    sangria = data.get("sangria_mm", 0)
    if not _is_number(sangria) or float(sangria) < 0:
        raise ValueError("sangria_mm deve ser numérico >= 0.")

    work_style = data.get("work_style", "Simplex")
    if not isinstance(work_style, str) or work_style not in _VALID_WORK_STYLES:
        raise ValueError(
            f"work_style inválido. Valores: {', '.join(sorted(_VALID_WORK_STYLES))}."
        )

    if "marcas_corte" in data:
        marcas = _require_bool(data, "marcas_corte")
    else:
        marcas = False

    marcas_pdf_raw = data.get("marcas_pdf_path")
    if marcas_pdf_raw is None or marcas_pdf_raw == "":
        marcas_pdf_path: str | None = None
    elif not isinstance(marcas_pdf_raw, str):
        raise ValueError("marcas_pdf_path deve ser texto (caminho do PDF).")
    else:
        marcas_pdf_path = marcas_pdf_raw.strip() or None
        if marcas_pdf_path and not marcas_pdf_path.lower().endswith(".pdf"):
            raise ValueError("marcas_pdf_path deve apontar para um arquivo .pdf.")

    if marcas and not marcas_pdf_path:
        raise ValueError(
            "Com marcas de corte ativas, informe marcas_pdf_path (PDF de marcas)."
        )
    if not marcas:
        marcas_pdf_path = None

    if "centralizar_na_folha" in data:
        centralizar = _require_bool(data, "centralizar_na_folha")
    else:
        centralizar = True

    return {
        "folha_mm": folha_out,
        "pagina": pagina_out,
        "grid": grid_out,
        "espacamento_mm": espacamento_out,
        "sangria_mm": float(sangria),
        "marcas_corte": marcas,
        "marcas_pdf_path": marcas_pdf_path,
        "centralizar_na_folha": centralizar,
        "work_style": work_style,
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

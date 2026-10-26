"""Carga e gravação do YAML local do letreiro."""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Optional

import yaml

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.yaml"
EXAMPLE_PATH = ROOT / "config.example.yaml"

INBOX_COLUMN_SOURCE = "inbox"

DEFAULT_BOARD: dict[str, Any] = {
    "sector": "SEFOC",
    "columnCount": 4,
    "columns": [
        {
            "id": "col_0",
            "title": "p/ Triagem",
            "statuses": [
                "Saída p/",
                "Saída parcial p/",
                "Entrada Inicial",
                "Tramit. de Prova p/",
                "Tramit. de Prévia p/",
                "Comentário",
            ],
        },
        {
            "id": "col_1",
            "title": "p/ Execução",
            "statuses": ["Em Execução", "Recebido"],
        },
        {
            "id": "col_2",
            "title": "Prob. Téc.",
            "statuses": ["Problemas Técnicos", "Problema Técnico"],
            "hideWhenEmpty": True,
        },
        {
            "id": "col_3",
            "title": "enviar E-mail",
            "statuses": ["Encam. de Docum."],
        },
    ],
}

DEFAULT_WINDOW: dict[str, Any] = {
    "width": 720,
    "x": None,
    "opacity": 0.95,
    "speed_px_per_sec": 40,
}

DEFAULT_CONFIG: dict[str, Any] = {
    "api_base_url": "http://127.0.0.1:8001/api",
    "ssl_verify": False,
    "ponto": "",
    "nome": "",
    "password": "",
    "poll_interval_sec": 10,
    "window": copy.deepcopy(DEFAULT_WINDOW),
    "board": copy.deepcopy(DEFAULT_BOARD),
}


def _clamp_int(value: Any, lo: int, hi: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(lo, min(hi, parsed))


def _clamp_float(value: Any, lo: float, hi: float, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(lo, min(hi, parsed))


def normalize_column(col: Any, index: int) -> dict[str, Any]:
    raw = col if isinstance(col, dict) else {}
    sector = str(raw.get("sector") or "").strip()
    is_inbox = raw.get("source") == INBOX_COLUMN_SOURCE
    statuses = raw.get("statuses") if isinstance(raw.get("statuses"), list) else []
    out: dict[str, Any] = {
        "id": str(raw.get("id") or f"col_{index}"),
        "title": str(raw.get("title") or f"Coluna {index + 1}"),
        "statuses": [str(s) for s in statuses],
    }
    if sector and not is_inbox:
        out["sector"] = sector
    if raw.get("hideWhenEmpty") is True:
        out["hideWhenEmpty"] = True
    if is_inbox:
        out["source"] = INBOX_COLUMN_SOURCE
    return out


def normalize_board(raw: Any) -> dict[str, Any]:
    parsed = raw if isinstance(raw, dict) else {}
    columns_raw = parsed.get("columns")
    if not isinstance(columns_raw, list) or not columns_raw:
        columns_raw = DEFAULT_BOARD["columns"]
    columns = [normalize_column(col, i) for i, col in enumerate(columns_raw[:6])]
    if not columns:
        columns = [normalize_column(c, i) for i, c in enumerate(DEFAULT_BOARD["columns"])]
    return {
        "sector": str(parsed.get("sector") or DEFAULT_BOARD["sector"]).strip() or "SEFOC",
        "columnCount": len(columns),
        "columns": columns,
    }


def normalize_window(raw: Any) -> dict[str, Any]:
    parsed = raw if isinstance(raw, dict) else {}
    x_raw = parsed.get("x", None)
    x: Optional[int]
    try:
        x = int(x_raw) if x_raw is not None and x_raw != "" else None
    except (TypeError, ValueError):
        x = None
    return {
        "width": _clamp_int(parsed.get("width"), 320, 4000, DEFAULT_WINDOW["width"]),
        "x": x,
        "opacity": _clamp_float(parsed.get("opacity"), 0.4, 1.0, DEFAULT_WINDOW["opacity"]),
        "speed_px_per_sec": _clamp_float(
            parsed.get("speed_px_per_sec"), 8.0, 160.0, DEFAULT_WINDOW["speed_px_per_sec"]
        ),
    }


def normalize_config(raw: Any) -> dict[str, Any]:
    parsed = raw if isinstance(raw, dict) else {}
    return {
        "api_base_url": str(parsed.get("api_base_url") or DEFAULT_CONFIG["api_base_url"]).rstrip("/"),
        "ssl_verify": bool(parsed.get("ssl_verify", False)),
        "ponto": str(parsed.get("ponto") or "").strip(),
        "nome": str(parsed.get("nome") or "").strip(),
        "password": str(parsed.get("password") or ""),
        "poll_interval_sec": _clamp_int(parsed.get("poll_interval_sec"), 5, 120, 10),
        "window": normalize_window(parsed.get("window")),
        "board": normalize_board(parsed.get("board")),
    }


def load_config(path: Optional[Path] = None) -> dict[str, Any]:
    target = path or CONFIG_PATH
    if not target.exists():
        if EXAMPLE_PATH.exists():
            data = yaml.safe_load(EXAMPLE_PATH.read_text(encoding="utf-8")) or {}
            cfg = normalize_config(data)
            save_config(cfg, target)
            return cfg
        cfg = normalize_config(copy.deepcopy(DEFAULT_CONFIG))
        save_config(cfg, target)
        return cfg
    data = yaml.safe_load(target.read_text(encoding="utf-8")) or {}
    return normalize_config(data)


def save_config(config: dict[str, Any], path: Optional[Path] = None) -> None:
    target = path or CONFIG_PATH
    payload = normalize_config(config)
    target.write_text(
        yaml.safe_dump(payload, allow_unicode=True, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )


def restore_default_board(config: dict[str, Any]) -> dict[str, Any]:
    next_cfg = copy.deepcopy(config)
    next_cfg["board"] = copy.deepcopy(DEFAULT_BOARD)
    return normalize_config(next_cfg)

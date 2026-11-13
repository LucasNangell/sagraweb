"""Modo de geração de provas da papelaria e correspondência WEB → CSP."""
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_SETTINGS_PATH = Path(__file__).resolve().parents[3] / "config" / "papelaria_settings.json"
_lock = threading.Lock()

MODO_PROVA_WEB = "prova_web"
MODO_PROVA_EMAIL = "prova_email"
MODOS = (MODO_PROVA_WEB, MODO_PROVA_EMAIL)

# Nome cadastrado (pasta CSP\WEB) → arquivo na pasta CSP.
EMAIL_MODEL_ALIASES: dict[str, str] = {
    "CtCump.cdr": "CtdeCumprimento.cdr",
    "CtCumpRS.cdr": "CtdeCumprimentoR.cdr",
    "CtDpPsLt.cdr": "CtDuploPaisagemLateral.cdr",
    "CtDpPsLtRS.cdr": "CtDuploPaisagemLateralR.cdr",
    "CtDpPsTp.cdr": "CtDuploPaisagemTopo.cdr",
    "CtDpPsTpRS.cdr": "CtDuploPaisagemTopoR.cdr",
    "CtDpRtLt.cdr": "CtDuploRetratoLateral.cdr",
    "CtDpRtLtRS.cdr": "CtDuploRetratoLateralR.cdr",
    "CtGabSimples.cdr": "CtGabSimples(Cor).cdr",
    "CtGabSimplesRS.cdr": "CtGabSimples(Cor)R.cdr",
    # WEB CtVisita.cdr = Somente Frente ("Ct Visita F") → CSP CtVisitaF.cdr
    # WEB CtVisitaFV.cdr = Frente e Verso → CSP CtVisita.cdr (FV)
    "CtVisita.cdr": "CtVisitaF.cdr",
    "CtVisitaFV.cdr": "CtVisita.cdr",
    "CtVisitaRS.cdr": "CtVisitaR.cdr",
    "PastaCBolso.cdr": "PastaAvulsocBolso.cdr",
    "PastaSBolso.cdr": "PastaAvulsoSemBolso.cdr",
    "BlocoA5.cdr": "BlocoA5.cdr",
    "TimbradoA4.cdr": "TimbradoA4.cdr",
}

_ALIASES_BY_KEY = {key.lower(): value for key, value in EMAIL_MODEL_ALIASES.items()}


def _normalize_arquivo(nome: str) -> str:
    base = os.path.basename((nome or "").strip().replace("/", "\\"))
    if base and not base.lower().endswith(".cdr"):
        base = f"{base}.cdr"
    return base


def resolve_arquivo_email(arquivo: str) -> str | None:
    """Nome do .cdr na pasta CSP, ou None quando o modelo não tem equivalente."""
    key = _normalize_arquivo(arquivo).lower()
    if not key:
        return None
    return _ALIASES_BY_KEY.get(key)


def get_modo() -> str:
    return get_public_settings()["modo"]


def get_public_settings() -> dict[str, str]:
    with _lock:
        raw = _load_raw()
    modo = raw.get("modo")
    if isinstance(modo, str) and modo.strip() in MODOS:
        return {"modo": modo.strip()}
    return {"modo": MODO_PROVA_WEB}


def set_modo(modo: str) -> None:
    valor = (modo or "").strip()
    if valor not in MODOS:
        raise ValueError("Modo de prova inválido. Use prova_web ou prova_email.")
    with _lock:
        raw = _load_raw()
        raw["modo"] = valor
        _save_raw(raw)


def filtrar_modelos_para_modo(
    modelos: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Prova e-mail usa os mesmos modelos WEB — sem filtrar por alias CSP."""
    return list(modelos), []


def assert_modelo_create_permitido(arquivo: str) -> None:
    """Mantido por compatibilidade; create usa modelos WEB em ambos os modos."""
    return


def _load_raw() -> dict[str, object]:
    if not _SETTINGS_PATH.is_file():
        return {}
    try:
        with _SETTINGS_PATH.open(encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Não foi possível ler %s: %s", _SETTINGS_PATH, exc)
        return {}


def _save_raw(data: dict[str, object]) -> None:
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _SETTINGS_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    tmp.replace(_SETTINGS_PATH)

"""Estilo tipográfico de campos do modelo na prévia (``dados.__campos_estilo``)."""
from __future__ import annotations

import json
from typing import Any

CAMPOS_ESTILO_DADOS_KEY = "__campos_estilo"
ALIGN_H = frozenset({"esquerda", "centro", "direita"})
ALIGN_V = frozenset({"topo", "meio", "base"})
TAMANHO_MIN = 4.0
TAMANHO_MAX = 72.0
ESTILOS_MAX = 200


class CamposEstiloError(ValueError):
    """JSON / formato inválido de ``__campos_estilo``."""


def normalizar_campos_estilo(raw: Any) -> dict[str, dict[str, Any]]:
    if raw in (None, ""):
        return {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise CamposEstiloError("Campos estilo: JSON inválido.") from exc
    if not isinstance(raw, dict):
        raise CamposEstiloError("Campos estilo devem ser um objeto.")
    if len(raw) > ESTILOS_MAX:
        raise CamposEstiloError("Campos estilo demais.")
    out: dict[str, dict[str, Any]] = {}
    for chave, valor in raw.items():
        partes = str(chave).split(":", 2)
        if len(partes) != 3 or not partes[0].isdigit() or not partes[1].isdigit() or not partes[2]:
            raise CamposEstiloError("Chave de estilo de campo inválida.")
        if not isinstance(valor, dict):
            raise CamposEstiloError("Estilo de campo inválido.")
        entry: dict[str, Any] = {}
        if "tamanho_pt" in valor and valor.get("tamanho_pt") not in (None, ""):
            try:
                tam = float(valor["tamanho_pt"])
            except (TypeError, ValueError) as exc:
                raise CamposEstiloError("Tamanho de estilo inválido.") from exc
            if not (TAMANHO_MIN <= tam <= TAMANHO_MAX):
                raise CamposEstiloError("Tamanho de estilo fora da faixa.")
            entry["tamanho_pt"] = tam
        ah = str(valor.get("align_h") or "").strip().lower()
        if ah:
            if ah not in ALIGN_H:
                raise CamposEstiloError("Alinhamento horizontal de estilo inválido.")
            entry["align_h"] = ah
        av = str(valor.get("align_v") or "").strip().lower()
        if av:
            if av not in ALIGN_V:
                raise CamposEstiloError("Alinhamento vertical de estilo inválido.")
            entry["align_v"] = av
        for eixo in ("x_pt", "y_pt"):
            if eixo not in valor or valor.get(eixo) in (None, ""):
                continue
            try:
                coord = float(valor[eixo])
            except (TypeError, ValueError) as exc:
                raise CamposEstiloError("Posição de estilo inválida.") from exc
            if not (-5000.0 <= coord <= 5000.0):
                raise CamposEstiloError("Posição de estilo fora da faixa.")
            entry[eixo] = coord
        if entry:
            out[f"{int(partes[0])}:{int(partes[1])}:{partes[2]}"] = entry
    return out


def campos_estilo_dos_dados(dados: dict[str, Any]) -> dict[str, dict[str, Any]]:
    try:
        return normalizar_campos_estilo((dados or {}).get(CAMPOS_ESTILO_DADOS_KEY))
    except CamposEstiloError:
        return {}


def estilo_do_campo(
    estilos: dict[str, dict[str, Any]] | None,
    *,
    modelo_id: int,
    pagina: int,
    marcador: str,
) -> dict[str, Any]:
    if not estilos:
        return {}
    chave = f"{int(modelo_id)}:{int(pagina)}:{marcador}"
    return estilos.get(chave) or {}


def estilos_do_modelo(dados: dict[str, Any], modelo_id: int) -> dict[str, dict[str, Any]]:
    """Estilos de um modelo, chave ``"pagina:marcador"``."""
    todos = campos_estilo_dos_dados(dados or {})
    prefixo = f"{int(modelo_id)}:"
    return {k[len(prefixo) :]: v for k, v in todos.items() if k.startswith(prefixo)}


def ancora_de_align_v(align_v: str | None) -> str | None:
    """UI usa ``meio``; o render usa âncora ``centro``."""
    av = str(align_v or "").strip().lower()
    if av == "meio":
        return "centro"
    if av in ("topo", "base", "centro"):
        return av
    return None


def align_v_de_ancora(ancora: str | None) -> str:
    a = str(ancora or "").strip().lower()
    if a == "centro":
        return "meio"
    if a in ("topo", "base"):
        return a
    return "topo"

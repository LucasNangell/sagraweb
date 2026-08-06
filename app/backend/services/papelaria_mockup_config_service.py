"""Validação de MockupConfigJson para modelos Papelaria."""
from __future__ import annotations

import json
from typing import Any

_VALID_MODOS = {
    "folha_simples",
    "cartao_simples",
    "cartao_dobrado",
    "folder",
    "pasta",
    "bloco",
}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_mockup_config_payload(data: Any) -> dict[str, Any]:
    """
    Valida estrutura mínima do mockup 3D.
    Retorna dict normalizado ou levanta ValueError com mensagem clara.
    """
    if data is None:
        raise ValueError("Configuração de mockup vazia.")

    if not isinstance(data, dict):
        raise ValueError("Configuração de mockup deve ser um objeto JSON.")

    modo = data.get("modo")
    if not modo or not isinstance(modo, str):
        raise ValueError("Campo obrigatório ausente: modo.")
    if modo not in _VALID_MODOS:
        raise ValueError(
            f"modo inválido: {modo}. Valores: {', '.join(sorted(_VALID_MODOS))}."
        )

    faces = data.get("faces")
    if not isinstance(faces, list) or not faces:
        raise ValueError("Campo obrigatório ausente: faces (lista não vazia).")

    normalized_faces: list[dict[str, Any]] = []
    for idx, face in enumerate(faces):
        if not isinstance(face, dict):
            raise ValueError(f"Face #{idx + 1} deve ser um objeto.")
        face_id = face.get("id")
        if not face_id or not isinstance(face_id, str):
            raise ValueError(f"Face #{idx + 1}: id obrigatório.")
        if "pageIndex" not in face or not _is_number(face.get("pageIndex")):
            raise ValueError(f"Face '{face_id}': pageIndex numérico obrigatório.")
        style3d = face.get("style3d")
        if not isinstance(style3d, dict):
            raise ValueError(f"Face '{face_id}': style3d obrigatório.")

        normalized_faces.append(face)

    largura = data.get("larguraAbertaMm")
    altura = data.get("alturaAbertaMm")
    if not _is_number(largura) or largura <= 0:
        raise ValueError("larguraAbertaMm numérico positivo obrigatório.")
    if not _is_number(altura) or altura <= 0:
        raise ValueError("alturaAbertaMm numérico positivo obrigatório.")

    return data


def parse_mockup_config_json(raw: Any) -> dict[str, Any] | None:
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
            raise ValueError("MockupConfigJson deve ser um objeto JSON.")
        return parsed
    raise ValueError("MockupConfigJson em formato não suportado.")


def normalize_mockup_config_json(raw: Any) -> str | None:
    """Valida e retorna string JSON compactada para persistência."""
    parsed = parse_mockup_config_json(raw)
    if parsed is None:
        return None
    validate_mockup_config_payload(parsed)
    return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))

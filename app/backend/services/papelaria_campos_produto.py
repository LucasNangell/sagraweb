"""
Campos do produto real (Corel já existente na pasta da SP).

Quando o Corel da pasta tem textos que não cabem no template do modelo (ex.:
nome do chefe de gabinete no verso, dois endereços na frente), cada ocorrência
desses objetos vira um campo próprio do formulário — editável no SEFOC e no
portal de aprovação do cliente. A definição fica no job (``dados`` →
``__campos_produto``, JSON):

    {
      "arquivo": "06592-...-CtVisita_Base.cdr",
      "objetos": {
        "Endereco": [
          {"face": "Frente", "x": 17.7, "y": 12.2, "key": "obj_endereco_1"},
          {"face": "Frente", "x": 65.9, "y": 12.2, "key": "obj_endereco_2"}
        ]
      },
      "campos": [
        {"key": "obj_endereco_1", "label": "Endereço — Frente (esquerda)",
         "type": "textarea", "rows": 4}
      ]
    }

``x``/``y`` = centro em mm na face do arquivo final; o worker associa cada
ocorrência à entrada da mesma face mais próxima.
"""
from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Optional

CHAVE_CAMPOS_PRODUTO = "__campos_produto"
_KEY_RE = re.compile(r"^obj_[a-z0-9_]{1,60}$")
_MAX_OBJETOS = 40
_MAX_OCORRENCIAS = 10
_FACES_VALIDAS = re.compile(r"^(Frente|Verso|Página \d{1,3})$")


def slug_objeto(nome: str) -> str:
    t = unicodedata.normalize("NFKD", str(nome or ""))
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")[:40] or "campo"


def chave_campo(nome_objeto: str, indice: int) -> str:
    return f"obj_{slug_objeto(nome_objeto)}_{int(indice)}"


def _chave_nome(nome: str) -> str:
    return re.sub(r"\s+", "", str(nome or "").strip().lower())


def validar_campos_produto(
    raw: Any,
    campos_modelo: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """Valida/normaliza a definição. Retorna None se vazia; ValueError se inválida."""
    if raw in (None, "", {}):
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("Campos do produto: JSON inválido.") from exc
    if not isinstance(raw, dict):
        raise ValueError("Campos do produto devem ser um objeto.")

    nomes_modelo = (
        {_chave_nome(k): k for k in campos_modelo} if isinstance(campos_modelo, dict) else None
    )
    objetos_raw = raw.get("objetos") or {}
    if not isinstance(objetos_raw, dict) or len(objetos_raw) > _MAX_OBJETOS:
        raise ValueError("Campos do produto: objetos inválidos.")

    objetos: dict[str, list[dict[str, Any]]] = {}
    chaves: set[str] = set()
    for nome, entradas in objetos_raw.items():
        nome_s = str(nome or "").strip()
        if not nome_s or len(nome_s) > 120:
            raise ValueError("Campos do produto: nome de objeto inválido.")
        if nomes_modelo is not None:
            if _chave_nome(nome_s) not in nomes_modelo:
                continue  # objeto que o modelo não conhece: ignora
            nome_s = nomes_modelo[_chave_nome(nome_s)]
        if not isinstance(entradas, list) or not entradas or len(entradas) > _MAX_OCORRENCIAS:
            raise ValueError(f"Campos do produto: ocorrências inválidas em '{nome_s}'.")
        lista: list[dict[str, Any]] = []
        for e in entradas:
            if not isinstance(e, dict):
                raise ValueError("Campos do produto: ocorrência inválida.")
            key = str(e.get("key") or "")
            face = str(e.get("face") or "")
            if not _KEY_RE.match(key) or key in chaves:
                raise ValueError(f"Campos do produto: chave inválida '{key}'.")
            if not _FACES_VALIDAS.match(face):
                raise ValueError(f"Campos do produto: face inválida '{face}'.")
            try:
                x = round(float(e.get("x")), 2)
                y = round(float(e.get("y")), 2)
            except (TypeError, ValueError) as exc:
                raise ValueError("Campos do produto: posição inválida.") from exc
            chaves.add(key)
            lista.append({"face": face, "x": x, "y": y, "key": key})
        objetos[nome_s] = lista
    if not objetos:
        return None

    labels: dict[str, dict[str, Any]] = {}
    for c in raw.get("campos") or []:
        if isinstance(c, dict) and str(c.get("key") or "") in chaves:
            labels[str(c["key"])] = c
    campos: list[dict[str, Any]] = []
    for lista in objetos.values():
        for e in lista:
            c = labels.get(e["key"]) or {}
            label = str(c.get("label") or e["key"]).strip()[:120]
            try:
                rows = max(1, min(8, int(c.get("rows") or 2)))
            except (TypeError, ValueError):
                rows = 2
            campos.append({"key": e["key"], "label": label, "type": "textarea", "rows": rows})
    arquivo = str(raw.get("arquivo") or "").strip()[:255]
    return {"arquivo": arquivo, "objetos": objetos, "campos": campos}


def carregar_de_dados(dados: Any) -> Optional[dict[str, Any]]:
    if not isinstance(dados, dict):
        return None
    try:
        return validar_campos_produto(dados.get(CHAVE_CAMPOS_PRODUTO))
    except ValueError:
        return None


def campos_modelo_sem_objetos(
    campos_modelo: dict[str, Any],
    produto: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """Templates do modelo sem os objetos que viraram campos do produto."""
    if not produto:
        return dict(campos_modelo or {})
    tirar = {_chave_nome(n) for n in produto.get("objetos") or {}}
    return {k: v for k, v in (campos_modelo or {}).items() if _chave_nome(k) not in tirar}


def variaveis_ocultas(
    campos_modelo: dict[str, Any],
    produto: Optional[dict[str, Any]],
) -> set[str]:
    """Variáveis usadas só por objetos que viraram campos do produto."""
    if not produto:
        return set()
    from services.papelaria_models_service import extrair_variaveis

    restantes = campos_modelo_sem_objetos(campos_modelo, produto)
    usadas = set()
    for tpl in restantes.values():
        usadas |= extrair_variaveis(str(tpl or ""))
    tiradas = set()
    for nome, tpl in (campos_modelo or {}).items():
        if nome not in restantes:
            tiradas |= extrair_variaveis(str(tpl or ""))
    return tiradas - usadas


def campos_formulario_com_produto(
    campos_formulario: list[dict[str, Any]],
    campos_modelo: dict[str, Any],
    produto: Optional[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Campos exibidos (SEFOC e portal): modelo sem as variáveis ocultas + campos do produto."""
    if not produto:
        return list(campos_formulario or [])
    ocultas = variaveis_ocultas(campos_modelo, produto)
    base = [f for f in campos_formulario or [] if str(f.get("key")) not in ocultas]
    return base + list(produto.get("campos") or [])


def _face_index(face: str) -> int:
    if face == "Frente":
        return 0
    if face == "Verso":
        return 1
    m = re.match(r"^Página (\d+)$", face or "")
    return int(m.group(1)) - 1 if m else 0


def preview_config_com_produto(
    preview_config_json: Optional[str],
    produto: Optional[dict[str, Any]],
) -> Optional[str]:
    """Prévia ao vivo: elemento do objeto passa a mostrar o campo da sua face."""
    if not preview_config_json or not produto:
        return preview_config_json
    try:
        cfg = json.loads(preview_config_json)
    except (TypeError, ValueError):
        return preview_config_json
    if not isinstance(cfg, dict):
        return preview_config_json
    por_nome = {_chave_nome(n): lista for n, lista in (produto.get("objetos") or {}).items()}
    for idx, face in enumerate(cfg.get("faces") or []):
        if not isinstance(face, dict):
            continue
        for el in face.get("elementos") or []:
            if not isinstance(el, dict):
                continue
            lista = por_nome.get(_chave_nome(str(el.get("id") or "")))
            if not lista:
                continue
            da_face = [e for e in lista if _face_index(e["face"]) == idx] or lista
            el["template"] = "{" + da_face[0]["key"] + "}"
    return json.dumps(cfg, ensure_ascii=False)

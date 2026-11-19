"""
Compara os dados do Corel já existente na pasta da SP com os campos do formulário.

Antes de «Criar prova» a partir do .cdr da pasta, o worker inspeciona o arquivo
(fila ``tabPapelariaCdrInspect``) e devolve o texto de cada objeto nomeado.
Aqui o texto que o formulário geraria em cada objeto (mesmo template do worker)
é comparado ao que está no Corel; havendo diferença o usuário escolhe entre
manter os dados originais ou aplicar os do formulário.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

STATUS_SEM_COREL = "sem_corel"

_LINHA_RE = re.compile(r"[ \t ]+")


def normalizar_texto(texto: Any) -> str:
    """Quebras do Corel (\\r, \\x0b, \\u2028) viram \\n; espaços repetidos somem."""
    raw = str(texto or "")
    for quebra in ("\r\n", "\r", "\x0b", " ", " "):
        raw = raw.replace(quebra, "\n")
    linhas = [_LINHA_RE.sub(" ", linha).strip() for linha in raw.split("\n")]
    while linhas and not linhas[-1]:
        linhas.pop()
    while linhas and not linhas[0]:
        linhas.pop(0)
    return "\n".join(linhas)


def preparar_dados(dados: dict[str, Any], modelo: dict[str, Any]) -> dict[str, Any]:
    """Mesmas normalizações do create_job / worker (gabinete, UF, anexo)."""
    from services.papelaria_models_service import extrair_variaveis, normalizar_gabinete

    out = {str(k): v for k, v in (dados or {}).items() if not str(k).startswith("__")}
    if out.get("gabinete"):
        out["gabinete"] = normalizar_gabinete(str(out["gabinete"]))
    if out.get("uf"):
        out["uf"] = str(out["uf"]).upper()
    campos = modelo.get("campos") or {}
    if "anexo" in extrair_variaveis(" ".join(str(v) for v in campos.values())):
        if not out.get("anexo"):
            out["anexo"] = "IV"
    return out


def textos_esperados(template: str, dados: dict[str, Any]) -> list[str]:
    """Texto(s) que o worker escreveria no objeto (Frente/Verso separados)."""
    from services.papelaria_models_service import dividir_frente_verso, substituir_variaveis

    partes = dividir_frente_verso(template)
    if partes:
        return [substituir_variaveis(partes[1], dados) or "", substituir_variaveis(partes[2], dados) or ""]
    return [substituir_variaveis(template, dados) or ""]


def _rotulo_campo(nome: str, template: str, campos_form: list[dict[str, Any]]) -> str:
    from services.papelaria_models_service import extrair_variaveis

    labels = {str(f.get("key")): str(f.get("label") or f.get("key")) for f in campos_form or []}
    usados = [labels[v] for v in sorted(extrair_variaveis(template)) if v in labels]
    return ", ".join(dict.fromkeys(usados)) or nome


def _exclusoes(dados: dict[str, Any]) -> set[str]:
    raw = (dados or {}).get("__exclusoes")
    if not raw:
        return set()
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return set()
    return {str(x) for x in parsed} if isinstance(parsed, list) else set()


def comparar_dados_corel(
    *,
    modelo: dict[str, Any],
    dados: dict[str, Any],
    campos_cdr: dict[str, str],
    ocorrencias_cdr: Optional[dict[str, list[str]]] = None,
    preview_config: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """
    Diferenças entre o Corel da pasta e o formulário, por objeto do modelo.

    Só entram objetos que existem no Corel (os ausentes ficam como estão de
    qualquer forma). Cada item: ``campo``, ``rotulo``, ``original`` (textos do
    Corel) e ``novo`` (texto que o formulário aplicaria).
    """
    from services.papelaria_live_preview_service import overlay_campos_com_templates_preview

    campos_modelo = overlay_campos_com_templates_preview(
        modelo.get("campos") or {}, preview_config
    )
    excluidos = _exclusoes(dados)
    dados_ok = preparar_dados(dados, modelo)
    por_nome = {_chave(k): v for k, v in (campos_cdr or {}).items()}
    ocorr = {_chave(k): v for k, v in (ocorrencias_cdr or {}).items()}

    diferencas: list[dict[str, Any]] = []
    for nome, template in campos_modelo.items():
        if nome in excluidos or template is None:
            continue
        chave = _chave(nome)
        textos = [t for t in (ocorr.get(chave) or []) if t is not None]
        if not textos and chave in por_nome:
            textos = [por_nome[chave]]
        if not textos:
            continue
        esperados = textos_esperados(str(template), dados_ok)
        esperados_norm = {normalizar_texto(e) for e in esperados}
        divergentes = [t for t in textos if normalizar_texto(t) not in esperados_norm]
        if not divergentes:
            continue
        originais = list(dict.fromkeys(normalizar_texto(t) for t in textos))
        novos = list(dict.fromkeys(normalizar_texto(e) for e in esperados))
        diferencas.append(
            {
                "campo": nome,
                "rotulo": _rotulo_campo(nome, str(template), modelo.get("campos_formulario") or []),
                "original": originais,
                "novo": novos,
            }
        )
    return diferencas


def _chave(nome: str) -> str:
    return re.sub(r"\s+", "", str(nome or "").strip().lower())


# ---------------------------------------------------------------------------
# Fluxo (inspeção via worker)
# ---------------------------------------------------------------------------


def iniciar_comparacao(ano: int, nro: int) -> dict[str, Any]:
    """Envia o .cdr da pasta para inspeção. Sem Corel na pasta: ``sem_corel``."""
    from services import papelaria_cdr_inspect_service as inspect_svc
    from services.papelaria_jobs_service import find_os_base_cdr

    base = find_os_base_cdr(ano, nro)
    if not base:
        return {"status": STATUS_SEM_COREL}
    with open(base["absolute_path"], "rb") as handle:
        content = handle.read()
    inspect = inspect_svc.create_inspect_request(content, base["filename"])
    return {
        "status": inspect.get("status") or inspect_svc.STATUS_PENDING,
        "inspect_id": inspect["inspect_id"],
        "arquivo": base["filename"],
        "relative_path": base["relative_path"],
    }


def resultado_comparacao(
    inspect_id: str,
    *,
    modelo_id: int,
    dados: dict[str, Any],
) -> dict[str, Any]:
    """Estado da inspeção; concluída, devolve as diferenças."""
    from services import papelaria_cdr_inspect_service as inspect_svc
    from services import papelaria_models_service as models_svc

    inspect = inspect_svc.get_inspect_request(inspect_id)
    if not inspect:
        raise LookupError("Leitura do Corel não encontrada.")
    status = inspect.get("status")
    base = {"status": status, "inspect_id": inspect_id, "arquivo": inspect.get("filename") or ""}
    if status == inspect_svc.STATUS_FAILED:
        return {**base, "erro": inspect.get("erro") or "Falha ao ler o Corel da pasta."}
    if status != inspect_svc.STATUS_COMPLETED:
        return base

    modelo = models_svc.get_modelo_by_id(int(modelo_id))
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")
    preview_config = None
    raw_preview = modelo.get("preview_config_json")
    if raw_preview:
        try:
            from services import papelaria_live_preview_service as preview_svc

            preview_config = preview_svc.parse_preview_config_json(raw_preview)
        except ValueError:
            preview_config = None
    diferencas = comparar_dados_corel(
        modelo=modelo,
        dados=dados or {},
        campos_cdr=inspect.get("campos") or {},
        ocorrencias_cdr=inspect.get("ocorrencias") or None,
        preview_config=preview_config,
    )
    inspect_svc.discard_inspect_file(inspect_id)
    return {**base, "diferencas": diferencas}


__all__ = [
    "STATUS_SEM_COREL",
    "comparar_dados_corel",
    "iniciar_comparacao",
    "normalizar_texto",
    "resultado_comparacao",
    "textos_esperados",
]

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
    """Rótulo do objeto: o campo do formulário quando o template usa uma variável só."""
    from services.papelaria_models_service import extrair_variaveis

    labels = {str(f.get("key")): str(f.get("label") or f.get("key")) for f in campos_form or []}
    variaveis = sorted(extrair_variaveis(template))
    if len(variaveis) == 1 and variaveis[0] in labels:
        return labels[variaveis[0]]
    return nome


def _exclusoes(dados: dict[str, Any]) -> set[str]:
    raw = (dados or {}).get("__exclusoes")
    if not raw:
        return set()
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return set()
    return {str(x) for x in parsed} if isinstance(parsed, list) else set()


def parear_ocorrencias(
    ocorrencias: list[dict[str, Any]],
    entradas: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    """Mesma regra do worker: mesma face, mais próxima, um para um."""
    pares: list[tuple[float, int, int]] = []
    for oi, oc in enumerate(ocorrencias):
        for ei, e in enumerate(entradas):
            if str(e.get("face") or "") != str(oc.get("face") or ""):
                continue
            dx = float(oc.get("x") or 0) - float(e.get("x") or 0)
            dy = float(oc.get("y") or 0) - float(e.get("y") or 0)
            pares.append((dx * dx + dy * dy, oi, ei))
    pares.sort()
    usados_o: set[int] = set()
    usados_e: set[int] = set()
    out: dict[int, dict[str, Any]] = {}
    for _d, oi, ei in pares:
        if oi in usados_o or ei in usados_e:
            continue
        usados_o.add(oi)
        usados_e.add(ei)
        out[oi] = entradas[ei]
    return out


def _normalizar_ocorrencias(itens: list[Any]) -> list[dict[str, Any]]:
    """Aceita o formato novo ({face,x,y,texto}) e o antigo (só textos)."""
    out: list[dict[str, Any]] = []
    for item in itens or []:
        if isinstance(item, dict):
            out.append(
                {
                    "face": str(item.get("face") or ""),
                    "x": item.get("x"),
                    "y": item.get("y"),
                    "texto": str(item.get("texto") or ""),
                }
            )
        elif item is not None:
            out.append({"face": "", "x": None, "y": None, "texto": str(item)})
    return out


def _rotulos_posicao(ocs: list[dict[str, Any]]) -> list[str]:
    """«Frente», «Verso», «Frente (esquerda)»… para distinguir ocorrências."""
    rotulos = [oc["face"] or "Corel" for oc in ocs]
    por_face: dict[str, list[int]] = {}
    for i, oc in enumerate(ocs):
        por_face.setdefault(oc["face"] or "Corel", []).append(i)
    for face, idxs in por_face.items():
        if len(idxs) < 2:
            continue
        xs = [float(ocs[i].get("x") or 0) for i in idxs]
        ys = [float(ocs[i].get("y") or 0) for i in idxs]
        if max(xs) - min(xs) >= 10:
            ordem = sorted(idxs, key=lambda i: float(ocs[i].get("x") or 0))
            nomes = ["esquerda", "direita"] if len(ordem) == 2 else [f"{n}ª da esquerda" for n in range(1, len(ordem) + 1)]
        else:
            ordem = sorted(idxs, key=lambda i: -float(ocs[i].get("y") or 0))
            nomes = ["superior", "inferior"] if len(ordem) == 2 else [f"{n}ª de cima" for n in range(1, len(ordem) + 1)]
        for nome, i in zip(nomes, ordem):
            rotulos[i] = f"{face} ({nome})"
    return rotulos


def _esperado_por_face(
    template: str, face: str, dados: dict[str, Any], original: str = ""
) -> str:
    from services.papelaria_models_service import dividir_frente_verso, substituir_variaveis

    partes = dividir_frente_verso(template)
    if partes:
        frente = substituir_variaveis(partes[1], dados) or ""
        verso = substituir_variaveis(partes[2], dados) or ""
        if face == "Verso":
            return verso
        if not face and normalizar_texto(original) == normalizar_texto(verso):
            return verso  # sem face (worker antigo): vale qualquer das partes
        return frente
    return substituir_variaveis(template, dados) or ""


def comparar_dados_corel(
    *,
    modelo: dict[str, Any],
    dados: dict[str, Any],
    campos_cdr: dict[str, str],
    ocorrencias_cdr: Optional[dict[str, list[Any]]] = None,
    preview_config: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """
    Diferenças entre o Corel da pasta e o formulário, por objeto do modelo.

    Cada item traz ``ocorrencias`` (face, posição, texto original e o que o
    formulário aplicaria) — base dos campos do produto real. Objetos já
    transformados em campos do produto comparam com os valores desses campos.
    """
    from services.papelaria_campos_produto import carregar_de_dados
    from services.papelaria_live_preview_service import overlay_campos_com_templates_preview

    campos_modelo = overlay_campos_com_templates_preview(
        modelo.get("campos") or {}, preview_config
    )
    excluidos = _exclusoes(dados)
    dados_ok = preparar_dados(dados, modelo)
    produto = carregar_de_dados(dados) or {}
    produto_por_nome = {_chave(n): v for n, v in (produto.get("objetos") or {}).items()}
    por_nome = {_chave(k): v for k, v in (campos_cdr or {}).items()}
    ocorr = {_chave(k): v for k, v in (ocorrencias_cdr or {}).items()}

    diferencas: list[dict[str, Any]] = []
    for nome, template in campos_modelo.items():
        if nome in excluidos or template is None:
            continue
        chave = _chave(nome)
        ocs = _normalizar_ocorrencias(ocorr.get(chave) or [])
        if not ocs and chave in por_nome:
            ocs = _normalizar_ocorrencias([por_nome[chave]])
        if not ocs:
            continue

        entradas = produto_por_nome.get(chave) or []
        pares = parear_ocorrencias(ocs, entradas) if entradas else {}
        rotulos = _rotulos_posicao(ocs)
        itens: list[dict[str, Any]] = []
        difere = False
        for i, oc in enumerate(ocs):
            entrada = pares.get(i)
            if entrada is not None:
                novo = str(dados.get(entrada["key"]) or "")
            else:
                novo = _esperado_por_face(str(template), oc["face"], dados_ok, oc["texto"])
            original = normalizar_texto(oc["texto"])
            novo_n = normalizar_texto(novo)
            if original != novo_n:
                difere = True
            itens.append(
                {
                    "face": oc["face"],
                    "x": oc["x"],
                    "y": oc["y"],
                    "rotulo": rotulos[i],
                    "original": original,
                    "novo": novo_n,
                    "key": entrada["key"] if entrada else None,
                }
            )
        if not difere:
            continue
        diferencas.append(
            {
                "campo": nome,
                "rotulo": _rotulo_campo(nome, str(template), modelo.get("campos_formulario") or []),
                # Sem face/posição (worker antigo) não dá para criar campos por ocorrência.
                "editavel": all(oc["face"] and oc["x"] is not None for oc in ocs),
                "ocorrencias": itens,
                "original": list(dict.fromkeys(it["original"] for it in itens)),
                "novo": list(dict.fromkeys(it["novo"] for it in itens)),
            }
        )
    return diferencas


def _chave(nome: str) -> str:
    return re.sub(r"\s+", "", str(nome or "").strip().lower())


# ---------------------------------------------------------------------------
# Fluxo (inspeção via worker)
# ---------------------------------------------------------------------------


def iniciar_comparacao(ano: int, nro: int, modelo_id: Optional[int] = None) -> dict[str, Any]:
    """Envia o .cdr da pasta para inspeção. Sem Corel na pasta: ``sem_corel``."""
    from services import papelaria_cdr_inspect_service as inspect_svc
    from services.papelaria_jobs_service import find_os_base_cdr

    base = find_os_base_cdr(ano, nro)
    if not base:
        return {"status": STATUS_SEM_COREL}
    modelo_arquivo = ""
    if modelo_id:
        from services import papelaria_models_service as models_svc

        modelo = models_svc.get_modelo_by_id(int(modelo_id))
        modelo_arquivo = str((modelo or {}).get("arquivo_modelo") or "").strip()
    with open(base["absolute_path"], "rb") as handle:
        content = handle.read()
    # O modelo dá o formato do produto: o worker identifica Frente/Verso.
    inspect = inspect_svc.create_inspect_request(
        content, base["filename"], modelo_arquivo=modelo_arquivo or None
    )
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
    "parear_ocorrencias",
    "resultado_comparacao",
    "textos_esperados",
]

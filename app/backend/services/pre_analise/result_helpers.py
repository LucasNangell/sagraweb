"""Estrutura padronizada de retorno das verificações."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional, Tuple

_MSG_ARQUIVO_PAGINA = re.compile(
    r'^("(?:\\.|[^"])+")\s+(?:pág\.\s*(\d+)|—\s+Página\s+(\d+)):\s*(.*)$',
    re.IGNORECASE | re.DOTALL,
)
_CANTO_LOCAL = re.compile(r"^canto\s+(\w+):\s*(.+)$", re.IGNORECASE)

Severidade = Literal["ok", "info", "warning", "error"]


def achado(
    codigo: str,
    titulo: str,
    mensagem: str,
    severidade: Severidade = "warning",
    **detalhes: Any,
) -> Dict[str, Any]:
    item: Dict[str, Any] = {
        "codigo": codigo,
        "titulo": titulo,
        "mensagem": mensagem,
        "severidade": severidade,
    }
    if detalhes:
        item["detalhes"] = detalhes
    return item


def _parse_mensagem_local(mensagem: str) -> Tuple[str, Optional[int], str, Optional[str]]:
    """
    Extrai prefixo (arquivo + página), número da página, texto do problema e local (ex.: canto).

    Ex.: "capa.pdf" pág. 1: canto tl: marcas sobrepostas (~0.3 mm)
    """
    texto = mensagem.strip()
    match = _MSG_ARQUIVO_PAGINA.match(texto)
    if not match:
        return texto, None, texto, None

    arquivo = match.group(1)
    pagina = int(match.group(2) or match.group(3))
    corpo = match.group(4).strip().rstrip(".")
    prefixo = f"{arquivo} pág. {pagina}"

    canto = _CANTO_LOCAL.match(corpo)
    if canto:
        return prefixo, pagina, canto.group(2).strip(), canto.group(1).lower()

    return prefixo, pagina, corpo, None


def consolidar_achados(achados: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Agrupa alertas repetidos do mesmo tipo no mesmo arquivo/página,
    listando os locais em uma única entrada.
    """
    resultado: List[Dict[str, Any]] = []
    indice_grupo: Dict[Tuple[Any, ...], int] = {}

    for item in achados:
        severidade = item.get("severidade", "ok")
        if severidade not in ("warning", "error"):
            resultado.append(item)
            continue

        codigo = item.get("codigo", "")
        titulo = item.get("titulo", "")
        detalhes = item.get("detalhes") or {}
        arquivo = detalhes.get("arquivo")
        pagina = detalhes.get("pagina")

        if arquivo is not None and pagina is not None:
            chave: Tuple[Any, ...] = (codigo, titulo, str(arquivo), int(pagina))
        else:
            chave = (codigo, titulo, item.get("mensagem", ""))

        prefixo, _, corpo, local = _parse_mensagem_local(item.get("mensagem", ""))

        if chave not in indice_grupo:
            indice_grupo[chave] = len(resultado)
            resultado.append(
                {
                    **item,
                    "_agrupado": {
                        "prefixo": prefixo,
                        "tipo": corpo if local else None,
                        "locais": [local] if local else [],
                        "partes": [] if local else [corpo],
                    },
                }
            )
            continue

        agrupado = resultado[indice_grupo[chave]].setdefault(
            "_agrupado",
            {"prefixo": prefixo, "tipo": None, "locais": [], "partes": []},
        )
        if local:
            if local not in agrupado["locais"]:
                agrupado["locais"].append(local)
            if not agrupado.get("tipo"):
                agrupado["tipo"] = corpo
        elif corpo and corpo not in agrupado["partes"]:
            agrupado["partes"].append(corpo)

    for item in resultado:
        agrupado = item.pop("_agrupado", None)
        if not agrupado:
            continue

        prefixo = agrupado["prefixo"]
        if agrupado.get("locais") and agrupado.get("tipo"):
            locais_txt = ", ".join(f"canto {loc}" for loc in agrupado["locais"])
            item["mensagem"] = f"{prefixo}: {agrupado['tipo']} ({locais_txt})."
        elif len(agrupado.get("partes") or []) > 1:
            item["mensagem"] = f"{prefixo}: {'; '.join(agrupado['partes'])}."
        elif len(agrupado.get("partes") or []) == 1:
            item["mensagem"] = f"{prefixo}: {agrupado['partes'][0]}."

    return resultado


def finalize_result(
    achados: List[Dict[str, Any]],
    pdf_count: int = 0,
    files: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    achados = consolidar_achados(achados)
    problemas = [
        a for a in achados if a.get("severidade") in ("warning", "error")
    ]
    status: Severidade = "ok"
    for item in problemas:
        sev = item.get("severidade", "ok")
        if sev == "error":
            status = "error"
            break
        if sev == "warning":
            status = "warning"

    mensagens = [a["mensagem"] for a in problemas]
    if not mensagens:
        mensagem = "Nenhum problema detectado nesta verificação."
        if achados:
            mensagem = achados[0].get("mensagem", mensagem)
    else:
        mensagem = " ".join(mensagens[:3])
        if len(mensagens) > 3:
            mensagem += f" (+{len(mensagens) - 3} alerta(s))"

    return {
        "status": status,
        "mensagem": mensagem,
        "achados": achados,
        "pdf_count": pdf_count,
        "files": files or [],
    }


def timeout_result(
    check_nome: str,
    timeout_sec: float,
) -> Dict[str, Any]:
    """Retorno quando a verificação excede o tempo limite."""
    msg = (
        f"Verificação interrompida após {timeout_sec:g} s (tempo limite). "
        "A análise seguiu para o próximo item."
    )
    return finalize_result(
        [
            achado(
                "verificacao_timeout",
                check_nome,
                msg,
                "warning",
                timeout_sec=timeout_sec,
            )
        ],
        pdf_count=0,
        files=[],
    )

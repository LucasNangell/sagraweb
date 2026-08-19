"""
Geração Corel/PDF — lógica extraída de Modelos/papelaria/papelaria.py.
Sempre trabalha em cópia temporária do modelo; nunca salva por cima do original.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from typing import Any, Callable, Optional

from runtime import dispatch_corel_application

logger = logging.getLogger(__name__)


class CorelGenerationError(Exception):
    pass


# HRESULT COM comuns (pywintypes.com_error args[0])
_COM_HRESULT_MESSAGES: dict[int, str] = {
    -2146959355: (
        "Não foi possível iniciar o CorelDRAW nesta máquina. "
        "Verifique se o CorelDRAW está instalado, licenciado e não bloqueado "
        "por outro processo."
    ),
    -2147221164: (
        "CorelDRAW não está instalado ou não está registrado no Windows "
        "(automação COM indisponível)."
    ),
    -2147024891: "Acesso negado ao recurso solicitado.",
    -2147024894: "Arquivo não encontrado.",
    -2147024893: "Caminho não encontrado ou indisponível na rede.",
    -2147024864: "Arquivo em uso por outro programa — feche o CorelDRAW ou o arquivo e tente novamente.",
    -2147220995: "Conexão com o CorelDRAW perdida durante a geração.",
    -2147023174: "CorelDRAW não respondeu (RPC indisponível).",
    -2147417848: "CorelDRAW ocupado — operação não concluída a tempo.",
}


def humanizar_erro_corel(exc: BaseException, *, contexto: str = "") -> str:
    """Traduz erros COM/OS genéricos para mensagens claras ao usuário."""
    prefixo = f"{contexto}: " if contexto else ""

    try:
        import pywintypes

        if isinstance(exc, pywintypes.com_error):
            hr = int(exc.args[0]) if exc.args else None
            if hr is not None and hr in _COM_HRESULT_MESSAGES:
                return prefixo + _COM_HRESULT_MESSAGES[hr]
            texto = str(exc.args[1]).strip() if len(exc.args) > 1 and exc.args[1] else ""
            if texto and texto.lower() not in ("none", "falha na execução do servidor"):
                return prefixo + texto
            if hr is not None:
                return prefixo + (
                    f"Erro do CorelDRAW (código {hr}). "
                    "Verifique instalação, licença e acesso aos arquivos."
                )
    except Exception:
        pass

    if isinstance(exc, CorelGenerationError):
        return prefixo + str(exc)

    if isinstance(exc, FileNotFoundError):
        return prefixo + (
            f"Arquivo não encontrado: {exc.filename or exc}. "
            "Confira se o modelo .cdr existe na pasta de modelos do worker "
            "e se o caminho de rede está acessível."
        )

    if isinstance(exc, PermissionError):
        alvo = getattr(exc, "filename", None) or str(exc)
        return prefixo + (
            f"Sem permissão para acessar ou gravar: {alvo}. "
            "Verifique permissões de rede/pasta com o administrador."
        )

    if isinstance(exc, OSError):
        msg = str(exc).lower()
        alvo = getattr(exc, "filename", None) or ""
        if exc.errno in (13, 5) or "permission" in msg or "acesso negado" in msg:
            return prefixo + (
                f"Sem permissão para acessar o caminho{f': {alvo}' if alvo else ''}. "
                "Verifique permissões de rede/pasta."
            )
        if exc.errno in (2, 3) or "not found" in msg or "não encontrado" in msg:
            return prefixo + (
                f"Caminho ou arquivo não encontrado{f': {alvo}' if alvo else ''}. "
                "Verifique se a pasta da OS e o modelo existem e estão acessíveis."
            )
        if "network" in msg or "rede" in msg or "unc" in msg:
            return prefixo + (
                "Caminho de rede indisponível. Verifique conexão com o servidor de arquivos."
            )

    texto = str(exc).strip()
    if texto.startswith("(-214") and "Falha na execução do servidor" in texto:
        return prefixo + _COM_HRESULT_MESSAGES[-2146959355]

    if texto:
        return prefixo + texto
    return prefixo + "Falha desconhecida na geração Corel/PDF."


def validar_acesso_job(
    caminho_modelo: str,
    output_dir: str,
    *,
    models_cache_dir: str = "",
) -> None:
    """Valida modelo e pasta de saída antes de abrir o CorelDRAW (fail-fast)."""
    if not caminho_modelo or not str(caminho_modelo).strip():
        raise CorelGenerationError("Caminho do modelo .cdr não informado.")

    if not os.path.isfile(caminho_modelo):
        raise CorelGenerationError(
            humanizar_erro_corel(
                FileNotFoundError(caminho_modelo),
                contexto="Modelo indisponível",
            )
        )

    try:
        with open(caminho_modelo, "rb") as handle:
            handle.read(1)
    except OSError as exc:
        raise CorelGenerationError(
            humanizar_erro_corel(exc, contexto="Não foi possível ler o modelo")
        ) from exc

    if models_cache_dir:
        try:
            os.makedirs(models_cache_dir, exist_ok=True)
        except OSError as exc:
            raise CorelGenerationError(
                humanizar_erro_corel(exc, contexto="Cache local de modelos indisponível")
            ) from exc

    if not output_dir or not str(output_dir).strip():
        raise CorelGenerationError("Pasta de saída (Sefoc da OS) não informada.")

    try:
        os.makedirs(output_dir, exist_ok=True)
        probe = os.path.join(output_dir, ".sagra_write_probe")
        with open(probe, "w", encoding="utf-8") as handle:
            handle.write("ok")
        os.remove(probe)
    except OSError as exc:
        raise CorelGenerationError(
            humanizar_erro_corel(
                exc,
                contexto=f"Não foi possível gravar na pasta de saída ({output_dir})",
            )
        ) from exc


def validar_acesso_export_cdr(caminho_cdr: str, output_dir: str) -> None:
    """Valida CDR existente da OS e pasta de saída antes de exportar PDF."""
    if not caminho_cdr or not str(caminho_cdr).strip():
        raise CorelGenerationError("Caminho do Corel existente não informado.")

    if not os.path.isfile(caminho_cdr):
        raise CorelGenerationError(
            humanizar_erro_corel(
                FileNotFoundError(caminho_cdr),
                contexto="Corel da OS indisponível",
            )
        )

    try:
        with open(caminho_cdr, "rb") as handle:
            handle.read(1)
    except OSError as exc:
        raise CorelGenerationError(
            humanizar_erro_corel(exc, contexto="Não foi possível ler o Corel da OS")
        ) from exc

    if not output_dir or not str(output_dir).strip():
        raise CorelGenerationError("Pasta de saída (Sefoc da OS) não informada.")

    try:
        os.makedirs(output_dir, exist_ok=True)
        probe = os.path.join(output_dir, ".sagra_write_probe")
        with open(probe, "w", encoding="utf-8") as handle:
            handle.write("ok")
        os.remove(probe)
    except OSError as exc:
        raise CorelGenerationError(
            humanizar_erro_corel(
                exc,
                contexto=f"Não foi possível gravar na pasta de saída ({output_dir})",
            )
        ) from exc


def encerrar_corel_forcadamente(*, matar_processo: bool = False) -> None:
    """Encerra sessão COM; opcionalmente finaliza CorelDRW.exe (job cancelado/timeout)."""
    reset_corel_session()
    if not matar_processo:
        return
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    for image_name in COREL_PROCESS_IMAGE_NAMES:
        try:
            subprocess.run(
                ["taskkill", "/F", "/IM", image_name],
                capture_output=True,
                timeout=15,
                creationflags=flags,
            )
        except Exception:
            pass


@dataclass
class GenerationResult:
    cdr_path: str
    pdf_path: str
    logs: list[str]


def limpar_nome_arquivo(texto: str) -> str:
    texto = str(texto).strip()
    texto = re.sub(r'[\\/*?:"<>|]', "", texto)
    texto = re.sub(r"\s+", "_", texto)
    return texto


def normalizar_gabinete(valor: str) -> str:
    numeros = re.findall(r"\d+", str(valor))
    if not numeros:
        return str(valor).strip()
    numero = numeros[-1]
    if len(numero) > 3:
        numero = numero[-3:]
    return numero.zfill(3)


def normalizar_quebras_para_corel(texto: Optional[str]) -> str:
    if texto is None:
        return ""
    texto = str(texto)
    texto = texto.replace("\r\n", "\n").replace("\r", "\n")
    return texto.replace("\n", chr(13))


VARIAVEIS_DERIVADAS = frozenset({"artigo", "genero_curto"})


def enriquecer_variaveis_derivadas(dados: dict[str, Any]) -> dict[str, Any]:
    out = dict(dados)
    feminino = "deputada" in str(out.get("genero") or "").lower()
    out["artigo"] = "da" if feminino else "do"
    out["genero_curto"] = "Deputada" if feminino else "Deputado"
    return out


def parse_inline_bold(texto: str) -> tuple[str, list[tuple[int, int]]]:
    """Remove pares `**...**` e devolve texto plano + intervalos 0-based em negrito."""
    plain_parts: list[str] = []
    ranges: list[tuple[int, int]] = []
    plain_len = 0
    i = 0
    n = len(texto)
    while i < n:
        if texto.startswith("**", i):
            close = texto.find("**", i + 2)
            if close < 0:
                plain_parts.append(texto[i:])
                break
            inner = texto[i + 2 : close]
            if inner:
                start = plain_len
                plain_parts.append(inner)
                plain_len += len(inner)
                ranges.append((start, start + len(inner)))
            i = close + 2
            continue
        plain_parts.append(texto[i])
        plain_len += 1
        i += 1
    return "".join(plain_parts), ranges


def _substituir_placeholders(texto_modelo: str, dados: dict[str, Any]) -> str:
    resolvidos = enriquecer_variaveis_derivadas(dados)

    def trocar(match: re.Match[str]) -> str:
        nome_var = match.group(1).strip()
        if nome_var == "nome_acessor":
            nome_var = "nome_assessor"
        return str(resolvidos.get(nome_var, ""))

    return re.sub(r"\{([^{}]+)\}", trocar, texto_modelo)


def substituir_variaveis_com_estilo(
    texto_modelo: Optional[str], dados: dict[str, Any]
) -> Optional[tuple[str, list[tuple[int, int]]]]:
    if texto_modelo is None:
        return None
    texto = _substituir_placeholders(str(texto_modelo), dados)
    texto = texto.replace("\r\n", "\n").replace("\r", "\n")
    plain, ranges = parse_inline_bold(texto)
    return normalizar_quebras_para_corel(plain), ranges


def substituir_variaveis(texto_modelo: Optional[str], dados: dict[str, Any]) -> Optional[str]:
    if texto_modelo is None:
        return None
    styled = substituir_variaveis_com_estilo(texto_modelo, dados)
    if styled is None:
        return None
    return styled[0]


def extrair_variaveis(texto: Optional[str]) -> set[str]:
    if not texto:
        return set()
    variaveis = set(re.findall(r"\{([^{}]+)\}", str(texto)))
    if "nome_acessor" in variaveis:
        variaveis.remove("nome_acessor")
        variaveis.add("nome_assessor")
    return variaveis - VARIAVEIS_DERIVADAS


def dividir_frente_verso(texto: Optional[str]) -> Optional[dict[int, str]]:
    if not texto:
        return None

    texto = str(texto).strip()
    if texto.startswith('"') and texto.endswith('"'):
        texto = texto[1:-1]
    texto = texto.replace("\r\n", "\n").replace("\r", "\n")

    padrao = re.compile(
        r"^\s*Frente:\s*\n?(.*?)\n\s*Verso:\s*\n?(.*?)\s*$",
        re.IGNORECASE | re.DOTALL,
    )
    match = padrao.match(texto)
    if not match:
        return None

    return {
        1: match.group(1).strip("\n"),
        2: match.group(2).strip("\n"),
    }


def encontrar_shapes_por_nome(shapes, nome_procurado: str, encontrados: Optional[list] = None) -> list:
    if encontrados is None:
        encontrados = []

    for i in range(1, shapes.Count + 1):
        shape = shapes.Item(i)
        try:
            nome_shape = str(shape.Name).strip()
        except Exception:
            nome_shape = ""

        if nome_shape == nome_procurado:
            encontrados.append(shape)

        try:
            if shape.Shapes.Count > 0:
                encontrar_shapes_por_nome(shape.Shapes, nome_procurado, encontrados)
        except Exception:
            pass

    return encontrados


def encontrar_shapes_na_pagina(page, nome_procurado: str) -> list:
    encontrados = []
    for l in range(1, page.Layers.Count + 1):
        layer = page.Layers.Item(l)
        encontrar_shapes_por_nome(layer.Shapes, nome_procurado, encontrados)
    return encontrados


def _registrar_shape_no_indice(
    indice: dict[str, list[dict[str, Any]]],
    nome_shape: str,
    pagina: int,
    shape: Any,
) -> None:
    nome = (nome_shape or "").strip()
    if not nome:
        return
    indice.setdefault(nome, []).append({"pagina": pagina, "shape": shape})


def _indexar_shapes_recursivo(
    shapes,
    pagina: int,
    indice: dict[str, list[dict[str, Any]]],
) -> None:
    for i in range(1, shapes.Count + 1):
        shape = shapes.Item(i)
        try:
            nome_shape = str(shape.Name).strip()
        except Exception:
            nome_shape = ""
        if nome_shape:
            _registrar_shape_no_indice(indice, nome_shape, pagina, shape)
        try:
            if shape.Shapes.Count > 0:
                _indexar_shapes_recursivo(shape.Shapes, pagina, indice)
        except Exception:
            pass


def construir_indice_shapes_documento(doc) -> dict[str, list[dict[str, Any]]]:
    """
    Percorre o documento uma única vez e indexa shapes por nome.
    Mesma lógica de encontrar_shapes_no_documento, sem repetir a varredura por campo.
    """
    indice: dict[str, list[dict[str, Any]]] = {}
    for p in range(1, doc.Pages.Count + 1):
        page = doc.Pages.Item(p)
        for l in range(1, page.Layers.Count + 1):
            layer = page.Layers.Item(l)
            _indexar_shapes_recursivo(layer.Shapes, p, indice)
    return indice


def encontrar_shapes_no_documento(
    doc,
    nome_procurado: str,
    indice: Optional[dict[str, list[dict[str, Any]]]] = None,
) -> list[dict[str, Any]]:
    chave = (nome_procurado or "").strip()
    if indice is not None:
        return list(indice.get(chave, []))

    encontrados = []
    for p in range(1, doc.Pages.Count + 1):
        page = doc.Pages.Item(p)
        for shape in encontrar_shapes_na_pagina(page, chave):
            encontrados.append({"pagina": p, "shape": shape})
    return encontrados


def ler_texto_shape(shape) -> Optional[str]:
    """Lê o conteúdo textual de um shape Corel, se existir."""
    for reader in (
        lambda s: str(s.Text.Story.Text),
        lambda s: str(s.Text.Story.Characters.All.Text),
        lambda s: str(s.Text.Story),
    ):
        try:
            texto = reader(shape)
            if texto is not None:
                return texto.replace("\r", "\n")
        except Exception:
            continue
    return None


def _ler_float_shape(shape: Any, *attrs: str, default: Optional[float] = None) -> Optional[float]:
    for attr in attrs:
        try:
            return float(getattr(shape, attr))
        except Exception:
            continue
    return default


def _corel_bounds_to_preview_rect(
    left: float,
    bottom: float,
    right: float,
    top: float,
    page_w: float,
    page_h: float,
) -> Optional[dict[str, int]]:
    """Converte bounds Corel (Y para cima) em retângulo da prévia SVG (Y para baixo)."""
    if page_w <= 0 or page_h <= 0:
        return None
    width = right - left
    height = top - bottom
    if width <= 0 or height <= 0:
        return None
    x = left
    y = page_h - top
    return {
        "x": int(round(max(0.0, x))),
        "y": int(round(max(0.0, y))),
        "width": int(round(max(1.0, width))),
        "height": int(round(max(1.0, height))),
    }


def _bounds_from_xywh(x: float, y: float, w: float, h: float) -> Optional[tuple[float, float, float, float]]:
    if w <= 0 or h <= 0:
        return None
    return x, y, x + w, y + h


def _extrair_bounds_shape(shape: Any) -> Optional[tuple[float, float, float, float]]:
    left = _ler_float_shape(shape, "LeftX", "PositionX", "Left")
    right = _ler_float_shape(shape, "RightX", "Right")
    top = _ler_float_shape(shape, "TopY", "PositionY", "Top")
    bottom = _ler_float_shape(shape, "BottomY", "Bottom")
    if None not in (left, right, top, bottom) and right > left and top > bottom:
        return left, bottom, right, top

    cx = _ler_float_shape(shape, "CenterX", "PositionX")
    cy = _ler_float_shape(shape, "CenterY", "PositionY")
    sw = _ler_float_shape(shape, "SizeWidth", "Width")
    sh = _ler_float_shape(shape, "SizeHeight", "Height")
    if None not in (cx, cy, sw, sh) and sw > 0 and sh > 0:
        return cx - sw / 2, cy - sh / 2, cx + sw / 2, cy + sh / 2

    try:
        bb = shape.GetBoundingBox()
        if bb is not None:
            parts = list(bb) if hasattr(bb, "__iter__") else [bb]
            if len(parts) >= 4:
                x, y, w, h = (float(parts[i]) for i in range(4))
                bounds = _bounds_from_xywh(x, y, w, h)
                if bounds:
                    return bounds
    except Exception:
        pass

    try:
        abb = shape.AbsoluteBoundingBox
        if abb is not None and hasattr(abb, "__iter__"):
            parts = list(abb)
            if len(parts) >= 4:
                left, bottom, right, top = (float(parts[i]) for i in range(4))
                if right > left and top > bottom:
                    return left, bottom, right, top
    except Exception:
        pass

    try:
        bb_obj = shape.BoundingBox
        x = _ler_float_shape(bb_obj, "x", "X", "Left")
        y = _ler_float_shape(bb_obj, "y", "Y", "Bottom")
        w = _ler_float_shape(bb_obj, "Width", "w")
        h = _ler_float_shape(bb_obj, "Height", "h")
        bounds = _bounds_from_xywh(x or 0.0, y or 0.0, w or 0.0, h or 0.0)
        if bounds:
            return bounds
    except Exception:
        pass

    try:
        story = shape.Text.Story
        for reader in (
            lambda s: s.GetBoundingBox(),
            lambda s: (float(s.Frame.X), float(s.Frame.Y), float(s.Frame.Width), float(s.Frame.Height)),
        ):
            try:
                raw = reader(story)
                if raw is None:
                    continue
                parts = list(raw) if hasattr(raw, "__iter__") else [raw]
                if len(parts) >= 4:
                    x, y, w, h = (float(parts[i]) for i in range(4))
                    bounds = _bounds_from_xywh(x, y, w, h)
                    if bounds:
                        return bounds
            except Exception:
                continue
    except Exception:
        pass

    return None


def _extrair_alinhamento_texto_shape(shape: Any) -> tuple[str, str]:
    align = "left"
    anchor = "start"
    value: Optional[int] = None
    for reader in (
        lambda s: int(s.Text.Story.Alignment),
        lambda s: int(s.Text.Story.Paragraphs.First.Alignment),
    ):
        try:
            value = reader(shape)
            break
        except Exception:
            continue
    if value == 1:
        align, anchor = "center", "middle"
    elif value == 2:
        align, anchor = "right", "end"
    return align, anchor


def _extrair_estilo_texto_shape(shape: Any, nome_campo: str) -> dict[str, Any]:
    font_family = "Arial, sans-serif"
    font_size = 32.0
    font_weight = 700 if nome_campo.lower() in ("nomedep", "nomeassessor") else 500
    color = "#231f20"
    line_height = 1.1

    try:
        raw_font = str(shape.Text.Story.Font)
        if raw_font.strip():
            font_family = f'"{raw_font.strip()}", Arial, Helvetica, sans-serif'
    except Exception:
        pass

    try:
        font_size = float(shape.Text.Story.Size)
    except Exception:
        pass

    try:
        if bool(getattr(shape.Text.Story.Font, "Bold", False)):
            font_weight = 700
    except Exception:
        pass

    align, anchor = _extrair_alinhamento_texto_shape(shape)
    if nome_campo.lower() in ("endereco", "contato", "rodape"):
        line_height = 1.2

    return {
        "fontFamily": font_family,
        "fontSize": int(round(max(8.0, font_size))),
        "fontWeight": font_weight,
        "fontStyle": "normal",
        "color": color,
        "align": align,
        "anchor": anchor,
        "lineHeight": line_height,
    }


def _extrair_layout_elemento_campo(
    nome_campo: str,
    pagina: int,
    shape: Any,
    page_w: float,
    page_h: float,
) -> dict[str, Any]:
    """Retorna página e estilo do shape; inclui x/y/width/height quando o Corel expõe bounds."""
    estilo = _extrair_estilo_texto_shape(shape, nome_campo)
    item: dict[str, Any] = {
        "campo": nome_campo,
        "page": pagina,
        "pageWidth": int(round(page_w)),
        "pageHeight": int(round(page_h)),
        **estilo,
    }
    bounds = _extrair_bounds_shape(shape)
    if not bounds:
        return item
    rect = _corel_bounds_to_preview_rect(*bounds, page_w, page_h)
    if rect:
        item.update(rect)
    return item


def extrair_preview_layout_documento(
    doc: Any,
    indice: dict[str, list[dict[str, Any]]],
    campos: dict[str, str],
) -> dict[str, Any]:
    """Extrai canvas e posições dos campos nomeados para PreviewConfigJson."""
    pages_meta: list[dict[str, int]] = []
    canvas_w = 1200
    canvas_h = 800

    try:
        for p in range(1, doc.Pages.Count + 1):
            page = doc.Pages.Item(p)
            pw = float(page.SizeWidth)
            ph = float(page.SizeHeight)
            pages_meta.append(
                {
                    "page": p,
                    "width": int(round(pw)),
                    "height": int(round(ph)),
                }
            )
        if pages_meta:
            canvas_w = pages_meta[0]["width"]
            canvas_h = pages_meta[0]["height"]
    except Exception:
        pages_meta = [{"page": 1, "width": canvas_w, "height": canvas_h}]

    page_sizes = {item["page"]: (item["width"], item["height"]) for item in pages_meta}
    elementos: list[dict[str, Any]] = []

    for nome_campo in sorted(campos.keys()):
        ocorrencias = indice.get(nome_campo) or []
        if not ocorrencias:
            continue
        ocorrencia = ocorrencias[0]
        pagina = int(ocorrencia.get("pagina") or 1)
        shape = ocorrencia.get("shape")
        if shape is None:
            continue
        pw, ph = page_sizes.get(pagina, (canvas_w, canvas_h))
        elementos.append(
            _extrair_layout_elemento_campo(nome_campo, pagina, shape, float(pw), float(ph))
        )

    return {
        "canvas": {"width": canvas_w, "height": canvas_h},
        "pages": pages_meta,
        "elementos": elementos,
    }


def alterar_texto(shape, novo_texto: str, logs: list[str]) -> None:
    texto = normalizar_quebras_para_corel(novo_texto)
    nome = getattr(shape, "Name", "?")

    try:
        shape.Text.Story.Text = texto
        return
    except Exception as exc1:
        err1 = str(exc1)

    try:
        shape.Text.Story.Characters.All.Text = texto
        return
    except Exception as exc2:
        err2 = str(exc2)

    try:
        shape.Text.Story = texto
        return
    except Exception as exc3:
        err3 = str(exc3)

    raise CorelGenerationError(
        f"Não foi possível alterar o texto do objeto '{nome}'. "
        f"Tentativas: Story.Text={err1}; Characters.All={err2}; Story={err3}"
    )


def _set_textrange_bold(text_range: Any) -> None:
    try:
        text_range.Bold = True
        return
    except Exception:
        pass
    try:
        text_range.Bold = -1
        return
    except Exception:
        pass
    font = getattr(text_range, "Font", None)
    if font is not None:
        font.Bold = True


def aplicar_negrito_inline(
    shape: Any,
    ranges: list[tuple[int, int]],
    logs: list[str],
    *,
    plain_texto: str = "",
) -> None:
    """Aplica Bold em intervalos 0-based do texto plano (Index COM 1-based)."""
    if not ranges:
        return
    nome = getattr(shape, "Name", "?")
    try:
        story = shape.Text.Story
    except Exception as exc:
        logs.append(f"Aviso: Story indisponível para negrito em '{nome}': {exc}")
        return

    try:
        story_len = int(story.Length)
    except Exception:
        story_len = len(plain_texto.replace("\n", "\r"))

    for start, end in ranges:
        if end <= start:
            continue
        first = start + 1
        count = end - start
        if story_len > 0 and first + count - 1 > story_len:
            logs.append(
                f"Aviso: negrito Characters({first},{count}) além do Story "
                f"(len={story_len}) em '{nome}' — ignorado."
            )
            continue
        applied = False
        errors: list[str] = []
        try:
            _set_textrange_bold(story.Characters(first, count))
            applied = True
        except Exception as exc:
            errors.append(f"Characters: {exc}")
        if not applied:
            try:
                last = first + count - 1
                _set_textrange_bold(story.Range(first, last))
                applied = True
            except Exception as exc:
                errors.append(f"Range: {exc}")
        if not applied:
            logs.append(
                f"Aviso: não foi possível aplicar negrito em '{nome}' "
                f"[{start}:{end}] ({'; '.join(errors)})"
            )


def aplicar_texto_modelo(
    shape: Any,
    texto_modelo: Optional[str],
    dados: dict[str, Any],
    logs: list[str],
) -> None:
    styled = substituir_variaveis_com_estilo(texto_modelo, dados)
    if styled is None:
        alterar_texto(shape, "", logs)
        return
    plain, ranges = styled
    alterar_texto(shape, plain, logs)
    aplicar_negrito_inline(shape, ranges, logs, plain_texto=plain)


def inspecionar_cdr(
    caminho_cdr: str,
    *,
    corel_visible: bool = False,
) -> dict[str, Any]:
    """
    Abre o .cdr no CorelDRAW e retorna objetos nomeados com conteúdo textual.
    Usado na criação de modelos (admin) — não altera o arquivo.
    """
    logs: list[str] = []
    if not os.path.isfile(caminho_cdr):
        raise CorelGenerationError(f"Arquivo .cdr não encontrado: {caminho_cdr}")

    _corel_session._ensure_com()
    doc = None
    try:
        corel = _corel_session.get_application(corel_visible, force_new=False)
        _preparar_corel_para_edicao(corel, logs)
        doc = corel.OpenDocument(os.path.abspath(caminho_cdr))
        logs.append(f"Documento aberto para inspeção — {doc.Pages.Count} página(s).")

        indice = construir_indice_shapes_documento(doc)
        logs.append(f"Objetos nomeados encontrados: {len(indice)}.")

        campos: dict[str, str] = {}
        for nome, ocorrencias in sorted(indice.items()):
            if not ocorrencias:
                continue
            shape = ocorrencias[0]["shape"]
            texto = ler_texto_shape(shape)
            if texto is None:
                continue
            campos[nome] = texto.strip()

        vars_set: set[str] = set()
        for texto in campos.values():
            vars_set.update(extrair_variaveis(texto))

        preview_layout = extrair_preview_layout_documento(doc, indice, campos)
        logs.append(
            f"Layout prévia: canvas {preview_layout['canvas']['width']}×"
            f"{preview_layout['canvas']['height']}, "
            f"{len(preview_layout.get('elementos') or [])} elemento(s)."
        )

        return {
            "campos": campos,
            "variaveis": sorted(vars_set),
            "preview_layout": preview_layout,
            "logs": logs,
        }
    finally:
        if doc is not None:
            try:
                doc.Close()
            except Exception:
                pass


def aplicar_campo(
    doc,
    nome_campo_corel: str,
    texto_modelo: str,
    dados: dict[str, Any],
    logs: list[str],
    *,
    indice_shapes: Optional[dict[str, list[dict[str, Any]]]] = None,
) -> None:
    ocorrencias = encontrar_shapes_no_documento(
        doc, nome_campo_corel, indice=indice_shapes
    )
    if not ocorrencias:
        raise CorelGenerationError(
            f"Objeto '{nome_campo_corel}' não encontrado em nenhuma página do documento."
        )

    frente_verso = dividir_frente_verso(texto_modelo)
    if frente_verso:
        for ocorrencia in ocorrencias:
            numero_pagina = ocorrencia["pagina"]
            shape = ocorrencia["shape"]
            if numero_pagina == 1:
                aplicar_texto_modelo(shape, frente_verso[1], dados, logs)
            elif numero_pagina == 2:
                aplicar_texto_modelo(shape, frente_verso[2], dados, logs)
            else:
                aplicar_texto_modelo(shape, frente_verso[1], dados, logs)
        logs.append(
            f"Campo '{nome_campo_corel}' aplicado em {len(ocorrencias)} ocorrência(s) (Frente/Verso)."
        )
        return

    for ocorrencia in ocorrencias:
        aplicar_texto_modelo(ocorrencia["shape"], texto_modelo, dados, logs)
    logs.append(
        f"Campo '{nome_campo_corel}' aplicado em {len(ocorrencias)} ocorrência(s)."
    )


def excluir_campo(
    doc,
    nome_campo_corel: str,
    logs: list[str],
    *,
    indice_shapes: Optional[dict[str, list[dict[str, Any]]]] = None,
) -> None:
    ocorrencias = encontrar_shapes_no_documento(
        doc, nome_campo_corel, indice=indice_shapes
    )
    if not ocorrencias:
        logs.append(f"Objeto '{nome_campo_corel}' para exclusão não encontrado no documento.")
        return

    for ocorrencia in ocorrencias:
        shape = ocorrencia["shape"]
        try:
            shape.Delete()
        except Exception as exc:
            logs.append(
                f"Aviso ao tentar excluir shape '{nome_campo_corel}': {exc}. "
                "Limpando texto como fallback."
            )
            try:
                alterar_texto(shape, "", logs)
            except Exception as exc2:
                logs.append(f"Erro ao limpar texto do shape '{nome_campo_corel}': {exc2}")

    logs.append(f"Campo '{nome_campo_corel}' excluído em {len(ocorrencias)} ocorrência(s).")


# --- Campos dinâmicos (criados na prova, replicados no CDR) ---

_SLOT_ANCHORS: dict[str, dict[str, Any]] = {
    "top-left": {"x_pct": 0.08, "y_pct": 0.1, "align": "left", "anchor": "start"},
    "top-center": {"x_pct": 0.5, "y_pct": 0.1, "align": "center", "anchor": "start"},
    "top-right": {"x_pct": 0.92, "y_pct": 0.1, "align": "right", "anchor": "start"},
    "center-left": {"x_pct": 0.08, "y_pct": 0.5, "align": "left", "anchor": "middle"},
    "center": {"x_pct": 0.5, "y_pct": 0.5, "align": "center", "anchor": "middle"},
    "center-right": {"x_pct": 0.92, "y_pct": 0.5, "align": "right", "anchor": "middle"},
    "bottom-left": {"x_pct": 0.08, "y_pct": 0.9, "align": "left", "anchor": "end"},
    "bottom-center": {"x_pct": 0.5, "y_pct": 0.9, "align": "center", "anchor": "end"},
    "bottom-right": {"x_pct": 0.92, "y_pct": 0.9, "align": "right", "anchor": "end"},
}


def _slot_to_preview_rect(
    slot_id: str,
    canvas_w: float,
    canvas_h: float,
    width: float = 400.0,
    height: float = 48.0,
) -> dict[str, float | str]:
    slot = _SLOT_ANCHORS.get(slot_id) or _SLOT_ANCHORS["center"]
    x_pct = float(slot["x_pct"])
    y_pct = float(slot["y_pct"])
    align = str(slot["align"])
    anchor = str(slot["anchor"])

    x_center = canvas_w * x_pct
    y_center = canvas_h * y_pct
    x = x_center - width / 2
    if align == "left":
        x = canvas_w * x_pct
    elif align == "right":
        x = canvas_w * x_pct - width

    y = y_center
    if anchor == "start":
        y = canvas_h * y_pct
    elif anchor == "middle":
        y = y_center - height / 2
    elif anchor == "end":
        y = canvas_h * y_pct - height

    return {
        "x": max(0.0, min(x, canvas_w - width)),
        "y": max(0.0, min(y, canvas_h - height)),
        "width": width,
        "height": height,
        "align": align,
    }


def _preview_px_to_corel_bounds(
    x: float,
    y: float,
    width: float,
    height: float,
    canvas_w: float,
    canvas_h: float,
    page_w: float,
    page_h: float,
) -> tuple[float, float, float, float]:
    """Converte retângulo top-left (prévia SVG) para (Left, Bottom, Right, Top) Corel."""
    scale_x = page_w / canvas_w if canvas_w else 1.0
    scale_y = page_h / canvas_h if canvas_h else 1.0
    left = x * scale_x
    right = (x + width) * scale_x
    top_corel = page_h - y * scale_y
    bottom_corel = page_h - (y + height) * scale_y
    return left, bottom_corel, right, top_corel


def _face_id_to_page(face_id: str, total_pages: int) -> int:
    fid = (face_id or "frente").strip().lower()
    if "verso" in fid and total_pages >= 2:
        return 2
    return 1


def _resolve_layer_prova_sefoc(page: Any) -> Any:
    try:
        for indice in range(1, page.Layers.Count + 1):
            layer = page.Layers.Item(indice)
            if _e_camada_prova_sefoc(str(layer.Name)):
                return layer
    except Exception:
        pass
    return page.ActiveLayer


def _font_name_from_template(raw: Any) -> str:
    text = str(raw or "Arial").split(",")[0].strip().strip("'\"")
    return text or "Arial"


def _set_paragraph_align(shape: Any, align: str) -> None:
    mapping = {"left": 0, "center": 1, "right": 2}
    value = mapping.get((align or "left").lower(), 0)
    try:
        shape.Text.Story.Alignment = value
    except Exception:
        try:
            shape.Text.Story.Paragraphs.First.Alignment = value
        except Exception:
            pass


def criar_campo_dinamico_texto(
    doc: Any,
    *,
    page_num: int,
    left: float,
    bottom: float,
    right: float,
    top: float,
    texto: str,
    font_name: str,
    font_size: float,
    align: str,
    shape_name: str,
    logs: list[str],
    bold_ranges: Optional[list[tuple[int, int]]] = None,
) -> None:
    page = doc.Pages.Item(page_num)
    layer = _resolve_layer_prova_sefoc(page)
    try:
        shape = layer.CreateParagraphText(left, bottom, right, top, normalizar_quebras_para_corel(texto))
    except Exception as exc:
        raise CorelGenerationError(
            f"Não foi possível criar texto dinâmico '{shape_name}': {exc}"
        ) from exc
    try:
        shape.Name = shape_name
    except Exception:
        pass
    try:
        shape.Text.Story.Font = font_name
    except Exception:
        pass
    try:
        shape.Text.Story.Size = float(font_size)
    except Exception:
        pass
    _set_paragraph_align(shape, align)
    if bold_ranges:
        aplicar_negrito_inline(shape, bold_ranges, logs, plain_texto=texto)
    logs.append(f"Campo dinâmico '{shape_name}' criado na página {page_num}.")


def aplicar_campos_dinamicos(
    doc: Any,
    dados: dict[str, Any],
    preview_config: Optional[dict[str, Any]],
    layout: Optional[dict[str, Any]],
    logs: list[str],
) -> None:
    if not preview_config or not layout:
        return
    if not preview_config.get("habilitarCamposDinamicos"):
        return
    templates = preview_config.get("camposDinamicos") or []
    if not isinstance(templates, list) or not templates:
        return
    if not isinstance(layout, dict) or not layout:
        return

    canvas = preview_config.get("canvas") or {}
    canvas_w = float(canvas.get("width") or 1200)
    canvas_h = float(canvas.get("height") or 800)
    tpl_by_id = {
        str(t.get("id") or t.get("variavel")): t
        for t in templates
        if isinstance(t, dict) and (t.get("id") or t.get("variavel"))
    }

    try:
        total_pages = doc.Pages.Count
    except Exception:
        total_pages = 1

    for template_id, placement in layout.items():
        if not isinstance(placement, dict):
            continue
        tpl = tpl_by_id.get(str(template_id))
        if not tpl:
            logs.append(f"Campo dinâmico ignorado (template ausente): {template_id}")
            continue
        slot_id = str(placement.get("posicaoSlot") or "center")
        face_id = str(placement.get("faceId") or "frente")
        page_num = _face_id_to_page(face_id, total_pages)

        try:
            page = doc.Pages.Item(page_num)
            page_w = float(page.SizeWidth)
            page_h = float(page.SizeHeight)
        except Exception as exc:
            logs.append(f"Campo dinâmico {template_id}: página indisponível ({exc})")
            continue

        width = float(tpl.get("width") or 400)
        height = float(tpl.get("height") or 48)
        rect = _slot_to_preview_rect(slot_id, canvas_w, canvas_h, width, height)
        align = str(tpl.get("align") or rect["align"])
        left, bottom, right, top = _preview_px_to_corel_bounds(
            float(rect["x"]),
            float(rect["y"]),
            width,
            height,
            canvas_w,
            canvas_h,
            page_w,
            page_h,
        )

        template_text = tpl.get("template") or f"{{{tpl.get('variavel', template_id)}}}"
        styled = substituir_variaveis_com_estilo(str(template_text), dados)
        texto_final, bold_ranges = styled if styled else ("", [])

        criar_campo_dinamico_texto(
            doc,
            page_num=page_num,
            left=left,
            bottom=bottom,
            right=right,
            top=top,
            texto=texto_final,
            font_name=_font_name_from_template(tpl.get("fontFamily")),
            font_size=float(tpl.get("fontSize") or 32),
            align=align,
            shape_name=f"Dyn_{template_id}",
            logs=logs,
            bold_ranges=bold_ranges,
        )


def configurar_pdf(corel, doc, logs: list[str]) -> None:
    try:
        pdf = doc.PDFSettings
    except Exception:
        try:
            pdf = doc.pdfSettings
        except Exception:
            logs.append("PDFSettings indisponível — usando padrões do Corel.")
            return

    import win32com.client

    try:
        constantes = win32com.client.constants
    except Exception:
        constantes = None

    for atributo, valor in {
        "Author": os.environ.get("USERNAME", "SAGRA-Worker"),
        "Subject": "Exportação automática SAGRA",
        "Keywords": "PDF, CorelDRAW, SAGRA",
        "JPEGQualityFactor": 90,
        "EmbedFonts": True,
        "SubsetFonts": True,
        "TextAsCurves": False,
    }.items():
        try:
            setattr(pdf, atributo, valor)
        except Exception:
            pass

    try:
        pdf.PublishRange = constantes.pdfWholeDocument
    except Exception:
        try:
            pdf.PublishRange = 0
        except Exception:
            pass

    for attr, const_name in (("BitmapCompression", "pdfJPEG"), ("ColorMode", "pdfRGB")):
        try:
            if constantes:
                setattr(pdf, attr, getattr(constantes, const_name))
        except Exception:
            pass

    try:
        total_paginas = doc.Pages.Count
        pdf.PageRange = f"1-{total_paginas}"
    except Exception:
        pass


def _preparar_corel_para_edicao(corel: Any, logs: list[str]) -> None:
    """Optimization=True adia alterações de texto — desliga durante todo o job."""
    for attr, value in (("Optimization", False), ("EventsEnabled", True)):
        try:
            setattr(corel, attr, value)
        except Exception:
            pass
    logs.append("Corel em modo edição (Optimization off).")


def _tamanho_pagina1_cdr(caminho: str) -> int:
    """Tamanho do content/data/page1.dat dentro do .cdr (zip)."""
    try:
        with zipfile.ZipFile(caminho, "r") as arquivo:
            for nome in arquivo.namelist():
                if nome.endswith("page1.dat"):
                    return arquivo.getinfo(nome).file_size
    except Exception:
        pass
    return 0


CAMADA_PROVA_SEFOC = "ProvaSefoc"


def _e_camada_prova_sefoc(nome: str) -> bool:
    return (nome or "").strip().lower() == CAMADA_PROVA_SEFOC.lower()


def _garantir_camada_prova_sefoc_imprimivel(doc: Any, logs: list[str]) -> None:
    """
    Camada ProvaSefoc com Printable=False gera CDR/PDF em branco no Corel.
    Habilita impressão apenas nessa camada; demais camadas não são alteradas.
    """
    paginas_ajustadas = 0
    try:
        total_paginas = doc.Pages.Count
    except Exception:
        return

    for numero_pagina in range(1, total_paginas + 1):
        try:
            page = doc.Pages.Item(numero_pagina)
            total_camadas = page.Layers.Count
        except Exception:
            continue

        for indice_camada in range(1, total_camadas + 1):
            try:
                layer = page.Layers.Item(indice_camada)
                if not _e_camada_prova_sefoc(str(layer.Name)):
                    continue
                if layer.Printable:
                    continue
                layer.Printable = True
                paginas_ajustadas += 1
            except Exception:
                continue

    if paginas_ajustadas:
        logs.append(
            f"Camada {CAMADA_PROVA_SEFOC}: Printable=True em "
            f"{paginas_ajustadas} página(s) (estava desabilitada para impressão)."
        )


def _ativar_pagina_principal(doc: Any, logs: list[str]) -> None:
    """
    Cartões duplos têm várias páginas (imposição); só a página 1 tem arte.
    Ativar a última página antes do Save faz o arquivo abrir 'em branco'.
    """
    try:
        doc.Pages.Item(1).Activate()
        logs.append("Página 1 ativada (conteúdo principal).")
    except Exception:
        pass


def _fechar_documento_corel(doc: Any, logs: list[str]) -> None:
    """Fecha o documento para forçar flush em disco e liberar o .cdr para cópia."""
    try:
        doc.Close()
        logs.append("Documento Corel fechado (flush em disco).")
    except Exception as exc:
        logs.append(f"Aviso ao fechar documento: {exc}")


def _copiar_arquivo_final(
    origem: str,
    destino: str,
    logs: list[str],
    *,
    rotulo: str,
    tentativas: int = 4,
) -> None:
    tamanho_origem = os.path.getsize(origem)
    for tentativa in range(1, tentativas + 1):
        try:
            shutil.copy2(origem, destino)
            tamanho_destino = os.path.getsize(destino)
            logs.append(
                f"{rotulo} copiado ({tamanho_destino // 1024} KB, origem {tamanho_origem // 1024} KB)."
            )
            if tamanho_destino < max(1024, tamanho_origem // 2):
                raise CorelGenerationError(
                    f"{rotulo} copiado parece incompleto "
                    f"({tamanho_destino} bytes vs origem {tamanho_origem})."
                )
            return
        except OSError as exc:
            if tentativa >= tentativas:
                raise CorelGenerationError(
                    f"Não foi possível copiar {rotulo} para destino: {exc}"
                ) from exc
            logs.append(f"Retry cópia {rotulo} ({tentativa}/{tentativas}): {exc}")
            time.sleep(0.5)


def _sincronizar_documento_corel(
    corel: Any,
    doc: Any,
    logs: list[str],
    *,
    antes_de_gravar: bool = False,
) -> None:
    """
    Com Optimization=True o Corel pode adiar a persistência do texto.
    Força flush visual e de disco antes do Save/PDF.
    """
    for attr, value in (("Optimization", False), ("EventsEnabled", True)):
        try:
            setattr(corel, attr, value)
        except Exception:
            pass

    for target, method_name in ((doc, "Refresh"), (corel, "Refresh")):
        try:
            getattr(target, method_name)()
        except Exception:
            pass

    try:
        import pythoncom

        pythoncom.PumpWaitingMessages()
    except Exception:
        pass

    time.sleep(0.5 if antes_de_gravar else 0.25)
    if antes_de_gravar:
        logs.append("Corel sincronizado (Optimization off) antes de gravar.")


def salvar_documento(doc, logs: list[str]) -> None:
    try:
        doc.Save()
        logs.append("CDR salvo com doc.Save().")
    except Exception as exc:
        raise CorelGenerationError(f"Não foi possível salvar o CDR: {exc}") from exc


def _ativar_documento_para_exportacao(
    corel: Any,
    doc: Any,
    logs: list[str],
) -> None:
    try:
        corel.ActiveDocument = doc
    except Exception:
        pass
    for method_name in ("Activate", "MakeActive"):
        try:
            getattr(doc, method_name)()
            logs.append(f"Documento ativado ({method_name}) antes do PDF.")
            break
        except Exception:
            pass
    _ativar_pagina_principal(doc, logs)


def exportar_pdf(corel, doc, caminho_pdf: str, logs: list[str]) -> None:
    caminho_pdf = os.path.abspath(caminho_pdf)
    os.makedirs(os.path.dirname(caminho_pdf), exist_ok=True)

    _garantir_camada_prova_sefoc_imprimivel(doc, logs)
    _sincronizar_documento_corel(corel, doc, logs, antes_de_gravar=True)
    _ativar_documento_para_exportacao(corel, doc, logs)
    configurar_pdf(corel, doc, logs)

    if os.path.exists(caminho_pdf):
        try:
            os.remove(caminho_pdf)
        except Exception:
            pass

    try:
        doc.PublishToPDF(caminho_pdf)
    except Exception as exc:
        raise CorelGenerationError(f"Não foi possível exportar PDF: {exc}") from exc

    try:
        tamanho = os.path.getsize(caminho_pdf)
    except OSError as exc:
        raise CorelGenerationError(f"PDF não encontrado após exportação: {exc}") from exc

    if tamanho < 1024:
        raise CorelGenerationError(
            f"PDF exportado inválido ou vazio ({tamanho} bytes): {caminho_pdf}"
        )

    logs.append(
        f"PDF exportado: {os.path.basename(caminho_pdf)} ({tamanho // 1024} KB)"
    )


def resolver_modelo_em_cache(caminho_modelo: str, cache_dir: str) -> str:
    """
    Mantém cópia local dos .cdr (UNC → disco local) para abrir/copiar mais rápido.
    Invalida cache quando o modelo na rede é mais novo.
    """
    if not caminho_modelo or not os.path.isfile(caminho_modelo):
        return caminho_modelo

    os.makedirs(cache_dir, exist_ok=True)
    nome = os.path.basename(caminho_modelo)
    cached = os.path.join(cache_dir, nome)

    try:
        src_mtime = os.path.getmtime(caminho_modelo)
    except OSError:
        return caminho_modelo

    if os.path.isfile(cached):
        try:
            if os.path.getmtime(cached) >= src_mtime:
                return cached
        except OSError:
            pass

    shutil.copy2(caminho_modelo, cached)
    return cached


_COM_TLS = threading.local()


def _ensure_com_in_current_thread() -> None:
    """CoInitialize é por thread — obrigatório em cada thread do ThreadPoolExecutor."""
    if getattr(_COM_TLS, "initialized", False):
        return
    import pythoncom

    pythoncom.CoInitialize()
    _COM_TLS.initialized = True


def _reset_com_in_current_thread() -> None:
    import pythoncom

    if getattr(_COM_TLS, "initialized", False):
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass
    _COM_TLS.initialized = False
    pythoncom.CoInitialize()
    _COM_TLS.initialized = True


def _is_com_disconnect_error(exc: BaseException) -> bool:
    """Detecta RPC/COM perdido (ex.: Corel encerrado após fechar o documento)."""
    try:
        import pywintypes

        if isinstance(exc, pywintypes.com_error):
            hr = exc.args[0] if exc.args else None
            if hr in (-2147220995, -2147023174, -2147417848, -2147221008):
                return True
    except Exception:
        pass
    msg = str(exc).lower()
    return (
        "não conectado" in msg
        or "not connected" in msg
        or "rpc server" in msg
        or "coinitialize" in msg
    )


def _ping_corel_application(corel: Any) -> bool:
    try:
        _ = corel.Version
        return True
    except Exception:
        return False


COREL_PROCESS_IMAGE_NAMES = ("CorelDRW.exe",)


def _tasklist_contem_processo(image_name: str) -> bool:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        resultado = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {image_name}", "/NH"],
            capture_output=True,
            text=True,
            timeout=15,
            creationflags=flags,
        )
    except Exception:
        return False
    saida = (resultado.stdout or "").lower()
    return image_name.lower() in saida and "nenhuma tarefa" not in saida


def corel_processo_em_execucao() -> bool:
    """True se algum processo CorelDRAW estiver rodando nesta máquina."""
    return any(_tasklist_contem_processo(nome) for nome in COREL_PROCESS_IMAGE_NAMES)


def corel_em_uso_externamente() -> bool:
    """
    True se o Corel está aberto fora da sessão COM do worker
    (ex.: designer usando o Corel manualmente).
    """
    if not corel_processo_em_execucao():
        return False
    return not _corel_session.has_application()


def aguardar_corel_disponivel(
    poll_interval_sec: float = 5.0,
    *,
    should_stop: Optional[Callable[[], bool]] = None,
    on_waiting: Optional[Callable[[], None]] = None,
) -> bool:
    """
    Aguarda até não haver Corel externo. Retorna False se should_stop() durante a espera.
    """
    while corel_em_uso_externamente():
        if should_stop and should_stop():
            return False
        if on_waiting:
            on_waiting()
        time.sleep(max(1.0, poll_interval_sec))
    return True


class _CorelSession:
    """Instância CorelDRAW COM durante um job (fechada após CDR/PDF)."""

    def __init__(self) -> None:
        self._corel: Any = None
        self._owner_thread: Optional[int] = None

    def _ensure_com(self) -> None:
        _ensure_com_in_current_thread()

    def _bind_current_thread(self) -> None:
        tid = threading.get_ident()
        if self._owner_thread is not None and self._owner_thread != tid:
            self.reset()
        self._owner_thread = tid

    def _apply_perf_settings(self, corel: Any) -> None:
        for attr, value in (("Optimization", True), ("EventsEnabled", False)):
            try:
                setattr(corel, attr, value)
            except Exception:
                pass

    def _create_application(self) -> Any:
        try:
            corel = dispatch_corel_application()
        except Exception as exc:
            raise CorelGenerationError(
                humanizar_erro_corel(exc, contexto="Falha ao iniciar CorelDRAW")
            ) from exc
        self._apply_perf_settings(corel)
        return corel

    def has_application(self) -> bool:
        if self._corel is None or self._owner_thread != threading.get_ident():
            return False
        self._ensure_com()
        return _ping_corel_application(self._corel)

    def get_application(self, visible: bool, *, force_new: bool = False) -> Any:
        self._ensure_com()
        self._bind_current_thread()
        if force_new or self._corel is None or not _ping_corel_application(self._corel):
            if self._corel is not None:
                try:
                    self._corel.Quit()
                except Exception:
                    pass
            self._corel = self._create_application()
        # Frota de workers: Corel sempre oculto (visible ignorado em produção).
        try:
            self._corel.Visible = False
        except Exception:
            if not _ping_corel_application(self._corel):
                self._corel = self._create_application()
                self._corel.Visible = False
        return self._corel

    def reset(self) -> None:
        if self._corel is not None:
            try:
                self._corel.Quit()
            except Exception:
                pass
            self._corel = None
        self._owner_thread = None


_corel_session = _CorelSession()


def reset_corel_session() -> None:
    """Encerra Corel COM (após cada job ou em falha)."""
    _corel_session.reset()


def _release_corel_after_job(logs: list[str], *, completed: bool) -> None:
    if _corel_session._corel is None:
        return
    reset_corel_session()
    if completed:
        logs.append("CorelDRAW encerrado após exportação.")
    else:
        logs.append("CorelDRAW encerrado.")


def nome_saida(modelo: dict[str, Any], dados: dict[str, Any]) -> str:
    produto = limpar_nome_arquivo(modelo.get("produto") or "Papelaria")
    cores = limpar_nome_arquivo(modelo.get("cores") or "")
    nome = limpar_nome_arquivo(dados.get("nome_deputado", "sem_nome"))
    gabinete = limpar_nome_arquivo(dados.get("gabinete", ""))

    partes = [produto, nome]
    if gabinete:
        partes.append(f"Gab{gabinete}")
    if cores:
        partes.append(cores)
    return "_".join(partes)


def _gerar_arquivo_corel_impl(
    modelo: dict[str, Any],
    dados: dict[str, Any],
    caminho_modelo: str,
    temp_cdr_path: str,
    output_cdr_path: str,
    output_pdf_path: str,
    corel_visible: bool,
    logs: list[str],
    *,
    models_cache_dir: str = "",
    reuse_corel_session: bool = True,
    preview_config: Optional[dict[str, Any]] = None,
    campos_dinamicos_layout: Optional[dict[str, Any]] = None,
    exclusoes: Optional[list[str]] = None,
) -> None:
    t0 = time.perf_counter()
    _corel_session._ensure_com()

    if not os.path.isfile(caminho_modelo):
        raise CorelGenerationError(f"Modelo não encontrado: {caminho_modelo}")

    fonte_modelo = caminho_modelo
    if models_cache_dir:
        fonte_modelo = resolver_modelo_em_cache(caminho_modelo, models_cache_dir)
        if fonte_modelo != caminho_modelo:
            logs.append(f"Modelo em cache local: {os.path.basename(fonte_modelo)}.")

    modelo_page1_bytes = _tamanho_pagina1_cdr(fonte_modelo)
    if modelo_page1_bytes:
        logs.append(f"Modelo page1.dat: {modelo_page1_bytes // 1024} KB.")

    os.makedirs(os.path.dirname(temp_cdr_path), exist_ok=True)
    if os.path.exists(temp_cdr_path):
        os.remove(temp_cdr_path)
    shutil.copy(fonte_modelo, temp_cdr_path)
    logs.append("Cópia do modelo criada em temp.")

    corel_reused = reuse_corel_session and _corel_session.has_application()

    job_completed = False
    try:
        for attempt in range(2):
            doc = None
            force_new_corel = attempt > 0
            try:
                if reuse_corel_session:
                    corel = _corel_session.get_application(
                        corel_visible,
                        force_new=force_new_corel,
                    )
                    if force_new_corel:
                        logs.append("CorelDRAW reiniciado após desconexão COM.")
                    else:
                        logs.append(
                            f"CorelDRAW {'reutilizado' if corel_reused else 'iniciado'} "
                            f"(Visible={corel_visible})."
                        )
                else:
                    _ensure_com_in_current_thread()
                    corel = dispatch_corel_application()
                    corel.Visible = corel_visible
                    logs.append(f"CorelDRAW aberto (Visible={corel_visible}).")

                _preparar_corel_para_edicao(corel, logs)

                doc = corel.OpenDocument(os.path.abspath(temp_cdr_path))
                logs.append(f"Documento aberto — {doc.Pages.Count} página(s).")

                campos = modelo.get("campos") or {}
                if not campos:
                    raise CorelGenerationError("Modelo sem campos configurados.")

                indice_shapes = construir_indice_shapes_documento(doc)
                logs.append(f"Índice de shapes: {len(indice_shapes)} nome(s) únicos.")

                for nome_campo, texto_modelo in campos.items():
                    if exclusoes and nome_campo in exclusoes:
                        logs.append(f"Excluindo campo do modelo: {nome_campo}")
                        excluir_campo(
                            doc,
                            nome_campo,
                            logs,
                            indice_shapes=indice_shapes,
                        )
                        continue

                    logs.append(f"Aplicando campo: {nome_campo}")
                    aplicar_campo(
                        doc,
                        nome_campo,
                        texto_modelo,
                        dados,
                        logs,
                        indice_shapes=indice_shapes,
                    )

                try:
                    aplicar_campos_dinamicos(
                        doc,
                        dados,
                        preview_config,
                        campos_dinamicos_layout,
                        logs,
                    )
                except CorelGenerationError:
                    raise
                except Exception as exc:
                    logs.append(f"Aviso campos dinâmicos: {exc}")

                temp_pdf_path = os.path.join(os.path.dirname(temp_cdr_path), "working.pdf")

                # sync → Save → fechar → copiar CDR (antes do PDF).
                # PublishToPDF em cartões duplos pode corromper o .cdr aberto (page1 encolhe).
                _sincronizar_documento_corel(corel, doc, logs, antes_de_gravar=True)
                _garantir_camada_prova_sefoc_imprimivel(doc, logs)
                _ativar_pagina_principal(doc, logs)
                salvar_documento(doc, logs)
                _fechar_documento_corel(doc, logs)
                doc = None

                os.makedirs(os.path.dirname(output_cdr_path), exist_ok=True)
                os.makedirs(os.path.dirname(output_pdf_path), exist_ok=True)
                _copiar_arquivo_final(
                    temp_cdr_path, output_cdr_path, logs, rotulo="CDR"
                )

                if modelo_page1_bytes:
                    saida_p1 = _tamanho_pagina1_cdr(output_cdr_path)
                    logs.append(f"Saída page1.dat: {saida_p1 // 1024} KB.")
                    if saida_p1 < int(modelo_page1_bytes * 0.6):
                        raise CorelGenerationError(
                            f"CDR corrompido após gravação: page1.dat {saida_p1} bytes "
                            f"(modelo {modelo_page1_bytes} bytes)."
                        )

                doc_pdf = corel.OpenDocument(os.path.abspath(temp_cdr_path))
                try:
                    logs.append(
                        f"Documento reaberto para PDF — {doc_pdf.Pages.Count} página(s)."
                    )
                    exportar_pdf(corel, doc_pdf, temp_pdf_path, logs)
                finally:
                    _fechar_documento_corel(doc_pdf, logs)
                    doc_pdf = None

                _copiar_arquivo_final(
                    temp_pdf_path, output_pdf_path, logs, rotulo="PDF"
                )

                try:
                    _corel_session._apply_perf_settings(corel)
                except Exception:
                    pass

                elapsed = time.perf_counter() - t0
                logs.append(f"Geração Corel/PDF em {elapsed:.1f}s.")
                job_completed = True
                return

            except Exception as exc:
                if attempt == 0 and reuse_corel_session and _is_com_disconnect_error(exc):
                    reset_corel_session()
                    _reset_com_in_current_thread()
                    logs.append(
                        "Conexão CorelDRAW perdida — nova tentativa com instância limpa."
                    )
                    continue
                if isinstance(exc, CorelGenerationError):
                    if _is_com_disconnect_error(exc):
                        reset_corel_session()
                    raise
                if _is_com_disconnect_error(exc):
                    reset_corel_session()
                    raise CorelGenerationError(
                        humanizar_erro_corel(exc, contexto="CorelDRAW desconectado")
                    ) from exc
                raise CorelGenerationError(humanizar_erro_corel(exc)) from exc
            finally:
                if doc is not None:
                    try:
                        doc.Close()
                        logs.append("Documento Corel fechado.")
                    except Exception as close_exc:
                        logs.append(f"Aviso ao fechar documento: {close_exc}")
                if not reuse_corel_session:
                    try:
                        import pythoncom

                        pythoncom.CoUninitialize()
                    except Exception:
                        pass
    finally:
        if reuse_corel_session:
            _release_corel_after_job(logs, completed=job_completed)


def gerar_arquivo_corel(
    modelo: dict[str, Any],
    dados: dict[str, Any],
    caminho_modelo: str,
    temp_dir: str,
    output_cdr_path: str,
    output_pdf_path: str,
    *,
    corel_visible: bool = False,
    job_timeout_sec: int = 300,
    job_id: Optional[int] = None,
    preview_config: Optional[dict[str, Any]] = None,
    campos_dinamicos_layout: Optional[dict[str, Any]] = None,
    exclusoes: Optional[list[str]] = None,
) -> GenerationResult:
    """
    Gera CDR e PDF a partir de cópia temporária do modelo.
    Retorna caminhos absolutos dos arquivos finais.
    """
    logs: list[str] = []
    job_tag = f"job_{job_id}" if job_id else "job"
    temp_job_dir = os.path.join(temp_dir, job_tag)
    os.makedirs(temp_job_dir, exist_ok=True)
    temp_cdr_path = os.path.join(temp_job_dir, "working.cdr")

    dados_norm = dict(dados)
    if dados_norm.get("gabinete"):
        dados_norm["gabinete"] = normalizar_gabinete(str(dados_norm["gabinete"]))
    if dados_norm.get("uf"):
        dados_norm["uf"] = str(dados_norm["uf"]).upper()
    if "anexo" in extrair_variaveis(" ".join((modelo.get("campos") or {}).values())):
        if not dados_norm.get("anexo"):
            dados_norm["anexo"] = "IV"

    models_cache_dir = os.path.join(temp_dir, "_models_cache")
    validar_acesso_job(
        caminho_modelo,
        os.path.dirname(output_cdr_path) or output_cdr_path,
        models_cache_dir=models_cache_dir,
    )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            _gerar_arquivo_corel_impl,
            modelo,
            dados_norm,
            caminho_modelo,
            temp_cdr_path,
            output_cdr_path,
            output_pdf_path,
            corel_visible,
            logs,
            models_cache_dir=models_cache_dir,
            reuse_corel_session=True,
            preview_config=preview_config,
            campos_dinamicos_layout=campos_dinamicos_layout,
            exclusoes=exclusoes,
        )
        try:
            future.result(timeout=max(30, job_timeout_sec))
        except FuturesTimeoutError as exc:
            encerrar_corel_forcadamente(matar_processo=True)
            raise CorelGenerationError(
                f"Geração excedeu o tempo limite de {job_timeout_sec}s — "
                "CorelDRAW encerrado. O job pode ser reprocessado por outro worker."
            ) from exc
        except Exception as exc:
            if _is_com_disconnect_error(exc):
                reset_corel_session()
                raise CorelGenerationError(
                    humanizar_erro_corel(exc, contexto="CorelDRAW desconectado")
                ) from exc
            if isinstance(exc, CorelGenerationError):
                raise
            raise CorelGenerationError(humanizar_erro_corel(exc)) from exc

    if not os.path.isfile(output_cdr_path):
        raise CorelGenerationError("CDR final não foi gerado.")
    if not os.path.isfile(output_pdf_path):
        raise CorelGenerationError("PDF final não foi gerado.")

    return GenerationResult(
        cdr_path=output_cdr_path,
        pdf_path=output_pdf_path,
        logs=logs,
    )


def _exportar_prova_cdr_existente_impl(
    caminho_cdr: str,
    temp_cdr_path: str,
    output_pdf_path: str,
    corel_visible: bool,
    logs: list[str],
    *,
    reuse_corel_session: bool = True,
) -> None:
    t0 = time.perf_counter()
    _corel_session._ensure_com()

    if not os.path.isfile(caminho_cdr):
        raise CorelGenerationError(f"Corel da OS não encontrado: {caminho_cdr}")

    os.makedirs(os.path.dirname(temp_cdr_path), exist_ok=True)
    if os.path.exists(temp_cdr_path):
        os.remove(temp_cdr_path)
    shutil.copy(caminho_cdr, temp_cdr_path)
    logs.append(f"Cópia do Corel da OS criada em temp ({os.path.basename(caminho_cdr)}).")

    corel_reused = reuse_corel_session and _corel_session.has_application()
    job_completed = False

    try:
        for attempt in range(2):
            doc = None
            force_new_corel = attempt > 0
            try:
                if reuse_corel_session:
                    corel = _corel_session.get_application(
                        corel_visible,
                        force_new=force_new_corel,
                    )
                    if force_new_corel:
                        logs.append("CorelDRAW reiniciado após desconexão COM.")
                    else:
                        logs.append(
                            f"CorelDRAW {'reutilizado' if corel_reused else 'iniciado'} "
                            f"(Visible={corel_visible})."
                        )
                else:
                    _ensure_com_in_current_thread()
                    corel = dispatch_corel_application()
                    corel.Visible = corel_visible
                    logs.append(f"CorelDRAW aberto (Visible={corel_visible}).")

                _preparar_corel_para_edicao(corel, logs)

                doc = corel.OpenDocument(os.path.abspath(temp_cdr_path))
                logs.append(f"Documento aberto — {doc.Pages.Count} página(s).")

                temp_pdf_path = os.path.join(os.path.dirname(temp_cdr_path), "working.pdf")
                exportar_pdf(corel, doc, temp_pdf_path, logs)

                os.makedirs(os.path.dirname(output_pdf_path), exist_ok=True)
                _copiar_arquivo_final(
                    temp_pdf_path, output_pdf_path, logs, rotulo="PDF"
                )

                try:
                    _corel_session._apply_perf_settings(corel)
                except Exception:
                    pass

                elapsed = time.perf_counter() - t0
                logs.append(f"Exportação PDF em {elapsed:.1f}s.")
                job_completed = True
                return

            except Exception as exc:
                if attempt == 0 and reuse_corel_session and _is_com_disconnect_error(exc):
                    reset_corel_session()
                    _reset_com_in_current_thread()
                    logs.append(
                        "Conexão CorelDRAW perdida — nova tentativa com instância limpa."
                    )
                    continue
                if isinstance(exc, CorelGenerationError):
                    if _is_com_disconnect_error(exc):
                        reset_corel_session()
                    raise
                if _is_com_disconnect_error(exc):
                    reset_corel_session()
                    raise CorelGenerationError(
                        humanizar_erro_corel(exc, contexto="CorelDRAW desconectado")
                    ) from exc
                raise CorelGenerationError(humanizar_erro_corel(exc)) from exc
            finally:
                if doc is not None:
                    try:
                        doc.Close()
                        logs.append("Documento Corel fechado.")
                    except Exception as close_exc:
                        logs.append(f"Aviso ao fechar documento: {close_exc}")
                if not reuse_corel_session:
                    try:
                        import pythoncom

                        pythoncom.CoUninitialize()
                    except Exception:
                        pass
    finally:
        if reuse_corel_session:
            _release_corel_after_job(logs, completed=job_completed)


def exportar_prova_de_cdr_existente(
    caminho_cdr: str,
    temp_dir: str,
    output_pdf_path: str,
    *,
    corel_visible: bool = False,
    job_timeout_sec: int = 300,
    job_id: Optional[int] = None,
) -> GenerationResult:
    """
    Exporta PDF de prova a partir do BaseSefoc.cdr já existente na pasta Sefoc.
    Não altera o CDR original na pasta da OS.
    """
    logs: list[str] = []
    job_tag = f"job_{job_id}" if job_id else "job"
    temp_job_dir = os.path.join(temp_dir, job_tag)
    os.makedirs(temp_job_dir, exist_ok=True)
    temp_cdr_path = os.path.join(temp_job_dir, "working.cdr")

    output_dir = os.path.dirname(output_pdf_path) or output_pdf_path
    validar_acesso_export_cdr(caminho_cdr, output_dir)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            _exportar_prova_cdr_existente_impl,
            caminho_cdr,
            temp_cdr_path,
            output_pdf_path,
            corel_visible,
            logs,
            reuse_corel_session=True,
        )
        try:
            future.result(timeout=max(30, job_timeout_sec))
        except FuturesTimeoutError as exc:
            encerrar_corel_forcadamente(matar_processo=True)
            raise CorelGenerationError(
                f"Exportação excedeu o tempo limite de {job_timeout_sec}s — "
                "CorelDRAW encerrado. O job pode ser reprocessado por outro worker."
            ) from exc
        except Exception as exc:
            if _is_com_disconnect_error(exc):
                reset_corel_session()
                raise CorelGenerationError(
                    humanizar_erro_corel(exc, contexto="CorelDRAW desconectado")
                ) from exc
            if isinstance(exc, CorelGenerationError):
                raise
            raise CorelGenerationError(humanizar_erro_corel(exc)) from exc

    if not os.path.isfile(output_pdf_path):
        raise CorelGenerationError("PDF final não foi gerado.")

    cdr_path = os.path.abspath(caminho_cdr)
    return GenerationResult(
        cdr_path=cdr_path,
        pdf_path=output_pdf_path,
        logs=logs,
    )


def cleanup_temp_dir(temp_dir: str, job_id: Optional[int] = None) -> None:
    if job_id is not None:
        path = os.path.join(temp_dir, f"job_{job_id}")
    else:
        path = temp_dir
    if os.path.isdir(path):
        try:
            shutil.rmtree(path, ignore_errors=True)
        except Exception as exc:
            logger.warning("Falha ao limpar temp %s: %s", path, exc)

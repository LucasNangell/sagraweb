"""
Modo «Prova PDF»: prova gerada no servidor a partir de um PDF do modelo.

O designer exporta o modelo do CorelDRAW para PDF com as fontes incorporadas
(sem subconjunto). Os textos variáveis do PDF (ex.: «SUB», «LEB», o nome de
exemplo) são ligados a templates de campos (``{nome_deputado}``…). Na geração,
só o texto desses marcadores é removido e o texto novo é escrito com a MESMA
fonte embutida no PDF, mesmo tamanho, cor (CMYK) e espaçamento entre letras —
sem CorelDRAW e sem worker. Todo o resto do PDF fica intacto.

Arquivos por modelo: ``Modelos/papelaria/prova_pdf/{modelo_id}/modelo.pdf`` e
``config.json`` (campos ligados). Só é usado quando o modo de prova é
``prova_pdf``; os outros modos não passam por aqui.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from config_manager import PROJECT_ROOT

logger = logging.getLogger(__name__)

RAIZ_MODELOS_PDF = PROJECT_ROOT / "Modelos" / "papelaria" / "prova_pdf"
WORKER_ID_SERVIDOR = "servidor-prova-pdf"
ALINHAMENTOS = ("auto", "esquerda", "centro", "direita")
ANCORAS = ("auto", "topo", "base", "centro")
MAX_PDF_BYTES = 30 * 1024 * 1024
# Caracteres que um campo costuma precisar (aviso se a fonte embutida não tiver).
CARACTERES_COMUNS = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    "çÇãõáéíóúâêôàÁÉÍÓÚÂÊÔÃÕ@.,;:-/()&ºª "
)


class ProvaPdfError(ValueError):
    """Erro de configuração/geração da Prova PDF (mensagem para o usuário)."""


# ---------------------------------------------------------------------------
# Arquivos do modelo
# ---------------------------------------------------------------------------


def _pasta(modelo_id: int) -> Path:
    return RAIZ_MODELOS_PDF / str(int(modelo_id))


def caminho_pdf(modelo_id: int) -> Path:
    return _pasta(modelo_id) / "modelo.pdf"


def _caminho_config(modelo_id: int) -> Path:
    return _pasta(modelo_id) / "config.json"


def tem_modelo_pdf(modelo_id: Optional[int]) -> bool:
    if not modelo_id:
        return False
    if not caminho_pdf(modelo_id).is_file():
        return False
    return any(c.get("template") for c in carregar_config(modelo_id).get("campos") or [])


def carregar_config(modelo_id: int) -> dict[str, Any]:
    path = _caminho_config(modelo_id)
    if not path.is_file():
        return {"campos": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"campos": []}
    return data if isinstance(data, dict) else {"campos": []}


def _salvar_config(modelo_id: int, config: dict[str, Any]) -> None:
    path = _caminho_config(modelo_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


# ---------------------------------------------------------------------------
# Fonte embutida (CID / Identity-H)
# ---------------------------------------------------------------------------


@dataclass
class FonteEmbutida:
    xref: int
    nome: str
    uni_cid: dict[str, int]
    larguras: dict[int, float]
    largura_padrao: float
    completa: bool

    def faltando(self, texto: str) -> list[str]:
        return sorted({c for c in texto if c not in ("\n", "\r") and c not in self.uni_cid})

    def largura(self, texto: str, tamanho: float, espacamento: float = 0.0) -> float:
        cids = [self.uni_cid[c] for c in texto if c in self.uni_cid]
        base = sum(self.larguras.get(c, self.largura_padrao) for c in cids) * tamanho / 1000.0
        return base + espacamento * max(0, len(cids) - 1)

    def codificar(self, texto: str) -> str:
        return "".join(f"{self.uni_cid[c]:04X}" for c in texto)


def _nome_sem_subconjunto(nome: str) -> str:
    return nome.split("+", 1)[1] if re.match(r"^[A-Z]{6}\+", nome or "") else (nome or "")


def _ler_larguras(doc: Any, texto_w: str) -> tuple[dict[int, float], float]:
    larg: dict[int, float] = {}
    toks = re.findall(r"\[|\]|-?[\d.]+", texto_w)
    if toks and toks[0] == "[":
        toks = toks[1:-1]
    i = 0
    while i < len(toks):
        try:
            ini = int(float(toks[i]))
        except ValueError:
            i += 1
            continue
        if i + 1 < len(toks) and toks[i + 1] == "[":
            j = i + 2
            c = ini
            while j < len(toks) and toks[j] != "]":
                larg[c] = float(toks[j])
                c += 1
                j += 1
            i = j + 1
        elif i + 2 < len(toks):
            fim, w = int(float(toks[i + 1])), float(toks[i + 2])
            for c in range(ini, fim + 1):
                larg[c] = w
            i += 3
        else:
            break
    return larg, 1000.0


def ler_fonte_embutida(doc: Any, xref: int) -> Optional[FonteEmbutida]:
    """Mapa letra→glifo e larguras de uma fonte Type0/Identity-H do PDF."""
    obj = doc.xref_object(xref)
    if "/Type0" not in obj or "Identity-H" not in obj:
        return None
    m_tu = re.search(r"/ToUnicode (\d+) 0 R", obj)
    m_desc = re.search(r"/DescendantFonts \[ ?(\d+) 0 R", obj)
    if not m_tu or not m_desc:
        return None
    tu = doc.xref_stream(int(m_tu.group(1))).decode("latin-1")
    uni_cid: dict[str, int] = {}
    for bloco in re.findall(r"beginbfchar(.*?)endbfchar", tu, re.S):
        for cid, uni in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", bloco):
            if len(uni) <= 4 and uni.upper() != "FFFF":
                uni_cid.setdefault(chr(int(uni, 16)), int(cid, 16))
    for bloco in re.findall(r"beginbfrange(.*?)endbfrange", tu, re.S):
        for ini, fim, uni in re.findall(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", bloco
        ):
            a, b, u = int(ini, 16), int(fim, 16), int(uni, 16)
            for k in range(b - a + 1):
                uni_cid.setdefault(chr(u + k), a + k)
    dobj = doc.xref_object(int(m_desc.group(1)))
    m_w = re.search(r"/W (\d+) 0 R", dobj)
    if m_w:
        w_txt = doc.xref_object(int(m_w.group(1)))
    else:
        m_wi = re.search(r"/W\s*(\[.*\])", dobj, re.S)
        w_txt = m_wi.group(1) if m_wi else "[]"
    larguras, _ = _ler_larguras(doc, w_txt)
    m_dw = re.search(r"/DW (\d+)", dobj)
    nome = _nome_sem_subconjunto(re.search(r"/BaseFont /([^\s/]+)", obj).group(1))
    # Alguns geradores mapeiam o espaço como NBSP: usa o mesmo glifo.
    if " " not in uni_cid and " " in uni_cid:
        uni_cid[" "] = uni_cid[" "]
    completa = all(c in uni_cid for c in CARACTERES_COMUNS if c != " ")
    return FonteEmbutida(
        xref=xref,
        nome=nome,
        uni_cid=uni_cid,
        larguras=larguras,
        largura_padrao=float(m_dw.group(1)) if m_dw else 1000.0,
        completa=completa,
    )


# ---------------------------------------------------------------------------
# Análise do PDF (textos candidatos a campo)
# ---------------------------------------------------------------------------


def _cor_pdf(cor: Any, n: int) -> str:
    vals = [max(0.0, min(1.0, float(v))) for v in (cor or [])]
    fmt = lambda v: f"{v:.4f}".rstrip("0").rstrip(".") or "0"  # noqa: E731
    if n == 4 and len(vals) == 4:
        return " ".join(fmt(v) for v in vals) + " k"
    if n == 3 and len(vals) == 3:
        return " ".join(fmt(v) for v in vals) + " rg"
    if n == 1 and vals:
        return f"{fmt(vals[0])} g"
    return "0 g"


def _cores_por_trecho(page: Any) -> list[tuple[Any, str]]:
    out = []
    try:
        for tr in page.get_texttrace():
            out.append((tr.get("bbox"), _cor_pdf(tr.get("color"), int(tr.get("colorspace") or 0))))
    except Exception:
        pass
    return out


_TOKENS_CONTEUDO = re.compile(
    rb"\[(?:\\.|[^\]\\])*\]\s*TJ"
    rb"|<[0-9A-Fa-f\s]*>\s*Tj"
    rb"|/[^\s/<>\[\]()]+\s+-?[\d.]+\s+Tf"
    rb"|-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+k(?![A-Za-z])"
    rb"|-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+rg(?![A-Za-z])"
    rb"|-?[\d.]+\s+g(?![A-Za-z])"
    rb"|/[^\s/<>\[\]()]+\s+cs(?![A-Za-z])"
    rb"|(?:-?[\d.]+\s+)+(?:/[^\s/<>\[\]()]+\s+)?scn?(?![A-Za-z])"
    rb"|(?<![A-Za-z/])(?:BT|ET|q|Q)(?![A-Za-z])"
)


def cores_originais_por_texto(doc: Any, page: Any) -> dict[str, str]:
    """
    Cor de preenchimento ORIGINAL (CMYK, RGB, cinza ou cor especial) de cada
    bloco de texto, lida do fluxo de conteúdo — a cor que a biblioteca devolve
    nos spans já vem convertida para RGB.
    """
    fontes: dict[str, Optional[FonteEmbutida]] = {}
    for f in page.get_fonts(full=True):
        fontes[f[4]] = ler_fonte_embutida(doc, f[0])
    cid_uni: dict[str, dict[int, str]] = {
        nome: {cid: ch for ch, cid in emb.uni_cid.items()} for nome, emb in fontes.items() if emb
    }
    try:
        conteudo = page.read_contents()
    except Exception:
        return {}
    out: dict[str, str] = {}
    cor, espaco = "0 g", ""
    pilha: list[tuple[str, str]] = []
    fonte_atual = ""
    texto_bt: list[str] = []
    cor_bt = cor
    for m in _TOKENS_CONTEUDO.finditer(conteudo):
        tok = m.group(0).decode("latin-1")
        parte = tok.split()
        m_op = re.search(r"(TJ|Tj|Tf|scn|sc|cs|rg|BT|ET|k|g|q|Q)\s*$", tok)
        op = m_op.group(1) if m_op else ""
        if op in ("k", "rg", "g", "Tf", "cs") and parte and parte[-1] != op:
            parte = parte[:-1] + [parte[-1][: -len(op)], op]
        if op == "q":
            pilha.append((cor, espaco))
        elif op == "Q":
            if pilha:
                cor, espaco = pilha.pop()
        elif op in ("k", "rg", "g"):
            cor, espaco = " ".join(parte), ""
        elif op == "cs":
            espaco = tok
        elif op in ("sc", "scn"):
            cor = (espaco + " " if espaco else "") + tok
        elif op == "BT":
            texto_bt, cor_bt = [], cor
        elif op == "Tf":
            fonte_atual = parte[0].lstrip("/")
        elif op in ("Tj", "TJ"):
            if not texto_bt:
                cor_bt = cor
            mapa = cid_uni.get(fonte_atual) or {}
            for hexa in re.findall(r"<([0-9A-Fa-f\s]*)>", tok):
                h = re.sub(r"\s+", "", hexa)
                texto_bt.append("".join(mapa.get(int(h[i : i + 4], 16), "") for i in range(0, len(h) - 3, 4)))
        elif op == "ET":
            chave = "".join(texto_bt).replace(" ", " ").strip()
            if chave and chave not in out:
                out[chave] = cor_bt
            texto_bt = []
    return out


def garantir_recurso_fonte(doc: Any, page: Any, recurso: str, xref_fonte: int) -> None:
    """Recoloca a fonte nos recursos da página (a remoção do texto pode tirá-la)."""
    tipo, valor = doc.xref_get_key(page.xref, "Resources")
    if tipo == "xref":
        alvo_xref, caminho = int(valor.split()[0]), f"Font/{recurso}"
    else:
        alvo_xref, caminho = page.xref, f"Resources/Font/{recurso}"
    tipo_f, valor_f = doc.xref_get_key(alvo_xref, caminho.rsplit("/", 1)[0])
    if tipo_f == "xref":
        alvo_xref, caminho = int(valor_f.split()[0]), recurso
    doc.xref_set_key(alvo_xref, caminho, f"{int(xref_fonte)} 0 R")


def _cor_do_span(cores: list[tuple[Any, str]], bbox: Any) -> str:
    import fitz

    alvo = fitz.Rect(bbox)
    melhor, area = "0 g", 0.0
    for tb, cor in cores:
        if tb is None:
            continue
        inter = alvo & fitz.Rect(tb)
        a = inter.get_area() if not inter.is_empty else 0.0
        if a > area:
            melhor, area = cor, a
    return melhor


def alinhamento_sugerido(x0: float, x1: float, largura_pagina: float) -> str:
    cx = (x0 + x1) / 2.0
    if abs(cx - largura_pagina / 2.0) <= largura_pagina * 0.06:
        return "centro"
    if x1 >= largura_pagina * 0.75 and x0 > largura_pagina / 2.0:
        return "direita"
    return "esquerda"


def ancora_sugerida(y0: float, y1: float, altura_pagina: float) -> str:
    return "base" if (y0 + y1) / 2.0 > altura_pagina * 0.6 else "topo"


def _abrir(content_or_path: Any) -> Any:
    import fitz

    if isinstance(content_or_path, (bytes, bytearray)):
        return fitz.open(stream=bytes(content_or_path), filetype="pdf")
    return fitz.open(str(content_or_path))


def analisar_pdf(content_or_path: Any) -> dict[str, Any]:
    """Páginas, fontes e textos (spans) do PDF, com alinhamento/âncora sugeridos."""
    doc = _abrir(content_or_path)
    try:
        paginas: list[dict[str, Any]] = []
        textos: list[dict[str, Any]] = []
        fontes: dict[str, dict[str, Any]] = {}
        for pidx, page in enumerate(doc):
            w, h = page.rect.width, page.rect.height
            paginas.append(
                {"pagina": pidx + 1, "largura_mm": round(w * 25.4 / 72, 2), "altura_mm": round(h * 25.4 / 72, 2)}
            )
            for f in page.get_fonts(full=True):
                nome = _nome_sem_subconjunto(f[3])
                if nome in fontes:
                    continue
                emb = ler_fonte_embutida(doc, f[0])
                fontes[nome] = {
                    "nome": nome,
                    "editavel": emb is not None,
                    "completa": bool(emb and emb.completa),
                    "glifos": len(emb.uni_cid) if emb else 0,
                    "faltam": (emb.faltando(CARACTERES_COMUNS) if emb else []),
                }
            cores = _cores_por_trecho(page)
            originais = cores_originais_por_texto(doc, page)
            for bloco in page.get_text("dict")["blocks"]:
                for linha in bloco.get("lines", []):
                    for span in linha["spans"]:
                        texto = span["text"].replace(" ", " ").strip()
                        if not texto:
                            continue
                        x0, y0, x1, y1 = span["bbox"]
                        textos.append(
                            {
                                "marcador": texto,
                                "pagina": pidx + 1,
                                "fonte": _nome_sem_subconjunto(span["font"]),
                                "tamanho": round(float(span["size"]), 2),
                                "cor": originais.get(texto) or _cor_do_span(cores, span["bbox"]),
                                "x_mm": round(x0 * 25.4 / 72, 2),
                                "y_mm": round(y0 * 25.4 / 72, 2),
                                "alinhamento_sugerido": alinhamento_sugerido(x0, x1, w),
                                "ancora_sugerida": ancora_sugerida(y0, y1, h),
                            }
                        )
        return {"paginas": paginas, "fontes": list(fontes.values()), "textos": textos}
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Configuração (admin)
# ---------------------------------------------------------------------------


def _normalizar_campo(raw: Any, marcadores: set[str]) -> Optional[dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    marcador = str(raw.get("marcador") or "").strip()
    if not marcador or marcador not in marcadores:
        return None
    template = str(raw.get("template") or "")
    if len(template) > 2000:
        raise ProvaPdfError(f"Template do campo «{marcador}» muito longo.")
    alinhamento = str(raw.get("alinhamento") or "auto")
    ancora = str(raw.get("ancora") or "auto")
    if alinhamento not in ALINHAMENTOS:
        alinhamento = "auto"
    if ancora not in ANCORAS:
        ancora = "auto"
    try:
        entrelinha = float(raw.get("entrelinha") or 1.2)
    except (TypeError, ValueError):
        entrelinha = 1.2
    try:
        pagina = int(raw.get("pagina") or 0)
    except (TypeError, ValueError):
        pagina = 0
    return {
        "marcador": marcador,
        "pagina": pagina,  # 0 = qualquer página
        "template": template,
        "alinhamento": alinhamento,
        "ancora": ancora,
        "entrelinha": max(0.8, min(3.0, entrelinha)),
        "reduzir_para_caber": bool(raw.get("reduzir_para_caber", True)),
    }


def obter_modelo_pdf(modelo_id: int) -> dict[str, Any]:
    pdf = caminho_pdf(modelo_id)
    config = carregar_config(modelo_id)
    if not pdf.is_file():
        return {"tem_pdf": False, "campos": config.get("campos") or [], "analise": None}
    return {
        "tem_pdf": True,
        "arquivo": config.get("arquivo_original") or pdf.name,
        "atualizado_em": config.get("atualizado_em"),
        "campos": config.get("campos") or [],
        "analise": analisar_pdf(pdf),
    }


def salvar_pdf_modelo(modelo_id: int, *, filename: str, content: bytes) -> dict[str, Any]:
    if not content:
        raise ProvaPdfError("Arquivo vazio.")
    if len(content) > MAX_PDF_BYTES:
        raise ProvaPdfError("PDF maior que 30 MB.")
    if not (filename or "").lower().endswith(".pdf") or not content.startswith(b"%PDF"):
        raise ProvaPdfError("Envie um arquivo PDF.")
    analise = analisar_pdf(content)
    if not analise["textos"]:
        raise ProvaPdfError(
            "O PDF não tem textos editáveis (estão em curvas?). Exporte com os textos como texto."
        )
    pasta = _pasta(modelo_id)
    pasta.mkdir(parents=True, exist_ok=True)
    caminho_pdf(modelo_id).write_bytes(content)
    marcadores = {t["marcador"] for t in analise["textos"]}
    anterior = carregar_config(modelo_id)
    campos = [
        c
        for c in (
            _normalizar_campo(x, marcadores) for x in (anterior.get("campos") or [])
        )
        if c
    ]
    _salvar_config(
        modelo_id,
        {
            "arquivo_original": os.path.basename(filename or "modelo.pdf"),
            "atualizado_em": time.strftime("%Y-%m-%d %H:%M:%S"),
            "campos": campos,
        },
    )
    return obter_modelo_pdf(modelo_id)


def salvar_campos(modelo_id: int, campos: list[Any]) -> dict[str, Any]:
    pdf = caminho_pdf(modelo_id)
    if not pdf.is_file():
        raise ProvaPdfError("Envie primeiro o PDF do modelo.")
    analise = analisar_pdf(pdf)
    marcadores = {t["marcador"] for t in analise["textos"]}
    normalizados = []
    vistos: set[tuple[str, int]] = set()
    for raw in campos or []:
        c = _normalizar_campo(raw, marcadores)
        if not c or not c["template"].strip():
            continue
        chave = (c["marcador"], c["pagina"])
        if chave in vistos:
            continue
        vistos.add(chave)
        normalizados.append(c)
    config = carregar_config(modelo_id)
    config["campos"] = normalizados
    config["atualizado_em"] = time.strftime("%Y-%m-%d %H:%M:%S")
    _salvar_config(modelo_id, config)
    return obter_modelo_pdf(modelo_id)


def remover_modelo_pdf(modelo_id: int) -> dict[str, Any]:
    for path in (caminho_pdf(modelo_id), _caminho_config(modelo_id)):
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Prova PDF: não foi possível remover %s: %s", path, exc)
    return obter_modelo_pdf(modelo_id)


# ---------------------------------------------------------------------------
# Renderização
# ---------------------------------------------------------------------------


def _espacamento_do_marcador(fonte: FonteEmbutida, chars: list[dict[str, Any]], tamanho: float) -> float:
    extras = []
    for a, b in zip(chars, chars[1:]):
        cid = fonte.uni_cid.get(a["c"])
        if cid is None:
            continue
        avanco = fonte.larguras.get(cid, fonte.largura_padrao) * tamanho / 1000.0
        extras.append(b["origin"][0] - a["origin"][0] - avanco)
    if not extras:
        return 0.0
    extras.sort()
    meio = extras[len(extras) // 2]
    return round(meio, 4) if abs(meio) > 0.01 else 0.0


def _texto_do_campo(template: str, dados: dict[str, Any]) -> str:
    from services.papelaria_models_service import substituir_variaveis

    texto = substituir_variaveis(template, dados) or ""
    linhas = texto.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    while linhas and not linhas[-1].strip():
        linhas.pop()
    return "\n".join(linhas)


def _chave_fonte(nome: str) -> str:
    chave = re.sub(r"[^a-z0-9]", "", _nome_sem_subconjunto(nome).lower())
    for sufixo in ("regular", "mt", "psmt"):
        if chave.endswith(sufixo) and len(chave) > len(sufixo):
            chave = chave[: -len(sufixo)]
    return chave


def _fonte_do_span(
    fontes_pg: dict[str, tuple[int, str]], nome_span: str
) -> Optional[tuple[int, str]]:
    """Fonte da página usada pelo span (o nome do span pode vir do arquivo da fonte)."""
    nome = _nome_sem_subconjunto(nome_span)
    if nome in fontes_pg:
        return fontes_pg[nome]
    chave = _chave_fonte(nome)
    candidatas = [v for k, v in fontes_pg.items() if _chave_fonte(k) == chave]
    if len(candidatas) == 1:
        return candidatas[0]
    if len(fontes_pg) == 1:
        return next(iter(fontes_pg.values()))
    return None


def renderizar(
    pdf_modelo: Any,
    campos: list[dict[str, Any]],
    dados: dict[str, Any],
) -> bytes:
    """
    Aplica os campos ao PDF do modelo e devolve o PDF final (bytes).

    Remove só o texto de cada marcador e escreve o texto novo com a fonte
    embutida no PDF, mesmo tamanho, cor e espaçamento entre letras.
    """
    import fitz

    doc = _abrir(pdf_modelo)
    try:
        por_pagina: dict[int, list[tuple[dict[str, Any], dict[str, Any]]]] = {}
        for pidx, page in enumerate(doc):
            fontes_pg = {
                _nome_sem_subconjunto(f[3]): (f[0], f[4]) for f in page.get_fonts(full=True)
            }
            cores = _cores_por_trecho(page)
            originais = cores_originais_por_texto(doc, page)
            for bloco in page.get_text("rawdict")["blocks"]:
                for linha in bloco.get("lines", []):
                    for span in linha["spans"]:
                        texto = "".join(c["c"] for c in span["chars"]).replace(" ", " ").strip()
                        for campo in campos:
                            if campo["marcador"] != texto:
                                continue
                            if campo.get("pagina") and int(campo["pagina"]) != pidx + 1:
                                continue
                            achada = _fonte_do_span(fontes_pg, span["font"])
                            if achada is None:
                                raise ProvaPdfError(f"Fonte do campo «{texto}» não encontrada no PDF.")
                            xref, recurso = achada
                            por_pagina.setdefault(pidx, []).append(
                                (
                                    campo,
                                    {
                                        "bbox": fitz.Rect(span["bbox"]),
                                        "origem": fitz.Point(span["origin"]),
                                        "tamanho": float(span["size"]),
                                        "chars": [c for c in span["chars"] if c["c"].strip()],
                                        "xref": xref,
                                        "recurso": recurso,
                                        "cor": originais.get(texto) or _cor_do_span(cores, span["bbox"]),
                                    },
                                )
                            )
        if not por_pagina:
            raise ProvaPdfError("Nenhum campo configurado foi encontrado no PDF do modelo.")

        # Margem da página = a menor distância de um texto do PDF até a borda
        # (o texto novo pode ocupar até ela antes de ser reduzido).
        margem_pagina: dict[int, float] = {}
        for pidx in por_pagina:
            pg = doc[pidx]
            ws = pg.rect.width
            dist = [
                min(s["bbox"][0], ws - s["bbox"][2])
                for b in pg.get_text("dict")["blocks"]
                for l in b.get("lines", [])
                for s in l["spans"]
                if s["text"].strip()
            ]
            margem_pagina[pidx] = max(5.67, min(dist) if dist else 14.17)  # ≥ 2 mm

        fontes_cache: dict[int, FonteEmbutida] = {}
        for pidx, itens in por_pagina.items():
            page = doc[pidx]
            largura_pg, altura_pg = page.rect.width, page.rect.height
            planos = []
            for campo, alvo in itens:
                fonte = fontes_cache.get(alvo["xref"])
                if fonte is None:
                    fonte = ler_fonte_embutida(doc, alvo["xref"])
                    if fonte is None:
                        raise ProvaPdfError(
                            f"A fonte do campo «{campo['marcador']}» não está incorporada de forma "
                            "editável. Exporte o PDF do Corel com as fontes incorporadas."
                        )
                    fontes_cache[alvo["xref"]] = fonte
                texto = _texto_do_campo(campo["template"], dados)
                faltam = fonte.faltando(texto)
                if faltam:
                    raise ProvaPdfError(
                        f"A fonte {fonte.nome} do PDF não tem os caracteres {' '.join(faltam)} "
                        f"(campo «{campo['marcador']}»). Exporte o PDF com a fonte inteira "
                        "(sem subconjunto)."
                    )
                planos.append((campo, alvo, fonte, texto))
                page.add_redact_annot(alvo["bbox"], fill=False)
            page.apply_redactions(
                images=fitz.PDF_REDACT_IMAGE_NONE,
                graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                text=fitz.PDF_REDACT_TEXT_REMOVE,
            )
            for _campo, alvo, _fonte, _texto in planos:
                garantir_recurso_fonte(doc, page, alvo["recurso"], alvo["xref"])

            ops = ["q"]
            for campo, alvo, fonte, texto in planos:
                if not texto:
                    continue
                bbox: fitz.Rect = alvo["bbox"]
                tam = alvo["tamanho"]
                tc = _espacamento_do_marcador(fonte, alvo["chars"], tam)
                alinhar = campo.get("alinhamento") or "auto"
                if alinhar == "auto":
                    alinhar = alinhamento_sugerido(bbox.x0, bbox.x1, largura_pg)
                ancora = campo.get("ancora") or "auto"
                if ancora == "auto":
                    ancora = ancora_sugerida(bbox.y0, bbox.y1, altura_pg)
                linhas = texto.split("\n")
                margem = margem_pagina.get(pidx, 0.0)
                if alinhar == "esquerda":
                    disponivel = largura_pg - margem - alvo["origem"].x
                elif alinhar == "direita":
                    disponivel = bbox.x1 - margem
                else:
                    cx = (bbox.x0 + bbox.x1) / 2.0
                    disponivel = 2.0 * min(cx - margem, largura_pg - margem - cx)
                maior = max(fonte.largura(l, tam, tc) for l in linhas)
                if campo.get("reduzir_para_caber", True) and disponivel > 0 and maior > disponivel:
                    fator = max(0.6, disponivel / maior)
                    tam *= fator
                    tc *= fator
                entrelinha = tam * float(campo.get("entrelinha") or 1.2)
                n = len(linhas)
                base_y = alvo["origem"].y
                for i, linha in enumerate(linhas):
                    if ancora == "base":
                        y = base_y - (n - 1 - i) * entrelinha
                    elif ancora == "centro":
                        y = base_y + (i - (n - 1) / 2.0) * entrelinha
                    else:
                        y = base_y + i * entrelinha
                    w = fonte.largura(linha, tam, tc)
                    if alinhar == "direita":
                        x = bbox.x1 - w
                    elif alinhar == "centro":
                        x = (bbox.x0 + bbox.x1) / 2.0 - w / 2.0
                    else:
                        x = alvo["origem"].x
                    ops.append(
                        f"BT {alvo['cor']} /{alvo['recurso']} {tam:.4f} Tf {tc:.4f} Tc "
                        f"1 0 0 1 {x:.4f} {altura_pg - y:.4f} Tm <{fonte.codificar(linha)}> Tj ET"
                    )
            ops.append("Q")
            page.wrap_contents()
            novo = doc.get_new_xref()
            doc.update_object(novo, "<<>>")
            doc.update_stream(novo, ("\n".join(ops) + "\n").encode("latin-1"))
            conteudos = page.get_contents() + [novo]
            doc.xref_set_key(page.xref, "Contents", "[" + " ".join(f"{x} 0 R" for x in conteudos) + "]")
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


def previa_png(modelo_id: int, dados: dict[str, Any], dpi: int = 150) -> dict[str, Any]:
    """Admin: aplica valores de teste e devolve as páginas em PNG (data URL)."""
    import fitz

    pdf = caminho_pdf(modelo_id)
    if not pdf.is_file():
        raise ProvaPdfError("Envie primeiro o PDF do modelo.")
    campos = [c for c in carregar_config(modelo_id).get("campos") or [] if c.get("template")]
    if not campos:
        raise ProvaPdfError("Ligue ao menos um texto do PDF a um campo.")
    from services.papelaria_corel_dados_service import preparar_dados
    from services import papelaria_models_service as models_svc

    modelo = models_svc.get_modelo_by_id(int(modelo_id)) or {}
    t0 = time.perf_counter()
    saida = renderizar(pdf, campos, preparar_dados(dados or {}, modelo))
    ms = int((time.perf_counter() - t0) * 1000)
    doc = fitz.open(stream=saida, filetype="pdf")
    try:
        paginas = [
            "data:image/png;base64," + base64.b64encode(p.get_pixmap(dpi=dpi).tobytes("png")).decode()
            for p in doc
        ]
    finally:
        doc.close()
    return {"paginas": paginas, "ms": ms}


# ---------------------------------------------------------------------------
# Job (modo prova_pdf)
# ---------------------------------------------------------------------------


def gerar_prova_do_job(job_id: int) -> dict[str, Any]:
    """
    Gera BaseSefoc.pdf + ProvaN.pdf do job no servidor e conclui o job como
    o worker faria (aguardando OK do técnico). O job deve estar «processing»
    com WorkerID = WORKER_ID_SERVIDOR.
    """
    from database import db
    from services import papelaria_jobs_service as jobs_svc
    from services.papelaria_corel_dados_service import preparar_dados
    from services import papelaria_models_service as models_svc

    job = jobs_svc.get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")
    t0 = time.perf_counter()
    try:
        modelo = models_svc.get_modelo_by_id(int(job["modelo_id"] or 0)) or {}
        campos = [c for c in carregar_config(int(job["modelo_id"])).get("campos") or [] if c.get("template")]
        dados = preparar_dados(
            {k: v for k, v in (job.get("dados") or {}).items() if not str(k).startswith("__")},
            modelo,
        )
        conteudo = renderizar(caminho_pdf(int(job["modelo_id"])), campos, dados)

        ano, nro = int(job["ano_protocolo"]), int(job["nro_protocolo"])
        sefoc = jobs_svc.resolve_os_papelaria_dir(ano, nro, create=True)
        _cdr, base_pdf = jobs_svc.build_output_filenames(ano, nro)
        prova_pdf = jobs_svc.build_prova_web_pdf_name(ano, nro)
        prova_numero = jobs_svc.extract_prova_version_from_filename(prova_pdf)
        Path(sefoc, base_pdf).write_bytes(conteudo)
        Path(sefoc, prova_pdf).write_bytes(conteudo)
        ms = int((time.perf_counter() - t0) * 1000)

        dados_job = dict(job.get("dados") or {})
        dados_job.update(
            {
                "prova_web_pdf_name": prova_pdf,
                "prova_numero": prova_numero,
                "prova_pdf_ms": ms,
                "gerado_por": "prova_pdf",
            }
        )
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(completed)s,
                ArquivoCdrGerado = NULL,
                ArquivoPdfGerado = %(pdf)s,
                ProvaRevisao = %(pending)s,
                DadosJson = %(dados)s,
                Versao = %(versao)s,
                ConcluidoEm = NOW(),
                Erro = NULL
            WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker)s
            """,
            {
                "id": job_id,
                "completed": jobs_svc.STATUS_COMPLETED,
                "pending": jobs_svc.PROVA_REVISAO_PENDING,
                "pdf": base_pdf,
                "dados": json.dumps(dados_job, ensure_ascii=False),
                "versao": prova_numero or 1,
                "processing": jobs_svc.STATUS_PROCESSING,
                "worker": WORKER_ID_SERVIDOR,
            },
        )
        jobs_svc.append_job_log(
            job_id,
            f"Prova PDF gerada no servidor em {ms} ms ({len(campos)} campo(s)) — "
            f"{base_pdf} e {prova_pdf}. Aguardando aprovação do técnico.",
            "info",
        )
    except Exception as exc:
        msg = str(exc) if isinstance(exc, (ProvaPdfError, LookupError, OSError)) else f"Falha na Prova PDF: {exc}"
        logger.exception("Prova PDF do job %s falhou", job_id)
        jobs_svc.fail_job(job_id, WORKER_ID_SERVIDOR, msg, retryable=False)
        return jobs_svc.get_job(job_id) or job
    updated = jobs_svc.get_job(job_id) or job
    jobs_svc.broadcast_job_update(updated)
    return updated

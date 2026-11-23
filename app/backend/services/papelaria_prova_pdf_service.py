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
import hashlib
import json
import logging
import os
import re
import time
from collections import OrderedDict
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
# «Reduzir para caber»: distância mínima do texto até a borda da página.
MARGEM_MINIMA_MM = 3.0
MARGEM_MINIMA_PT = MARGEM_MINIMA_MM * 72.0 / 25.4
# Limite de legibilidade: abaixo disso o texto não é mais reduzido (gera aviso).
FATOR_REDUCAO_MINIMO = 0.6
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


def _nome_fonte_legivel(nome: str) -> str:
    """Remove prefixo de subset e decodifica escapes PDF (#20 → espaço)."""
    base = _nome_sem_subconjunto(nome or "")
    return re.sub(r"#([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), base)


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


_CACHE_CORES: "OrderedDict[tuple[Any, ...], dict[str, str]]" = OrderedDict()
_CACHE_CORES_MAX = 32


def cores_originais_por_texto(doc: Any, page: Any) -> dict[str, str]:
    """
    Cor de preenchimento ORIGINAL (CMYK, RGB, cinza ou cor especial) de cada
    bloco de texto, lida do fluxo de conteúdo — a cor que a biblioteca devolve
    nos spans já vem convertida para RGB.

    Ler o fluxo é a parte cara da prévia (centenas de ms em PDFs do Corel);
    o resultado fica em cache pelo conteúdo da página + fontes.
    """
    try:
        conteudo = page.read_contents()
        chave = (
            hashlib.sha1(conteudo).hexdigest(),
            tuple((f[0], f[3], f[4]) for f in page.get_fonts(full=True)),
        )
    except Exception:
        chave = None
    if chave is not None and chave in _CACHE_CORES:
        _CACHE_CORES.move_to_end(chave)
        return dict(_CACHE_CORES[chave])
    out = _cores_originais_por_texto(doc, page)
    if chave is not None:
        _CACHE_CORES[chave] = dict(out)
        while len(_CACHE_CORES) > _CACHE_CORES_MAX:
            _CACHE_CORES.popitem(last=False)
    return out


def _cores_originais_por_texto(doc: Any, page: Any) -> dict[str, str]:
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


# ---------------------------------------------------------------------------
# Linhas de texto: uma linha visual do PDF pode vir partida em vários spans
# (o CorelDRAW abre um span novo a cada troca de fonte/estilo — ex.: o nome do
# deputado em Semibold no meio de «Gabinete do Deputado Nome - PARTIDO/UF»).
# Spans encostados da mesma linha formam UM texto do PDF.
# ---------------------------------------------------------------------------


def _texto_span(span: dict[str, Any]) -> str:
    """Texto de um span de ``get_text("dict")`` ou ``get_text("rawdict")``."""
    if "text" in span:
        bruto = span["text"]
    else:
        bruto = "".join(c["c"] for c in span.get("chars") or [])
    return bruto.replace("\u00a0", " ")


def agrupar_spans_da_linha(spans: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """
    Junta spans encostados de uma mesma linha. Um espaço grande entre dois
    spans (textos distantes na mesma altura) separa os grupos.
    """
    grupos: list[list[dict[str, Any]]] = []
    atual: list[dict[str, Any]] = []
    fim: Optional[float] = None
    for span in spans:
        if not _texto_span(span).strip():
            if atual:
                atual.append(span)  # espaço entre estilos faz parte do texto
            continue
        x0 = float(span["bbox"][0])
        limite = max(float(span.get("size") or 0.0), 1.0) * 1.2
        if atual and fim is not None and x0 - fim > limite:
            grupos.append(atual)
            atual = []
        atual.append(span)
        fim = float(span["bbox"][2])
    if atual:
        grupos.append(atual)
    return grupos


def _texto_do_grupo(grupo: list[dict[str, Any]]) -> str:
    return "".join(_texto_span(s) for s in grupo).strip()


def _spans_com_texto(grupo: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [s for s in grupo if _texto_span(s).strip()]


def _span_base(grupo: list[dict[str, Any]]) -> dict[str, Any]:
    """Span cuja fonte representa o texto: o primeiro em estilo não negrito."""
    com_texto = _spans_com_texto(grupo) or grupo
    for span in com_texto:
        if not _eh_fonte_negrito(_nome_sem_subconjunto(span["font"])):
            return span
    return com_texto[0]


def _bbox_do_grupo(grupo: list[dict[str, Any]]) -> tuple[float, float, float, float]:
    caixas = [s["bbox"] for s in (_spans_com_texto(grupo) or grupo)]
    return (
        min(float(b[0]) for b in caixas),
        min(float(b[1]) for b in caixas),
        max(float(b[2]) for b in caixas),
        max(float(b[3]) for b in caixas),
    )


def _fontes_do_grupo(grupo: list[dict[str, Any]]) -> list[str]:
    vistas: list[str] = []
    for span in _spans_com_texto(grupo):
        nome = _nome_sem_subconjunto(span["font"])
        if nome not in vistas:
            vistas.append(nome)
    return vistas


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
                    for grupo in agrupar_spans_da_linha(linha["spans"]):
                        texto = _texto_do_grupo(grupo)
                        if not texto:
                            continue
                        base = _span_base(grupo)
                        x0, y0, x1, y1 = _bbox_do_grupo(grupo)
                        fontes_linha = _fontes_do_grupo(grupo)
                        item: dict[str, Any] = {
                            "marcador": texto,
                            "pagina": pidx + 1,
                            "fonte": _nome_sem_subconjunto(base["font"]),
                            "tamanho": round(float(base["size"]), 2),
                            "cor": originais.get(texto)
                            or originais.get(_texto_span(base).strip())
                            or _cor_do_span(cores, base["bbox"]),
                            "x_mm": round(x0 * 25.4 / 72, 2),
                            "y_mm": round(y0 * 25.4 / 72, 2),
                            "alinhamento_sugerido": alinhamento_sugerido(x0, x1, w),
                            "ancora_sugerida": ancora_sugerida(y0, y1, h),
                        }
                        if len(fontes_linha) > 1:
                            # Linha com estilos mistos (ex.: nome em negrito).
                            item["fontes"] = fontes_linha
                            item["trechos"] = [
                                {
                                    "texto": _texto_span(sp),
                                    "fonte": _nome_sem_subconjunto(sp["font"]),
                                    "negrito": _eh_fonte_negrito(_nome_sem_subconjunto(sp["font"])),
                                }
                                for sp in grupo
                                if _texto_span(sp)
                            ]
                        textos.append(item)
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


def salvar_campos(
    modelo_id: int, campos: list[Any], *, limpar: bool = False
) -> dict[str, Any]:
    pdf = caminho_pdf(modelo_id)
    if not pdf.is_file():
        raise ProvaPdfError("Envie primeiro o PDF do modelo.")
    analise = analisar_pdf(pdf)
    marcadores = {t["marcador"] for t in analise["textos"]}
    config = carregar_config(modelo_id)
    existentes = [
        c
        for c in (config.get("campos") or [])
        if isinstance(c, dict) and str(c.get("template") or "").strip()
    ]
    # Aceita órfãos já salvos (marcador sumiu da análise após trocar o PDF).
    marcadores_aceitos = marcadores | {
        str(c.get("marcador") or "").strip()
        for c in existentes
        if str(c.get("marcador") or "").strip()
    }
    normalizados = []
    vistos: set[tuple[str, int]] = set()
    for raw in campos or []:
        c = _normalizar_campo(raw, marcadores_aceitos)
        if not c or not c["template"].strip():
            continue
        chave = (c["marcador"], c["pagina"])
        if chave in vistos:
            continue
        vistos.add(chave)
        normalizados.append(c)
    # Evita apagar vínculos por payload vazio acidental (ex.: closure stale no admin).
    if not normalizados and existentes and not limpar:
        raise ProvaPdfError(
            "Nenhum campo foi enviado, mas este modelo já tem campos salvos. "
            "Envie os campos novamente ou confirme a limpeza explícita."
        )
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


def _linhas_com_informacao(template: str, dados: dict[str, Any]) -> str:
    """
    Tira do template as linhas cujas variáveis estão todas vazias — junto com o
    texto fixo delas («Fone: », «/»). Linhas só com texto fixo ficam.
    """
    from services.papelaria_models_service import enriquecer_variaveis_derivadas

    resolvidos = enriquecer_variaveis_derivadas(dados)

    def valor(nome: str) -> str:
        nome = nome.strip()
        if nome == "nome_acessor":
            nome = "nome_assessor"
        return str(resolvidos.get(nome) or "").strip()

    linhas = (template or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    mantidas = []
    for linha in linhas:
        variaveis = re.findall(r"\{([^{}]+)\}", linha)
        if variaveis and not any(valor(v) for v in variaveis):
            continue
        mantidas.append(linha)
    return "\n".join(mantidas)


def _texto_do_campo(
    template: str, dados: dict[str, Any]
) -> tuple[str, list[tuple[int, int]]]:
    """Substitui variáveis e interpreta `**negrito**` → texto plano + intervalos."""
    from services.papelaria_models_service import (
        _substituir_placeholders,
        parse_inline_bold,
    )

    texto = _substituir_placeholders(_linhas_com_informacao(template, dados), dados)
    texto = texto.replace("\r\n", "\n").replace("\r", "\n")
    plain, ranges = parse_inline_bold(texto)
    linhas = plain.split("\n")
    while linhas and not linhas[-1].strip():
        linhas.pop()
    plain = "\n".join(linhas)
    lim = len(plain)
    ranges = [(a, min(b, lim)) for a, b in ranges if a < lim and a < b]
    return plain, ranges


def _chave_fonte(nome: str) -> str:
    chave = re.sub(r"[^a-z0-9]", "", _nome_fonte_legivel(nome).lower())
    for sufixo in ("regular", "mt", "psmt"):
        if chave.endswith(sufixo) and len(chave) > len(sufixo):
            chave = chave[: -len(sufixo)]
    return chave


def _familia_fonte(nome: str) -> str:
    """Família tipográfica sem sufixo de estilo (regular/bold/italic…)."""
    chave = re.sub(r"[^a-z0-9]", "", _nome_fonte_legivel(nome).lower())
    for sufixo in (
        "bolditalic",
        "boldoblique",
        "blackitalic",
        "semibold",
        "bold",
        "black",
        "heavy",
        "italic",
        "oblique",
        "regular",
        "medium",
        "light",
        "mt",
        "psmt",
    ):
        if chave.endswith(sufixo) and len(chave) > len(sufixo):
            chave = chave[: -len(sufixo)]
    return chave


def _eh_fonte_negrito(nome: str) -> bool:
    chave = re.sub(r"[^a-z0-9]", "", _nome_fonte_legivel(nome).lower())
    return any(tag in chave for tag in ("bold", "black", "heavy", "semibold"))


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


def _resolver_fonte_negrito(
    doc: Any,
    fontes_pg: dict[str, tuple[int, str]],
    fonte_regular: FonteEmbutida,
    fontes_cache: dict[int, FonteEmbutida],
) -> Optional[tuple[int, str, FonteEmbutida]]:
    """Localiza variante Bold/Black da mesma família já embutida no PDF."""
    familia = _familia_fonte(fonte_regular.nome)
    for nome, (xref, recurso) in fontes_pg.items():
        if xref == fonte_regular.xref:
            continue
        if not _eh_fonte_negrito(nome):
            continue
        if _familia_fonte(nome) != familia:
            continue
        emb = fontes_cache.get(xref)
        if emb is None:
            emb = ler_fonte_embutida(doc, xref)
            if emb is None:
                continue
            fontes_cache[xref] = emb
        return xref, recurso, emb
    return None


def _segmentos_com_negrito(
    texto: str, ranges: list[tuple[int, int]]
) -> list[tuple[str, bool]]:
    """Parte o texto em segmentos (trecho, é_negrito) segundo intervalos 0-based."""
    if not texto:
        return []
    if not ranges:
        return [(texto, False)]
    marks = [False] * len(texto)
    for ini, fim in ranges:
        for i in range(max(0, ini), min(len(texto), fim)):
            marks[i] = True
    segs: list[tuple[str, bool]] = []
    i = 0
    while i < len(texto):
        flag = marks[i]
        j = i + 1
        while j < len(texto) and marks[j] == flag:
            j += 1
        segs.append((texto[i:j], flag))
        i = j
    return segs


def _segmentos_por_linha(
    texto: str, ranges: list[tuple[int, int]]
) -> list[list[tuple[str, bool]]]:
    """Segmentos de cada linha (offsets globais do texto completo)."""
    linhas = texto.split("\n")
    out: list[list[tuple[str, bool]]] = []
    offset = 0
    for i, linha in enumerate(linhas):
        locais = [
            (max(0, a - offset), min(len(linha), b - offset))
            for a, b in ranges
            if b > offset and a < offset + len(linha)
        ]
        locais = [(a, b) for a, b in locais if a < b]
        out.append(_segmentos_com_negrito(linha, locais))
        offset += len(linha) + (1 if i < len(linhas) - 1 else 0)
    return out


def _largura_segmentos(
    segs: list[tuple[str, bool]],
    fonte: FonteEmbutida,
    fonte_bold: Optional[FonteEmbutida],
    tamanho: float,
    espacamento: float,
) -> float:
    total = 0.0
    for trecho, negrito in segs:
        if not trecho:
            continue
        f = fonte_bold if negrito and fonte_bold is not None else fonte
        total += f.largura(trecho, tamanho, espacamento)
    return total


def renderizar(
    pdf_modelo: Any,
    campos: list[dict[str, Any]],
    dados: dict[str, Any],
    avisos: Optional[list[str]] = None,
) -> bytes:
    """
    Aplica os campos ao PDF do modelo e devolve o PDF final (bytes).

    Remove só o texto de cada marcador e escreve o texto novo com a fonte
    embutida no PDF, mesmo tamanho, cor e espaçamento entre letras.
    Se houver `**negrito**` sem Bold embutida, desenha em regular e acrescenta
    aviso em ``avisos`` (quando fornecido).
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
            def _campos_do_texto(texto: str, pagina: int = pidx + 1) -> list[dict[str, Any]]:
                return [
                    c
                    for c in campos
                    if c["marcador"] == texto
                    and not (c.get("pagina") and int(c["pagina"]) != pagina)
                ]

            def _alvo(
                grupo: list[dict[str, Any]],
                texto: str,
                fontes_pg: dict[str, tuple[int, str]] = fontes_pg,
                cores: list[tuple[Any, str]] = cores,
                originais: dict[str, str] = originais,
            ) -> dict[str, Any]:
                base = _span_base(grupo)
                achada = _fonte_do_span(fontes_pg, base["font"])
                if achada is None:
                    raise ProvaPdfError(f"Fonte do campo «{texto}» não encontrada no PDF.")
                xref, recurso = achada
                primeiro = (_spans_com_texto(grupo) or grupo)[0]
                return {
                    "bbox": fitz.Rect(_bbox_do_grupo(grupo)),
                    # x do início da linha; linha de base do trecho principal.
                    "origem": fitz.Point(float(primeiro["origin"][0]), float(base["origin"][1])),
                    "tamanho": float(base["size"]),
                    "chars": [c for c in base["chars"] if c["c"].strip()],
                    "xref": xref,
                    "recurso": recurso,
                    "cor": originais.get(texto)
                    or originais.get(_texto_span(base).strip())
                    or _cor_do_span(cores, base["bbox"]),
                }

            for bloco in page.get_text("rawdict")["blocks"]:
                for linha in bloco.get("lines", []):
                    for grupo in agrupar_spans_da_linha(linha["spans"]):
                        texto = _texto_do_grupo(grupo)
                        if not texto:
                            continue
                        ligados = _campos_do_texto(texto)
                        if ligados:
                            alvo = _alvo(grupo, texto)
                            for campo in ligados:
                                por_pagina.setdefault(pidx, []).append((campo, alvo))
                            continue
                        # Compatibilidade: campos salvos antes do agrupamento
                        # apontam para um span isolado da linha.
                        com_texto = _spans_com_texto(grupo)
                        if len(com_texto) < 2:
                            continue
                        for span in com_texto:
                            texto_span = _texto_span(span).strip()
                            ligados_span = _campos_do_texto(texto_span)
                            if not ligados_span:
                                continue
                            alvo = _alvo([span], texto_span)
                            for campo in ligados_span:
                                por_pagina.setdefault(pidx, []).append((campo, alvo))
        if not por_pagina:
            raise ProvaPdfError("Nenhum campo configurado foi encontrado no PDF do modelo.")

        fontes_cache: dict[int, FonteEmbutida] = {}
        for pidx, itens in por_pagina.items():
            page = doc[pidx]
            largura_pg, altura_pg = page.rect.width, page.rect.height
            fontes_pg = {
                _nome_sem_subconjunto(f[3]): (f[0], f[4]) for f in page.get_fonts(full=True)
            }
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
                texto, ranges_negrito = _texto_do_campo(campo["template"], dados)
                fonte_bold: Optional[FonteEmbutida] = None
                bold_xref = 0
                bold_recurso = ""
                if ranges_negrito:
                    resolvida = _resolver_fonte_negrito(
                        doc, fontes_pg, fonte, fontes_cache
                    )
                    if resolvida is None:
                        msg = (
                            f"O campo «{campo['marcador']}» usa negrito (`**...**`), "
                            f"mas o PDF não tem a Bold da família «{fonte.nome}» "
                            "incorporada — o trecho saiu em regular. Exporte do "
                            "CorelDRAW com a variante Bold incorporada (sem subconjunto)."
                        )
                        if avisos is not None:
                            avisos.append(msg)
                        ranges_negrito = []
                    else:
                        bold_xref, bold_recurso, fonte_bold = resolvida
                faltam = fonte.faltando(texto)
                if faltam:
                    raise ProvaPdfError(
                        f"A fonte {fonte.nome} do PDF não tem os caracteres {' '.join(faltam)} "
                        f"(campo «{campo['marcador']}»). Exporte o PDF com a fonte inteira "
                        "(sem subconjunto)."
                    )
                if fonte_bold is not None:
                    negrito_txt = "".join(
                        texto[a:b] for a, b in ranges_negrito if 0 <= a < b <= len(texto)
                    )
                    faltam_b = fonte_bold.faltando(negrito_txt)
                    if faltam_b:
                        raise ProvaPdfError(
                            f"A fonte negrito {fonte_bold.nome} não tem os caracteres "
                            f"{' '.join(faltam_b)} (campo «{campo['marcador']}»). "
                            "Exporte o PDF com a fonte Bold inteira (sem subconjunto)."
                        )
                planos.append(
                    (campo, alvo, fonte, texto, ranges_negrito, fonte_bold, bold_xref, bold_recurso)
                )
                page.add_redact_annot(alvo["bbox"], fill=False)
            page.apply_redactions(
                images=fitz.PDF_REDACT_IMAGE_NONE,
                graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                text=fitz.PDF_REDACT_TEXT_REMOVE,
            )
            for _campo, alvo, _fonte, _texto, _ranges, fonte_bold, bold_xref, bold_recurso in planos:
                garantir_recurso_fonte(doc, page, alvo["recurso"], alvo["xref"])
                if fonte_bold is not None and bold_xref and bold_recurso:
                    garantir_recurso_fonte(doc, page, bold_recurso, bold_xref)

            ops = ["q"]
            for campo, alvo, fonte, texto, ranges_negrito, fonte_bold, _bx, bold_recurso in planos:
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
                segs_linhas = _segmentos_por_linha(texto, ranges_negrito)
                margem = MARGEM_MINIMA_PT
                if alinhar == "esquerda":
                    disponivel = largura_pg - margem - alvo["origem"].x
                elif alinhar == "direita":
                    disponivel = bbox.x1 - margem
                else:
                    cx = (bbox.x0 + bbox.x1) / 2.0
                    disponivel = 2.0 * min(cx - margem, largura_pg - margem - cx)
                maior = max(
                    (
                        _largura_segmentos(segs, fonte, fonte_bold, tam, tc)
                        for segs in segs_linhas
                    ),
                    default=0.0,
                )
                # «Reduzir para caber»: só quando a linha mais larga invadiria a
                # margem mínima de 3 mm da página — e só o necessário para
                # encostar nela (fonte e espaçamento escalam juntos).
                if campo.get("reduzir_para_caber", True) and disponivel > 0 and maior > disponivel:
                    fator = disponivel / maior
                    if fator < FATOR_REDUCAO_MINIMO:
                        fator = FATOR_REDUCAO_MINIMO
                        if avisos is not None:
                            avisos.append(
                                f"O campo «{campo['marcador']}» ficou longo demais: mesmo reduzido a "
                                f"{int(FATOR_REDUCAO_MINIMO * 100)}% ele passa da margem de "
                                f"{MARGEM_MINIMA_MM:g} mm da página."
                            )
                    tam *= fator
                    tc *= fator
                entrelinha = tam * float(campo.get("entrelinha") or 1.2)
                n = len(segs_linhas)
                base_y = alvo["origem"].y
                for i, segs in enumerate(segs_linhas):
                    if ancora == "base":
                        y = base_y - (n - 1 - i) * entrelinha
                    elif ancora == "centro":
                        y = base_y + (i - (n - 1) / 2.0) * entrelinha
                    else:
                        y = base_y + i * entrelinha
                    w = _largura_segmentos(segs, fonte, fonte_bold, tam, tc)
                    if alinhar == "direita":
                        x = bbox.x1 - w
                    elif alinhar == "centro":
                        x = (bbox.x0 + bbox.x1) / 2.0 - w / 2.0
                    else:
                        x = alvo["origem"].x
                    cursor = x
                    for trecho, negrito in segs:
                        if not trecho:
                            continue
                        if negrito and fonte_bold is not None:
                            f_use, rec_use = fonte_bold, bold_recurso
                        else:
                            f_use, rec_use = fonte, alvo["recurso"]
                        ops.append(
                            f"BT {alvo['cor']} /{rec_use} {tam:.4f} Tf {tc:.4f} Tc "
                            f"1 0 0 1 {cursor:.4f} {altura_pg - y:.4f} Tm "
                            f"<{f_use.codificar(trecho)}> Tj ET"
                        )
                        cursor += f_use.largura(trecho, tam, tc)
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


def previa_png(
    modelo_id: int,
    dados: dict[str, Any],
    dpi: int = 150,
    *,
    modelo: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Aplica os valores e devolve as páginas em PNG (data URL).

    Usada no admin (valores de teste) e na prévia ao vivo da página Papelaria
    (valores do formulário) — a mesma renderização da prova final.
    """
    import fitz

    pdf = caminho_pdf(modelo_id)
    if not pdf.is_file():
        raise ProvaPdfError("Envie primeiro o PDF do modelo.")
    campos = [c for c in carregar_config(modelo_id).get("campos") or [] if c.get("template")]
    if not campos:
        raise ProvaPdfError("Ligue ao menos um texto do PDF a um campo.")
    from services.papelaria_corel_dados_service import preparar_dados
    from services import papelaria_models_service as models_svc

    if modelo is None:
        modelo = models_svc.get_modelo_by_id(int(modelo_id)) or {}
    avisos: list[str] = []
    t0 = time.perf_counter()
    saida = renderizar(pdf, campos, preparar_dados(dados or {}, modelo), avisos=avisos)
    ms = int((time.perf_counter() - t0) * 1000)
    doc = fitz.open(stream=saida, filetype="pdf")
    try:
        paginas = [
            "data:image/png;base64," + base64.b64encode(p.get_pixmap(dpi=dpi).tobytes("png")).decode()
            for p in doc
        ]
    finally:
        doc.close()
    return {"paginas": paginas, "ms": ms, "avisos": avisos}


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

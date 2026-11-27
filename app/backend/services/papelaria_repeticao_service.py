"""
Repetição de SP: a base da nova prova sai do PDF da última prova da OS
repetida (o mesmo produto, os mesmos textos).

Da prova antiga só se aproveita o que está dentro das molduras do produto:
a BordaF (página 1, Frente) e a BordaV (página 2, Verso). O nome do objeto
não sobrevive no PDF exportado do Corel, então as molduras são achadas pela
geometria: retângulo sem preenchimento do tamanho do produto (provas antigas
em folha A4), a página inteira quando ela já está no formato do produto
(provas novas) ou o retângulo com a proporção do produto (prova reduzida
para caber no A4, com ou sem rotação).

O conteúdo de dentro da moldura não é reescrito: a página é copiada, o que
está fora é apagado e um único ``cm`` (deslocamento/escala/rotação) leva a
moldura para a página nova — fontes, cores (CMYK) e estrutura ficam
idênticas e os textos continuam no conteúdo da página (editáveis na prévia).

O PDF antigo é lido em memória; nada é gravado na pasta da OS nova. A base
fica em ``Modelos/papelaria/prova_pdf/repeticao/{ano}-{nro}/``.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

MM = 72.0 / 25.4
TOLERANCIA_MM = 2.0
TOLERANCIA_PROPORCAO = 0.02
LADO_MINIMO_MM = 20.0


class RepeticaoError(ValueError):
    """Erro de replicação com mensagem para o usuário."""


# ---------------------------------------------------------------------------
# Observação «Repetição da OS 1234/25»
# ---------------------------------------------------------------------------

_REPETICAO_RE = re.compile(r"repeticao[^0-9]{0,40}?(\d{1,5})\s*/\s*(\d{2,4})")


def _sem_acento(texto: str) -> str:
    return unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode().lower()


def detectar_repeticao(observ: Optional[str]) -> Optional[dict[str, Any]]:
    """
    ``{"origem_nro", "origem_ano", "rotulo"}`` quando a observação fala em
    repetição; números ausentes → ``origem_* = None`` (o usuário informa).
    """
    texto = _sem_acento(observ or "")
    if "repeticao" not in texto:
        return None
    m = _REPETICAO_RE.search(texto)
    if not m:
        return {"origem_nro": None, "origem_ano": None, "rotulo": None}
    nro = int(m.group(1))
    ano = int(m.group(2))
    if ano < 100:
        ano += 2000
    return {"origem_nro": nro, "origem_ano": ano, "rotulo": f"{nro:04d}/{ano % 100:02d}"}


# ---------------------------------------------------------------------------
# Onde está a prova antiga
# ---------------------------------------------------------------------------


def _pasta_sefoc_movida(dest_ano: int, dest_nro: int, origem_ano: int, origem_nro: int) -> Optional[str]:
    """Sefoc da OS antiga movido para a pasta da OS nova («26 05570 Sefoc»)."""
    from services.os_folder_path_service import resolve_os_folder_path

    pasta = resolve_os_folder_path(int(dest_ano), int(dest_nro))
    if not pasta or not os.path.isdir(pasta):
        return None
    nome = f"{origem_ano % 100:02d} {int(origem_nro):05d} Sefoc".lower()
    for item in os.listdir(pasta):
        if item.lower() == nome and os.path.isdir(os.path.join(pasta, item)):
            return os.path.join(pasta, item)
    return None


def _ultima_prova_na_pasta(pasta: str) -> Optional[str]:
    from services.proof_files_service import summarize_prova_files

    entradas = []
    for nome in os.listdir(pasta):
        caminho = os.path.join(pasta, nome)
        if nome.lower().endswith(".pdf") and os.path.isfile(caminho):
            entradas.append((nome, os.path.getmtime(caminho)))
    if not entradas:
        return None
    resumo = summarize_prova_files(entradas)
    escolhido = resumo.get("latest")
    return os.path.join(pasta, escolhido) if escolhido else None


def localizar_prova_origem(dest_ano: int, dest_nro: int, origem_ano: int, origem_nro: int) -> str:
    """
    Caminho do PDF da última prova da OS repetida: primeiro o Sefoc movido
    para a OS nova (Mover pastas), depois o Sefoc da própria OS antiga.
    """
    movida = _pasta_sefoc_movida(dest_ano, dest_nro, origem_ano, origem_nro)
    if movida:
        achado = _ultima_prova_na_pasta(movida)
        if achado:
            return achado
    try:
        from services.proof_files_service import list_proof_pdf_files, resolve_proof_pdf_path

        info = list_proof_pdf_files(int(origem_ano), int(origem_nro))
        if info.get("suggested"):
            return resolve_proof_pdf_path(int(origem_ano), int(origem_nro), info["suggested"])
    except Exception as exc:  # noqa: BLE001 — pasta da OS antiga inacessível
        logger.info("Repetição: pasta da OS %s/%s indisponível: %s", origem_nro, origem_ano, exc)
    raise RepeticaoError(
        f"Não encontrei a prova da OS {origem_nro}/{origem_ano % 100:02d} — nem na pasta dela "
        "nem na pasta Sefoc movida para esta OS."
    )


# ---------------------------------------------------------------------------
# Molduras
# ---------------------------------------------------------------------------


@dataclass
class Moldura:
    pagina: int  # índice 0-based na prova antiga
    rect: Any  # fitz.Rect (coordenadas da página, origem no topo)
    escala: float = 1.0
    rotacao: int = 0  # 0, 90 ou -90 (sentido do conteúdo na página nova)
    espessura: float = 0.0
    pagina_inteira: bool = False
    metodo: str = ""
    face: Optional[str] = None
    extras: dict[str, Any] = field(default_factory=dict)


def _segmentos_no_contorno(itens: list[Any], r: Any, tol: float) -> bool:
    """Traços retos sobre as bordas do retângulo (moldura feita de linhas)."""
    bordas = set()
    for it in itens:
        if it[0] != "l":
            return False
        p1, p2 = it[1], it[2]
        if abs(p1.y - p2.y) <= tol and (abs(p1.y - r.y0) <= tol or abs(p1.y - r.y1) <= tol):
            bordas.add("h0" if abs(p1.y - r.y0) <= tol else "h1")
        elif abs(p1.x - p2.x) <= tol and (abs(p1.x - r.x0) <= tol or abs(p1.x - r.x1) <= tol):
            bordas.add("v0" if abs(p1.x - r.x0) <= tol else "v1")
        else:
            return False
    return len(bordas) >= 2


def retangulos_sem_preenchimento(page: Any) -> list[dict[str, Any]]:
    """Retângulos só com contorno (``re``, quad ou linhas sobre as bordas)."""
    out: list[dict[str, Any]] = []
    for d in page.get_drawings():
        if d.get("type") == "f":
            continue
        r = d.get("rect")
        itens = d.get("items") or []
        if r is None or r.width < LADO_MINIMO_MM * MM or r.height < LADO_MINIMO_MM * MM:
            continue
        tipos = [it[0] for it in itens]
        if tipos == ["re"] or tipos == ["qu"]:
            ok = True
        else:
            ok = 2 <= len(itens) <= 4 and _segmentos_no_contorno(itens, r, 0.6)
        if not ok:
            continue
        rect = r
        if any(abs(rect.x0 - o["rect"].x0) < 0.5 and abs(rect.y0 - o["rect"].y0) < 0.5
               and abs(rect.x1 - o["rect"].x1) < 0.5 and abs(rect.y1 - o["rect"].y1) < 0.5 for o in out):
            continue
        out.append({"rect": rect, "espessura": float(d.get("width") or 0.0), "cor": d.get("color")})
    return out


def _casa(w: float, h: float, alvo_w: float, alvo_h: float) -> Optional[tuple[float, int, str]]:
    """(escala, rotação, método) quando o retângulo w×h (pt) serve para o produto."""
    tol = TOLERANCIA_MM * MM
    if abs(w - alvo_w) <= tol and abs(h - alvo_h) <= tol:
        return 1.0, 0, "tamanho do produto"
    if abs(w - alvo_h) <= tol and abs(h - alvo_w) <= tol and abs(alvo_w - alvo_h) > tol:
        return 1.0, 90, "tamanho do produto (girado)"
    if w < alvo_w and h < alvo_h and abs((w / h) / (alvo_w / alvo_h) - 1) <= TOLERANCIA_PROPORCAO:
        return alvo_w / w, 0, "prova reduzida"
    if w < alvo_h and h < alvo_w and abs((w / h) / (alvo_h / alvo_w) - 1) <= TOLERANCIA_PROPORCAO:
        return alvo_h / w, 90, "prova reduzida (girada)"
    return None


def _rotulo_face(page: Any, r: Any) -> Optional[str]:
    """«Frente»/«Verso» escrito logo acima (ou dentro, no topo) da moldura."""
    import fitz

    faixa = fitz.Rect(r.x0, r.y0 - 25 * MM, r.x1, r.y0 + 6 * MM)
    for b in page.get_text("dict", clip=faixa)["blocks"]:
        for linha in b.get("lines", []):
            t = _sem_acento(" ".join(s["text"] for s in linha["spans"]).strip())
            if t in ("frente", "verso"):
                return t
    return None


def _sentido_texto(page: Any, r: Any) -> int:
    """Rotação que deixa os textos de dentro na horizontal (90 ou -90)."""
    votos = 0
    for b in page.get_text("dict", clip=r)["blocks"]:
        for linha in b.get("lines", []):
            dx, dy = linha.get("dir", (1, 0))
            if abs(dy) > abs(dx):
                # Texto «subindo» (dy < 0) precisa girar no sentido horário.
                votos += -1 if dy < 0 else 1
    return -90 if votos < 0 else 90


def detectar_molduras(doc: Any, alvo_mm: tuple[float, float], faces: int) -> list[Moldura]:
    """
    Molduras das faces (Frente, depois Verso) na prova antiga.
    Preferência: página no formato do produto → moldura do tamanho do produto
    → moldura reduzida com a proporção do produto.
    """
    alvo_w, alvo_h = alvo_mm[0] * MM, alvo_mm[1] * MM
    tol = TOLERANCIA_MM * MM

    # Prova nova: cada página já é uma face.
    inteiras = [
        Moldura(pagina=i, rect=p.rect, pagina_inteira=True, metodo="página no formato do produto")
        for i, p in enumerate(doc)
        if abs(p.rect.width - alvo_w) <= tol and abs(p.rect.height - alvo_h) <= tol
    ]
    if len(inteiras) >= faces:
        escolhidas = inteiras[:faces]
        for m, nome in zip(escolhidas, ("frente", "verso")):
            m.face = nome
        return escolhidas

    candidatas: list[Moldura] = []
    for i, page in enumerate(doc):
        for ret in retangulos_sem_preenchimento(page):
            r = ret["rect"]
            casa = _casa(r.width, r.height, alvo_w, alvo_h)
            if not casa:
                continue
            escala, rotacao, metodo = casa
            if rotacao:
                rotacao = _sentido_texto(page, r)
            candidatas.append(
                Moldura(
                    pagina=i,
                    rect=r,
                    escala=escala,
                    rotacao=rotacao,
                    espessura=ret["espessura"],
                    metodo=metodo,
                    face=_rotulo_face(page, r),
                )
            )
    if not candidatas:
        for m, nome in zip(inteiras, ("frente", "verso")):
            m.face = nome
        return inteiras[:faces]
    # Tamanho real antes de reduzido; dentro de cada grupo, rótulos e ordem de leitura.
    melhor = min(abs(c.escala - 1) for c in candidatas)
    candidatas = [c for c in candidatas if abs(abs(c.escala - 1) - melhor) < 0.05]
    candidatas.sort(key=lambda c: (c.pagina, round(c.rect.y0 / (5 * MM)), c.rect.x0))
    out: list[Moldura] = []
    for nome in ("frente", "verso")[:faces]:
        rotulada = next((c for c in candidatas if c.face == nome and c not in out), None)
        if rotulada:
            out.append(rotulada)
    for c in candidatas:
        if len(out) >= faces:
            break
        if c not in out and c.face not in {m.face for m in out if m.face}:
            out.append(c)
    for m, nome in zip(out, ("frente", "verso")):
        m.face = m.face or nome
    out.sort(key=lambda m: 0 if m.face == "frente" else 1)
    return out


# ---------------------------------------------------------------------------
# Montagem da base
# ---------------------------------------------------------------------------

# Versão do processamento da base: bases e PDFs de imposição montados antes
# desta versão são limpos ao serem usados (v2: o contorno da moldura ia junto;
# v3: o carimbo de prova de dentro da moldura ia junto).
VERSAO_MONTAGEM = 3
PREFIXO_MARCA_MONTAGEM = "sagra-base-repeticao v"
MARCA_MONTAGEM = f"{PREFIXO_MARCA_MONTAGEM}{VERSAO_MONTAGEM}"

_SEPARADORES = " \t\r\n\f\x00()<>[]{}/%"
_RE_FIM_IMAGEM = re.compile(r"\sEI(?=\s|$)")
_PINTURAS = {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"}


def _tokens(texto: str):
    """
    Tokens de um content stream: ``(tipo, valor, inicio, fim)`` com tipo
    ``num``, ``op`` ou ``outro`` (strings, nomes, arrays, imagens inline).
    """
    i, n = 0, len(texto)
    while i < n:
        ch = texto[i]
        if ch in " \t\r\n\f\x00":
            i += 1
            continue
        if ch == "%":
            while i < n and texto[i] not in "\r\n":
                i += 1
            continue
        if ch == "(":
            j, prof = i + 1, 1
            while j < n and prof:
                c = texto[j]
                if c == "\\":
                    j += 2
                    continue
                if c == "(":
                    prof += 1
                elif c == ")":
                    prof -= 1
                j += 1
            yield "outro", None, i, j
            i = j
            continue
        if ch == "<":
            if texto.startswith("<<", i):
                yield "outro", "<<", i, i + 2
                i += 2
                continue
            j = texto.find(">", i)
            j = n if j < 0 else j + 1
            yield "outro", None, i, j
            i = j
            continue
        if ch in ">[]{})":
            j = i + (2 if texto.startswith(">>", i) else 1)
            yield "outro", ch, i, j
            i = j
            continue
        j = i + 1
        while j < n and texto[j] not in _SEPARADORES:
            j += 1
        palavra = texto[i:j]
        if ch == "/":
            yield "outro", None, i, j
        elif palavra == "ID":  # imagem inline: dados binários até «EI»
            m = _RE_FIM_IMAGEM.search(texto, j + 1)
            j = m.end() if m else n
            yield "outro", None, i, j
        else:
            try:
                yield "num", float(palavra), i, j
            except ValueError:
                yield "op", palavra, i, j
        i = j


def _no_contorno(p1: Any, p2: Any, alvo: tuple[float, float, float, float], tol: float) -> bool:
    """Segmento reto sobre uma das bordas do retângulo ``alvo`` (coordenadas PDF)."""
    x0, y0, x1, y1 = alvo
    if abs(p1.y - p2.y) <= tol and min(abs(p1.y - y0), abs(p1.y - y1)) <= tol:
        return min(p1.x, p2.x) >= x0 - tol and max(p1.x, p2.x) <= x1 + tol
    if abs(p1.x - p2.x) <= tol and min(abs(p1.x - x0), abs(p1.x - x1)) <= tol:
        return min(p1.y, p2.y) >= y0 - tol and max(p1.y, p2.y) <= y1 + tol
    return False


def _edicoes_do_contorno(
    textos: list[str], alvo: tuple[float, float, float, float], tol: float
) -> list[list[tuple[int, int, str]]]:
    """
    Acha nos content streams (em sequência, com a matriz de q/Q/cm) os traços
    só de contorno cujos segmentos estão todos sobre as bordas de ``alvo`` —
    em ``re``, em polilinha ou partida em vários caminhos — e devolve as
    edições por stream: a pintura vira ``n`` (ou o subcaminho sai, quando o
    mesmo traço desenha outras coisas). Nada mais é reescrito.
    """
    import fitz

    lado = min(alvo[2] - alvo[0], alvo[3] - alvo[1])
    ctm = fitz.Matrix(1, 0, 0, 1, 0, 0)
    pilha: list[Any] = []
    caminho: list[dict[str, Any]] = []
    sub: Optional[dict[str, Any]] = None
    ponto = None
    operandos: list[tuple[Optional[float], int]] = []
    edicoes: list[list[tuple[int, int, str]]] = [[] for _ in textos]

    def novo_sub(si: int, ini: int, p: Any) -> dict[str, Any]:
        d = {"stream": si, "ini": ini, "fim": ini, "segs": [], "inicio": p}
        caminho.append(d)
        return d

    def classe(d: dict[str, Any]) -> str:
        retos = [sg for sg in d["segs"] if sg == "curva" or abs(sg[0].x - sg[1].x) + abs(sg[0].y - sg[1].y) > 0.01]
        if not retos:
            return "vazio"
        if all(sg != "curva" and _no_contorno(sg[0], sg[1], alvo, tol) for sg in retos):
            return "moldura"
        return "outro"

    for si, texto in enumerate(textos):
        for tipo, valor, ini, fim in _tokens(texto):
            if tipo == "num":
                operandos.append((valor, ini))
                continue
            if tipo == "outro":
                operandos.append((None, ini))
                continue
            op = valor
            args = [v for v, _ in operandos]
            arg_ini = operandos[0][1] if operandos else ini
            operandos = []
            numeros = all(v is not None for v in args)
            if op == "q":
                pilha.append(ctm)
            elif op == "Q":
                ctm = pilha.pop() if pilha else ctm
            elif op == "cm" and len(args) == 6 and numeros:
                ctm = fitz.Matrix(*args) * ctm
            elif op == "m" and len(args) == 2 and numeros:
                ponto = fitz.Point(*args) * ctm
                sub = novo_sub(si, arg_ini, ponto)
                sub["fim"] = fim
            elif op == "re" and len(args) == 4 and numeros:
                x, y, w, h = args
                cantos = [fitz.Point(a, b) * ctm for a, b in ((x, y), (x + w, y), (x + w, y + h), (x, y + h))]
                sub = novo_sub(si, arg_ini, cantos[0])
                sub["segs"] = [(cantos[k], cantos[(k + 1) % 4]) for k in range(4)]
                sub["fim"] = fim
                ponto = cantos[0]
            elif op in ("l", "c", "v", "y", "h") and sub is not None and ponto is not None:
                if op == "l" and len(args) == 2 and numeros:
                    novo = fitz.Point(*args) * ctm
                    sub["segs"].append((ponto, novo))
                    ponto = novo
                elif op == "h":
                    sub["segs"].append((ponto, sub["inicio"]))
                    ponto = sub["inicio"]
                elif op in ("c", "v", "y") and len(args) >= 4 and numeros:
                    sub["segs"].append("curva")
                    ponto = fitz.Point(args[-2], args[-1]) * ctm
                if sub["stream"] == si:
                    sub["fim"] = fim
                else:
                    sub["stream"] = -1  # subcaminho atravessa streams: não remove em parte
            elif op in _PINTURAS:
                if op in ("S", "s") and caminho:
                    if op == "s" and sub is not None and ponto is not None:
                        sub["segs"].append((ponto, sub["inicio"]))
                    classes = [classe(d) for d in caminho]
                    maior = max(
                        (abs(sg[0].x - sg[1].x) + abs(sg[0].y - sg[1].y)
                         for d, c in zip(caminho, classes) if c == "moldura" for sg in d["segs"] if sg != "curva"),
                        default=0.0,
                    )
                    if "moldura" in classes and maior >= 0.2 * lado:
                        if all(c in ("moldura", "vazio") for c in classes):
                            edicoes[si].append((ini, fim, "n"))
                        elif all(d["stream"] >= 0 for d, c in zip(caminho, classes) if c == "moldura"):
                            for d, c in zip(caminho, classes):
                                if c == "moldura":
                                    edicoes[d["stream"]].append((d["ini"], d["fim"], " "))
                caminho, sub, ponto = [], None, None
    return edicoes


def _apagar_contorno(doc: Any, page: Any, r: Any, tol: float = 1.0) -> int:
    """
    Tira do conteúdo da página o contorno da moldura ``r`` (coordenadas da
    página, origem no topo). Devolve quantos traços saíram.
    """
    import fitz

    q = fitz.Rect(r) * ~page.transformation_matrix
    alvo = (min(q.x0, q.x1), min(q.y0, q.y1), max(q.x0, q.x1), max(q.y0, q.y1))
    xrefs = page.get_contents()
    textos = [(doc.xref_stream(x) or b"").decode("latin-1") for x in xrefs]
    total = 0
    for xref, texto, eds in zip(xrefs, textos, _edicoes_do_contorno(textos, alvo, tol)):
        if not eds:
            continue
        for ini, fim, novo in sorted(eds, reverse=True):
            texto = texto[:ini] + novo + texto[fim:]
        doc.update_stream(xref, texto.encode("latin-1"))
        total += len(eds)
    return total


# Carimbo de prova (caixa «Prova SEFOC», «Não vale como prova fiel de cor»,
# nome e medidas do produto). Nas provas antigas de produtos do tamanho da
# folha (Timbrado A4) ele ficava dentro da BordaF — não pode ir para a base.
_CARIMBO_ANCORAS = ("prova sefoc", "vale como prova fiel de cor")
_CARIMBO_DIMENSOES = re.compile(r"\d+\s*mm\s*\((larg|alt)\)\s*x\s*\d+\s*mm\s*\((larg|alt)\)")
_CARIMBO_LINHAS = (
    re.compile(r"^(sp|os|op|xx)\s*n[o.]?\s*:?$"),  # «SP nº» (º some sem acento)
    re.compile(r"^prova\s*n[o.]?\s*:?$"),
    re.compile(r"^data\s*:?$"),
    re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4}$"),  # data
    re.compile(r"^\d{1,5}\s*/\s*\d{2,4}$"),  # número da OS
    re.compile(r"^\d{1,2}$"),  # número da prova
)
CARIMBO_ZONA_MM = 15.0
CARIMBO_CAIXA_MAX_MM = (120.0, 45.0)


def _linhas_de_texto(page: Any, clip: Any) -> list[tuple[Any, str]]:
    import fitz

    out = []
    for b in page.get_text("dict", clip=clip)["blocks"]:
        for linha in b.get("lines", []):
            # \s pega também o espaço não separável (NBSP), que _sem_acento descartaria.
            bruto = re.sub(r"\s+", " ", " ".join(s["text"] for s in linha["spans"]))
            texto = " ".join(_sem_acento(bruto).split())
            if texto:
                out.append((fitz.Rect(linha["bbox"]), texto))
    return out


def areas_do_carimbo(page: Any, clip: Any = None) -> tuple[list[Any], list[Any]]:
    """
    ``(textos, caixas)``: retângulos (coordenadas da página) do carimbo de
    prova dentro de ``clip`` — as linhas de texto dele e as caixas que as
    contêm. Vazios quando não há «Prova SEFOC» nem «Não vale como prova fiel
    de cor».
    """
    import fitz

    clip = fitz.Rect(clip or page.rect)
    linhas = _linhas_de_texto(page, clip)
    ancoras = [r for r, t in linhas if any(a in t for a in _CARIMBO_ANCORAS)]
    if not ancoras:
        return [], []
    zona = fitz.Rect(ancoras[0])
    for r in ancoras[1:]:
        zona |= r
    for r, t in linhas:
        if _CARIMBO_DIMENSOES.search(t) and r.intersects(zona + (-60 * MM, -60 * MM, 60 * MM, 60 * MM)):
            zona |= r
    zona = (zona + (-CARIMBO_ZONA_MM * MM, -CARIMBO_ZONA_MM * MM, CARIMBO_ZONA_MM * MM, CARIMBO_ZONA_MM * MM)) & clip

    def e_do_carimbo(t: str) -> bool:
        return (
            any(a in t for a in _CARIMBO_ANCORAS)
            or bool(_CARIMBO_DIMENSOES.search(t))
            or any(p.match(t) for p in _CARIMBO_LINHAS)
        )

    textos = [r for r, t in linhas if r in zona and e_do_carimbo(t)]
    max_w, max_h = CARIMBO_CAIXA_MAX_MM[0] * MM, CARIMBO_CAIXA_MAX_MM[1] * MM
    candidatas = [
        fitz.Rect(d["rect"])
        for d in page.get_drawings()
        if d["rect"] in zona and d["rect"].width <= max_w and d["rect"].height <= max_h
        and d["rect"].width > 0.5 and d["rect"].height > 0.5
    ]
    # Caixas do carimbo: as que têm texto dele dentro; depois as de dentro delas.
    caixas = [c for c in candidatas if any((c & r).get_area() >= 0.5 * r.get_area() for r in textos)]
    caixas += [c for c in candidatas if c not in caixas and any(c in k for k in caixas)]
    # Texto qualquer dentro de uma caixa do carimbo (nome do produto).
    textos += [r for r, _t in linhas if r not in textos and any(r in k for k in caixas)]
    return textos, caixas


def _edicoes_dentro(
    textos: list[str], alvos: list[tuple[float, float, float, float]], tol: float
) -> list[list[tuple[int, int, str]]]:
    """
    Pinturas de caminho (contorno/preenchimento) cujos pontos estão todos
    dentro de um dos retângulos ``alvos`` (coordenadas PDF) viram ``n``.
    Acompanha q/Q/cm como ``_edicoes_do_contorno``; nada mais é reescrito.
    """
    import fitz

    ctm = fitz.Matrix(1, 0, 0, 1, 0, 0)
    pilha: list[Any] = []
    pontos: list[Any] = []
    operandos: list[Optional[float]] = []
    edicoes: list[list[tuple[int, int, str]]] = [[] for _ in textos]
    for si, texto in enumerate(textos):
        for tipo, valor, ini, fim in _tokens(texto):
            if tipo != "op":
                operandos.append(valor if tipo == "num" else None)
                continue
            op, args, operandos = valor, operandos, []
            numeros = all(v is not None for v in args)
            if op == "q":
                pilha.append(ctm)
            elif op == "Q":
                ctm = pilha.pop() if pilha else ctm
            elif op == "cm" and len(args) == 6 and numeros:
                ctm = fitz.Matrix(*args) * ctm
            elif op in ("m", "l", "c", "v", "y") and numeros and len(args) >= 2 and len(args) % 2 == 0:
                pontos += [fitz.Point(args[k], args[k + 1]) * ctm for k in range(0, len(args), 2)]
            elif op == "re" and len(args) == 4 and numeros:
                x, y, w, h = args
                pontos += [fitz.Point(a, b) * ctm for a, b in ((x, y), (x + w, y + h), (x + w, y), (x, y + h))]
            elif op in _PINTURAS:
                if op != "n" and pontos:
                    x0, y0 = min(p.x for p in pontos), min(p.y for p in pontos)
                    x1, y1 = max(p.x for p in pontos), max(p.y for p in pontos)
                    if any(
                        x0 >= a[0] - tol and y0 >= a[1] - tol and x1 <= a[2] + tol and y1 <= a[3] + tol
                        for a in alvos
                    ):
                        edicoes[si].append((ini, fim, "n"))
                pontos = []
    return edicoes


def _apagar_carimbo(page: Any, clip: Any = None) -> int:
    """Tira da página o carimbo de prova (textos e caixas). Devolve quantos itens saíram."""
    import fitz

    textos, caixas = areas_do_carimbo(page, clip)
    if not textos:
        return 0
    total = 0
    if caixas:
        # Caixas pelo conteúdo: a redação do MuPDF só tira o desenho coberto
        # com muita sobra (folga do traço/esquadria), o que não é confiável.
        doc = page.parent
        inv = ~page.transformation_matrix
        alvos = []
        for c in caixas:
            q = fitz.Rect(c) * inv
            alvos.append((min(q.x0, q.x1), min(q.y0, q.y1), max(q.x0, q.x1), max(q.y0, q.y1)))
        xrefs = page.get_contents()
        streams = [(doc.xref_stream(x) or b"").decode("latin-1") for x in xrefs]
        for xref, texto, eds in zip(xrefs, streams, _edicoes_dentro(streams, alvos, 1.0)):
            if not eds:
                continue
            for ini, fim, novo in sorted(eds, reverse=True):
                texto = texto[:ini] + novo + texto[fim:]
            doc.update_stream(xref, texto.encode("latin-1"))
            total += len(eds)
    for r in textos:
        page.add_redact_annot(r, fill=False)
    page.apply_redactions(
        images=fitz.PDF_REDACT_IMAGE_NONE,
        graphics=fitz.PDF_REDACT_LINE_ART_NONE,
        text=fitz.PDF_REDACT_TEXT_REMOVE,
    )
    return total + len(textos)


def _marcar_montagem(doc: Any) -> None:
    meta = dict(doc.metadata or {})
    meta["keywords"] = MARCA_MONTAGEM
    meta["creator"] = "SAGRA Papelaria"
    doc.set_metadata({k: v for k, v in meta.items() if k not in ("format", "encryption")})


def limpar_base_montada(pdf_bytes: bytes) -> tuple[bytes, int]:
    """
    Base já montada (páginas no formato do produto): tira o carimbo de prova
    e os traços de contorno sobre as bordas da página (o que ficou em
    montagens antigas) e marca a versão. Devolve ``(pdf, itens removidos)``.
    """
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        total = 0
        for page in doc:
            total += _apagar_carimbo(page)
            total += _apagar_contorno(doc, page, page.rect)
        _marcar_montagem(doc)
        return doc.tobytes(garbage=3, deflate=True), total
    finally:
        doc.close()


def montagem_atual(caminho: str) -> bool:
    """O PDF foi montado (ou limpo) por esta versão do processamento."""
    import fitz

    try:
        with fitz.open(caminho) as doc:
            return (doc.metadata or {}).get("keywords") == MARCA_MONTAGEM
    except Exception:  # noqa: BLE001
        return False


def _montado_por_versao_antiga(caminho: str) -> bool:
    """Base montada antes da versão atual (sem marca e sem produtor — não é do Corel/Distiller)."""
    import fitz

    try:
        with fitz.open(caminho) as doc:
            meta = doc.metadata or {}
    except Exception:  # noqa: BLE001
        return False
    marca = meta.get("keywords") or ""
    if marca == MARCA_MONTAGEM:
        return False
    if marca.startswith(PREFIXO_MARCA_MONTAGEM):
        return True
    return not (meta.get("producer") or "").strip() and not (meta.get("creator") or "").strip()


def _matriz(m: Moldura, x0: float, y0: float, x1: float, y1: float, s: float) -> tuple[float, ...]:
    """``cm`` que leva a moldura (coordenadas PDF) para a página nova a partir de (0, 0)."""
    if m.rotacao == 90:  # anti-horário
        return (0.0, s, -s, 0.0, s * y1, -s * x0)
    if m.rotacao == -90:  # horário
        return (0.0, -s, s, 0.0, -s * y0, s * x1)
    return (s, 0.0, 0.0, s, -s * x0, -s * y0)


def montar_face(src: Any, m: Moldura, alvo_mm: tuple[float, float]) -> bytes:
    """PDF de uma página no tamanho do produto com o conteúdo da moldura."""
    import fitz

    tmp = fitz.open()
    try:
        tmp.insert_pdf(src, from_page=m.pagina, to_page=m.pagina)
        page = tmp[0]
        if page.rotation:
            page.set_rotation(0)
        r = fitz.Rect(m.rect)
        # 0) Carimbo de prova dentro da moldura (Timbrado A4 e afins).
        _apagar_carimbo(page, r)
        if not m.pagina_inteira:
            # 1) Apaga o que está fora da moldura (rótulos, carimbo, a outra face…).
            pr = page.rect
            faixas = [
                fitz.Rect(pr.x0, pr.y0, pr.x1, r.y0),
                fitz.Rect(pr.x0, r.y1, pr.x1, pr.y1),
                fitz.Rect(pr.x0, r.y0, r.x0, r.y1),
                fitz.Rect(r.x1, r.y0, pr.x1, r.y1),
            ]
            for f in faixas:
                if f.width > 0.01 and f.height > 0.01:
                    page.add_redact_annot(f, fill=False)
            page.apply_redactions(
                images=fitz.PDF_REDACT_IMAGE_NONE,
                graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                text=fitz.PDF_REDACT_TEXT_REMOVE,
            )
            # 2) Tira o contorno da moldura do conteúdo; sem achar, recorta
            #    para dentro além da espessura do traço.
            if not _apagar_contorno(tmp, page, r):
                folga = max(m.espessura, 0.6)
                r = r + (folga, folga, -folga, -folga)
        inv = ~page.transformation_matrix
        p0 = fitz.Point(r.x0, r.y1) * inv
        p1 = fitz.Point(r.x1, r.y0) * inv
        x0, y0, x1, y1 = min(p0.x, p1.x), min(p0.y, p1.y), max(p0.x, p1.x), max(p0.y, p1.y)
        largura_alvo = alvo_mm[0] * MM
        altura_alvo = alvo_mm[1] * MM
        if m.rotacao:
            s = largura_alvo / (y1 - y0)
        else:
            s = largura_alvo / (x1 - x0)
        a, b, c, d, e, f_ = _matriz(m, x0, y0, x1, y1, s)
        # 3) Um único «cm» antes do conteúdo original: nada de dentro é reescrito.
        pre = tmp.get_new_xref()
        tmp.update_object(pre, "<<>>")
        tmp.update_stream(pre, f"q {a:.6f} {b:.6f} {c:.6f} {d:.6f} {e:.4f} {f_:.4f} cm\n".encode("latin-1"))
        pos = tmp.get_new_xref()
        tmp.update_object(pos, "<<>>")
        tmp.update_stream(pos, b"\nQ\n")
        conteudos = [pre, *page.get_contents(), pos]
        tmp.xref_set_key(page.xref, "Contents", "[" + " ".join(f"{x} 0 R" for x in conteudos) + "]")
        caixa = f"[0 0 {largura_alvo:.4f} {altura_alvo:.4f}]"
        for chave in ("MediaBox", "CropBox", "TrimBox", "BleedBox", "ArtBox"):
            tmp.xref_set_key(page.xref, chave, caixa if chave in ("MediaBox", "CropBox") else "null")
        return tmp.tobytes(garbage=3, deflate=True)
    finally:
        tmp.close()


def montar_base(pdf_bytes: bytes, alvo_mm: tuple[float, float], faces: int) -> tuple[bytes, list[Moldura]]:
    """PDF base (Frente e, se houver, Verso) a partir da prova antiga."""
    import fitz

    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        molduras = detectar_molduras(src, alvo_mm, faces)
        # OS antiga só frente: a base fica com a Frente e o verso sai de um modelo.
        if faces == 2 and len(molduras) == 1 and molduras[0].face == "frente":
            pass
        elif len(molduras) < faces:
            achadas = ", ".join(m.face or "?" for m in molduras) or "nenhuma"
            raise RepeticaoError(
                f"Não encontrei na prova antiga a moldura do produto ({alvo_mm[0]:g} × {alvo_mm[1]:g} mm) "
                f"para {'Frente e Verso' if faces == 2 else 'a Frente'} (achadas: {achadas})."
            )
        out = fitz.open()
        try:
            for m in molduras:
                parte = fitz.open(stream=montar_face(src, m, alvo_mm), filetype="pdf")
                try:
                    out.insert_pdf(parte)
                finally:
                    parte.close()
            _marcar_montagem(out)
            return out.tobytes(garbage=3, deflate=True), molduras
        finally:
            out.close()
    finally:
        src.close()


# ---------------------------------------------------------------------------
# Base guardada (fora da pasta da OS) + campos para editar na prévia
# ---------------------------------------------------------------------------


def _pasta_base(ano: int, nro: int) -> Path:
    from services.papelaria_prova_pdf_service import RAIZ_MODELOS_PDF

    return RAIZ_MODELOS_PDF / "repeticao" / f"{int(ano)}-{int(nro)}"


def caminho_base(ano: int, nro: int) -> Path:
    return _pasta_base(ano, nro) / "modelo.pdf"


def carregar_config_base(ano: int, nro: int) -> dict[str, Any]:
    caminho = _pasta_base(ano, nro) / "config.json"
    if not caminho.is_file():
        return {}
    try:
        cfg = json.loads(caminho.read_text(encoding="utf-8")) or {}
    except (OSError, ValueError):
        return {}
    if int(cfg.get("versao_montagem") or 1) < VERSAO_MONTAGEM:
        cfg = _atualizar_base_antiga(ano, nro, cfg)
    return cfg


def _atualizar_base_antiga(ano: int, nro: int, cfg: dict[str, Any]) -> dict[str, Any]:
    """Base montada por versão antiga: tira a moldura e o carimbo que tinham ficado no PDF."""
    pdf = caminho_base(ano, nro)
    try:
        cfg = {**cfg, "versao_montagem": VERSAO_MONTAGEM}
        if pdf.is_file():
            limpo, n = limpar_base_montada(pdf.read_bytes())
            pdf.write_bytes(limpo)
            if n:
                logger.info("Repetição %s/%s: %d item(ns) da moldura/carimbo removido(s) da base", nro, ano, n)
                # Os textos do carimbo não são mais campos editáveis.
                cfg["campos"], _avisos = campos_editaveis(limpo)
        (_pasta_base(ano, nro) / "config.json").write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as exc:  # noqa: BLE001 — sem conseguir limpar, segue com a base como está
        logger.warning("Repetição %s/%s: base antiga não atualizada: %s", nro, ano, exc)
    return cfg


def tem_base(ano: int, nro: int) -> bool:
    return caminho_base(ano, nro).is_file()


def resumo_base(ano: int, nro: int) -> Optional[dict[str, Any]]:
    if not tem_base(ano, nro):
        return None
    cfg = carregar_config_base(ano, nro)
    return {
        "origem": cfg.get("origem"),
        "propria": bool(cfg.get("propria")),
        "arquivo_origem": cfg.get("arquivo_origem"),
        "criado_em": cfg.get("criado_em"),
        "faces": cfg.get("faces"),
        "avisos": cfg.get("avisos") or [],
    }


def campos_editaveis(pdf_bytes: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    """Cada texto da base vira um campo editável na prévia (redesenhado só se editado)."""
    from services.papelaria_prova_pdf_service import analisar_pdf

    analise = analisar_pdf(pdf_bytes)
    campos = [
        {
            "marcador": t["marcador"],
            "pagina": t["pagina"],
            "template": t["marcador"],
            "alinhamento": "auto",
            "ancora": "auto",
            "entrelinha": 1.2,
            "reduzir_para_caber": True,
            "somente_se_editado": True,
        }
        for t in analise["textos"]
    ]
    avisos = []
    incompletas = [f["nome"] for f in analise.get("fontes") or [] if not (f.get("editavel") and f.get("completa"))]
    if incompletas:
        avisos.append(
            "Algumas fontes da prova antiga estão incorporadas só com os caracteres usados "
            f"({', '.join(sorted(set(incompletas))[:4])}): ao editar, letras que não existiam no "
            "texto original podem não estar disponíveis."
        )
    return campos, avisos


def ultima_prova_da_os(ano: int, nro: int) -> Optional[str]:
    """Caminho da última prova na pasta Sefoc da própria OS (ou None)."""
    try:
        from services.proof_files_service import list_proof_pdf_files, resolve_proof_pdf_path

        info = list_proof_pdf_files(int(ano), int(nro))
        if info.get("suggested"):
            return resolve_proof_pdf_path(int(ano), int(nro), info["suggested"])
    except Exception as exc:  # noqa: BLE001 — pasta inacessível
        logger.info("Prova da OS %s/%s indisponível: %s", nro, ano, exc)
    return None


_CACHE_FORMATO: dict[tuple[str, float], tuple[float, float]] = {}


def _tamanho_pagina_mm(caminho: str) -> Optional[tuple[float, float]]:
    """Tamanho da página 1 em mm (com cache pela data do arquivo)."""
    import fitz

    try:
        chave = (os.path.normcase(os.path.abspath(caminho)), os.path.getmtime(caminho))
    except OSError:
        return None
    if chave not in _CACHE_FORMATO:
        try:
            with fitz.open(caminho) as doc:
                r = doc[0].rect
            _CACHE_FORMATO[chave] = (r.width / MM, r.height / MM)
        except Exception:  # noqa: BLE001
            return None
    return _CACHE_FORMATO[chave]


def no_formato_do_produto(caminho: str, alvo_mm: tuple[float, float]) -> bool:
    tam = _tamanho_pagina_mm(caminho)
    return bool(
        tam
        and abs(tam[0] - alvo_mm[0]) <= TOLERANCIA_MM
        and abs(tam[1] - alvo_mm[1]) <= TOLERANCIA_MM
    )


def prova_antiga_da_os(ano: int, nro: int) -> Optional[dict[str, Any]]:
    """
    Última prova da OS no padrão antigo (folha A4 com as molduras, não no
    formato do produto): ``{"arquivo", "caminho"}``; senão None.
    """
    caminho = ultima_prova_da_os(ano, nro)
    if not caminho:
        return None
    try:
        alvo, _faces, _modelo = formato_do_produto(ano, nro)
    except RepeticaoError:
        return None
    if no_formato_do_produto(caminho, alvo):
        return None
    return {"arquivo": os.path.basename(caminho), "caminho": caminho}


def pdf_base_para_imposicao(ano: int, nro: int, existente: Optional[str]) -> Optional[str]:
    """
    PDF no formato do produto para a imposição. Usa o BaseSefoc se ele já
    está no formato; senão monta um a partir da última prova da OS (padrão
    antigo, folha A4 com molduras) — o mesmo processamento da repetição — e
    grava na pasta Sefoc sem sobrescrever o BaseSefoc existente.
    Devolve None quando não há como montar (mantém o comportamento antigo).
    """
    try:
        alvo, faces, _modelo = formato_do_produto(ano, nro)
    except RepeticaoError:
        return None
    if existente and no_formato_do_produto(existente, alvo):
        if _montado_por_versao_antiga(existente):
            # Montado por nós antes da correção: tira a moldura que tinha ficado.
            with open(existente, "rb") as fh:
                limpo, n = limpar_base_montada(fh.read())
            if n:
                with open(existente, "wb") as fh:
                    fh.write(limpo)
                logger.info("Imposição: moldura removida de %s", os.path.basename(existente))
        return existente
    prova = ultima_prova_da_os(ano, nro)
    if not prova:
        return None
    from services.papelaria_jobs_service import (
        build_base_sefoc_pdf_name,
        get_os_folder_basename,
        resolve_os_papelaria_dir,
    )

    sefoc = resolve_os_papelaria_dir(int(ano), int(nro), create=False)
    nome = (
        f"{get_os_folder_basename(int(ano), int(nro))}-BaseSefoc-Formato.pdf"
        if existente
        else build_base_sefoc_pdf_name(int(ano), int(nro))
    )
    destino = os.path.join(sefoc, nome)
    # Já montado a partir desta prova (ou de uma mais nova): reaproveita.
    if os.path.isfile(destino) and os.path.getmtime(destino) >= os.path.getmtime(prova):
        if no_formato_do_produto(destino, alvo) and montagem_atual(destino):
            return destino
    with open(prova, "rb") as fh:
        base, _molduras = montar_base(fh.read(), alvo, faces)
    with open(destino, "wb") as fh:
        fh.write(base)
    logger.info("Imposição: base no formato do produto montada de %s → %s", os.path.basename(prova), nome)
    return destino


def criar_base(
    *,
    ano: int,
    nro: int,
    origem_ano: int,
    origem_nro: int,
    alvo_mm: tuple[float, float],
    faces: int,
    propria: bool = False,
) -> dict[str, Any]:
    """
    Lê a prova antiga, monta a base e grava (substitui) a base desta SP.
    ``propria``: a prova é da própria OS (alteração de prova no padrão antigo).
    """
    if propria:
        caminho = ultima_prova_da_os(ano, nro)
        if not caminho:
            raise RepeticaoError("Esta OS não tem prova na pasta Sefoc.")
        origem_ano, origem_nro = int(ano), int(nro)
    elif (int(origem_ano), int(origem_nro)) == (int(ano), int(nro)):
        raise RepeticaoError("A OS repetida não pode ser a própria OS.")
    else:
        caminho = localizar_prova_origem(ano, nro, origem_ano, origem_nro)
    with open(caminho, "rb") as fh:
        conteudo = fh.read()  # só em memória: a prova antiga não é copiada para esta OS
    base, molduras = montar_base(conteudo, alvo_mm, faces)
    campos, avisos = campos_editaveis(base)
    if faces == 2 and len(molduras) == 1:
        avisos.insert(
            0,
            "A OS repetida era só frente: escolha o verso na lista de Versos (os campos dele aparecem no formulário).",
        )
    pasta = _pasta_base(ano, nro)
    pasta.mkdir(parents=True, exist_ok=True)
    caminho_base(ano, nro).write_bytes(base)
    config = {
        "origem": {"ano": int(origem_ano), "nro": int(origem_nro)},
        "propria": bool(propria),
        "arquivo_origem": os.path.basename(caminho),
        "criado_em": time.strftime("%Y-%m-%d %H:%M:%S"),
        "versao_montagem": VERSAO_MONTAGEM,
        "faces": [
            {"face": m.face, "metodo": m.metodo, "pagina_origem": m.pagina + 1, "escala": round(m.escala, 4), "rotacao": m.rotacao}
            for m in molduras
        ],
        "avisos": avisos,
        "campos": campos,
    }
    (pasta / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    return resumo_base(ano, nro) or {}


def remover_base(ano: int, nro: int) -> None:
    pasta = _pasta_base(ano, nro)
    for nome in ("modelo.pdf", "config.json"):
        try:
            (pasta / nome).unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Repetição: não foi possível remover %s: %s", pasta / nome, exc)


def formato_do_produto(ano: int, nro: int) -> tuple[tuple[float, float], int, Optional[int]]:
    """
    (tamanho da face em mm, nº de faces, modelo padrão) da SP: o tamanho vem
    do PDF do modelo padrão do produto (página 1); 2 faces quando a OS é
    frente e verso.
    """
    import fitz

    from database import db
    from services import papelaria_models_service as models_svc
    from services.papelaria_prova_pdf_service import caminho_pdf

    rows = db.execute_query(
        """
        SELECT d.TipoPublicacaoLink, d.Cores, d.CoresDescricao, d.FrenteVerso
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s
        """,
        {"nro": int(nro), "ano": int(ano)},
    ) or []
    if not rows:
        raise RepeticaoError("OS não encontrada.")
    row = rows[0]
    produto = str(row.get("TipoPublicacaoLink") or "").strip()
    cores = str(row.get("CoresDescricao") or row.get("Cores") or "").strip()
    frente_verso = str(row.get("FrenteVerso") or "").strip()
    modelos, _avisos, auto_id = models_svc.match_modelos_para_os(
        produto, cores, frente_verso, models_svc.list_modelos()
    )
    candidatos = [m["id"] for m in modelos]
    if auto_id in candidatos:
        candidatos.remove(auto_id)
        candidatos.insert(0, auto_id)
    for mid in candidatos:
        pdf = caminho_pdf(int(mid))
        if not pdf.is_file():
            continue
        with fitz.open(pdf) as doc:
            r = doc[0].rect
        # Mesma leitura do resto do sistema («1»/«0», «Frente e Verso»…).
        fv = models_svc._normalizar_frente_verso_os(frente_verso)
        faces = 2 if fv == "frente e verso" else 1
        return (round(r.width / MM, 2), round(r.height / MM, 2)), faces, int(auto_id or mid)
    raise RepeticaoError(
        f"O produto «{produto or '?'}» não tem modelo com PDF configurado — preciso do tamanho do produto."
    )


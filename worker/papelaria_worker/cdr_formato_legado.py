"""
Corel da pasta da OS fora do formato do produto (padrão antigo).

Arquivos antigos têm uma página grande (ex.: A4) com a arte do cartão dentro
de retângulos de referência — ``BordaF`` (frente) e ``BordaV`` (verso) ou,
sem nome, retângulos do tamanho do produto. Este módulo:

1. detecta as bordas (por nome ou pelo tamanho esperado + rótulos
   «Frente»/«Verso»);
2. cria um documento novo no tamanho correto (página Frente e, se houver
   verso, página Verso);
3. copia o conteúdo cujo centro está dentro de cada borda, nas mesmas
   camadas e na mesma posição relativa à borda — sem copiar as bordas nem
   os retângulos (fundo) da camada «Base»;
4. move o .cdr antigo para ``AdminDocs`` (mesma pasta do arquivo).

As regras geométricas são funções puras (testáveis sem CorelDRAW); só
``reconstruir_documento_no_formato`` e ``ler_tamanho_primeira_pagina`` usam COM.
"""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

Bounds = tuple[float, float, float, float]  # left, bottom, right, top (mm)

CDR_UNIT_MM = 3  # cdrMillimeter
CDR_RECTANGLE_SHAPE = 1  # cdrRectangleShape
CDR_TEXT_SHAPE = 6  # cdrTextShape

TOLERANCIA_FORMATO_MM = 1.0
TOLERANCIA_BORDA_MM = 1.5
PASTA_ADMIN_DOCS = "AdminDocs"
CAMADA_FUNDO = "base"
NOMES_BORDA = ("bordaf", "bordav")


class FormatoLegadoError(Exception):
    """Não foi possível reconstruir o Corel no formato do produto."""


# ---------------------------------------------------------------------------
# Geometria (sem COM)
# ---------------------------------------------------------------------------


def _norm(nome: str) -> str:
    return "".join((nome or "").split()).lower()


def largura_altura(b: Bounds) -> tuple[float, float]:
    return b[2] - b[0], b[3] - b[1]


def centro(b: Bounds) -> tuple[float, float]:
    return (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0


def tamanhos_iguais(
    a: tuple[float, float],
    b: tuple[float, float],
    tol: float = TOLERANCIA_FORMATO_MM,
) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def formato_difere(
    pagina_mm: tuple[float, float],
    esperado_mm: Optional[tuple[float, float]],
) -> bool:
    if not esperado_mm:
        return False
    return not tamanhos_iguais(pagina_mm, esperado_mm)


def centro_dentro(shape: Bounds, area: Bounds) -> bool:
    cx, cy = centro(shape)
    return area[0] <= cx <= area[2] and area[1] <= cy <= area[3]


def mesma_area(a: Bounds, b: Bounds, tol: float = 0.5) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def contem_area(externo: Bounds, interno: Bounds, tol: float = 0.5) -> bool:
    return (
        externo[0] <= interno[0] + tol
        and externo[1] <= interno[1] + tol
        and externo[2] >= interno[2] - tol
        and externo[3] >= interno[3] - tol
    )


@dataclass
class Borda:
    face: str  # "Frente" | "Verso"
    bounds: Bounds
    pagina: int = 1
    nome: str = ""


@dataclass
class ShapeInfo:
    """Resumo de um objeto para as regras (o objeto COM fica em ``ref``)."""

    nome: str
    tipo: int
    bounds: Optional[Bounds]
    camada: str
    texto: str = ""
    ref: Any = None
    filhos: list["ShapeInfo"] = field(default_factory=list)


def eh_nome_borda(nome: str) -> bool:
    return _norm(nome) in NOMES_BORDA


def detectar_bordas(
    shapes: Iterable[ShapeInfo],
    esperado_mm: Optional[tuple[float, float]],
    *,
    pagina: int = 1,
) -> list[Borda]:
    """
    BordaF/BordaV pelo nome; sem nome, retângulos do tamanho do produto.

    Sem nome, a frente é o retângulo mais próximo do rótulo «Frente» (texto),
    e o verso o mais próximo de «Verso»; sem rótulos, de cima para baixo e da
    esquerda para a direita.
    """
    todos = list(_achatar(shapes))
    nomeadas: dict[str, Borda] = {}
    for s in todos:
        if s.bounds and eh_nome_borda(s.nome):
            face = "Frente" if _norm(s.nome) == "bordaf" else "Verso"
            nomeadas.setdefault(face, Borda(face, s.bounds, pagina, s.nome))
    if "Frente" in nomeadas:
        return [nomeadas[f] for f in ("Frente", "Verso") if f in nomeadas]

    if not esperado_mm:
        return []
    candidatos: list[Bounds] = []
    for s in todos:
        if s.tipo != CDR_RECTANGLE_SHAPE or not s.bounds:
            continue
        if _norm(s.camada) == CAMADA_FUNDO:
            continue
        if not tamanhos_iguais(largura_altura(s.bounds), esperado_mm, TOLERANCIA_BORDA_MM):
            continue
        if any(mesma_area(s.bounds, c) for c in candidatos):
            continue
        candidatos.append(s.bounds)
    if not candidatos:
        return []

    rotulos = {
        face: s.bounds
        for s in todos
        for face in ("Frente", "Verso")
        if s.tipo == CDR_TEXT_SHAPE
        and s.bounds
        and _norm(s.texto) == face.lower()
    }
    restantes = list(candidatos)
    escolhidas: dict[str, Bounds] = {}
    for face in ("Frente", "Verso"):
        rot = rotulos.get(face)
        if rot is None or not restantes:
            continue
        rx, ry = centro(rot)
        melhor = min(
            restantes,
            key=lambda b: (centro(b)[0] - rx) ** 2 + (b[3] - ry) ** 2,
        )
        escolhidas[face] = melhor
        restantes.remove(melhor)
    restantes.sort(key=lambda b: (-b[3], b[0]))
    for face in ("Frente", "Verso"):
        if face not in escolhidas and restantes:
            escolhidas[face] = restantes.pop(0)
    return [
        Borda(face, escolhidas[face], pagina)
        for face in ("Frente", "Verso")
        if face in escolhidas
    ]


def _achatar(shapes: Iterable[ShapeInfo]) -> Iterable[ShapeInfo]:
    for s in shapes:
        yield s
        if s.filhos:
            yield from _achatar(s.filhos)


def _eh_referencia(s: ShapeInfo, bordas: list[Borda]) -> bool:
    if eh_nome_borda(s.nome):
        return True
    if not s.bounds:
        return False
    if s.tipo == CDR_RECTANGLE_SHAPE and _norm(s.camada) == CAMADA_FUNDO:
        return True  # retângulo de fundo (verde) da camada Base
    for b in bordas:
        if mesma_area(s.bounds, b.bounds):
            return True
        # Moldura (ex.: retângulo do tamanho da página) que envolve a borda.
        if s.tipo == CDR_RECTANGLE_SHAPE and contem_area(s.bounds, b.bounds):
            return True
    return False


def selecionar_conteudo(
    shapes: Iterable[ShapeInfo],
    borda: Borda,
    bordas: list[Borda],
) -> list[ShapeInfo]:
    """Objetos com centro dentro da borda, sem as referências (bordas/fundo)."""
    out: list[ShapeInfo] = []
    for s in shapes:
        if s.filhos and any(_eh_referencia(f, bordas) for f in _achatar(s.filhos)):
            # Grupo que contém uma borda: decide objeto a objeto.
            out.extend(selecionar_conteudo(s.filhos, borda, bordas))
            continue
        if _eh_referencia(s, bordas) or not s.bounds:
            continue
        if centro_dentro(s.bounds, borda.bounds):
            out.append(s)
    return out


def deslocamento(
    borda: Bounds,
    pagina_destino: Bounds,
) -> tuple[float, float]:
    """(dx, dy) que leva a borda para a página nova, centralizada se o tamanho diferir."""
    bw, bh = largura_altura(borda)
    pw, ph = largura_altura(pagina_destino)
    alvo_left = pagina_destino[0] + (pw - bw) / 2.0
    alvo_bottom = pagina_destino[1] + (ph - bh) / 2.0
    return alvo_left - borda[0], alvo_bottom - borda[1]


def destino_admin_docs(caminho: str, existe: Callable[[str], bool] = os.path.exists) -> str:
    """``<pasta>/AdminDocs/<nome>``, com sufixo « (2)», « (3)»… se já existir."""
    pasta = os.path.join(os.path.dirname(caminho), PASTA_ADMIN_DOCS)
    nome = os.path.basename(caminho)
    base, ext = os.path.splitext(nome)
    alvo = os.path.join(pasta, nome)
    n = 2
    while existe(alvo):
        alvo = os.path.join(pasta, f"{base} ({n}){ext}")
        n += 1
    return alvo


def mover_para_admin_docs(caminho: str) -> str:
    """Move o .cdr antigo para AdminDocs (mesma pasta). Retorna o novo caminho."""
    alvo = destino_admin_docs(caminho)
    os.makedirs(os.path.dirname(alvo), exist_ok=True)
    shutil.move(caminho, alvo)
    return alvo


# ---------------------------------------------------------------------------
# CorelDRAW (COM)
# ---------------------------------------------------------------------------


def _itens(colecao: Any) -> list[Any]:
    try:
        n = int(colecao.Count)
    except Exception:
        return []
    out = []
    for i in range(1, n + 1):
        try:
            out.append(colecao.Item(i))
        except Exception:
            continue
    return out


def _bounds_com(shape: Any) -> Optional[Bounds]:
    try:
        left = float(shape.LeftX)
        bottom = float(shape.BottomY)
        w = float(shape.SizeWidth)
        h = float(shape.SizeHeight)
    except Exception:
        return None
    if w <= 0 or h <= 0:
        return None
    return left, bottom, left + w, bottom + h


def _texto_com(shape: Any) -> str:
    try:
        if int(shape.Type) == CDR_TEXT_SHAPE:
            return str(shape.Text.Story.Text or "").strip()
    except Exception:
        pass
    return ""


def _info_com(shape: Any, camada: str, profundidade: int = 0) -> ShapeInfo:
    try:
        tipo = int(shape.Type)
    except Exception:
        tipo = -1
    filhos: list[ShapeInfo] = []
    if profundidade < 2:
        try:
            filhos = [
                _info_com(f, camada, profundidade + 1) for f in _itens(shape.Shapes)
            ]
        except Exception:
            filhos = []
    return ShapeInfo(
        nome=str(getattr(shape, "Name", "") or ""),
        tipo=tipo,
        bounds=_bounds_com(shape),
        camada=camada,
        texto=_texto_com(shape),
        ref=shape,
        filhos=filhos,
    )


def _camadas_da_pagina(page: Any) -> list[Any]:
    """Camadas da página (Item(1) = topo), sem as camadas mestras/especiais."""
    out = []
    for layer in _itens(page.Layers):
        try:
            if bool(getattr(layer, "IsSpecialLayer", False)):
                continue
            if bool(getattr(layer, "Master", False)):
                continue
        except Exception:
            pass
        out.append(layer)
    return out


def _shapes_da_pagina(page: Any) -> list[tuple[Any, list[ShapeInfo]]]:
    return [
        (layer, [_info_com(s, str(layer.Name)) for s in _itens(layer.Shapes)])
        for layer in _camadas_da_pagina(page)
    ]


def _definir_mm(doc: Any) -> None:
    try:
        doc.Unit = CDR_UNIT_MM
    except Exception as exc:
        raise FormatoLegadoError(f"Não foi possível usar milímetros no documento: {exc}") from exc


def _bounds_pagina(page: Any) -> Bounds:
    w, h = float(page.SizeWidth), float(page.SizeHeight)
    try:
        cx, cy = float(page.CenterX), float(page.CenterY)
        return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    except Exception:
        pass
    try:
        left, bottom = float(page.LeftX), float(page.BottomY)
        return left, bottom, left + w, bottom + h
    except Exception:
        return 0.0, 0.0, w, h


def salvar_documento_como(doc: Any, caminho: str, logs: list[str], corel: Any = None) -> None:
    """SaveAs robusto (StructSaveAsOptions + conferência em disco)."""
    from credenciais_depol_generator import _save_document_as

    _save_document_as(doc, caminho, logs, corel)


def ler_tamanho_primeira_pagina(corel: Any, caminho_cdr: str) -> tuple[float, float]:
    """Tamanho (mm) da página 1 de um .cdr (ex.: modelo do produto)."""
    doc = corel.OpenDocument(os.path.abspath(caminho_cdr))
    try:
        _definir_mm(doc)
        page = doc.Pages.Item(1)
        return round(float(page.SizeWidth), 3), round(float(page.SizeHeight), 3)
    finally:
        try:
            doc.Dirty = False
        except Exception:
            pass
        doc.Close()


def precisa_reconstruir(
    doc: Any,
    esperado_mm: Optional[tuple[float, float]],
) -> tuple[bool, tuple[float, float]]:
    """(precisa?, tamanho da página 1). Precisa se o formato difere ou há BordaF nomeada."""
    _definir_mm(doc)
    page = doc.Pages.Item(1)
    tamanho = (float(page.SizeWidth), float(page.SizeHeight))
    if formato_difere(tamanho, esperado_mm):
        return True, tamanho
    for _layer, infos in _shapes_da_pagina(page):
        if any(eh_nome_borda(s.nome) for s in _achatar(infos)):
            return True, tamanho
    return False, tamanho


def _copiar_para_camada(
    corel: Any,
    doc_origem: Any,
    shape: Any,
    doc_destino: Any,
    layer: Any,
    tentativas: int = 3,
) -> Any:
    """
    Copia o objeto para a camada de outro documento via área de transferência.

    ``CopyToLayer`` não atravessa documentos; Copy só é confiável com o
    documento de origem ativo e o objeto selecionado.
    """
    import time

    ultimo: Optional[BaseException] = None
    for tentativa in range(tentativas):
        try:
            doc_origem.Activate()
            try:
                doc_origem.ClearSelection()
            except Exception:
                pass
            try:
                shape.CreateSelection()
                corel.ActiveSelection.Copy()
            except Exception:
                shape.Copy()
            doc_destino.Activate()
            try:
                layer.Activate()
            except Exception:
                pass
            return layer.Paste()
        except Exception as exc:  # área de transferência ocupada etc.
            ultimo = exc
            time.sleep(0.3 * (tentativa + 1))
    raise FormatoLegadoError(f"Falha ao copiar objeto entre documentos: {ultimo}")


def _posicionar(copia: Any, alvo_left: float, alvo_bottom: float) -> None:
    """Move a cópia para (left, bottom) — o Paste mantém a posição relativa ao centro da página."""
    atual = _bounds_com(copia)
    if atual is None:
        raise FormatoLegadoError("Não foi possível ler a posição do objeto colado.")
    dx = alvo_left - atual[0]
    dy = alvo_bottom - atual[1]
    if abs(dx) > 1e-4 or abs(dy) > 1e-4:
        copia.Move(dx, dy)


def _preparar_camadas(page_nova: Any, camadas_origem: list[Any]) -> dict[str, Any]:
    """Recria as camadas da origem (mesma ordem/visibilidade) na página nova."""
    padrao = _itens(page_nova.Layers)
    criadas: dict[str, Any] = {}
    for layer in reversed(camadas_origem):  # de baixo para cima
        nome = str(layer.Name)
        nova = page_nova.CreateLayer(nome)
        for attr in ("Visible", "Printable", "Editable"):
            try:
                setattr(nova, attr, bool(getattr(layer, attr)))
            except Exception:
                pass
        criadas[nome] = nova
    # Camada padrão do documento novo («Camada 1») sai se ficar vazia.
    for layer in padrao:
        try:
            if bool(getattr(layer, "IsSpecialLayer", False)) or bool(getattr(layer, "Master", False)):
                continue
            if str(layer.Name) in criadas:
                continue
            if int(layer.Shapes.Count) == 0:
                layer.Delete()
        except Exception:
            continue
    return criadas


def _remover_camadas_vazias(
    page: Any, camadas: dict[str, Any], manter: str = "arte"
) -> None:
    """Remove camadas vazias da página (inclusive as herdadas por AddPages)."""
    manter_layer = next(
        (layer for nome, layer in camadas.items() if _norm(nome) == manter), None
    )
    for layer in _camadas_da_pagina(page):
        try:
            if int(layer.Shapes.Count) > 0:
                continue
            # Mantém só a «Arte» criada aqui (mesmo vazia); a herdada sai.
            if manter_layer is not None and _mesmo_com(layer, manter_layer):
                continue
            layer.Delete()
        except Exception:
            continue


def _mesmo_com(a: Any, b: Any) -> bool:
    try:
        return a._oleobj_ == b._oleobj_
    except Exception:
        return a is b


def reconstruir_documento_no_formato(
    corel: Any,
    doc: Any,
    esperado_mm: Optional[tuple[float, float]],
    logs: list[str],
) -> Any:
    """
    Cria documento novo no formato do produto com o conteúdo de BordaF/BordaV.

    Retorna o documento novo (aberto, ainda não salvo). ``doc`` não é alterado.
    """
    _definir_mm(doc)
    origem = doc.Pages.Item(1)
    camadas = _shapes_da_pagina(origem)
    todos = [info for _layer, infos in camadas for info in infos]
    bordas = detectar_bordas(todos, esperado_mm, pagina=1)
    if not bordas:
        raise FormatoLegadoError(
            "Corel da pasta fora do formato do produto e sem BordaF/BordaV "
            "nem retângulo do tamanho do produto para recortar."
        )
    tamanho = esperado_mm or largura_altura(bordas[0].bounds)
    logs.append(
        "Bordas encontradas: "
        + ", ".join(
            f"{b.face} {largura_altura(b.bounds)[0]:.1f}×{largura_altura(b.bounds)[1]:.1f} mm"
            + (f" ({b.nome})" if b.nome else "")
            for b in bordas
        )
        + f" — novo documento {tamanho[0]:.1f}×{tamanho[1]:.1f} mm."
    )

    novo = corel.CreateDocument()
    try:
        _definir_mm(novo)
        for idx, borda in enumerate(bordas, start=1):
            if idx > 1:
                novo.AddPages(1)
            page = novo.Pages.Item(idx)
            page.SetSize(float(tamanho[0]), float(tamanho[1]))
            try:
                page.Name = borda.face
            except Exception:
                pass
            destino = _preparar_camadas(page, [layer for layer, _ in camadas])
            dx, dy = deslocamento(borda.bounds, _bounds_pagina(page))
            copiados = 0
            for layer, infos in camadas:
                alvo = destino.get(str(layer.Name))
                if alvo is None:
                    continue
                # Item(1) é o topo: copia de baixo para cima para manter a ordem.
                for info in reversed(selecionar_conteudo(infos, borda, bordas)):
                    copia = _copiar_para_camada(corel, doc, info.ref, novo, alvo)
                    if copia is None or info.bounds is None:
                        raise FormatoLegadoError(
                            f"Falha ao copiar '{info.nome or info.tipo}' para a página {borda.face}."
                        )
                    _posicionar(copia, info.bounds[0] + dx, info.bounds[1] + dy)
                    copiados += 1
            _remover_camadas_vazias(page, destino)
            logs.append(f"{borda.face}: {copiados} objeto(s) copiado(s) na mesma posição relativa à borda.")
        try:
            novo.Pages.Item(1).Activate()
        except Exception:
            pass
        return novo
    except Exception:
        try:
            novo.Dirty = False
            novo.Close()
        except Exception:
            pass
        raise


# ---------------------------------------------------------------------------
# Ocorrências por face (campos do produto real)
# ---------------------------------------------------------------------------


def nome_face(pagina: int) -> str:
    return {1: "Frente", 2: "Verso"}.get(int(pagina), f"Página {int(pagina)}")


def parear_ocorrencias(
    ocorrencias: list[tuple[int, str, float, float]],
    entradas: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    """
    Associa cada ocorrência (idx, face, x, y) à entrada da mesma face mais
    próxima, um para um (o mais próximo primeiro).
    """
    pares: list[tuple[float, int, int]] = []
    for oi, (idx, face, x, y) in enumerate(ocorrencias):
        for ei, entrada in enumerate(entradas):
            if str(entrada.get("face") or "") != face:
                continue
            try:
                ex, ey = float(entrada.get("x")), float(entrada.get("y"))
            except (TypeError, ValueError):
                ex, ey = x, y
            pares.append(((x - ex) ** 2 + (y - ey) ** 2, oi, ei))
    pares.sort()
    usados_o: set[int] = set()
    usados_e: set[int] = set()
    out: dict[int, dict[str, Any]] = {}
    for _dist, oi, ei in pares:
        if oi in usados_o or ei in usados_e:
            continue
        usados_o.add(oi)
        usados_e.add(ei)
        out[ocorrencias[oi][0]] = entradas[ei]
    return out


class unidade_mm:
    """Context manager: documento em mm e unidade original restaurada na saída."""

    def __init__(self, doc: Any) -> None:
        self.doc = doc
        self.anterior: Optional[int] = None

    def __enter__(self) -> Any:
        try:
            self.anterior = int(self.doc.Unit)
        except Exception:
            self.anterior = None
        _definir_mm(self.doc)
        return self.doc

    def __exit__(self, *exc: Any) -> None:
        if self.anterior is not None:
            try:
                self.doc.Unit = self.anterior
            except Exception:
                pass


def localizador_faces(
    doc: Any,
    esperado_mm: Optional[tuple[float, float]],
) -> Callable[[Any, int], Optional[tuple[str, float, float]]]:
    """
    Função (shape, página) → (face, x, y): centro em mm relativo ao canto
    inferior esquerdo da página no arquivo final (já no formato do produto).

    No padrão antigo, a face vem da borda que contém o objeto (fora das bordas
    = None, pois não vai para o arquivo novo). Chamar com o documento em mm.
    """
    precisa, _tamanho = precisa_reconstruir(doc, esperado_mm)
    if precisa:
        infos = [i for _l, lista in _shapes_da_pagina(doc.Pages.Item(1)) for i in lista]
        bordas = detectar_bordas(infos, esperado_mm, pagina=1)
        if bordas:
            tamanho = esperado_mm or largura_altura(bordas[0].bounds)
            destino = (0.0, 0.0, float(tamanho[0]), float(tamanho[1]))
            desloc = [(b, deslocamento(b.bounds, destino)) for b in bordas]

            def _legado(shape: Any, pagina: int) -> Optional[tuple[str, float, float]]:
                if int(pagina) != 1:
                    return None
                b = _bounds_com(shape)
                if b is None:
                    return None
                for borda, (dx, dy) in desloc:
                    if centro_dentro(b, borda.bounds):
                        cx, cy = centro(b)
                        return borda.face, round(cx + dx, 2), round(cy + dy, 2)
                return None

            return _legado

    paginas: dict[int, Bounds] = {}

    def _normal(shape: Any, pagina: int) -> Optional[tuple[str, float, float]]:
        b = _bounds_com(shape)
        if b is None:
            return None
        if pagina not in paginas:
            paginas[pagina] = _bounds_pagina(doc.Pages.Item(int(pagina)))
        pb = paginas[pagina]
        cx, cy = centro(b)
        return nome_face(pagina), round(cx - pb[0], 2), round(cy - pb[1], 2)

    return _normal

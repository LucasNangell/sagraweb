"""
Campos de texto/redes extras na prévia PDF (só operador).

Gravados em ``dados.__campos_extras``: posicionados relativos a um campo
âncora (acima/abaixo/esquerda/direita), com offsets absolutos, alinhamento
de conteúdo, tamanho e negrito opcionais.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

CAMPOS_EXTRAS_DADOS_KEY = "__campos_extras"
DIRECOES = frozenset({"acima", "abaixo", "esquerda", "direita"})
TIPOS = frozenset({"texto", "rede"})
ALIGN_H = frozenset({"esquerda", "centro", "direita"})
ALIGN_V = frozenset({"topo", "meio", "base"})
EXTRAS_MAX = 40
TEXTO_MAX = 2000
GAP_PT = 5.0
TAMANHO_MIN = 4.0
TAMANHO_MAX = 72.0
ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
ANCORA_RE = re.compile(r"^(\d+):(\d+):(.+)$")


class CamposExtrasError(ValueError):
    """JSON / formato inválido de ``__campos_extras``."""


def _float_or_none(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _normalizar_negrito(raw: Any, texto_len: int) -> list[list[int]]:
    if not isinstance(raw, list):
        return []
    out: list[list[int]] = []
    for item in raw:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        try:
            a = max(0, min(texto_len, int(item[0])))
            b = max(0, min(texto_len, int(item[1])))
        except (TypeError, ValueError):
            continue
        if b > a:
            out.append([a, b])
    return out


def normalizar_campos_extras(raw: Any) -> list[dict[str, Any]]:
    """Valida e normaliza a lista de extras (ou [])."""
    if raw in (None, ""):
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise CamposExtrasError("Campos extras: JSON inválido.") from exc
    if not isinstance(raw, list):
        raise CamposExtrasError("Campos extras devem ser uma lista.")
    if len(raw) > EXTRAS_MAX:
        raise CamposExtrasError("Campos extras demais.")
    out: list[dict[str, Any]] = []
    ids: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise CamposExtrasError("Item de campo extra inválido.")
        eid = str(item.get("id") or "").strip()
        if not ID_RE.match(eid) or eid in ids:
            raise CamposExtrasError("Id de campo extra inválido ou duplicado.")
        ids.add(eid)
        tipo = str(item.get("tipo") or "").strip().lower()
        if tipo not in TIPOS:
            raise CamposExtrasError("Tipo de campo extra inválido.")
        direcao = str(item.get("direcao") or "").strip().lower()
        if direcao not in DIRECOES:
            raise CamposExtrasError("Direção de campo extra inválida.")
        ancora = str(item.get("ancora_chave") or "").strip()
        if not ANCORA_RE.match(ancora) and not ancora.startswith("extra:"):
            raise CamposExtrasError("Âncora de campo extra inválida.")
        align_h = str(item.get("align_h") or "esquerda").strip().lower()
        align_v = str(item.get("align_v") or "topo").strip().lower()
        if align_h not in ALIGN_H:
            raise CamposExtrasError("Alinhamento horizontal inválido.")
        if align_v not in ALIGN_V:
            raise CamposExtrasError("Alinhamento vertical inválido.")
        x_pt = _float_or_none(item.get("x_pt"))
        y_pt = _float_or_none(item.get("y_pt"))
        try:
            offset_x = float(item.get("offset_x_pt") or 0)
            offset_y = float(item.get("offset_y_pt") or 0)
        except (TypeError, ValueError) as exc:
            raise CamposExtrasError("Offset de campo extra inválido.") from exc
        tamanho = _float_or_none(item.get("tamanho_pt"))
        if tamanho is not None and not (TAMANHO_MIN <= tamanho <= TAMANHO_MAX):
            raise CamposExtrasError("Tamanho de fonte do campo extra inválido.")
        entry: dict[str, Any] = {
            "id": eid,
            "tipo": tipo,
            "ancora_chave": ancora,
            "direcao": direcao,
            "texto": "",
            "rede_chave": "",
            "rede_valor": "",
            "x_pt": x_pt,
            "y_pt": y_pt,
            "offset_x_pt": offset_x,
            "offset_y_pt": offset_y,
            "align_h": align_h,
            "align_v": align_v,
            "tamanho_pt": tamanho,
            "negrito": [],
        }
        if tipo == "texto":
            texto = str(item.get("texto") or "")
            if len(texto) > TEXTO_MAX:
                raise CamposExtrasError("Texto de campo extra longo demais.")
            entry["texto"] = texto
            entry["negrito"] = _normalizar_negrito(item.get("negrito"), len(texto))
        else:
            rede_chave = str(item.get("rede_chave") or "").strip()
            rede_valor = str(item.get("rede_valor") or "").strip()
            if not rede_chave or len(rede_chave) > 64:
                raise CamposExtrasError("Rede do campo extra inválida.")
            if len(rede_valor) > 200:
                raise CamposExtrasError("Handle da rede extra longo demais.")
            entry["rede_chave"] = rede_chave
            entry["rede_valor"] = rede_valor
        out.append(entry)
    return out


def campos_extras_dos_dados(dados: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        return normalizar_campos_extras((dados or {}).get(CAMPOS_EXTRAS_DADOS_KEY))
    except CamposExtrasError:
        return []


def _area_abs(regiao: dict[str, Any], page_rect: Any) -> Any:
    import fitz

    area = regiao.get("area") or [0, 0, 0, 0]
    if len(area) != 4:
        return fitz.Rect(0, 0, 0, 0)
    x0, y0, x1, y1 = (float(v) for v in area)
    return fitz.Rect(
        x0 * page_rect.width,
        y0 * page_rect.height,
        x1 * page_rect.width,
        y1 * page_rect.height,
    )


def _ponto_ancora(box: Any, align_h: str, align_v: str) -> tuple[float, float]:
    """Ponto fixo da caixa conforme o alinhamento 3×3 (canto/centro)."""
    if align_h == "direita":
        x = float(box.x1)
    elif align_h == "centro":
        x = (float(box.x0) + float(box.x1)) / 2.0
    else:
        x = float(box.x0)
    if align_v == "base":
        y = float(box.y1)
    elif align_v == "meio":
        y = (float(box.y0) + float(box.y1)) / 2.0
    else:
        y = float(box.y0)
    return x, y


def _box_from_ancora(
    ax: float,
    ay: float,
    w: float,
    h: float,
    align_h: str,
    align_v: str,
    largura: float,
    altura: float,
) -> Any:
    """Monta a caixa a partir do ponto âncora (cresce para o lado oposto ao align)."""
    import fitz

    w = max(2.0, float(w))
    h = max(2.0, float(h))
    if align_h == "direita":
        x0, x1 = ax - w, ax
    elif align_h == "centro":
        x0, x1 = ax - w / 2.0, ax + w / 2.0
    else:
        x0, x1 = ax, ax + w
    if align_v == "base":
        y0, y1 = ay - h, ay
    elif align_v == "meio":
        y0, y1 = ay - h / 2.0, ay + h / 2.0
    else:
        y0, y1 = ay, ay + h
    page = fitz.Rect(0, 0, largura, altura)
    box = fitz.Rect(x0, y0, x1, y1) & page
    if box.is_empty or box.width < 2 or box.height < 2:
        box = fitz.Rect(
            max(0.0, min(x0, largura - w)),
            max(0.0, min(y0, altura - h)),
            max(0.0, min(x0, largura - w)) + w,
            max(0.0, min(y0, altura - h)) + h,
        ) & page
    return box


def _bbox_relativo(
    ancora: Any,
    direcao: str,
    largura: float,
    altura: float,
    *,
    linha_h: float,
    largura_conteudo: float,
    align_h: str,
    align_v: str = "topo",
) -> Any:
    """
    Caixa do extra relativa à âncora.

    Calcula a caixa “natural” colada na direção pedida e depois a reconstrói
    a partir do ponto âncora do align 3×3 — assim, ao mudar o tamanho, o canto
    escolhido permanece fixo em relação à âncora.
    """
    gap = GAP_PT
    h = max(8.0, float(linha_h))
    w = max(8.0, float(largura_conteudo), float(ancora.width) * 0.35)

    # Caixa base (topo-esquerda), só para obter o ponto âncora desejado.
    if direcao == "acima":
        x0 = float(ancora.x0)
        if align_h == "direita":
            x0 = float(ancora.x1) - w
        elif align_h == "centro":
            x0 = (float(ancora.x0) + float(ancora.x1)) / 2.0 - w / 2.0
        y1 = float(ancora.y0) - gap
        y0 = y1 - h
    elif direcao == "abaixo":
        x0 = float(ancora.x0)
        if align_h == "direita":
            x0 = float(ancora.x1) - w
        elif align_h == "centro":
            x0 = (float(ancora.x0) + float(ancora.x1)) / 2.0 - w / 2.0
        y0 = float(ancora.y1) + gap
        y1 = y0 + h
    elif direcao == "esquerda":
        x1 = float(ancora.x0) - gap
        x0 = x1 - w
        y0 = float(ancora.y0)
        if align_v == "base":
            y0 = float(ancora.y1) - h
        elif align_v == "meio":
            y0 = (float(ancora.y0) + float(ancora.y1)) / 2.0 - h / 2.0
        y1 = y0 + h
    else:
        x0 = float(ancora.x1) + gap
        y0 = float(ancora.y0)
        if align_v == "base":
            y0 = float(ancora.y1) - h
        elif align_v == "meio":
            y0 = (float(ancora.y0) + float(ancora.y1)) / 2.0 - h / 2.0
        y1 = y0 + h

    import fitz

    base = fitz.Rect(x0, y0, x0 + w, y1)
    ax, ay = _ponto_ancora(base, align_h, align_v)
    return _box_from_ancora(ax, ay, w, h, align_h, align_v, largura, altura)


def _aplicar_offsets(
    box: Any,
    extra: dict[str, Any],
    largura: float,
    altura: float,
    *,
    align_h: str,
    align_v: str,
) -> Any:
    """
    ``x_pt``/``y_pt`` são o ponto âncora do align 3×3 (não o canto superior-esquerdo).
    Assim, ao mudar o tamanho, a caixa cresce para o lado oposto ao alinhamento.
    """
    import fitz

    if extra.get("x_pt") is not None and extra.get("y_pt") is not None:
        return _box_from_ancora(
            float(extra["x_pt"]),
            float(extra["y_pt"]),
            box.width,
            box.height,
            align_h,
            align_v,
            largura,
            altura,
        )
    dx = float(extra.get("offset_x_pt") or 0)
    dy = float(extra.get("offset_y_pt") or 0)
    if dx == 0 and dy == 0:
        return box
    moved = fitz.Rect(box.x0 + dx, box.y0 + dy, box.x1 + dx, box.y1 + dy)
    return moved & fitz.Rect(0, 0, largura, altura)


def _estilo_proximo(doc: Any, page: Any, area: Any) -> Optional[dict[str, Any]]:
    """Fonte/tamanho/cor de um span próximo à área âncora."""
    from services import papelaria_prova_pdf_service as pdf_svc

    import fitz

    fontes_pg = {
        pdf_svc._nome_sem_subconjunto(f[3]): (f[0], f[4]) for f in page.get_fonts(full=True)
    }
    originais = pdf_svc.cores_originais_por_texto(doc, page)
    cores = pdf_svc._cores_por_trecho(page)
    melhor = None
    melhor_dist = 1e18
    centro = fitz.Point((area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2)
    for b in page.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            for g in pdf_svc.agrupar_spans_da_linha(l["spans"]):
                texto = pdf_svc._texto_do_grupo(g)
                if not texto.strip():
                    continue
                base = pdf_svc._span_base(g)
                bb = fitz.Rect(base["bbox"])
                dist = abs(bb.x0 - centro.x) + abs(bb.y0 - centro.y)
                if dist >= melhor_dist:
                    continue
                achada = pdf_svc._fonte_do_span(fontes_pg, base["font"])
                if not achada:
                    continue
                fonte = pdf_svc.ler_fonte_embutida(doc, achada[0])
                if fonte is None:
                    continue
                melhor_dist = dist
                melhor = {
                    "fonte": fonte,
                    "xref": achada[0],
                    "recurso": achada[1],
                    "tamanho": float(base["size"]),
                    "cor": originais.get(texto.strip())
                    or originais.get(pdf_svc._texto_span(base).strip())
                    or pdf_svc._cor_do_span(cores, base["bbox"]),
                    "bbox": bb,
                    "fontes_pg": fontes_pg,
                }
    return melhor


def _append_ops(doc: Any, page: Any, ops: list[str]) -> None:
    page.wrap_contents()
    novo = doc.get_new_xref()
    doc.update_object(novo, "<<>>")
    doc.update_stream(novo, ("\n".join(ops) + "\n").encode("latin-1"))
    conteudos = page.get_contents() + [novo]
    doc.xref_set_key(
        page.xref, "Contents", "[" + " ".join(f"{c} 0 R" for c in conteudos) + "]"
    )


def _pos_conteudo(
    box: Any,
    tw: float,
    th: float,
    align_h: str,
    align_v: str,
) -> tuple[float, float]:
    """Canto superior-esquerdo do conteúdo dentro da caixa."""
    if align_h == "direita":
        x = box.x1 - tw
    elif align_h == "centro":
        x = (box.x0 + box.x1) / 2.0 - tw / 2.0
    else:
        x = box.x0
    if align_v == "base":
        y = box.y1 - th
    elif align_v == "meio":
        y = (box.y0 + box.y1) / 2.0 - th / 2.0
    else:
        y = box.y0
    return x, y


def aplicar_campos_extras(
    pdf_bytes: bytes,
    extras: list[dict[str, Any]],
    regioes: list[dict[str, Any]],
    *,
    modelo_id: int,
    estilo_redes: Optional[str] = None,
    avisos: Optional[list[str]] = None,
) -> bytes:
    """
    Desenha extras sobre o PDF já renderizado e acrescenta regiões clicáveis
    (``tipo`` = ``campo_extra`` | ``rede_extra``).
    """
    if not extras:
        return pdf_bytes

    import fitz

    from services import papelaria_prova_pdf_service as pdf_svc
    from services import papelaria_redes_service as redes_svc

    por_chave = {str(r.get("chave") or ""): r for r in regioes if r.get("chave")}
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for extra in extras:
            ancora = por_chave.get(extra["ancora_chave"])
            if not ancora:
                if avisos is not None:
                    avisos.append(
                        f"Campo extra «{extra['id']}»: âncora "
                        f"{extra['ancora_chave']} não encontrada — ignorado."
                    )
                continue
            pidx = int(ancora.get("pagina_saida", int(ancora.get("pagina", 1)) - 1))
            if not 0 <= pidx < doc.page_count:
                continue
            page = doc[pidx]
            page_rect = page.rect
            largura_pg, altura_pg = page_rect.width, page_rect.height
            ancora_box = _area_abs(ancora, page_rect)
            if ancora_box.is_empty:
                continue

            estilo = _estilo_proximo(doc, page, ancora_box)
            fonte = estilo["fonte"] if estilo else None
            recurso = estilo["recurso"] if estilo else None
            xref = estilo["xref"] if estilo else None
            tam_base = float(estilo["tamanho"]) if estilo else 11.0
            cor = estilo["cor"] if estilo else "0 0 0 rg"
            tam = float(extra["tamanho_pt"]) if extra.get("tamanho_pt") is not None else tam_base
            tam = max(TAMANHO_MIN, min(TAMANHO_MAX, tam))
            align_h = str(extra.get("align_h") or "esquerda")
            align_v = str(extra.get("align_v") or "topo")
            linha_h = tam * 1.2

            if fonte is not None and recurso is not None and xref is not None:
                pdf_svc.garantir_recurso_fonte(doc, page, recurso, xref)

            fonte_bold = None
            bold_recurso = None
            if estilo and fonte is not None:
                fontes_cache = {xref: fonte} if xref is not None else {}
                resolvida = pdf_svc._resolver_fonte_negrito(
                    doc, estilo["fontes_pg"], fonte, fontes_cache
                )
                if resolvida:
                    bold_xref, bold_recurso, fonte_bold = resolvida
                    pdf_svc.garantir_recurso_fonte(doc, page, bold_recurso, bold_xref)

            if extra["tipo"] == "texto":
                texto = str(extra.get("texto") or "")
                ranges = [
                    (int(a), int(b)) for a, b in (extra.get("negrito") or []) if b > a
                ]
                if texto and fonte is not None and fonte.faltando(texto):
                    if avisos is not None:
                        avisos.append(
                            f"Campo extra «{extra['id']}»: fonte sem "
                            f"{' '.join(fonte.faltando(texto))} — texto omitido."
                        )
                    texto = ""
                tw = 40.0
                if texto and fonte is not None:
                    segs = pdf_svc._segmentos_com_negrito(texto, ranges)
                    tw = pdf_svc._largura_segmentos(segs, fonte, fonte_bold, tam, 0.0)
                    tw = max(tw, 8.0)
                box = _bbox_relativo(
                    ancora_box,
                    extra["direcao"],
                    largura_pg,
                    altura_pg,
                    linha_h=linha_h,
                    largura_conteudo=tw,
                    align_h=align_h,
                    align_v=align_v,
                )
                box = _aplicar_offsets(
                    box, extra, largura_pg, altura_pg, align_h=align_h, align_v=align_v
                )
                th = tam * 1.05
                cx, cy = _pos_conteudo(box, tw if texto else box.width, th, align_h, align_v)
                if texto and fonte is not None and recurso is not None:
                    if ranges and fonte_bold is None and avisos is not None:
                        avisos.append(
                            f"Campo extra «{extra['id']}»: negrito indisponível "
                            "na tipografia da âncora — usado regular."
                        )
                    base_y = cy + tam * 0.85
                    cursor = cx
                    ops = ["q"]
                    for trecho, eh_n in pdf_svc._segmentos_com_negrito(texto, ranges):
                        if not trecho:
                            continue
                        if eh_n and fonte_bold is not None and bold_recurso:
                            f_use, rec_use = fonte_bold, bold_recurso
                        else:
                            f_use, rec_use = fonte, recurso
                        ops.append(
                            f"BT {cor} /{rec_use} {tam:.4f} Tf 0 Tc "
                            f"1 0 0 1 {cursor:.4f} {altura_pg - base_y:.4f} Tm "
                            f"<{f_use.codificar(trecho)}> Tj ET"
                        )
                        cursor += f_use.largura(trecho, tam, 0.0)
                    ops.append("Q")
                    _append_ops(doc, page, ops)
                    texto_box = fitz.Rect(cx, cy, cx + tw, cy + th)
                else:
                    texto_box = box if not box.is_empty else fitz.Rect(
                        ancora_box.x0,
                        ancora_box.y1 + GAP_PT,
                        ancora_box.x0 + 60,
                        ancora_box.y1 + GAP_PT + linha_h,
                    )
                reg = {
                    "pagina": pidx + 1,
                    "pagina_saida": pidx,
                    "modelo_id": int(modelo_id),
                    "marcador": f"__extra:{extra['id']}",
                    "chave": f"extra:{extra['id']}",
                    "texto": texto,
                    "negrito": [[a, b] for a, b in ranges],
                    "template": "",
                    "valores": {},
                    "editado": True,
                    "tipo": "campo_extra",
                    "extra_id": extra["id"],
                    "tamanho_pt": tam,
                    "fonte": getattr(fonte, "nome", None) if fonte is not None else None,
                    "align_h": align_h,
                    "align_v": align_v,
                    "page_w": largura_pg,
                    "page_h": altura_pg,
                    "area": pdf_svc._area_relativa(
                        texto_box & page_rect, largura_pg, altura_pg
                    ),
                    "bloquear_edicao": False,
                }
                regioes.append(reg)
                por_chave[reg["chave"]] = reg
                continue

            # Rede
            catalogo = redes_svc.por_chave()
            rede = catalogo.get(extra["rede_chave"])
            if not rede or not rede.get("ativo"):
                if avisos is not None:
                    avisos.append(
                        f"Campo extra «{extra['id']}»: rede "
                        f"«{extra['rede_chave']}» indisponível."
                    )
                # Ainda tenta desenhar placeholder se tipografia existir
                if not rede:
                    continue
            valor = str(extra.get("rede_valor") or "").strip()
            icone = tam * 1.15
            gap_i = max(2.0, tam * 0.25)
            tw_txt = (
                fonte.largura(valor, tam, 0.0)
                if valor and fonte is not None and not fonte.faltando(valor)
                else 0.0
            )
            tw = icone + (gap_i + tw_txt if tw_txt else 0.0)
            box = _bbox_relativo(
                ancora_box,
                extra["direcao"],
                largura_pg,
                altura_pg,
                linha_h=max(linha_h, icone),
                largura_conteudo=max(tw, 24.0),
                align_h=align_h,
                align_v=align_v,
            )
            box = _aplicar_offsets(
                box, extra, largura_pg, altura_pg, align_h=align_h, align_v=align_v
            )
            th = max(icone, tam * 1.05)
            cx, cy = _pos_conteudo(box, tw, th, align_h, align_v)
            centro = cy + th / 2
            caixa_logo = fitz.Rect(cx, centro - icone / 2, cx + icone, centro + icone / 2)
            estilo_logo = estilo_redes if estilo_redes in redes_svc.ESTILOS_IDS else None
            logo = redes_svc.caminho_logo(rede, estilo_logo, permitir_outro=True) if rede else None
            if logo is not None:
                try:
                    if logo.suffix.lower() == ".png":
                        page.insert_image(
                            caixa_logo, filename=str(logo), keep_proportion=True
                        )
                    else:
                        with fitz.open(str(logo)) as ld:
                            page.show_pdf_page(caixa_logo, ld, 0, keep_proportion=True)
                except Exception as exc:
                    logger.warning("Logo extra %s falhou: %s", rede.get("chave"), exc)
            elif avisos is not None and rede:
                avisos.append(f"Campo extra «{extra['id']}»: logo da rede indisponível.")
            if estilo is None and avisos is not None:
                avisos.append(
                    f"Campo extra «{extra['id']}»: tipografia da âncora "
                    "indisponível — só o logo foi aplicado."
                )
            tx = caixa_logo.x1 + gap_i
            base_y = centro + tam * 0.15
            if valor and fonte is not None and recurso is not None and not fonte.faltando(valor):
                _append_ops(
                    doc,
                    page,
                    [
                        "q",
                        (
                            f"BT {cor} /{recurso} {tam:.4f} Tf 0 Tc "
                            f"1 0 0 1 {tx:.4f} {altura_pg - base_y:.4f} Tm "
                            f"<{fonte.codificar(valor)}> Tj ET"
                        ),
                        "Q",
                    ],
                )
                texto_box = fitz.Rect(
                    caixa_logo.x0,
                    min(caixa_logo.y0, base_y - tam * 0.85),
                    tx + max(tw_txt, 1.0),
                    max(caixa_logo.y1, base_y + tam * 0.2),
                )
            else:
                texto_box = caixa_logo
            reg = {
                "pagina": pidx + 1,
                "pagina_saida": pidx,
                "modelo_id": int(modelo_id),
                "marcador": f"__extra_rede:{extra['id']}",
                "chave": f"extra:{extra['id']}",
                "texto": valor,
                "negrito": [],
                "template": "",
                "valores": {},
                "editado": True,
                "tipo": "rede_extra",
                "extra_id": extra["id"],
                "rede_chave": extra["rede_chave"],
                "tamanho_pt": tam,
                "fonte": getattr(fonte, "nome", None) if fonte is not None else None,
                "align_h": align_h,
                "align_v": align_v,
                "page_w": largura_pg,
                "page_h": altura_pg,
                "area": pdf_svc._area_relativa(
                    texto_box & page_rect, largura_pg, altura_pg
                ),
                "bloquear_edicao": False,
            }
            regioes.append(reg)
            por_chave[reg["chave"]] = reg
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()

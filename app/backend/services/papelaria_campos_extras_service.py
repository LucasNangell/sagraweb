"""
Campos de texto/redes extras na prévia PDF (só operador).

Gravados em ``dados.__campos_extras``: posicionados relativos a um campo
âncora (acima/abaixo/esquerda/direita), herdando a tipografia do âncora.
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
EXTRAS_MAX = 40
TEXTO_MAX = 2000
GAP_PT = 5.0
ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
ANCORA_RE = re.compile(r"^(\d+):(\d+):(.+)$")


class CamposExtrasError(ValueError):
    """JSON / formato inválido de ``__campos_extras``."""


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
        entry: dict[str, Any] = {
            "id": eid,
            "tipo": tipo,
            "ancora_chave": ancora,
            "direcao": direcao,
            "texto": "",
            "rede_chave": "",
            "rede_valor": "",
        }
        if tipo == "texto":
            texto = str(item.get("texto") or "")
            if len(texto) > TEXTO_MAX:
                raise CamposExtrasError("Texto de campo extra longo demais.")
            entry["texto"] = texto
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


def _bbox_relativo(ancora: Any, direcao: str, largura: float, altura: float) -> Any:
    import fitz

    gap = GAP_PT
    w = max(8.0, float(ancora.width))
    h = max(8.0, float(ancora.height))
    if direcao == "acima":
        y1 = ancora.y0 - gap
        y0 = y1 - h
        x0, x1 = ancora.x0, ancora.x0 + w
    elif direcao == "abaixo":
        y0 = ancora.y1 + gap
        y1 = y0 + h
        x0, x1 = ancora.x0, ancora.x0 + w
    elif direcao == "esquerda":
        x1 = ancora.x0 - gap
        x0 = x1 - w
        y0, y1 = ancora.y0, ancora.y0 + h
    else:
        x0 = ancora.x1 + gap
        x1 = x0 + w
        y0, y1 = ancora.y0, ancora.y0 + h
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
                }
    return melhor


def _append_ops(doc: Any, page: Any, ops: list[str]) -> None:
    """Anexa stream de operadores à página (mesmo padrão das redes)."""
    page.wrap_contents()
    novo = doc.get_new_xref()
    doc.update_object(novo, "<<>>")
    doc.update_stream(novo, ("\n".join(ops) + "\n").encode("latin-1"))
    conteudos = page.get_contents() + [novo]
    doc.xref_set_key(
        page.xref, "Contents", "[" + " ".join(f"{c} 0 R" for c in conteudos) + "]"
    )


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
            box = _bbox_relativo(ancora_box, extra["direcao"], largura_pg, altura_pg)
            estilo = _estilo_proximo(doc, page, ancora_box)
            if estilo is None:
                if avisos is not None:
                    avisos.append(
                        f"Campo extra «{extra['id']}»: tipografia da âncora "
                        "indisponível — ignorado."
                    )
                continue

            fonte = estilo["fonte"]
            recurso = estilo["recurso"]
            xref = estilo["xref"]
            tam = float(estilo["tamanho"])
            cor = estilo["cor"]
            pdf_svc.garantir_recurso_fonte(doc, page, recurso, xref)

            if extra["tipo"] == "texto":
                texto = str(extra.get("texto") or "")
                if texto and fonte.faltando(texto):
                    if avisos is not None:
                        avisos.append(
                            f"Campo extra «{extra['id']}»: fonte sem "
                            f"{' '.join(fonte.faltando(texto))} — texto omitido."
                        )
                    texto = ""
                if texto:
                    base_y = box.y0 + tam * 0.85
                    _append_ops(
                        doc,
                        page,
                        [
                            "q",
                            (
                                f"BT {cor} /{recurso} {tam:.4f} Tf 0 Tc "
                                f"1 0 0 1 {box.x0:.4f} {altura_pg - base_y:.4f} Tm "
                                f"<{fonte.codificar(texto)}> Tj ET"
                            ),
                            "Q",
                        ],
                    )
                    tw = fonte.largura(texto, tam, 0.0)
                    texto_box = fitz.Rect(
                        box.x0,
                        base_y - tam * 0.85,
                        box.x0 + max(tw, box.width * 0.5),
                        base_y + tam * 0.2,
                    )
                else:
                    texto_box = box
                reg = {
                    "pagina": pidx + 1,
                    "pagina_saida": pidx,
                    "modelo_id": int(modelo_id),
                    "marcador": f"__extra:{extra['id']}",
                    "chave": f"extra:{extra['id']}",
                    "texto": texto,
                    "negrito": [],
                    "template": "",
                    "valores": {},
                    "editado": True,
                    "tipo": "campo_extra",
                    "extra_id": extra["id"],
                    "area": pdf_svc._area_relativa(
                        texto_box & page_rect, largura_pg, altura_pg
                    ),
                    "bloquear_edicao": False,
                }
                regioes.append(reg)
                por_chave[reg["chave"]] = reg
                continue

            catalogo = redes_svc.por_chave()
            rede = catalogo.get(extra["rede_chave"])
            if not rede or not rede.get("ativo"):
                if avisos is not None:
                    avisos.append(
                        f"Campo extra «{extra['id']}»: rede "
                        f"«{extra['rede_chave']}» indisponível."
                    )
                continue
            valor = str(extra.get("rede_valor") or "").strip()
            icone = min(box.height, tam * 1.2)
            gap = max(2.0, tam * 0.25)
            centro = (box.y0 + box.y1) / 2
            caixa_logo = fitz.Rect(
                box.x0, centro - icone / 2, box.x0 + icone, centro + icone / 2
            )
            estilo_logo = estilo_redes if estilo_redes in redes_svc.ESTILOS_IDS else None
            logo = redes_svc.caminho_logo(rede, estilo_logo, permitir_outro=True)
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
            tx = caixa_logo.x1 + gap
            base_y = centro + tam * 0.15
            if valor and not fonte.faltando(valor):
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
                tw = fonte.largura(valor, tam, 0.0)
                texto_box = fitz.Rect(
                    caixa_logo.x0,
                    base_y - tam * 0.85,
                    tx + max(tw, 1.0),
                    base_y + tam * 0.2,
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

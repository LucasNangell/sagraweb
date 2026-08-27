"""
Motor de custeio Digital e Offset — puro, sem I/O.

Reproduz a metodologia das planilhas de estimativa (não os bugs de referência
deslocada). Valores monetários intermediários ficam em float; o total é
arredondado a 2 casas no consolidado.
"""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Any, Optional

_GRAMATURA_RE = re.compile(r"(\d+)\s*g(?:r|ra|ramas)?\b", re.IGNORECASE)
_WS_RE = re.compile(r"\s+")


def _money(value: float) -> float:
    return round(float(value) + 1e-12, 2)


def _f(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(str(value).strip().replace(",", "."))
    except (TypeError, ValueError):
        return default


def _b(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    text = str(value).strip().lower()
    return text in {"1", "true", "sim", "s", "x", "yes"}


def normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("ê", "e").replace("é", "e")
    return _WS_RE.sub(" ", text)


def suggest_formato(
    menor_mm: float,
    maior_mm: float,
    formatos: list[dict],
) -> Optional[dict]:
    """Menor formato cujo envelope comporta as dimensões (mesma lógica da planilha)."""
    if menor_mm <= 0 or maior_mm <= 0:
        return None
    if menor_mm > maior_mm:
        menor_mm, maior_mm = maior_mm, menor_mm
    ordered = sorted(
        [f for f in formatos if f.get("ativo", True)],
        key=lambda f: (_f(f.get("fator_a4"), 99), _f(f.get("ordem"))),
        reverse=True,
    )
    for fmt in ordered:
        if menor_mm <= _f(fmt.get("menor_mm")) and maior_mm <= _f(fmt.get("maior_mm")):
            return fmt
    return None


def match_papel(nome: Optional[str], insumos: list[dict]) -> Optional[dict]:
    """Casa PapelLink da OS com insumo de papel via código, aliases ou gramatura+tipo."""
    if not nome or not str(nome).strip():
        return None
    raw = str(nome).strip()
    norm = normalize_text(raw)
    papeis = [i for i in insumos if i.get("categoria") == "papel" and i.get("ativo", True)]

    for item in papeis:
        if normalize_text(item.get("codigo")) == norm:
            return item

    for item in papeis:
        aliases = item.get("aliases") or []
        if isinstance(aliases, str):
            aliases = [aliases]
        candidates = [item.get("especificacao") or "", *aliases]
        for cand in candidates:
            cand_n = normalize_text(cand)
            if cand_n and (cand_n in norm or norm in cand_n):
                return item

    gram_m = _GRAMATURA_RE.search(norm)
    gram = gram_m.group(1) if gram_m else None
    tipo_keys = []
    if "couche" in norm or "couch" in norm:
        tipo_keys.append("couche")
        if "fosco" in norm:
            tipo_keys.append("fosco")
        if "brilhan" in norm:
            tipo_keys.append("brilhan")
    elif "recicl" in norm:
        tipo_keys.append("recicl")
    elif "offset" in norm or "off-set" in norm or "off set" in norm:
        tipo_keys.append("off")
    elif "supremo" in norm:
        tipo_keys.append("supremo")

    if gram and tipo_keys:
        scored: list[tuple[int, dict]] = []
        for item in papeis:
            spec = normalize_text(item.get("especificacao"))
            if gram not in spec:
                continue
            hits = sum(1 for k in tipo_keys if k in spec)
            if hits:
                scored.append((hits, item))
        if scored:
            scored.sort(key=lambda t: (-t[0], t[1].get("codigo") or ""))
            return scored[0][1]
    return None


def insumo_by_codigo(insumos: list[dict], codigo: Optional[str]) -> Optional[dict]:
    if not codigo:
        return None
    wanted = normalize_text(codigo)
    for item in insumos:
        if normalize_text(item.get("codigo")) == wanted and item.get("ativo", True):
            return item
    return None


def faixa_pessoal(tiragem: int, faixas: list[dict]) -> float:
    ordered = sorted(faixas, key=lambda f: int(f.get("limite_inf") or 0))
    chosen = 0.0
    for faixa in ordered:
        if not faixa.get("ativo", True):
            continue
        inf = int(faixa.get("limite_inf") or 0)
        sup = faixa.get("limite_sup")
        if tiragem < inf:
            continue
        if sup is None or tiragem <= int(sup):
            chosen = _f(faixa.get("percentual"))
    return chosen


def _chapas_capa(cor: bool, frente_verso: bool, verso_cor: bool) -> int:
    if not cor:
        return 1
    if not frente_verso:
        return 4
    if verso_cor:
        return 8
    return 5


def _pages_per_form(fator_a4: float) -> float:
    if fator_a4 <= 0:
        return 4.0
    return 4.0 * fator_a4


def _chapas_miolo(paginas: int, cor: bool, fator_a4: float) -> int:
    denom = _pages_per_form(fator_a4)
    if denom <= 0:
        denom = 4.0
    forms = max(1, math.ceil(max(paginas, 1) / denom))
    return forms * (4 if cor else 1)


def _component_format(comp: dict, formatos: list[dict]) -> dict:
    menor = min(_f(comp.get("menor_mm")), _f(comp.get("maior_mm")))
    maior = max(_f(comp.get("menor_mm")), _f(comp.get("maior_mm")))
    suggested = suggest_formato(menor, maior, formatos) if menor > 0 else None
    codigo = comp.get("formato_codigo") or (suggested or {}).get("codigo")
    fator = _f((suggested or {}).get("fator_a4"), 1.0)
    if codigo:
        for fmt in formatos:
            if fmt.get("codigo") == codigo:
                fator = _f(fmt.get("fator_a4"), fator)
                suggested = fmt
                break
    return {
        "codigo": codigo or "A4",
        "fator_a4": fator if fator > 0 else 1.0,
        "menor_mm": menor,
        "maior_mm": maior,
        "sugerido": suggested,
    }


def _calc_componente(
    comp: dict,
    *,
    tiragem: int,
    tecnologia: str,
    catalog: dict,
) -> dict:
    params = catalog["parametros"]
    insumos = catalog["insumos"]
    formatos = catalog["formatos"]
    fmt = _component_format(comp, formatos)
    fator = fmt["fator_a4"]
    paginas = max(int(_f(comp.get("paginas"), 1)), 1)
    cor = _b(comp.get("cor"))
    fv = _b(comp.get("frente_verso"))
    verso_cor = _b(comp.get("verso_cor")) if fv else False
    papel = insumo_by_codigo(insumos, comp.get("papel_codigo"))
    rendimento = _f((papel or {}).get("rendimento_a4"), 8) or 8
    preco_folha = _f((papel or {}).get("preco_unitario"))

    total_paginas = tiragem * paginas
    if tecnologia == "digital":
        a4_eq = total_paginas / fator
        acerto = 0.0
    else:
        divisor_fv = 2.0 if fv else 1.0
        folhas_produto = total_paginas / divisor_fv
        a4_eq = folhas_produto / fator
        acerto = _f(params.get("acerto_offset_folhas"), 50)

    folhas_matriz = a4_eq / rendimento + acerto
    custo_papel = folhas_matriz * preco_folha

    clique_unit = _f(params.get("clique_digital_cor" if cor else "clique_digital_pb"))
    custo_clique = a4_eq * clique_unit if tecnologia == "digital" else 0.0

    tipo = str(comp.get("tipo") or "UNICO").upper()
    if tipo == "CAPA" or paginas <= 4:
        qtd_chapas = _chapas_capa(cor, fv, verso_cor)
    else:
        qtd_chapas = _chapas_miolo(paginas, cor, fator)
    if tecnologia != "offset":
        qtd_chapas_cobradas = 0
    else:
        qtd_chapas_cobradas = qtd_chapas
    chapa = insumo_by_codigo(insumos, params.get("chapa_codigo_padrao") or "c4")
    custo_chapa = qtd_chapas_cobradas * _f((chapa or {}).get("preco_unitario"))
    qtd_provas = int(_f(comp.get("qtd_provas")))
    qtd_fotolitos = int(_f(comp.get("qtd_fotolitos")))
    custo_prova = qtd_provas * _f(params.get("cotacao_prova"), 5)
    custo_fotolito = qtd_fotolitos * _f(params.get("cotacao_fotolito"), 16)
    custo_pre = custo_chapa + custo_prova + custo_fotolito

    tinta = insumo_by_codigo(
        insumos,
        params.get("tinta_cor_codigo" if cor else "tinta_pb_codigo"),
    )
    impressoes = 2.0 * folhas_matriz if tecnologia == "offset" else 0.0
    custo_tinta = impressoes * (_f((tinta or {}).get("preco_unitario")) / 10000.0)

    custo_laminacao = 0.0
    if _b(comp.get("laminacao")):
        bopp = insumo_by_codigo(insumos, params.get("bopp_codigo") or "b0")
        metros = _f(params.get("bopp_metros"), 1500) or 1500
        fator_fv = 2.0 if _b(comp.get("laminacao_fv")) else 1.0
        custo_laminacao = (folhas_matriz / metros) * _f((bopp or {}).get("preco_unitario")) * fator_fv

    custo_cola = 0.0
    if _b(comp.get("cola")) and paginas > _f(params.get("cola_min_paginas"), 70):
        cola = insumo_by_codigo(insumos, params.get("cola_codigo") or "c7")
        kg_ref = _f(params.get("cola_kg"), 25)
        ex_ref = _f(params.get("cola_exemplares"), 10000)
        pg_ref = _f(params.get("cola_paginas_ref"), 180)
        denom = ex_ref * pg_ref
        if denom > 0:
            custo_cola = (kg_ref * total_paginas / denom) * _f((cola or {}).get("preco_unitario"))

    custo_grampo = 0.0
    if _b(comp.get("grampo")) and paginas <= _f(params.get("grampo_max_paginas"), 80):
        grampo = insumo_by_codigo(insumos, params.get("grampo_codigo") or "g1")
        qtd = _f(params.get("grampos_por_exemplar"), 2) * tiragem
        custo_grampo = qtd * _f((grampo or {}).get("preco_unitario"))

    custo_espiral = 0.0
    if _b(comp.get("espiral")):
        espiral = insumo_by_codigo(insumos, comp.get("espiral_codigo") or params.get("espiral_codigo") or "e1")
        custo_espiral = tiragem * _f((espiral or {}).get("preco_unitario"))

    custo_pvc = 0.0
    if _b(comp.get("capa_pvc")):
        pvc = insumo_by_codigo(insumos, params.get("capa_pvc_codigo") or "c9")
        custo_pvc = tiragem * _f((pvc or {}).get("preco_unitario"))

    custo_extras = _f(comp.get("verniz")) + _f(comp.get("faca_cliche"))
    custo_acabamento = (
        custo_laminacao + custo_cola + custo_grampo + custo_espiral + custo_pvc + custo_extras
    )

    return {
        "nome": comp.get("nome") or tipo.title(),
        "tipo": tipo,
        "formato": fmt["codigo"],
        "fator_a4": fator,
        "paginas": paginas,
        "cor": cor,
        "frente_verso": fv,
        "papel_codigo": (papel or {}).get("codigo"),
        "papel_especificacao": (papel or {}).get("especificacao"),
        "a4_equivalentes": a4_eq,
        "folhas_matriz": folhas_matriz,
        "acerto": acerto,
        "custo_papel": custo_papel,
        "custo_clique": custo_clique,
        "qtd_chapas": qtd_chapas_cobradas,
        "custo_pre": custo_pre,
        "custo_tinta": custo_tinta,
        "custo_laminacao": custo_laminacao,
        "custo_cola": custo_cola,
        "custo_grampo": custo_grampo,
        "custo_espiral": custo_espiral,
        "custo_pvc": custo_pvc,
        "custo_extras": custo_extras,
        "custo_acabamento": custo_acabamento,
        "alertas": [] if papel else ["Papel não selecionado"],
    }


def _sum_key(rows: list[dict], key: str) -> float:
    return sum(_f(r.get(key)) for r in rows)


def _consolidar(tecnologia: str, rows: list[dict], catalog: dict, tiragem: int) -> dict:
    params = catalog["parametros"]
    papel = _sum_key(rows, "custo_papel")
    clique = _sum_key(rows, "custo_clique")
    pre = _sum_key(rows, "custo_pre")
    tinta = _sum_key(rows, "custo_tinta")
    acabamento = _sum_key(rows, "custo_acabamento")
    linhas_indiretos: list[dict] = []

    if tecnologia == "digital":
        base_ind = papel + acabamento
        aliq = _f(params.get("aliquota_indiretos_digital"), 0.87)
        indiretos = _money(base_ind * aliq)
        linhas_indiretos.append(
            {"nome": "Insumos indiretos (papel + acabamento)", "aliquota": aliq, "valor": indiretos}
        )
        direto = papel + clique + acabamento
        total = direto + indiretos
    else:
        direto = papel + pre + tinta + acabamento
        pessoal = faixa_pessoal(tiragem, catalog["faixas"])
        aliquotas = [
            ("Gastos com pessoal", pessoal),
            ("Energia elétrica", _f(params.get("aliquota_energia"), 0.07)),
            ("Depreciação", _f(params.get("aliquota_depreciacao"), 0.10)),
            ("Perdas na produção", _f(params.get("aliquota_perdas"), 0.03)),
            ("Manutenção", _f(params.get("aliquota_manutencao"), 0.05)),
        ]
        if _b(params.get("aplicar_diagramacao")):
            aliquotas.append(("Diagramação", _f(params.get("aliquota_diagramacao"), 0.20)))
        indiretos = 0.0
        for nome, aliq in aliquotas:
            valor = direto * aliq
            linhas_indiretos.append({"nome": nome, "aliquota": aliq, "valor": valor})
            indiretos += valor
        indiretos = _money(indiretos)
        total = direto + indiretos

    unitario = (total / tiragem) if tiragem else 0.0
    pags = sum(int(r.get("paginas") or 0) for r in rows) or 1
    por_cento_pag = unitario / (pags / 100.0) if pags else 0.0
    return {
        "tecnologia": tecnologia,
        "custo_papel": papel,
        "custo_clique": clique,
        "custo_pre": pre,
        "custo_tinta": tinta,
        "custo_acabamento": acabamento,
        "custo_direto": direto,
        "custo_indiretos": indiretos,
        "indiretos_detalhe": linhas_indiretos,
        "total": _money(total),
        "unitario": unitario,
        "por_cento_paginas": por_cento_pag,
        "componentes": rows,
    }


def calcular(payload: dict, catalog: dict) -> dict:
    """
    payload: titulo, tiragem, tecnologia (digital|offset|auto), componentes[].
    catalog: insumos, parametros, formatos, faixas.
    """
    tiragem = max(int(_f(payload.get("tiragem"), 1)), 1)
    componentes = payload.get("componentes") or []
    if not componentes:
        raise ValueError("Informe ao menos um componente.")

    digital_rows = [
        _calc_componente(c, tiragem=tiragem, tecnologia="digital", catalog=catalog)
        for c in componentes
    ]
    offset_rows = [
        _calc_componente(c, tiragem=tiragem, tecnologia="offset", catalog=catalog)
        for c in componentes
    ]
    digital = _consolidar("digital", digital_rows, catalog, tiragem)
    offset = _consolidar("offset", offset_rows, catalog, tiragem)

    requested = str(payload.get("tecnologia") or "auto").strip().lower()
    if requested not in {"digital", "offset", "auto"}:
        requested = "auto"
    if requested == "auto":
        escolhida = "digital" if digital["total"] <= offset["total"] else "offset"
    else:
        escolhida = requested

    escolhido = digital if escolhida == "digital" else offset
    alertas: list[str] = []
    for row in escolhido["componentes"]:
        alertas.extend(row.get("alertas") or [])
    if any(_f(c.get("menor_mm")) <= 0 for c in componentes):
        alertas.append("Dimensões do formato não informadas.")

    return {
        "tiragem": tiragem,
        "tecnologia_solicitada": requested,
        "tecnologia_escolhida": escolhida,
        "mais_economica": "digital" if digital["total"] <= offset["total"] else "offset",
        "digital": digital,
        "offset": offset,
        "escolhido": escolhido,
        "total": escolhido["total"],
        "unitario": escolhido["unitario"],
        "alertas": alertas,
    }

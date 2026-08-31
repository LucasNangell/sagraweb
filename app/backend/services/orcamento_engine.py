"""
Motor de custeio Digital e Offset — puro, sem I/O.

Digital segue a planilha OS 1365 (clique + 87% sobre papel+acabamento).
Offset segue a planilha 2 componentes (faixa de pessoal + 7/10/3/5%).
Preços de papel são distintos por tecnologia. Valores intermediários ficam
em float; o total é arredondado a 2 casas no consolidado.
"""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Any, Optional

from services.orcamento_pessoal import custear_passos

_GRAMATURA_RE = re.compile(r"(\d+)\s*g(?:r|ra|ramas)?\b", re.IGNORECASE)
_CORES_XY_RE = re.compile(r"(\d)\s*[xX×/]\s*(\d)")
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


def _preco_insumo(item: Optional[dict], tecnologia: str) -> float:
    """Digital usa preco_unitario_digital quando > 0; Offset (e fallback) usa preco_unitario."""
    if not item:
        return 0.0
    if tecnologia == "digital":
        dig = _f(item.get("preco_unitario_digital"))
        if dig > 0:
            return dig
    return _f(item.get("preco_unitario"))


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


def parse_cores_impressao(cores: Optional[str]) -> Optional[dict]:
    """Lê 4x0 / 4x1 / 4x4: verso 0 = sem impressão no verso (2 páginas da capa não entram em chapas)."""
    if not cores or not str(cores).strip():
        return None
    match = _CORES_XY_RE.search(str(cores).replace(" ", ""))
    if not match:
        return None
    frente, verso = int(match.group(1)), int(match.group(2))
    return {
        "cor": frente >= 4,
        "frente_verso": verso > 0,
        "verso_cor": verso >= 4,
        "frente": frente,
        "verso": verso,
    }


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
    parsed_imp = parse_cores_impressao(comp.get("impressao"))
    if parsed_imp is not None:
        cor = bool(parsed_imp["cor"])
        fv = bool(parsed_imp["frente_verso"])
        verso_cor = bool(parsed_imp["verso_cor"])
    else:
        cor = _b(comp.get("cor"))
        fv = _b(comp.get("frente_verso"))
        verso_cor = _b(comp.get("verso_cor")) if fv else False
    papel = insumo_by_codigo(insumos, comp.get("papel_codigo"))
    preco_folha = _preco_insumo(papel, tecnologia)

    total_paginas = tiragem * paginas
    if tecnologia == "digital":
        a4_eq = total_paginas / fator
        acerto = 0.0
        rendimento = _f(params.get("rendimento_digital_a4"), 8) or 8
    else:
        # Planilha Offset 2 componentes: G13/G14 fixos em 2 (F/V no papel).
        divisor_fv = 2.0
        folhas_produto = total_paginas / divisor_fv
        a4_eq = folhas_produto / fator
        acerto = _f(params.get("acerto_offset_folhas"), 50)
        rendimento = _f(params.get("rendimento_offset_a4"), 8) or 8

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
    custo_chapa = qtd_chapas_cobradas * _preco_insumo(chapa, tecnologia)
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
    custo_tinta = impressoes * (_preco_insumo(tinta, tecnologia) / 10000.0)

    custo_laminacao = 0.0
    if _b(comp.get("laminacao")):
        bopp = insumo_by_codigo(insumos, params.get("bopp_codigo") or "b0")
        metros = _f(params.get("bopp_metros"), 1500) or 1500
        fator_fv = 2.0 if _b(comp.get("laminacao_fv")) else 1.0
        # Planilha Acabamento!G = A4_eq / rendimento (sem acerto).
        folhas_bopp = a4_eq / rendimento
        custo_laminacao = (folhas_bopp / metros) * _preco_insumo(bopp, tecnologia) * fator_fv

    custo_cola = 0.0
    if _b(comp.get("cola")) and paginas > _f(params.get("cola_min_paginas"), 70):
        cola = insumo_by_codigo(insumos, params.get("cola_codigo") or "c7")
        kg_ref = _f(params.get("cola_kg"), 25)
        ex_ref = _f(params.get("cola_exemplares"), 10000)
        pg_ref = _f(params.get("cola_paginas_ref"), 180)
        denom = ex_ref * pg_ref
        if denom > 0:
            custo_cola = (kg_ref * total_paginas / denom) * _preco_insumo(cola, tecnologia)

    custo_grampo = 0.0
    if _b(comp.get("grampo")) and paginas <= _f(params.get("grampo_max_paginas"), 80):
        grampo = insumo_by_codigo(insumos, params.get("grampo_codigo") or "g1")
        qtd = _f(params.get("grampos_por_exemplar"), 2) * tiragem
        custo_grampo = qtd * _preco_insumo(grampo, tecnologia)

    custo_espiral = 0.0
    if _b(comp.get("espiral")):
        espiral = insumo_by_codigo(insumos, comp.get("espiral_codigo") or params.get("espiral_codigo") or "e1")
        custo_espiral = tiragem * _preco_insumo(espiral, tecnologia)

    custo_pvc = 0.0
    if _b(comp.get("capa_pvc")):
        pvc = insumo_by_codigo(insumos, params.get("capa_pvc_codigo") or "c9")
        custo_pvc = tiragem * _preco_insumo(pvc, tecnologia)

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


def _filter_passos(passos: list[dict], produto: str) -> list[dict]:
    wanted = normalize_text(produto)
    if not wanted:
        return []
    return [p for p in passos if normalize_text(p.get("produto_rotulo")) == wanted]


def _facility_aliquotas(params: dict) -> list[tuple[str, float]]:
    linhas = [
        ("Energia elétrica", _f(params.get("aliquota_energia"), 0.07)),
        ("Depreciação", _f(params.get("aliquota_depreciacao"), 0.10)),
        ("Perdas na produção", _f(params.get("aliquota_perdas"), 0.03)),
        ("Manutenção", _f(params.get("aliquota_manutencao"), 0.05)),
    ]
    if _b(params.get("aplicar_diagramacao")):
        linhas.append(("Diagramação", _f(params.get("aliquota_diagramacao"), 0.20)))
    return linhas


def _consolidar(tecnologia: str, rows: list[dict], catalog: dict, tiragem: int) -> dict:
    params = catalog["parametros"]
    papel = _sum_key(rows, "custo_papel")
    clique = _sum_key(rows, "custo_clique")
    pre = _sum_key(rows, "custo_pre")
    tinta = _sum_key(rows, "custo_tinta")
    acabamento = _sum_key(rows, "custo_acabamento")
    linhas_indiretos: list[dict] = []
    pags = sum(int(r.get("paginas") or 0) for r in rows) or 1
    folhas = _sum_key(rows, "folhas_matriz")
    pessoal_info = custear_passos(
        catalog.get("passos") or [],
        tecnologia=tecnologia,
        tiragem=tiragem,
        paginas=pags,
        folhas=folhas,
        funcoes=catalog.get("funcoes") or [],
        learned=catalog.get("learned") or [],
        k=_f(params.get("blend_k"), 8),
        utilizacao=_f(params.get("overhead_utilizacao"), 0.6),
        horas_mes=176.0,
    )
    usa_hora = _b(params.get("pessoal_por_hora")) and bool(pessoal_info.get("tem_passos"))

    if tecnologia == "digital":
        if usa_hora:
            material = papel + clique + acabamento
            direto = material
            indiretos = 0.0
            for nome, aliq in _facility_aliquotas(params):
                valor = material * aliq
                linhas_indiretos.append({"nome": nome, "aliquota": aliq, "valor": valor})
                indiretos += valor
            for linha in pessoal_info.get("detalhe") or []:
                if linha.get("cobra_pessoal"):
                    linhas_indiretos.append(
                        {
                            "nome": f"Pessoal: {linha.get('nome')}",
                            "aliquota": 0,
                            "valor": linha.get("valor") or 0,
                        }
                    )
            if pessoal_info.get("overhead_estrutura"):
                linhas_indiretos.append(
                    {
                        "nome": "Estrutura (gerente/mecânico)",
                        "aliquota": 0,
                        "valor": pessoal_info["overhead_estrutura"],
                    }
                )
            indiretos = _money(indiretos + (pessoal_info.get("custo_pessoal") or 0))
            total = direto + indiretos
        else:
            base_ind = papel + acabamento
            aliq = _f(params.get("aliquota_indiretos_digital"), 0.87)
            indiretos = _money(base_ind * aliq)
            linhas_indiretos.append(
                {"nome": "Insumos indiretos (papel + acabamento)", "aliquota": aliq, "valor": indiretos}
            )
            direto = papel + clique + acabamento
            total = direto + indiretos
            pessoal_info = {**pessoal_info, "custo_pessoal": 0.0, "detalhe": []}
    else:
        material = papel + pre + tinta + acabamento
        direto = material
        indiretos = 0.0
        if usa_hora:
            aliquotas = _facility_aliquotas(params)
        else:
            pessoal = faixa_pessoal(tiragem, catalog.get("faixas") or [])
            aliquotas = [("Gastos com pessoal", pessoal), *_facility_aliquotas(params)]
        for nome, aliq in aliquotas:
            valor = direto * aliq
            linhas_indiretos.append({"nome": nome, "aliquota": aliq, "valor": valor})
            indiretos += valor
        if usa_hora:
            for linha in pessoal_info.get("detalhe") or []:
                if linha.get("cobra_pessoal"):
                    linhas_indiretos.append(
                        {
                            "nome": f"Pessoal: {linha.get('nome')}",
                            "aliquota": 0,
                            "valor": linha.get("valor") or 0,
                        }
                    )
            if pessoal_info.get("overhead_estrutura"):
                linhas_indiretos.append(
                    {
                        "nome": "Estrutura (gerente/mecânico)",
                        "aliquota": 0,
                        "valor": pessoal_info["overhead_estrutura"],
                    }
                )
            indiretos += pessoal_info.get("custo_pessoal") or 0
        else:
            pessoal_info = {**pessoal_info, "custo_pessoal": 0.0, "detalhe": []}
        indiretos = _money(indiretos)
        total = direto + indiretos

    unitario = (total / tiragem) if tiragem else 0.0
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
        "custo_pessoal": pessoal_info.get("custo_pessoal") or 0.0,
        "pessoal_detalhe": pessoal_info.get("detalhe") or [],
        "indiretos_detalhe": linhas_indiretos,
        "total": _money(total),
        "unitario": unitario,
        "por_cento_paginas": por_cento_pag,
        "componentes": rows,
        "usa_pessoal_hora": usa_hora,
    }


def calcular(payload: dict, catalog: dict) -> dict:
    """
    payload: titulo, tiragem, tecnologia (digital|offset|auto), componentes[].
    catalog: insumos, parametros, formatos, faixas.
    """
    catalog = catalog or {}
    produto = str((payload.get("os") or {}).get("produto") or "")
    catalog_local = dict(catalog)
    catalog_local["passos"] = _filter_passos(catalog.get("passos") or [], produto)

    tiragem = max(int(_f(payload.get("tiragem"), 1)), 1)
    componentes = payload.get("componentes") or []
    if not componentes:
        raise ValueError("Informe ao menos um componente.")

    digital_rows = [
        _calc_componente(c, tiragem=tiragem, tecnologia="digital", catalog=catalog_local)
        for c in componentes
    ]
    offset_rows = [
        _calc_componente(c, tiragem=tiragem, tecnologia="offset", catalog=catalog_local)
        for c in componentes
    ]
    digital = _consolidar("digital", digital_rows, catalog_local, tiragem)
    offset = _consolidar("offset", offset_rows, catalog_local, tiragem)

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

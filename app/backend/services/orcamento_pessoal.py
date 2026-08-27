"""
Custeio de pessoal por etapa: prior, blend com aprendizado e overhead de estrutura.
Puro, sem I/O.
"""
from __future__ import annotations

from typing import Any, Optional


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
    return str(value).strip().lower() in {"1", "true", "sim", "s", "x", "yes"}


def _money(value: float) -> float:
    return round(float(value) + 1e-12, 2)


def prior_horas(
    passo: dict,
    *,
    tiragem: int,
    paginas: int,
    folhas: float,
) -> float:
    """Tempo-padrão em horas: setup + tiragem×un + páginas×pag + folhas×folha (minutos)."""
    setup = _f(passo.get("setup_min"))
    por_un = _f(passo.get("min_por_un"))
    por_pag = _f(passo.get("min_por_pag"))
    por_folha = _f(passo.get("min_por_folha"))
    minutos = setup + tiragem * por_un + paginas * por_pag + folhas * por_folha
    return max(minutos, 0.0) / 60.0


def blend_horas(
    prior: float,
    *,
    n: int = 0,
    mediana: float = 0.0,
    k: float = 8.0,
) -> float:
    """Empirical Bayes: n=0 → prior; n grande → mediana aprendida."""
    k = max(_f(k, 8.0), 0.0)
    samples = max(int(n or 0), 0)
    if samples <= 0 or k <= 0:
        return max(prior, 0.0)
    w = samples / (samples + k)
    return max(w * _f(mediana) + (1.0 - w) * prior, 0.0)


def cap_stint(observed: float, prior: float, teto_fator: float = 3.0) -> float:
    teto = max(_f(teto_fator, 3.0), 1.0)
    ceiling = prior * teto if prior > 0 else observed
    return max(min(_f(observed), ceiling), 0.0)


def passo_cobra_pessoal(passo: dict) -> bool:
    tipo = str(passo.get("tipo") or "produtiva").strip().lower()
    if tipo in {"espera_cliente", "fim"}:
        return False
    if "cobra_pessoal" in passo:
        return _b(passo.get("cobra_pessoal"))
    return tipo == "produtiva"


def passo_compativel_tecnologia(passo: dict, tecnologia: str) -> bool:
    raw = str(passo.get("tecnologia") or "qualquer").strip().lower()
    if raw in {"", "qualquer", "any", "*"}:
        return True
    return raw == str(tecnologia or "").strip().lower()


def overhead_hora(
    funcoes: list[dict],
    *,
    horas_mes: float = 176.0,
    utilizacao: float = 0.6,
) -> float:
    """
    Taxa de estrutura (R$/hora produtiva do job).
    pool mensal (overhead) / (176 × FTE etapa × utilização).
    """
    pool = 0.0
    fte_prod = 0.0
    for fn in funcoes:
        if not fn.get("ativo", True):
            continue
        qtd = max(_f(fn.get("quantidade"), 1.0), 0.0)
        mensal = _f(fn.get("custo_mensal"))
        aloc = str(fn.get("alocacao") or "etapa").strip().lower()
        if aloc == "overhead":
            pool += mensal * (qtd or 1.0)
        else:
            fte_prod += qtd or 1.0
    horas = max(_f(horas_mes, 176.0), 1.0)
    util = min(max(_f(utilizacao, 0.6), 0.05), 1.0)
    denom = horas * fte_prod * util
    if denom <= 0 or pool <= 0:
        return 0.0
    return pool / denom


def _funcao_by_id(funcoes: list[dict], funcao_id: Any) -> Optional[dict]:
    try:
        wanted = int(funcao_id)
    except (TypeError, ValueError):
        return None
    for fn in funcoes:
        try:
            if int(fn.get("id")) == wanted and fn.get("ativo", True):
                return fn
        except (TypeError, ValueError):
            continue
    return None


def custo_crew(passo: dict, funcoes: list[dict], horas: float) -> tuple[float, list[dict]]:
    linhas: list[dict] = []
    total = 0.0
    for crew in passo.get("funcoes") or []:
        fn = _funcao_by_id(funcoes, crew.get("funcao_id") or crew.get("id"))
        if not fn:
            continue
        qtd = max(_f(crew.get("quantidade"), 1.0), 0.0)
        hora = _f(fn.get("custo_hora"))
        valor = qtd * horas * hora
        total += valor
        linhas.append(
            {
                "funcao_id": int(fn["id"]),
                "nome": fn.get("nome") or fn.get("codigo"),
                "quantidade": qtd,
                "custo_hora": hora,
                "horas": horas,
                "valor": _money(valor),
            }
        )
    return _money(total), linhas


def learned_for_passo(passo: dict, learned: list[dict]) -> dict:
    pid = passo.get("id")
    for row in learned or []:
        if pid is not None and str(row.get("passo_id")) == str(pid):
            return row
    setor = str(passo.get("setor_link") or "").strip().casefold()
    for row in learned or []:
        if str(row.get("setor_link") or "").strip().casefold() == setor:
            return row
    return {}


def custear_passos(
    passos: list[dict],
    *,
    tecnologia: str,
    tiragem: int,
    paginas: int,
    folhas: float,
    funcoes: list[dict],
    learned: list[dict] | None = None,
    k: float = 8.0,
    utilizacao: float = 0.6,
    horas_mes: float = 176.0,
) -> dict:
    """
    Retorna custo de pessoal das etapas + overhead de estrutura.
    Passos de espera/fim não entram.
    """
    detalhe: list[dict] = []
    horas_prod = 0.0
    custo_etapas = 0.0
    tem_passo_produtivo = False
    learned = learned or []

    for passo in passos:
        if not passo_compativel_tecnologia(passo, tecnologia):
            continue
        if not passo_cobra_pessoal(passo):
            detalhe.append(
                {
                    "passo_id": passo.get("id"),
                    "nome": passo.get("nome") or passo.get("setor_link"),
                    "setor_link": passo.get("setor_link"),
                    "tipo": passo.get("tipo"),
                    "cobra_pessoal": False,
                    "horas_prior": 0.0,
                    "horas": 0.0,
                    "n_amostras": 0,
                    "fonte": "isento",
                    "valor": 0.0,
                    "crew": [],
                }
            )
            continue
        tem_passo_produtivo = True
        prior = prior_horas(passo, tiragem=tiragem, paginas=paginas, folhas=folhas)
        rec = learned_for_passo(passo, learned)
        n = int(_f(rec.get("n")))
        mediana = _f(rec.get("mediana_horas"))
        horas = blend_horas(prior, n=n, mediana=mediana, k=k)
        valor, crew = custo_crew(passo, funcoes, horas)
        horas_prod += horas
        custo_etapas += valor
        detalhe.append(
            {
                "passo_id": passo.get("id"),
                "nome": passo.get("nome") or passo.get("setor_link"),
                "setor_link": passo.get("setor_link"),
                "tipo": passo.get("tipo") or "produtiva",
                "cobra_pessoal": True,
                "horas_prior": prior,
                "horas": horas,
                "n_amostras": n,
                "fonte": "blend" if n > 0 else "prior",
                "valor": valor,
                "crew": crew,
            }
        )

    taxa_oh = overhead_hora(funcoes, horas_mes=horas_mes, utilizacao=utilizacao)
    overhead = _money(horas_prod * taxa_oh)
    matching = [p for p in passos if passo_compativel_tecnologia(p, tecnologia)]
    return {
        "tem_passos": len(matching) > 0,
        "tem_pessoal_hora": tem_passo_produtivo,
        "horas_produtivas": horas_prod,
        "custo_etapas": _money(custo_etapas),
        "overhead_estrutura": overhead,
        "overhead_hora": taxa_oh,
        "custo_pessoal": _money(custo_etapas + overhead),
        "detalhe": detalhe,
    }


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(_f(v) for v in values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * min(max(p, 0.0), 1.0)
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (rank - lo)


def median(values: list[float]) -> float:
    return percentile(values, 0.5)


def iqr_filter(values: list[float], *, k: float = 1.5, min_n: int = 4) -> list[float]:
    nums = [_f(v) for v in values]
    if len(nums) < min_n:
        return nums
    q1 = percentile(nums, 0.25)
    q3 = percentile(nums, 0.75)
    iqr = q3 - q1
    lo = q1 - k * iqr
    hi = q3 + k * iqr
    kept = [v for v in nums if lo <= v <= hi]
    return kept or nums


def upsert_amostra(
    amostras: list[dict],
    os_key: str,
    horas: float,
    *,
    ewma_alpha: float = 0.3,
) -> tuple[list[dict], dict]:
    """Substitui a amostra da OS (idempotente) e recalcula n/mediana/IQR/EWMA."""
    horas = max(_f(horas), 0.0)
    next_rows: list[dict] = []
    replaced = False
    for row in amostras or []:
        if str(row.get("os") or "") == os_key:
            next_rows.append({**row, "horas": horas})
            replaced = True
        else:
            next_rows.append(dict(row))
    if not replaced:
        next_rows.append({"os": os_key, "horas": horas})
    hours = [_f(r.get("horas")) for r in next_rows]
    kept = iqr_filter(hours)
    n = len(kept)
    ewma = 0.0
    for h in hours:
        ewma = h if ewma == 0.0 else ewma_alpha * h + (1.0 - ewma_alpha) * ewma
    return next_rows, {
        "n": n,
        "mediana_horas": median(kept) if kept else 0.0,
        "ewma_horas": ewma,
        "p25_horas": percentile(kept, 0.25) if kept else None,
        "p75_horas": percentile(kept, 0.75) if kept else None,
    }

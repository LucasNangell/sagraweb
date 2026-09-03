"""
Realizado de orçamento na entrega: stints de andamento (horas úteis 6h–22h),
custeio de pessoal e aprendizado (mediana + IQR). Não interrompe o andamento.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any, Optional

from database import db
from services.orcamento_engine import normalize_text
from services.orcamento_pessoal import (
    cap_stint,
    custo_crew,
    overhead_hora,
    passo_cobra_pessoal,
    passo_compativel_tecnologia,
    prior_horas,
    upsert_amostra,
)

logger = logging.getLogger(__name__)

_DELIVERED = frozenset({"entregue"})
_RETRABALHO = ("retrabalho", "retrabl")
_CANCEL = frozenset({"cancelado", "cancelada"})


def _f(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(str(value).strip().replace(",", "."))
    except (TypeError, ValueError):
        return default


def _money(value: float) -> float:
    return round(float(value) + 1e-12, 2)


def parse_andamento_dt(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, date) and not isinstance(value, datetime):
        return datetime(value.year, value.month, value.day)
    text = str(value).strip()[:26]
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def is_retrabalho(situacao: str | None) -> bool:
    text = (situacao or "").strip().casefold()
    return any(token in text for token in _RETRABALHO)


def is_entregue(situacao: str | None) -> bool:
    return (situacao or "").strip().casefold() in _DELIVERED


def os_key(nro: int, ano: int) -> str:
    return f"{int(nro)}/{int(ano)}"


def stints_from_andamentos(rows: list[dict]) -> list[dict]:
    """
    Sequência de permanência por setor: andamento i até i+1, horas úteis 6h–22h.
    Retrabalho e cancelamento não geram stint de aprendizado.
    """
    from services.expediente_service import business_hours_between as _business_hours_between

    ordered = sorted(
        rows or [],
        key=lambda r: (
            parse_andamento_dt(r.get("Data") or r.get("data")) or datetime.min,
            str(r.get("CodStatus") or r.get("cod_status") or ""),
        ),
    )
    stints: list[dict] = []
    for idx, row in enumerate(ordered[:-1]):
        nxt = ordered[idx + 1]
        situ = str(row.get("SituacaoLink") or row.get("situacao") or "")
        if is_retrabalho(situ) or situ.strip().casefold() in _CANCEL:
            continue
        start = parse_andamento_dt(row.get("Data") or row.get("data"))
        end = parse_andamento_dt(nxt.get("Data") or nxt.get("data"))
        if not start or not end or end <= start:
            continue
        hours = _business_hours_between(start, end)
        if hours <= 0:
            continue
        setor = str(row.get("SetorLink") or row.get("setor") or "").strip()
        if not setor:
            continue
        stints.append(
            {
                "setor_link": setor,
                "horas": hours,
                "situacao": situ,
                "inicio": start.isoformat(sep=" "),
                "fim": end.isoformat(sep=" "),
            }
        )
    return stints


def match_stints_to_passos(
    passos: list[dict],
    stints: list[dict],
    *,
    tecnologia: str,
    tiragem: int,
    paginas: int,
    folhas: float,
    teto_fator: float = 3.0,
) -> list[dict]:
    """Casa stints em ordem com passos produtivos do mesmo SetorLink."""
    unused = list(stints or [])
    matched: list[dict] = []
    for passo in passos or []:
        if not passo_compativel_tecnologia(passo, tecnologia):
            continue
        prior = prior_horas(passo, tiragem=tiragem, paginas=paginas, folhas=folhas)
        cobra = passo_cobra_pessoal(passo)
        if not cobra:
            matched.append(
                {
                    "passo": passo,
                    "horas_obs": 0.0,
                    "horas": 0.0,
                    "horas_prior": prior,
                    "capped": False,
                    "stint": None,
                }
            )
            continue
        wanted = normalize_text(passo.get("setor_link"))
        found_i = next(
            (
                i
                for i, st in enumerate(unused)
                if normalize_text(st.get("setor_link")) == wanted
            ),
            None,
        )
        if found_i is None:
            matched.append(
                {
                    "passo": passo,
                    "horas_obs": 0.0,
                    "horas": 0.0,
                    "horas_prior": prior,
                    "capped": False,
                    "stint": None,
                }
            )
            continue
        stint = unused.pop(found_i)
        obs = _f(stint.get("horas"))
        capped = cap_stint(obs, prior, teto_fator)
        matched.append(
            {
                "passo": passo,
                "horas_obs": obs,
                "horas": capped,
                "horas_prior": prior,
                "capped": capped < obs - 1e-9,
                "stint": stint,
            }
        )
    return matched


def custear_matched(
    matched: list[dict],
    funcoes: list[dict],
    *,
    utilizacao: float = 0.6,
    horas_mes: float = 176.0,
) -> dict:
    detalhe: list[dict] = []
    horas_prod = 0.0
    custo_etapas = 0.0
    for item in matched:
        passo = item["passo"]
        horas = _f(item.get("horas"))
        cobra = passo_cobra_pessoal(passo)
        if not cobra:
            detalhe.append(
                {
                    "passo_id": passo.get("id"),
                    "nome": passo.get("nome") or passo.get("setor_link"),
                    "setor_link": passo.get("setor_link"),
                    "tipo": passo.get("tipo"),
                    "cobra_pessoal": False,
                    "horas_prior": item.get("horas_prior") or 0.0,
                    "horas_obs": 0.0,
                    "horas": 0.0,
                    "valor": 0.0,
                    "crew": [],
                }
            )
            continue
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
                "horas_prior": item.get("horas_prior") or 0.0,
                "horas_obs": item.get("horas_obs") or 0.0,
                "horas": horas,
                "capped": bool(item.get("capped")),
                "valor": valor,
                "crew": crew,
            }
        )
    taxa_oh = overhead_hora(funcoes, horas_mes=horas_mes, utilizacao=utilizacao)
    overhead = _money(horas_prod * taxa_oh)
    return {
        "horas_produtivas": horas_prod,
        "custo_etapas": _money(custo_etapas),
        "overhead_estrutura": overhead,
        "custo_pessoal": _money(custo_etapas + overhead),
        "detalhe": detalhe,
    }


def material_teorico(escolhido: dict) -> float:
    return _money(
        _f(escolhido.get("custo_papel"))
        + _f(escolhido.get("custo_clique"))
        + _f(escolhido.get("custo_pre"))
        + _f(escolhido.get("custo_tinta"))
        + _f(escolhido.get("custo_acabamento"))
    )


def material_consumo(movimentos: list[dict]) -> float:
    total = 0.0
    for row in movimentos or []:
        tipo = str(row.get("tipo") or "").strip().casefold()
        if tipo not in {"saida", "saída", "consumo", "baixa"}:
            continue
        total += _f(row.get("custo_total"))
    return _money(total)


def aplicar_aprendizado(
    matched: list[dict],
    amostras_por_passo: dict[int, list[dict]],
    os_key_value: str,
) -> dict[int, dict]:
    """Devolve {passo_id: {amostras, stats}} só para etapas produtivas com hora > 0."""
    out: dict[int, dict] = {}
    for item in matched:
        passo = item["passo"]
        if not passo_cobra_pessoal(passo):
            continue
        horas = _f(item.get("horas"))
        if horas <= 0:
            continue
        pid = passo.get("id")
        if pid is None:
            continue
        pid = int(pid)
        amostras, stats = upsert_amostra(
            amostras_por_passo.get(pid) or [],
            os_key_value,
            horas,
        )
        out[pid] = {
            "amostras": amostras,
            "stats": stats,
            "setor_link": passo.get("setor_link"),
            "catalog_id": passo.get("catalog_id"),
        }
    return out


def montar_realizado(
    *,
    estimado: dict,
    pessoal: dict,
    consumo: float | None,
) -> dict:
    teorico = material_teorico(estimado)
    tem_estoque = consumo is not None
    material = consumo if tem_estoque else teorico
    desperdicio = _money(max((consumo or 0) - teorico, 0.0)) if tem_estoque else 0.0
    usa_hora = bool(estimado.get("usa_pessoal_hora"))
    pessoal_val = _f(pessoal.get("custo_pessoal")) if usa_hora else 0.0
    facility = 0.0
    for linha in estimado.get("indiretos_detalhe") or []:
        nome = str(linha.get("nome") or "")
        if usa_hora and (
            nome.startswith("Pessoal:")
            or nome.startswith("Estrutura")
            or nome.startswith("Gastos com pessoal")
            or "Insumos indiretos" in nome
        ):
            continue
        facility += _f(linha.get("valor"))
    total = _money(material + pessoal_val + facility)
    return {
        "custo_pessoal": _money(pessoal_val),
        "custo_material": _money(material),
        "custo_material_teorico": teorico,
        "desperdicio": desperdicio,
        "tem_estoque": tem_estoque,
        "nota_material": None
        if tem_estoque
        else "Sem movimento de estoque: material realizado = teórico do motor.",
        "custo_instalacoes": _money(facility),
        "total": total,
        "pessoal_detalhe": pessoal.get("detalhe") or [],
        "horas_produtivas": pessoal.get("horas_produtivas") or 0.0,
    }


def _query(sql: str, params: tuple = ()) -> list[dict]:
    return db.execute_query(sql, params) or []


def _load_andamentos(nro: int, ano: int) -> list[dict]:
    from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE
    from services.andamento_table import get_andamento_table

    table = get_andamento_table()
    return _query(
        f"""
        SELECT a.CodStatus, a.SetorLink, a.SituacaoLink, a.`Data`
        FROM `{table}` a
        WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
          AND {MIRROR_EXCLUDE_CLAUSE}
        ORDER BY a.`Data` ASC, a.CodStatus ASC
        """,
        (nro, ano),
    )


def _load_movimentos(nro: int, ano: int) -> list[dict]:
    try:
        return _query(
            """
            SELECT tipo, custo_total
            FROM tab_estoque_movimento
            WHERE referencia_os_nro = %s AND referencia_os_ano = %s
            """,
            (nro, ano),
        )
    except Exception:
        logger.debug("Estoque indisponível para realizado OS %s/%s", nro, ano)
        return []


def _latest_orcamento_row(nro: int, ano: int) -> Optional[dict]:
    rows = _query(
        """
        SELECT id, valor_total, snapshot_json
        FROM tab_orcamento
        WHERE nro_protocolo = %s AND ano_protocolo = %s
        ORDER BY id DESC
        LIMIT 1
        """,
        (nro, ano),
    )
    return rows[0] if rows else None


def _parse_json(raw: Any) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_amostras(passo_id: int) -> list[dict]:
    rows = _query(
        "SELECT amostras_json FROM tab_orcamento_tempo_aprendido WHERE passo_id = %s",
        (passo_id,),
    )
    if not rows:
        return []
    data = _parse_json(rows[0].get("amostras_json"))
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    return []


def _persist_aprendido(catalog_id: int, passo_id: int, setor: str, amostras: list[dict], stats: dict) -> None:
    payload = json.dumps(amostras, ensure_ascii=False, default=str)

    def _tx(cursor):
        cursor.execute(
            """
            INSERT INTO tab_orcamento_tempo_aprendido (
                catalog_id, passo_id, setor_link, n, mediana_horas, ewma_horas,
                p25_horas, p75_horas, amostras_json, atualizado_em
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
            ON DUPLICATE KEY UPDATE
                n = VALUES(n),
                mediana_horas = VALUES(mediana_horas),
                ewma_horas = VALUES(ewma_horas),
                p25_horas = VALUES(p25_horas),
                p75_horas = VALUES(p75_horas),
                amostras_json = VALUES(amostras_json),
                setor_link = VALUES(setor_link),
                catalog_id = VALUES(catalog_id),
                atualizado_em = NOW()
            """,
            (
                catalog_id,
                passo_id,
                setor or "",
                int(stats.get("n") or 0),
                stats.get("mediana_horas") or 0,
                stats.get("ewma_horas") or 0,
                stats.get("p25_horas"),
                stats.get("p75_horas"),
                payload,
            ),
        )

    db.execute_transaction([_tx])


def _persist_realizado(
    nro: int,
    ano: int,
    orcamento_id: Optional[int],
    estimado: dict,
    realizado: dict,
) -> None:
    payload_est = json.dumps(estimado, ensure_ascii=False, default=str)
    payload_real = json.dumps(realizado, ensure_ascii=False, default=str)

    def _tx(cursor):
        cursor.execute(
            """
            INSERT INTO tab_orcamento_realizado (
                nro_protocolo, ano_protocolo, orcamento_id, estimado_json,
                realizado_json, computed_at
            ) VALUES (%s,%s,%s,%s,%s,NOW())
            ON DUPLICATE KEY UPDATE
                orcamento_id = VALUES(orcamento_id),
                estimado_json = VALUES(estimado_json),
                realizado_json = VALUES(realizado_json),
                computed_at = NOW()
            """,
            (nro, ano, orcamento_id, payload_est, payload_real),
        )

    db.execute_transaction([_tx])


def load_realizado_row(nro: int, ano: int) -> Optional[dict]:
    rows = _query(
        """
        SELECT orcamento_id, estimado_json, realizado_json, computed_at
        FROM tab_orcamento_realizado
        WHERE nro_protocolo = %s AND ano_protocolo = %s
        LIMIT 1
        """,
        (nro, ano),
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "orcamento_id": row.get("orcamento_id"),
        "estimado": _parse_json(row.get("estimado_json")),
        "realizado": _parse_json(row.get("realizado_json")),
        "computed_at": str(row.get("computed_at") or ""),
    }


def ultima_situacao(nro: int, ano: int) -> str:
    from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE
    from services.andamento_table import get_andamento_table

    table = get_andamento_table()
    rows = _query(
        f"""
        SELECT a.SituacaoLink
        FROM `{table}` a
        WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
          AND {MIRROR_EXCLUDE_CLAUSE}
        ORDER BY a.UltimoStatus DESC, a.`Data` DESC
        LIMIT 1
        """,
        (nro, ano),
    )
    if not rows:
        return ""
    return str(rows[0].get("SituacaoLink") or "")


def on_os_entregue(nro: int, ano: int) -> Optional[dict]:
    """
    Grava realizado e atualiza aprendizado. Nunca propaga exceção ao caller.
    """
    try:
        return _on_os_entregue(int(nro), int(ano))
    except Exception:
        logger.exception("Orçamento realizado: falha na OS %s/%s", nro, ano)
        return None


def _on_os_entregue(nro: int, ano: int) -> Optional[dict]:
    from services import orcamento_admin_service as admin_svc
    from services import orcamento_os_service as os_svc
    from services import orcamento_produto_passos_service as passos_svc

    catalog = admin_svc.load_catalog()
    payload = os_svc.map_os_to_payload(ano, nro, catalog)
    computed = os_svc.calcular_payload(payload, catalog)
    resultado = computed.get("resultado") or {}
    escolhido = resultado.get("escolhido") or {}
    params = catalog.get("parametros") or {}
    produto = str((payload.get("os") or {}).get("produto") or "")
    passos = passos_svc.list_passos_por_produto(produto)
    if not passos:
        passos = [
            p
            for p in (catalog.get("passos") or [])
            if normalize_text(p.get("produto_rotulo")) == normalize_text(produto)
        ]

    snap_row = _latest_orcamento_row(nro, ano)
    snap = _parse_json((snap_row or {}).get("snapshot_json"))
    if snap.get("resultado"):
        estimado = (snap.get("resultado") or {}).get("escolhido") or escolhido
        fonte = "snapshot"
        orcamento_id = int(snap_row["id"]) if snap_row and snap_row.get("id") else None
    else:
        estimado = escolhido
        fonte = "recalculo"
        orcamento_id = int(snap_row["id"]) if snap_row and snap_row.get("id") else None

    andamentos = _load_andamentos(nro, ano)
    stints = stints_from_andamentos(andamentos)
    pags = sum(int(c.get("paginas") or 0) for c in (payload.get("componentes") or [])) or 1
    folhas = sum(_f(c.get("folhas_matriz")) for c in (estimado.get("componentes") or []))
    tec = str(resultado.get("tecnologia_escolhida") or payload.get("tecnologia") or "digital")
    matched = match_stints_to_passos(
        passos,
        stints,
        tecnologia=tec,
        tiragem=int(payload.get("tiragem") or 1),
        paginas=pags,
        folhas=folhas,
        teto_fator=_f(params.get("stint_teto_fator"), 3.0),
    )
    pessoal = custear_matched(
        matched,
        catalog.get("funcoes") or [],
        utilizacao=_f(params.get("overhead_utilizacao"), 0.6),
    )
    movs = _load_movimentos(nro, ano)
    consumo = material_consumo(movs) if movs else None
    realizado = montar_realizado(estimado=estimado, pessoal=pessoal, consumo=consumo)
    estimado_resumo = {
        "fonte": fonte,
        "total": _f(estimado.get("total")),
        "custo_pessoal": _f(estimado.get("custo_pessoal")),
        "custo_material": material_teorico(estimado),
        "custo_indiretos": _f(estimado.get("custo_indiretos")),
        "pessoal_detalhe": estimado.get("pessoal_detalhe") or [],
        "usa_pessoal_hora": bool(estimado.get("usa_pessoal_hora")),
        "tecnologia": estimado.get("tecnologia"),
    }
    _persist_realizado(nro, ano, orcamento_id, estimado_resumo, realizado)

    amostras_map = {
        int(p["id"]): _load_amostras(int(p["id"])) for p in passos if p.get("id")
    }
    learned = aplicar_aprendizado(matched, amostras_map, os_key(nro, ano))
    for pid, rec in learned.items():
        catalog_id = rec.get("catalog_id")
        if not catalog_id:
            passo = next((p for p in passos if int(p.get("id") or 0) == pid), None)
            catalog_id = (passo or {}).get("catalog_id") or 0
        _persist_aprendido(
            int(catalog_id or 0),
            pid,
            str(rec.get("setor_link") or ""),
            rec["amostras"],
            rec["stats"],
        )
    return {"estimado": estimado_resumo, "realizado": realizado, "learned": learned}


def comparativo_da_os(ano: int, os_id: int, computed: dict) -> Optional[dict]:
    """Monta estimado vs real para a página. Recalcula na entrega se ainda não gravou."""
    stored = load_realizado_row(os_id, ano)
    situ = ""
    try:
        situ = ultima_situacao(os_id, ano)
    except Exception:
        logger.debug("Situação da OS %s/%s indisponível para comparativo", os_id, ano)
    if stored is None and is_entregue(situ):
        on_os_entregue(os_id, ano)
        stored = load_realizado_row(os_id, ano)
    if stored is None and not is_entregue(situ):
        return None

    resultado = computed.get("resultado") or {}
    escolhido = resultado.get("escolhido") or {}
    params = computed.get("parametros") or {}
    k = _f(params.get("blend_k"), 8.0)

    if stored and stored.get("estimado"):
        estimado = stored["estimado"]
        fonte = estimado.get("fonte") or "snapshot"
    else:
        snap_row = _latest_orcamento_row(os_id, ano)
        snap = _parse_json((snap_row or {}).get("snapshot_json"))
        if snap.get("resultado"):
            est_full = (snap.get("resultado") or {}).get("escolhido") or escolhido
            fonte = "snapshot"
        else:
            est_full = escolhido
            fonte = "recalculo"
        estimado = {
            "fonte": fonte,
            "total": _f(est_full.get("total")),
            "custo_pessoal": _f(est_full.get("custo_pessoal")),
            "custo_material": material_teorico(est_full),
            "pessoal_detalhe": est_full.get("pessoal_detalhe") or [],
            "usa_pessoal_hora": bool(est_full.get("usa_pessoal_hora")),
        }

    realizado = (stored or {}).get("realizado")
    ns = [
        int(d.get("n_amostras") or 0)
        for d in (estimado.get("pessoal_detalhe") or escolhido.get("pessoal_detalhe") or [])
        if d.get("cobra_pessoal")
    ]
    n_min = min(ns) if ns else 0
    if n_min <= 0:
        confianca_rotulo = "prior ainda dominante"
    elif n_min < k:
        confianca_rotulo = "aprendizado inicial"
    else:
        confianca_rotulo = "mediana dominante"

    delta = None
    if realizado:
        delta = _money(_f(realizado.get("total")) - _f(estimado.get("total")))
    return {
        "tem_realizado": realizado is not None,
        "situacao": situ,
        "estimado": estimado,
        "estimado_fonte": estimado.get("fonte") or fonte,
        "realizado": realizado,
        "delta": delta,
        "confianca": {"n": n_min, "k": k, "rotulo": confianca_rotulo},
        "computed_at": (stored or {}).get("computed_at"),
    }

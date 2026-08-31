"""Read-only: tempo de impressao digital SIELT por produto e pagina."""
from __future__ import annotations

import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))

import pymysql
from config_manager import config_manager

OBS_TIME_RE = re.compile(r"^\s*(\d{1,2})h(\d{2})", re.IGNORECASE)
IQR_MULT = 1.5
MIN_IQR_N = 8
BIZ_OPEN = 6
BIZ_CLOSE = 22
DIGITAL_MAQ = ("digital cor", "digital cor/pb", "digital pb", "cópia pb", "copia pb")


def overlay_time(data, obs) -> datetime | None:
    if not data:
        return None
    base = data if isinstance(data, datetime) else datetime.fromisoformat(str(data))
    m = OBS_TIME_RE.match(obs or "")
    if m:
        hh, mm = int(m.group(1)), int(m.group(2))
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            return base.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if base.hour == 0 and base.minute == 0 and base.second == 0:
        return None
    return base


def business_hours(start: datetime, end: datetime) -> float:
    if end <= start:
        return 0.0
    total = 0.0
    cursor = start
    guard = 0
    while cursor < end and guard < 400:
        guard += 1
        day_start = cursor.replace(hour=BIZ_OPEN, minute=0, second=0, microsecond=0)
        day_end = cursor.replace(hour=BIZ_CLOSE, minute=0, second=0, microsecond=0)
        window_start = max(cursor, day_start)
        window_end = min(end, day_end)
        if window_start < window_end:
            total += (window_end - window_start).total_seconds() / 3600.0
        if end <= day_end:
            break
        cursor = (cursor + timedelta(days=1)).replace(
            hour=BIZ_OPEN, minute=0, second=0, microsecond=0
        )
    return total


def iqr_bounds(values: list[float]) -> tuple[float, float] | None:
    if len(values) < MIN_IQR_N:
        return None
    s = sorted(values)
    n = len(s)

    def pct(p: float) -> float:
        idx = (n - 1) * p
        lo = int(math.floor(idx))
        hi = int(math.ceil(idx))
        if lo == hi:
            return s[lo]
        w = idx - lo
        return s[lo] * (1 - w) + s[hi] * w

    q1, q3 = pct(0.25), pct(0.75)
    iqr = q3 - q1
    if iqr <= 0:
        return (min(s), s[int(0.95 * (n - 1))])
    return (max(0.0, q1 - IQR_MULT * iqr), q3 + IQR_MULT * iqr)


def mean(xs):
    return statistics.fmean(xs) if xs else None


def median(xs):
    return statistics.median(xs) if xs else None


def fmt(x, nd=2):
    if x is None:
        return None
    return round(float(x), nd)


def is_digital_maq(maquina: str) -> bool:
    t = (maquina or "").strip().lower()
    if t.startswith("digital"):
        return True
    return t in DIGITAL_MAQ


def obs_looks_digital(obs: str) -> bool:
    t = (obs or "").lower()
    return any(k in t for k in ("xerox", "versant", " cor", "\ncor", " pb", "\npb"))


def main():
    cfg = config_manager.get_mysql_config()
    conn = pymysql.connect(
        host=cfg["host"],
        port=int(cfg.get("port", 3306)),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        read_timeout=180,
        connect_timeout=15,
    )
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            CodStatus, NroProtocoloLink AS nro, AnoProtocoloLink AS ano,
            SituacaoLink AS situacao, SetorLink AS setor,
            `Data` AS data_evento, `Observaçao` AS obs
        FROM tabAndamento
        """
    )
    rows = cur.fetchall()
    print("andamentos", len(rows))

    by_os: dict[tuple, list] = defaultdict(list)
    print_keys = set()
    for r in rows:
        key = (r["nro"], r["ano"])
        r["_ts"] = overlay_time(r["data_evento"], r["obs"])
        by_os[key].append(r)
        if (r["situacao"] or "") == "Em Execução" and (r["setor"] or "").strip() == "SIELT":
            print_keys.add(key)

    print("os com em execucao SIELT", len(print_keys))
    placeholders = ",".join(["(%s,%s)"] * len(print_keys))
    params = [v for pair in print_keys for v in pair]
    cur.execute(
        f"""
        SELECT
            d.NroProtocoloLinkDet AS nro,
            d.AnoProtocoloLinkDet AS ano,
            TRIM(COALESCE(d.TipoPublicacaoLink, '')) AS produto,
            COALESCE(d.Pags, 0) AS pags,
            COALESCE(d.Tiragem, 0) AS tiragem,
            TRIM(COALESCE(d.MaquinaLink, '')) AS maquina
        FROM tabDetalhesServico AS d
        WHERE (d.NroProtocoloLinkDet, d.AnoProtocoloLinkDet) IN ({placeholders})
        """,
        params,
    )
    detalhes = cur.fetchall()
    conn.close()

    det_by_os: dict[tuple, list] = defaultdict(list)
    for d in detalhes:
        det_by_os[(d["nro"], d["ano"])].append(d)

    skipped = Counter()
    stints = []
    next_sit = Counter()
    maq_used = Counter()

    for key in print_keys:
        dets = det_by_os.get(key) or []
        maquina = (dets[0]["maquina"] if dets else "") or ""
        digital = is_digital_maq(maquina)
        events = [e for e in by_os[key] if e["_ts"] is not None]
        events.sort(key=lambda e: (e["_ts"], e["CodStatus"] or ""))
        for i, e in enumerate(events):
            if (e["situacao"] or "") != "Em Execução":
                continue
            if (e["setor"] or "").strip() != "SIELT":
                continue
            if not digital:
                skipped["nao_digital"] += 1
                continue
            if i + 1 >= len(events):
                skipped["sem_proximo"] += 1
                continue
            nxt = events[i + 1]
            start, end = e["_ts"], nxt["_ts"]
            if end <= start:
                skipped["duracao_invalida"] += 1
                continue
            cal_h = (end - start).total_seconds() / 3600.0
            if cal_h > 24 * 21:
                skipped["duracao_invalida"] += 1
                continue
            biz_h = business_hours(start, end)
            if biz_h <= 0:
                skipped["duracao_invalida"] += 1
                continue
            produto = (dets[0]["produto"] if dets else "") or "(sem produto)"
            if not produto.strip():
                produto = "(sem produto)"
            pags = max((int(d["pags"] or 0) for d in dets), default=0)
            tiragem = max((int(d["tiragem"] or 0) for d in dets), default=0)
            if pags <= 0:
                skipped["sem_paginas"] += 1
                continue
            volume = pags * max(tiragem, 1)
            next_sit[f"{nxt['situacao']} / {(nxt['setor'] or '').strip()}"] += 1
            maq_used[maquina or "(sem máquina)"] += 1
            stints.append(
                {
                    "nro": key[0],
                    "ano": key[1],
                    "start": start.isoformat(sep=" "),
                    "end": end.isoformat(sep=" "),
                    "biz_h": biz_h,
                    "cal_h": cal_h,
                    "produto": produto,
                    "pags": pags,
                    "tiragem": tiragem,
                    "volume": volume,
                    "maquina": maquina,
                    "min_pp": biz_h * 60.0 / pags,
                    "min_pv": biz_h * 60.0 / volume,
                    "sit_next": nxt["situacao"],
                    "year": start.year,
                }
            )

    print("stints", len(stints), "skipped", dict(skipped))

    by_prod: dict[str, list] = defaultdict(list)
    for s in stints:
        by_prod[s["produto"]].append(s)

    all_vals = [s["min_pp"] for s in stints]
    glob_bounds = iqr_bounds(all_vals)

    def keep_items(items):
        values = [i["min_pp"] for i in items]
        bounds = iqr_bounds(values)
        if bounds:
            lo, hi = bounds
            return [i for i in items if lo <= i["min_pp"] <= hi], bounds, True
        if glob_bounds:
            lo, hi = glob_bounds
            kept = [i for i in items if lo <= i["min_pp"] <= hi]
            if len(kept) >= max(1, len(items) // 2):
                return kept, glob_bounds, True
        return items, None, False

    table = []
    all_kept = []
    for produto, items in by_prod.items():
        kept, bounds, applied = keep_items(items)
        all_kept.extend(kept)
        lo, hi = bounds if bounds else (None, None)
        kv = [i["min_pp"] for i in kept]
        kvol = [i["min_pv"] for i in kept]
        kp = [i["pags"] for i in kept]
        kt = [i["tiragem"] for i in kept if i["tiragem"] > 0]
        kd = [i["biz_h"] * 60 for i in kept]
        weighted_pag = (
            sum(i["biz_h"] * 60 for i in kept) / sum(kp) if kept and sum(kp) else None
        )
        weighted_vol = (
            sum(i["biz_h"] * 60 for i in kept) / sum(i["volume"] for i in kept)
            if kept and sum(i["volume"] for i in kept)
            else None
        )
        table.append(
            {
                "produto": produto,
                "n_stints": len(items),
                "n_kept": len(kept),
                "n_outliers": len(items) - len(kept),
                "iqr_aplicado": applied,
                "iqr_lo": fmt(lo, 2),
                "iqr_hi": fmt(hi, 2),
                "pags_mediana": fmt(median(kp), 1) if kp else None,
                "pags_media": fmt(mean(kp), 1) if kp else None,
                "tiragem_mediana": fmt(median(kt), 0) if kt else None,
                "duracao_mediana_min": fmt(median(kd), 1) if kd else None,
                "duracao_media_min": fmt(mean(kd), 1) if kd else None,
                "min_por_pagina_media": fmt(mean(kv), 2),
                "min_por_pagina_mediana": fmt(median(kv), 2),
                "seg_por_pagina_media": fmt(mean(kv) * 60, 1) if kv else None,
                "min_por_pagina_ponderado": fmt(weighted_pag, 2),
                "seg_por_pagina_impressa_media": fmt(mean(kvol) * 60, 2) if kvol else None,
                "seg_por_pagina_impressa_mediana": fmt(median(kvol) * 60, 2) if kvol else None,
                "seg_por_pagina_impressa_pond": fmt(weighted_vol * 60, 2) if weighted_vol else None,
            }
        )

    table.sort(key=lambda r: (-(r["n_kept"] or 0), r["produto"]))
    overall_vals = [i["min_pp"] for i in all_kept]
    years = Counter(s["year"] for s in stints)
    glob_lo, glob_hi = glob_bounds if glob_bounds else (None, None)

    def top(items, key, n=6, reverse=True, min_biz_min=0):
        pool = [i for i in items if i["biz_h"] * 60 >= min_biz_min]
        return [
            {
                "os": f"{i['nro']}/{i['ano']}",
                "produto": i["produto"],
                "pags": i["pags"],
                "tiragem": i["tiragem"],
                "biz_min": round(i["biz_h"] * 60, 1),
                "min_pag": round(i["min_pp"], 2),
                "start": i["start"][11:16],
                "end": i["end"][11:16],
                "dia": i["start"][:10],
                "next": i["sit_next"],
            }
            for i in sorted(pool, key=key, reverse=reverse)[:n]
        ]

    result = {
        "source": "MySQL local sagrafulldb · tabAndamento + tabDetalhesServico",
        "period": f"{min(years)}–{max(years)}" if years else "",
        "method": (
            "Início: SituacaoLink='Em Execução', SetorLink='SIELT', máquina digital "
            "(MaquinaLink Digital*) ou observação Xerox/Versant/Cor/PB. "
            "Horário = prefixo HHhMM. Término = andamento seguinte da OS ordenado "
            "pelo horário sobreposto. Duração em horas úteis 6h–22h. "
            "Tempo/página do produto = duração / Pags. "
            "Tempo/página-impressa = duração / (Pags × Tiragem). "
            "Outliers IQR 1,5 sobre min/página do produto, por tipo."
        ),
        "counts": {
            "stints_validos": len(stints),
            "n_kept": len(all_kept),
            "skipped": dict(skipped),
            "anos": dict(sorted(years.items())),
            "produtos": len(table),
            "maquinas": dict(maq_used.most_common(12)),
        },
        "overall": {
            "n_kept": len(all_kept),
            "iqr_global_lo": fmt(glob_lo, 2),
            "iqr_global_hi": fmt(glob_hi, 2),
            "min_por_pagina_media": fmt(mean(overall_vals), 2),
            "min_por_pagina_mediana": fmt(median(overall_vals), 2),
            "seg_por_pagina_media": fmt(mean(overall_vals) * 60, 1) if overall_vals else None,
            "duracao_mediana_min": fmt(median([i["biz_h"] * 60 for i in all_kept]), 1),
            "seg_por_pagina_impressa_mediana": fmt(
                median([i["min_pv"] for i in all_kept]) * 60, 2
            ),
        },
        "next_situacao": [{"situacao": k, "n": v} for k, v in next_sit.most_common(12)],
        "table": table,
        "reliable": [r for r in table if (r["n_kept"] or 0) >= 5],
        "thin": [r for r in table if 0 < (r["n_kept"] or 0) < 5],
        "examples_slow": top(all_kept, lambda i: i["min_pp"], 6, True),
        "examples_fast": top(all_kept, lambda i: i["min_pp"], 6, False, min_biz_min=5),
    }

    out = ROOT / "tools" / "_tmp_sielt_result.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"counts": result["counts"], "overall": result["overall"]}, ensure_ascii=False, indent=2))
    print("table:")
    for r in table:
        print(
            f"{r['produto']:<28} n={r['n_kept']:4}/{r['n_stints']:<4}  "
            f"pags~{r['pags_mediana']} tir~{r['tiragem_mediana']}  "
            f"media={r['min_por_pagina_media']} min/pág  "
            f"mediana={r['min_por_pagina_mediana']}  "
            f"seg/imp={r['seg_por_pagina_impressa_mediana']}"
        )


if __name__ == "__main__":
    main()

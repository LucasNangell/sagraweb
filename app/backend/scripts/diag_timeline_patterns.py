"""Diagnóstico de padrões de andamento para linha do tempo do cliente."""
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import db  # noqa: E402


def collapse(seq: list[str]) -> list[str]:
    out: list[str] = []
    prev = None
    for s in seq:
        if s and s != prev:
            out.append(s)
            prev = s
    return out


def dump_os(nr: int, ano: int) -> None:
    rows = db.execute_query(
        """
        SELECT CodStatus, SituacaoLink, SetorLink, `Data`, `Observaçao`
        FROM tabAndamento
        WHERE NroProtocoloLink=%s AND AnoProtocoloLink=%s
        ORDER BY CodStatus
        """,
        (nr, ano),
    )
    print(f"=== OS {nr}/{ano} ({len(rows)} andamentos) ===")
    for r in rows:
        obs = str(r.get("Observaçao") or "")[:80].replace("\n", " | ")
        print(
            f"  {r['CodStatus']} | {r['SituacaoLink']} | {r['SetorLink']}"
            f" | {r['Data']} | {obs}"
        )


def analyze_product_maquina(produto: str, maquina: str, limit: int = 20) -> None:
    similar = db.execute_query(
        """
        SELECT p.NroProtocolo AS nr, p.AnoProtocolo AS ano
        FROM tabProtocolos p
        JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        JOIN tabAndamento a
          ON p.NroProtocolo = a.NroProtocoloLink
         AND p.AnoProtocolo = a.AnoProtocoloLink
         AND a.UltimoStatus = 1
        WHERE TRIM(d.TipoPublicacaoLink) = %s
          AND TRIM(d.MaquinaLink) = %s
          AND a.SituacaoLink = 'Entregue'
        ORDER BY p.AnoProtocolo DESC, p.NroProtocolo DESC
        LIMIT %s
        """,
        (produto, maquina, limit),
    )
    print(f"\n=== Análise {produto} / {maquina} ({len(similar)} OSs entregues) ===")

    position_counts: dict[int, Counter[str]] = defaultdict(Counter)
    transition_counts: Counter[tuple[str, str]] = Counter()
    all_situacoes: Counter[str] = Counter()
    sequences: list[list[str]] = []

    for s in similar:
        nr, ano = int(s["nr"]), int(s["ano"])
        rows = db.execute_query(
            """
            SELECT SituacaoLink, SetorLink FROM tabAndamento
            WHERE NroProtocoloLink=%s AND AnoProtocoloLink=%s
            ORDER BY CodStatus
            """,
            (nr, ano),
        )
        seq = collapse([str(r["SituacaoLink"] or "") for r in rows])
        sequences.append(seq)
        for i, sit in enumerate(seq[:30]):
            position_counts[i][sit] += 1
        for a, b in zip(seq, seq[1:]):
            transition_counts[(a, b)] += 1
        for sit in seq:
            all_situacoes[sit] += 1

    print("Top situacoes:", all_situacoes.most_common(20))
    print("Top transitions:", transition_counts.most_common(25))
    for i in range(18):
        if i in position_counts:
            print(f"Pos {i}:", position_counts[i].most_common(6))

    # median length
    lens = [len(s) for s in sequences]
    if lens:
        print(f"Seq lengths: min={min(lens)} max={max(lens)} avg={sum(lens)/len(lens):.1f}")


if __name__ == "__main__":
    for nr, ano in [(957, 2026), (952, 2026)]:
        dump_os(nr, ano)
        meta = db.execute_query(
            """
            SELECT d.MaquinaLink, d.TipoPublicacaoLink, d.Titulo
            FROM tabDetalhesServico d
            WHERE NroProtocoloLinkDet=%s AND AnoProtocoloLinkDet=%s
            """,
            (nr, ano),
        )
        print(f"Meta {nr}:", meta)

    analyze_product_maquina("Folder", "Digital Cor", 25)
    analyze_product_maquina("Folder", "Offset", 15)

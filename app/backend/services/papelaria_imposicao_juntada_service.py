"""Regras de juntada Timbrado A4 / Pasta Avulso para imposição pré-impressa."""
from __future__ import annotations

import math
from typing import Any, Optional

SITUACAO_AGUARD_JUNTADA = "Aguard. Juntada"

DEFAULT_JDF_IMPORT_ROOT_PAPELARIA = r"\\apogee\JDFImportRoot\Papelaria"
DEFAULT_JDF_IMPORT_ROOT_PASTA = r"\\apogee\JDFImportRoot\Papelaria_Pasta"
DEFAULT_JDF_IMPORT_ROOT_TIMBRADO = r"\\apogee\JDFImportRoot\Papelaria_Timbrado"

_MAX_SLOTS_PASTA = 2
_MAX_SLOTS_TIMBRADO = 4


def is_pasta_avulso_familia(produto: Optional[str]) -> bool:
    return (produto or "").strip().lower().startswith("pasta avulso")


def is_timbrado_a4_offset(produto: Optional[str]) -> bool:
    return (produto or "").strip().lower() == "timbrado a4"


def is_pre_impresso_produto(produto: Optional[str]) -> bool:
    return is_pasta_avulso_familia(produto) or is_timbrado_a4_offset(produto)


def mesma_familia_produto(a: Optional[str], b: Optional[str]) -> bool:
    if is_pasta_avulso_familia(a) and is_pasta_avulso_familia(b):
        return True
    if is_timbrado_a4_offset(a) and is_timbrado_a4_offset(b):
        return True
    return False


def max_slots(produto: Optional[str]) -> int:
    if is_pasta_avulso_familia(produto):
        return _MAX_SLOTS_PASTA
    if is_timbrado_a4_offset(produto):
        return _MAX_SLOTS_TIMBRADO
    return 1


def default_jdf_import_root(produto: Optional[str]) -> str:
    if is_pasta_avulso_familia(produto):
        return DEFAULT_JDF_IMPORT_ROOT_PASTA
    if is_timbrado_a4_offset(produto):
        return DEFAULT_JDF_IMPORT_ROOT_TIMBRADO
    return DEFAULT_JDF_IMPORT_ROOT_PAPELARIA


def resolve_jdf_import_root(
    config: Optional[dict[str, Any]],
    *,
    produto: Optional[str],
) -> str:
    raw = ""
    if isinstance(config, dict):
        raw = str(config.get("jdf_import_root") or "").strip()
    if raw:
        return raw
    return default_jdf_import_root(produto)


def _as_positive_int(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError("Tiragem inválida.") from None
    if n < 1:
        raise ValueError("Tiragem deve ser >= 1.")
    return n


def _gcd_many(values: list[int]) -> int:
    g = values[0]
    for v in values[1:]:
        g = math.gcd(g, v)
    return max(1, g)


def preencher_slots_ate_capacidade(
    slots: list[int],
    tiragens: list[int],
    cap: int,
) -> list[int]:
    """
    Garante sum(slots) == cap duplicando (Apogee Pasta=2, Timbrado=4).

    Se cap é múltiplo da soma, multiplica proporcionalmente; senão
    reparte extras priorizando maior tiragem.
    """
    if cap < 1:
        raise ValueError("Capacidade da folha inválida.")
    out = [max(0, int(s)) for s in slots]
    if len(out) != len(tiragens):
        raise ValueError("slots e tiragens com tamanhos diferentes.")
    total = sum(out)
    if total < 1:
        raise ValueError("Nenhum slot alocado.")
    if total > cap:
        raise ValueError(
            f"Slots {out} somam {total} (máx. {cap})."
        )
    if total == cap:
        return out
    if cap % total == 0:
        k = cap // total
        return [s * k for s in out]

    remaining = cap - total
    # Prioriza maior tiragem; em empate, menor quantidade atual de slots.
    while remaining > 0:
        order = sorted(
            range(len(out)),
            key=lambda i: (-int(tiragens[i]), int(out[i]), i),
        )
        out[order[0]] += 1
        remaining -= 1
    return out


def alocar_slots(
    tiragens: list[Any],
    *,
    produto: Optional[str],
) -> dict[str, Any]:
    """
    Aloca slots na folha conforme tiragens e **preenche sempre** a capacidade:
    Pasta → 2; Timbrado A4 → 4 (duplica o PDF base quando necessário).

    Pasta: tiragens iguais; Timbrado: unit=gcd; folhas=unit.
    """
    if not tiragens:
        raise ValueError("Informe ao menos uma tiragem.")
    nums = [_as_positive_int(t) for t in tiragens]
    cap = max_slots(produto)
    if len(nums) > cap:
        raise ValueError(
            f"Máximo de {cap} OS(s) na juntada para este produto."
        )

    if is_pasta_avulso_familia(produto):
        if len(set(nums)) != 1:
            raise ValueError(
                "Pasta Avulso: tiragens das OSs juntadas devem ser iguais."
            )
        base = [1] * len(nums)
        slots = preencher_slots_ate_capacidade(base, nums, cap)
        return {
            "slots": slots,
            "unit": nums[0],
            "folhas": nums[0],
            "total_slots": sum(slots),
            "max_slots": cap,
            "pdfs_enviados": cap,
        }

    if is_timbrado_a4_offset(produto):
        unit = _gcd_many(nums)
        base = [n // unit for n in nums]
        slots = preencher_slots_ate_capacidade(base, nums, cap)
        return {
            "slots": slots,
            "unit": unit,
            "folhas": unit,
            "total_slots": sum(slots),
            "max_slots": cap,
            "pdfs_enviados": cap,
        }

    raise ValueError("Produto não elegível à juntada pré-impressa.")


def expandir_paginas_por_slots(slots_por_os: list[int]) -> list[int]:
    """
    Lista de índices de OS (0-based) na ordem das páginas do PDF ganged.
    Ex.: slots [1,1,2] → [0, 1, 2, 2] (sempre max_slots páginas).
    """
    paginas: list[int] = []
    for os_idx, n_slots in enumerate(slots_por_os):
        for _ in range(max(0, int(n_slots))):
            paginas.append(os_idx)
    return paginas


def montar_ocupadas_por_slots(
    *,
    colunas: int,
    linhas: int,
    slots_por_pagina: list[int],
) -> list[dict[str, int]]:
    """
    Preenche a grade na ordem linha-major.

    O PDF ganged já traz uma página por slot (com duplicatas físicas).
    Cada célula aponta para pagina 1..N sequencial.
    """
    capacity = max(1, int(colunas) * int(linhas))
    total = sum(max(0, int(s)) for s in slots_por_pagina)
    if total < 1:
        raise ValueError("Nenhum slot alocado para a grade.")
    if total > capacity:
        raise ValueError(
            f"Slots ({total}) excedem a grade {colunas}×{linhas} ({capacity})."
        )

    # Páginas físicas no PDF ganged = 1..total (já duplicadas).
    ocupadas: list[dict[str, int]] = []
    cells = [(c, r) for r in range(int(linhas)) for c in range(int(colunas))]
    for i in range(total):
        col, row = cells[i]
        ocupadas.append({"col": col, "row": row, "pagina": i + 1})
    return ocupadas


def grid_padrao_pre_impresso(produto: Optional[str]) -> dict[str, int]:
    """Grade que comporta a capacidade fixa (Pasta 2×1, Timbrado 2×2)."""
    if is_pasta_avulso_familia(produto):
        return {"colunas": 2, "linhas": 1}
    if is_timbrado_a4_offset(produto):
        return {"colunas": 2, "linhas": 2}
    return {"colunas": 1, "linhas": 1}


def format_juntada_descricao(
    ancora: dict[str, Any],
    membros: list[dict[str, Any]],
) -> str:
    """Texto para JobDescription/Comment: âncora + demais OSs."""
    parts: list[str] = []
    for item in [ancora, *membros]:
        nro = int(item.get("nro") or 0)
        label = str(item.get("label") or item.get("nome") or "").strip()
        nro5 = f"{nro:05d}"
        if label:
            # Evita repetir Nr no início do label.
            if label.lower().startswith(nro5.lower()):
                parts.append(label)
            else:
                parts.append(f"{nro5}-{label}")
        else:
            parts.append(nro5)
    if len(parts) <= 1:
        return parts[0] if parts else "Papelaria"
    return f"{parts[0]} | juntada: {'; '.join(parts[1:])}"


def _os_tiragem(row: dict[str, Any]) -> int:
    for key in ("tiragem", "Tiragem", "tiragem_final", "TiragemFinal"):
        raw = row.get(key)
        if raw is None or raw == "":
            continue
        try:
            n = int(float(str(raw).replace(",", ".").strip()))
            if n >= 1:
                return n
        except (TypeError, ValueError):
            continue
    for key in ("tiragem_solicitada", "TiragemSolicitada"):
        raw = row.get(key)
        if raw is None or raw == "":
            continue
        try:
            n = int(float(str(raw).replace(",", ".").strip()))
            if n >= 1:
                return n
        except (TypeError, ValueError):
            continue
    raise ValueError("OS sem tiragem válida.")


def _ultima_situacao(ano: int, nro: int) -> str:
    from database import db

    rows = db.execute_query(
        """
        SELECT SituacaoLink
        FROM tabAndamento
        WHERE NroProtocoloLink = %(nro)s AND AnoProtocoloLink = %(ano)s
          AND UltimoStatus = 1
        ORDER BY Data DESC, CodStatus DESC
        LIMIT 1
        """,
        {"nro": int(nro), "ano": int(ano)},
    )
    if not rows:
        return ""
    return str(rows[0].get("SituacaoLink") or "").strip()


def list_imposicao_candidatas(
    *,
    ano: int,
    nro: int,
    produto: str,
) -> dict[str, Any]:
    """
    Lista OSs no mesmo andamento atual, mesma família de produto,
    elegíveis à juntada (tiragem compatível com a âncora sozinha).
    """
    from database import db
    from services.os_folder_path_service import (
        get_os_folder_basename,
        resolve_os_papelaria_dir,
    )

    if not is_pre_impresso_produto(produto):
        return {
            "ancora": {"ano": ano, "nro": nro, "produto": produto},
            "situacao": _ultima_situacao(ano, nro),
            "max_slots": max_slots(produto),
            "candidatas": [],
        }

    situacao = _ultima_situacao(ano, nro)
    ancora_rows = db.execute_query(
        """
        SELECT p.NroProtocolo AS nro, p.AnoProtocolo AS ano,
               d.TipoPublicacaoLink AS produto,
               d.Tiragem AS tiragem,
               d.TiragemSolicitada AS tiragem_solicitada
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s
        LIMIT 1
        """,
        {"nro": int(nro), "ano": int(ano)},
    )
    if not ancora_rows:
        raise LookupError("OS não encontrada.")
    ancora_row = ancora_rows[0]
    ancora_produto = str(ancora_row.get("produto") or produto or "").strip()
    ancora_tiragem = _os_tiragem(ancora_row)
    try:
        ancora_label = get_os_folder_basename(ano, nro)
    except Exception:
        ancora_label = f"{int(nro):05d}"

    candidatas: list[dict[str, Any]] = []
    if not situacao:
        return {
            "ancora": {
                "ano": ano,
                "nro": nro,
                "produto": ancora_produto,
                "tiragem": ancora_tiragem,
                "label": ancora_label,
            },
            "situacao": situacao,
            "max_slots": max_slots(ancora_produto),
            "candidatas": candidatas,
        }

    # Candidatas: mesmo andamento atual + produto da família.
    rows = db.execute_query(
        """
        SELECT p.NroProtocolo AS nro, p.AnoProtocolo AS ano,
               d.TipoPublicacaoLink AS produto,
               d.Tiragem AS tiragem,
               d.TiragemSolicitada AS tiragem_solicitada
        FROM tabAndamento a
        INNER JOIN tabProtocolos p
          ON p.NroProtocolo = a.NroProtocoloLink
         AND p.AnoProtocolo = a.AnoProtocoloLink
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE a.UltimoStatus = 1
          AND a.SituacaoLink = %(situacao)s
          AND NOT (p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s)
        ORDER BY p.AnoProtocolo DESC, p.NroProtocolo DESC
        LIMIT 200
        """,
        {"situacao": situacao, "nro": int(nro), "ano": int(ano)},
    )

    for row in rows or []:
        cand_produto = str(row.get("produto") or "").strip()
        if not mesma_familia_produto(ancora_produto, cand_produto):
            continue
        cand_ano = int(row["ano"])
        cand_nro = int(row["nro"])
        try:
            cand_tiragem = _os_tiragem(row)
        except ValueError:
            continue
        # BaseSefoc disponível?
        try:
            sefoc = resolve_os_papelaria_dir(cand_ano, cand_nro, create=False)
        except Exception:
            continue
        import os

        has_base = False
        if os.path.isdir(sefoc):
            for name in os.listdir(sefoc):
                low = name.lower()
                if low.endswith("-basesefoc.pdf") or low.endswith("basesefoc.pdf"):
                    has_base = True
                    break
                if low.endswith("-basesefoc.cdr") or low.endswith("basesefoc.cdr"):
                    has_base = True
                    break
        if not has_base:
            continue
        try:
            alloc = alocar_slots(
                [ancora_tiragem, cand_tiragem],
                produto=ancora_produto,
            )
        except ValueError:
            continue
        try:
            label = get_os_folder_basename(cand_ano, cand_nro)
        except Exception:
            label = f"{cand_nro:05d}"
        candidatas.append(
            {
                "ano": cand_ano,
                "nro": cand_nro,
                "produto": cand_produto,
                "tiragem": cand_tiragem,
                "label": label,
                "slots_com_ancora": alloc["slots"],
                "total_slots_com_ancora": alloc["total_slots"],
            }
        )

    return {
        "ancora": {
            "ano": ano,
            "nro": nro,
            "produto": ancora_produto,
            "tiragem": ancora_tiragem,
            "label": ancora_label,
        },
        "situacao": situacao,
        "max_slots": max_slots(ancora_produto),
        "candidatas": candidatas,
    }

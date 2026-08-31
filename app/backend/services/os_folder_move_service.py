"""Movimentação de subpastas entre OSs na rede (renomeia apenas Original/Sefoc)."""
from __future__ import annotations

import logging
import os
import shutil
from typing import Any, Callable, List, Optional

from database import db
from services.os_arquivos_service import _fetch_os_meta
from services.os_folder_structure import ensure_os_folder_on_network, normalize_text_custom

logger = logging.getLogger(__name__)

GetOsFolderPath = Callable[[int, int], Optional[str]]

CONCLUDED_SITUACOES = frozenset({"Entregue", "Cancelada", "Cancelado"})
REPETICAO_OBSERV_LINE_2 = "      Arquivos movidos pra pasta"
REPETICAO_OBSERV_LINE_3 = "----------------------------------"


def _year_suffix(ano: int) -> str:
    year = _normalize_ano(ano)
    if year >= 100:
        return f"{year % 100:02d}"
    return f"{year:02d}"


def _normalize_ano(ano: int) -> int:
    year = int(ano)
    if year < 100:
        return 2000 + year
    return year


def transfer_suffix(dest_nr: int, dest_ano: int) -> str:
    return f"(Transf CS {int(dest_nr):05d} {_year_suffix(dest_ano)})"


def prefixed_folder_name(src_nr: int, src_ano: int, subfolder_name: str) -> str:
    return f"{_year_suffix(src_ano)} {int(src_nr):05d} {subfolder_name}"


def _normalize_compare(value: str, *, is_product: bool) -> str:
    return normalize_text_custom(value or "", is_product=is_product)


def _is_original_folder(name: str) -> bool:
    lower = name.lower()
    return lower.startswith("original") or lower.startswith("orignal")


def _is_sefoc_folder(name: str) -> bool:
    return name.lower() == "sefoc"


def _folder_sort_key(name: str) -> tuple[int, str]:
    if _is_original_folder(name):
        return (0, name.lower())
    if _is_sefoc_folder(name):
        return (1, name.lower())
    return (2, name.lower())


def planned_target_name(origem_id: int, origem_ano: int, from_name: str) -> str:
    if _is_original_folder(from_name) or _is_sefoc_folder(from_name):
        return prefixed_folder_name(origem_id, origem_ano, from_name)
    return from_name


def list_move_candidate_folders(source_dir: str) -> List[str]:
    if not source_dir or not os.path.isdir(source_dir):
        return []
    names: List[str] = []
    for name in os.listdir(source_dir):
        full = os.path.join(source_dir, name)
        if not os.path.isdir(full):
            continue
        names.append(name)
    return sorted(names, key=_folder_sort_key)


def format_os_short_label(nr: int, ano: int) -> str:
    return f"{int(nr)}/{_year_suffix(ano)}"


def format_repeticao_observ(origem_id: int, origem_ano: int) -> str:
    return (
        f"---- Repetição da OS {format_os_short_label(origem_id, origem_ano)} ----\n"
        f"{REPETICAO_OBSERV_LINE_2}\n"
        f"{REPETICAO_OBSERV_LINE_3}"
    )


def merge_observ(existing: Optional[str], block: str) -> str:
    current = (existing or "").rstrip()
    if not current:
        return block
    return f"{current}\n{block}"


def is_origem_concluida(situacao: Optional[str]) -> bool:
    return (situacao or "").strip() in CONCLUDED_SITUACOES


def _serialize_andamento_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def fetch_origem_andamento(origem_ano: int, origem_id: int) -> dict:
    rows = db.execute_query(
        """
        SELECT CodStatus, SituacaoLink, SetorLink, Data, Ponto, `Observaçao`, UltimoStatus
        FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        ORDER BY CodStatus
        """,
        (origem_id, origem_ano),
    ) or []

    andamentos: List[dict] = []
    current_situacao: Optional[str] = None
    current_time = None
    for row in rows:
        situacao = _serialize_andamento_value(row.get("SituacaoLink"))
        andamentos.append(
            {
                "situacao": situacao,
                "setor": _serialize_andamento_value(row.get("SetorLink")),
                "data": _serialize_andamento_value(row.get("Data")),
                "ponto": _serialize_andamento_value(row.get("Ponto")),
                "observacao": _serialize_andamento_value(row.get("Observaçao")),
            }
        )
        if not row.get("UltimoStatus"):
            continue
        data = row.get("Data")
        if current_situacao is None or (
            data is not None and (current_time is None or data >= current_time)
        ):
            current_situacao = (situacao or "").strip() or None
            current_time = data

    return {
        "origem_situacao": current_situacao,
        "origem_concluida": is_origem_concluida(current_situacao),
        "origem_andamentos": andamentos,
    }


def write_repeticao_observ(
    *,
    dest_ano: int,
    dest_id: int,
    origem_id: int,
    origem_ano: int,
) -> str:
    block = format_repeticao_observ(origem_id, origem_ano)
    rows = db.execute_query(
        """
        SELECT Observ
        FROM tabDetalhesServico
        WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
        """,
        (dest_id, dest_ano),
    ) or []
    existing = rows[0].get("Observ") if rows else None
    merged = merge_observ(existing, block)
    if rows:
        db.execute_query(
            """
            UPDATE tabDetalhesServico
            SET Observ = %s
            WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
            """,
            (merged, dest_id, dest_ano),
        )
    else:
        db.execute_query(
            """
            INSERT INTO tabDetalhesServico (NroProtocoloLinkDet, AnoProtocoloLinkDet, Observ)
            VALUES (%s, %s, %s)
            """,
            (dest_id, dest_ano, merged),
        )
    return merged


def compare_os_meta(
    *,
    dest_ano: int,
    dest_id: int,
    origem_ano: int,
    origem_id: int,
) -> dict:
    dest_meta = _fetch_os_meta(dest_ano, dest_id)
    origem_meta = _fetch_os_meta(origem_ano, origem_id)

    dest_sol = _normalize_compare(dest_meta["solicitante"], is_product=False)
    origem_sol = _normalize_compare(origem_meta["solicitante"], is_product=False)
    dest_prod = _normalize_compare(dest_meta["produto"], is_product=True)
    origem_prod = _normalize_compare(origem_meta["produto"], is_product=True)

    same_solicitante = dest_sol == origem_sol
    same_produto = dest_prod == origem_prod

    return {
        "dest_solicitante": dest_meta["solicitante"],
        "dest_produto": dest_meta["produto"],
        "origem_solicitante": origem_meta["solicitante"],
        "origem_produto": origem_meta["produto"],
        "same_solicitante": same_solicitante,
        "same_produto": same_produto,
        "meta_mismatch": not (same_solicitante and same_produto),
    }


def preview_folder_move(
    *,
    dest_ano: int,
    dest_id: int,
    origem_ano: int,
    origem_id: int,
    get_os_folder_path: GetOsFolderPath,
) -> dict:
    origem_ano = _normalize_ano(origem_ano)

    if dest_ano == origem_ano and dest_id == origem_id:
        raise ValueError("A OS de origem não pode ser igual à OS de destino.")

    comparison = compare_os_meta(
        dest_ano=dest_ano,
        dest_id=dest_id,
        origem_ano=origem_ano,
        origem_id=origem_id,
    )

    origem_dir = get_os_folder_path(origem_ano, origem_id)
    dest_dir = get_os_folder_path(dest_ano, dest_id)

    candidates = list_move_candidate_folders(origem_dir or "")
    planned_moves = [
        {
            "from_name": name,
            "to_name": planned_target_name(origem_id, origem_ano, name),
        }
        for name in candidates
    ]

    dest_conflicts = []
    if dest_dir and os.path.isdir(dest_dir):
        existing = {entry.lower() for entry in os.listdir(dest_dir)}
        for item in planned_moves:
            if item["to_name"].lower() in existing:
                dest_conflicts.append(item["to_name"])

    andamento = fetch_origem_andamento(origem_ano, origem_id)

    return {
        **comparison,
        **andamento,
        "origem_folder_exists": bool(origem_dir and os.path.isdir(origem_dir)),
        "origem_folder_path": origem_dir or "",
        "dest_folder_exists": bool(dest_dir and os.path.isdir(dest_dir)),
        "dest_folder_path": dest_dir or "",
        "folders_to_move": planned_moves,
        "dest_conflicts": dest_conflicts,
        "can_execute": bool(
            origem_dir
            and os.path.isdir(origem_dir)
            and planned_moves
            and not dest_conflicts
        ),
    }


def _append_transfer_suffix(folder_path: str, suffix: str) -> str:
    parent = os.path.dirname(folder_path.rstrip("\\/"))
    base = os.path.basename(folder_path.rstrip("\\/"))
    if suffix in base:
        return folder_path
    new_name = f"{base} {suffix}"
    new_path = os.path.join(parent, new_name)
    os.rename(folder_path, new_path)
    return new_path


def execute_folder_move(
    *,
    dest_ano: int,
    dest_id: int,
    origem_ano: int,
    origem_id: int,
    confirm_meta_mismatch: bool = False,
    append_repeticao_observ: bool = False,
    confirm_origem_nao_concluida: bool = False,
    get_os_folder_path: GetOsFolderPath,
) -> dict:
    preview = preview_folder_move(
        dest_ano=dest_ano,
        dest_id=dest_id,
        origem_ano=origem_ano,
        origem_id=origem_id,
        get_os_folder_path=get_os_folder_path,
    )

    if preview["meta_mismatch"] and not confirm_meta_mismatch:
        raise ValueError(
            "Solicitante ou produto diferente entre as OSs. Confirme a operação para continuar."
        )

    if (
        append_repeticao_observ
        and not preview["origem_concluida"]
        and not confirm_origem_nao_concluida
    ):
        raise ValueError(
            "A OS de origem ainda não foi concluída. Confirme a transferência de arquivos para continuar."
        )

    if not preview["origem_folder_exists"]:
        raise ValueError("Pasta da OS de origem não encontrada na rede.")

    if not preview["folders_to_move"]:
        raise ValueError("Nenhuma subpasta encontrada na OS de origem.")

    if preview["dest_conflicts"]:
        conflict = ", ".join(preview["dest_conflicts"])
        raise ValueError(f"A pasta de destino já contém: {conflict}")

    origem_dir = preview["origem_folder_path"]
    dest_dir = preview["dest_folder_path"]

    if not dest_dir or not os.path.isdir(dest_dir):
        dest_meta = _fetch_os_meta(dest_ano, dest_id)
        dest_dir, _folder_name = ensure_os_folder_on_network(
            nr_os=dest_id,
            ano=dest_ano,
            solicitante=dest_meta["solicitante"],
            produto=dest_meta["produto"],
        )

    moved: List[dict] = []
    suffix = transfer_suffix(dest_id, dest_ano)

    try:
        for item in preview["folders_to_move"]:
            from_name = item["from_name"]
            to_name = item["to_name"]
            src_path = os.path.join(origem_dir, from_name)
            if not os.path.isdir(src_path):
                raise RuntimeError(f"Subpasta não encontrada: {from_name}")

            dest_path = os.path.join(dest_dir, to_name)
            if from_name == to_name:
                shutil.move(src_path, dest_path)
            else:
                renamed_path = os.path.join(origem_dir, to_name)
                if os.path.exists(renamed_path):
                    raise RuntimeError(f"Nome temporário já existe na origem: {to_name}")
                os.rename(src_path, renamed_path)
                shutil.move(renamed_path, dest_path)
            moved.append({"from_name": from_name, "to_name": to_name, "dest_path": dest_path})

        origem_dir = _append_transfer_suffix(origem_dir, suffix)
    except Exception:
        logger.exception(
            "Falha ao mover pastas %s/%s -> %s/%s",
            origem_id,
            origem_ano,
            dest_id,
            dest_ano,
        )
        raise

    if append_repeticao_observ:
        write_repeticao_observ(
            dest_ano=dest_ano,
            dest_id=dest_id,
            origem_id=origem_id,
            origem_ano=origem_ano,
        )

    return {
        "status": "ok",
        "dest_folder_path": dest_dir,
        "origem_folder_path": origem_dir,
        "moved_folders": moved,
        "transfer_suffix": suffix,
        "dest_folder_created": not preview["dest_folder_exists"],
        "meta_mismatch": preview["meta_mismatch"],
    }

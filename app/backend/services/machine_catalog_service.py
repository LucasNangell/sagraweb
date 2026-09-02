"""Grupos e configurações adicionais para máquinas cadastradas."""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional

from database import db
from machine_catalog_schema import ensure_machine_catalog_schema
from services import system_catalog_service as catalog_svc

VALID_GROUP_TYPES = {"geral", "impressora"}
VALID_PRINT_TECHNOLOGIES = {"digital", "offset"}


def _normalize_label(value: str) -> str:
    return " ".join((value or "").strip().split())


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _serialize_group(row: Dict[str, Any]) -> Dict[str, Any]:
    created = row.get("CriadoEm")
    updated = row.get("AtualizadoEm")
    return {
        "id": int(row["ID"]),
        "nome": str(row.get("Nome") or ""),
        "tipo": str(row.get("Tipo") or "geral"),
        "ativo": bool(row.get("Ativo")),
        "ordem": int(row.get("Ordem") or 50),
        "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
        "updated_at": updated.isoformat() if hasattr(updated, "isoformat") else updated,
        "updated_by_ponto": row.get("AtualizadoPorPonto"),
    }


def _serialize_config(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not row:
        return {
            "grupo_id": None,
            "tecnologia": None,
            "papel_max_altura_mm": None,
            "papel_max_largura_mm": None,
            "papel_padrao_altura_mm": None,
            "papel_padrao_largura_mm": None,
            "margem_superior_mm": None,
            "margem_direita_mm": None,
            "margem_inferior_mm": None,
            "margem_esquerda_mm": None,
        }
    return {
        "grupo_id": int(row["GrupoID"]) if row.get("GrupoID") is not None else None,
        "tecnologia": row.get("Tecnologia") or None,
        "papel_max_altura_mm": _to_float(row.get("PapelMaxAlturaMm")),
        "papel_max_largura_mm": _to_float(row.get("PapelMaxLarguraMm")),
        "papel_padrao_altura_mm": _to_float(row.get("PapelPadraoAlturaMm")),
        "papel_padrao_largura_mm": _to_float(row.get("PapelPadraoLarguraMm")),
        "margem_superior_mm": _to_float(row.get("MargemSuperiorMm")),
        "margem_direita_mm": _to_float(row.get("MargemDireitaMm")),
        "margem_inferior_mm": _to_float(row.get("MargemInferiorMm")),
        "margem_esquerda_mm": _to_float(row.get("MargemEsquerdaMm")),
    }


def list_groups(*, include_inactive: bool = False) -> List[Dict[str, Any]]:
    ensure_machine_catalog_schema()
    where = "" if include_inactive else "WHERE Ativo = 1"
    rows = db.execute_query(
        f"""
        SELECT ID, Nome, Tipo, Ativo, Ordem, CriadoEm, AtualizadoEm, AtualizadoPorPonto
        FROM tabSystemMachineGroup
        {where}
        ORDER BY Ativo DESC, Ordem ASC, Nome ASC
        """
    )
    return [_serialize_group(row) for row in (rows or [])]


def create_group(
    *,
    nome: str,
    tipo: str = "geral",
    ordem: int = 50,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_machine_catalog_schema()
    normalized = _normalize_label(nome)
    if not normalized:
        raise ValueError("Informe um nome válido para o grupo.")
    group_type = (tipo or "geral").strip().lower()
    if group_type not in VALID_GROUP_TYPES:
        raise ValueError("Tipo de grupo inválido.")

    existing = db.execute_query(
        "SELECT ID FROM tabSystemMachineGroup WHERE Nome = %s LIMIT 1",
        (normalized,),
    )
    if existing:
        raise ValueError(f'Grupo "{normalized}" já cadastrado.')

    db.execute_query(
        """
        INSERT INTO tabSystemMachineGroup (Nome, Tipo, Ativo, Ordem, AtualizadoPorPonto)
        VALUES (%s, %s, 1, %s, %s)
        """,
        (normalized, group_type, ordem, updated_by_ponto),
    )
    rows = db.execute_query(
        """
        SELECT ID, Nome, Tipo, Ativo, Ordem, CriadoEm, AtualizadoEm, AtualizadoPorPonto
        FROM tabSystemMachineGroup
        WHERE Nome = %s
        ORDER BY ID DESC LIMIT 1
        """,
        (normalized,),
    )
    if not rows:
        raise RuntimeError("Falha ao criar grupo de máquinas.")
    return _serialize_group(rows[0])


def _known_machine_label(label: str) -> str:
    normalized = _normalize_label(label)
    if not normalized:
        raise ValueError("Informe uma máquina válida.")
    for item in catalog_svc.list_admin_items("maquina"):
        item_label = _normalize_label(str(item.get("label") or ""))
        if item_label.casefold() == normalized.casefold():
            return item_label
    raise KeyError(f'Máquina "{normalized}" não encontrada.')


def _validate_group_id(group_id: Optional[int]) -> Optional[int]:
    if group_id is None:
        return None
    rows = db.execute_query(
        """
        SELECT ID FROM tabSystemMachineGroup
        WHERE ID = %s AND Ativo = 1
        LIMIT 1
        """,
        (group_id,),
    )
    if not rows:
        raise ValueError("Grupo de máquinas não encontrado ou inativo.")
    return int(group_id)


def _validate_dimension_pair(
    first: Optional[float],
    second: Optional[float],
    label: str,
) -> None:
    if (first is None) != (second is None):
        raise ValueError(f"Informe altura e largura para {label}, ou deixe ambas vazias.")


def update_machine_config(
    maquina_rotulo: str,
    *,
    grupo_id: Optional[int] = None,
    tecnologia: Optional[str] = None,
    papel_max_altura_mm: Optional[float] = None,
    papel_max_largura_mm: Optional[float] = None,
    papel_padrao_altura_mm: Optional[float] = None,
    papel_padrao_largura_mm: Optional[float] = None,
    margem_superior_mm: Optional[float] = None,
    margem_direita_mm: Optional[float] = None,
    margem_inferior_mm: Optional[float] = None,
    margem_esquerda_mm: Optional[float] = None,
    updated_by_ponto: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_machine_catalog_schema()
    label = _known_machine_label(maquina_rotulo)
    group_id = _validate_group_id(grupo_id)
    tech = (tecnologia or "").strip().lower() or None
    if tech is not None and tech not in VALID_PRINT_TECHNOLOGIES:
        raise ValueError("Tecnologia de impressão inválida.")

    _validate_dimension_pair(papel_max_altura_mm, papel_max_largura_mm, "o papel máximo")
    _validate_dimension_pair(
        papel_padrao_altura_mm,
        papel_padrao_largura_mm,
        "o papel padrão",
    )

    db.execute_query(
        """
        INSERT INTO tabSystemMachineConfig (
            MaquinaRotulo, GrupoID, Tecnologia,
            PapelMaxAlturaMm, PapelMaxLarguraMm,
            PapelPadraoAlturaMm, PapelPadraoLarguraMm,
            MargemSuperiorMm, MargemDireitaMm, MargemInferiorMm, MargemEsquerdaMm,
            AtualizadoPorPonto
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            GrupoID = VALUES(GrupoID),
            Tecnologia = VALUES(Tecnologia),
            PapelMaxAlturaMm = VALUES(PapelMaxAlturaMm),
            PapelMaxLarguraMm = VALUES(PapelMaxLarguraMm),
            PapelPadraoAlturaMm = VALUES(PapelPadraoAlturaMm),
            PapelPadraoLarguraMm = VALUES(PapelPadraoLarguraMm),
            MargemSuperiorMm = VALUES(MargemSuperiorMm),
            MargemDireitaMm = VALUES(MargemDireitaMm),
            MargemInferiorMm = VALUES(MargemInferiorMm),
            MargemEsquerdaMm = VALUES(MargemEsquerdaMm),
            AtualizadoPorPonto = VALUES(AtualizadoPorPonto)
        """,
        (
            label,
            group_id,
            tech,
            papel_max_altura_mm,
            papel_max_largura_mm,
            papel_padrao_altura_mm,
            papel_padrao_largura_mm,
            margem_superior_mm,
            margem_direita_mm,
            margem_inferior_mm,
            margem_esquerda_mm,
            updated_by_ponto,
        ),
    )
    return get_machine_config(label)


def get_machine_config(maquina_rotulo: str) -> Dict[str, Any]:
    ensure_machine_catalog_schema()
    label = _known_machine_label(maquina_rotulo)
    rows = db.execute_query(
        """
        SELECT MaquinaRotulo, GrupoID, Tecnologia,
               PapelMaxAlturaMm, PapelMaxLarguraMm,
               PapelPadraoAlturaMm, PapelPadraoLarguraMm,
               MargemSuperiorMm, MargemDireitaMm, MargemInferiorMm, MargemEsquerdaMm
        FROM tabSystemMachineConfig
        WHERE MaquinaRotulo = %s
        LIMIT 1
        """,
        (label,),
    )
    return {"maquina_rotulo": label, **_serialize_config(rows[0] if rows else None)}


def list_machine_admin_view() -> Dict[str, Any]:
    ensure_machine_catalog_schema()
    groups = list_groups(include_inactive=False)
    config_rows = db.execute_query(
        """
        SELECT MaquinaRotulo, GrupoID, Tecnologia,
               PapelMaxAlturaMm, PapelMaxLarguraMm,
               PapelPadraoAlturaMm, PapelPadraoLarguraMm,
               MargemSuperiorMm, MargemDireitaMm, MargemInferiorMm, MargemEsquerdaMm
        FROM tabSystemMachineConfig
        """
    )
    config_by_label = {
        _normalize_label(str(row.get("MaquinaRotulo") or "")).casefold(): row
        for row in (config_rows or [])
    }
    machines = []
    for item in catalog_svc.list_admin_items("maquina"):
        label = _normalize_label(str(item.get("label") or ""))
        config = _serialize_config(config_by_label.get(label.casefold()))
        machines.append({**item, "config": config})
    return {"groups": groups, "machines": machines}

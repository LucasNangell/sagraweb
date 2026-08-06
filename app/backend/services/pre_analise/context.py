"""Contexto compartilhado das verificações de pré-análise."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:
    from services.pre_analise.folder_session import FolderPdfSession


@dataclass
class PreAnaliseContext:
    folder_path: str
    ano: int
    os_id: int
    os_details: Dict[str, Any] = field(default_factory=dict)
    pdf_session: Optional["FolderPdfSession"] = None
    batch_mode: bool = False
    workload: Dict[str, Any] = field(default_factory=dict)

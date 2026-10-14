from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from database import db
from sequencia_producao_schema import ensure_sequencia_producao_schema
from services.os_componentes_service import load_componentes_for_os
from services.sequencia_producao_docx import write_sequencia_docx
from services.sequencia_producao_models import SequenciaDraft, SequenciaResponse
from services.sequencia_producao_rules import compute_source_hash, generate_sequencia_draft

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _fetch_os_row(ano: int, os_id: int) -> dict[str, Any]:
    rows = db.execute_query(
        """
        SELECT
            p.NroProtocolo, p.AnoProtocolo, p.NomeUsuario, p.SiglaOrgao,
            d.Titulo, d.TipoPublicacaoLink, d.FormatoLink, d.MaquinaLink,
            d.Tiragem, d.TiragemSolicitada, d.Pags, d.FrenteVerso,
            d.ModelosArq, d.PapelLink, d.PapelDescricao, d.Cores,
            d.CoresDescricao, d.DescAcabamento, d.Observ
        FROM tabProtocolos AS p
        LEFT JOIN tabDetalhesServico AS d
            ON p.NroProtocolo = d.NroProtocoloLinkDet
           AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %s AND p.AnoProtocolo = %s
        """,
        (os_id, ano),
    )
    if not rows:
        raise LookupError("OS não encontrada.")
    return dict(rows[0])


def _load_context(ano: int, os_id: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    row = _fetch_os_row(ano, os_id)
    try:
        componentes = load_componentes_for_os(os_id, ano, ativos_only=True)
    except Exception:
        componentes = []
    return row, componentes


def _docx_filename(ano: int, os_id: int) -> str:
    return f"{os_id:05d}_Seq Produção.docx"


def _docx_download_url(ano: int, os_id: int) -> str:
    return f"/os/{ano}/{os_id}/sequencia-producao/docx"


def _parse_saved_draft(raw: Any) -> SequenciaDraft | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        return SequenciaDraft.model_validate(parsed)
    except Exception:
        return None


def _saved_row(ano: int, os_id: int) -> dict[str, Any] | None:
    ensure_sequencia_producao_schema()
    rows = db.execute_query(
        """
        SELECT DraftJson, SourceHash, DocxPath, DocxGeneratedAt, UpdatedAt
        FROM tabOsSequenciaProducao
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
        """,
        (os_id, ano),
    )
    return dict(rows[0]) if rows else None


def get_sequencia_producao(ano: int, os_id: int, *, regenerate: bool = False) -> SequenciaResponse:
    os_row, componentes = _load_context(ano, os_id)
    generated = generate_sequencia_draft(os_row, componentes)
    saved = None if regenerate else _saved_row(ano, os_id)
    saved_draft = _parse_saved_draft(saved.get("DraftJson") if saved else None)
    draft = saved_draft or generated
    generated_hash = compute_source_hash(os_row, componentes)
    docx_path = saved.get("DocxPath") if saved else None
    docx_exists = bool(docx_path and os.path.exists(str(docx_path)))
    updated_at = saved.get("UpdatedAt") if saved else None
    return SequenciaResponse(
        draft=draft,
        generated_source_hash=generated_hash,
        saved=saved_draft is not None,
        source_changed=bool(saved_draft and saved_draft.source_hash != generated_hash),
        docx_filename=_docx_filename(ano, os_id) if docx_exists else None,
        docx_download_url=_docx_download_url(ano, os_id) if docx_exists else None,
        updated_at=updated_at.isoformat() if hasattr(updated_at, "isoformat") else None,
    )


def save_sequencia_producao(ano: int, os_id: int, draft: SequenciaDraft, *, ponto: str | None = None) -> SequenciaResponse:
    ensure_sequencia_producao_schema()
    _fetch_os_row(ano, os_id)
    payload = json.dumps(draft.model_dump(mode="json"), ensure_ascii=False)
    db.execute_transaction(
        [
            (
                """
                INSERT INTO tabOsSequenciaProducao (
                    NroProtocolo, AnoProtocolo, DraftJson, SourceHash, CreatedBy, UpdatedBy
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    DraftJson = VALUES(DraftJson),
                    SourceHash = VALUES(SourceHash),
                    UpdatedBy = VALUES(UpdatedBy),
                    UpdatedAt = CURRENT_TIMESTAMP
                """,
                (os_id, ano, payload, draft.source_hash, ponto, ponto),
            )
        ]
    )
    return get_sequencia_producao(ano, os_id)


def _resolve_sefoc_folder(ano: int, os_id: int) -> Path:
    from routers.os_routes import _fetch_os_folder_meta, _resolve_os_root_path
    from services.os_folder_structure import ensure_os_folder_on_network

    root = _resolve_os_root_path(ano, os_id)
    if not root:
        meta = _fetch_os_folder_meta(ano, os_id)
        created_path, _ = ensure_os_folder_on_network(
            nr_os=os_id,
            ano=ano,
            solicitante=meta["folder_solicitante"],
            produto=meta["produto"],
        )
        root = created_path
    sefoc = Path(root) / "Sefoc"
    sefoc.mkdir(parents=True, exist_ok=True)
    return sefoc


def create_sequencia_docx(
    ano: int,
    os_id: int,
    draft: SequenciaDraft | None = None,
    *,
    ponto: str | None = None,
    overwrite: bool = True,
) -> tuple[Path, SequenciaResponse]:
    if draft is None:
        draft = get_sequencia_producao(ano, os_id).draft
    if draft.os.numero != os_id or draft.os.ano != ano:
        raise ValueError("Rascunho não corresponde à OS informada.")

    folder = _resolve_sefoc_folder(ano, os_id)
    target = folder / _docx_filename(ano, os_id)
    if target.exists() and not overwrite:
        raise FileExistsError("DOCX já existe na pasta Sefoc.")

    write_sequencia_docx(draft, target)
    save_sequencia_producao(ano, os_id, draft, ponto=ponto)
    db.execute_transaction(
        [
            (
                """
                UPDATE tabOsSequenciaProducao
                SET DocxPath = %s, DocxGeneratedAt = %s, UpdatedBy = %s
                WHERE NroProtocolo = %s AND AnoProtocolo = %s
                """,
                (str(target), datetime.now(), ponto, os_id, ano),
            )
        ]
    )
    return target, get_sequencia_producao(ano, os_id)


def get_sequencia_docx_path(ano: int, os_id: int) -> Path:
    saved = _saved_row(ano, os_id)
    path = Path(str(saved.get("DocxPath"))) if saved and saved.get("DocxPath") else _resolve_sefoc_folder(ano, os_id) / _docx_filename(ano, os_id)
    if not path.exists():
        raise FileNotFoundError("DOCX de sequência de produção ainda não foi gerado.")
    return path

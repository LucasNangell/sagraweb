"""Listagem e resolução segura de PDFs de prova na pasta Sefoc da OS."""
from __future__ import annotations

import glob
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

_INVALID_PROOF_NAME = re.compile(r"[/\\]|\.\.")

_MAX_FILENAME_LEN = 512


def _max_attachment_bytes() -> int:
    raw = (os.environ.get("SAGRA_EMAIL_ATTACHMENT_MAX_MB") or "50").strip()
    try:
        mb = max(1, int(raw))
    except ValueError:
        mb = 50
    return mb * 1024 * 1024


def validate_proof_pdf_size(pdf_path: str) -> None:
    """Bloqueia anexo acima do limite configurável (padrão 50 MB)."""
    try:
        size = os.path.getsize(pdf_path)
    except OSError as exc:
        raise HTTPException(
            status_code=400,
            detail="Não foi possível ler o tamanho do PDF de prova.",
        ) from exc
    limit = _max_attachment_bytes()
    if size > limit:
        mb = limit // (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"O PDF de prova excede o limite de {mb} MB para anexo em e-mail.",
        )


def validate_proof_filename(filename: str) -> str:
    """Valida caminho relativo dentro de Sefoc (ex.: prova.pdf ou Offset/prova.pdf)."""
    raw = (filename or "").strip().replace("\\", "/")
    if not raw or raw in (".", ".."):
        raise HTTPException(status_code=400, detail="Nome de arquivo de prova inválido.")
    parts = [part for part in raw.split("/") if part and part != "."]
    if not parts or ".." in parts:
        raise HTTPException(status_code=400, detail="Nome de arquivo de prova inválido.")
    for part in parts:
        if _INVALID_PROOF_NAME.search(part) or part != os.path.basename(part):
            raise HTTPException(status_code=400, detail="Nome de arquivo de prova inválido.")
        if len(part) > _MAX_FILENAME_LEN:
            raise HTTPException(status_code=400, detail="Nome de arquivo de prova inválido.")
    if not parts[-1].lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="O arquivo de prova deve ser um PDF.")
    return "/".join(parts)


def _get_os_folder_path(ano: int, os_id: int) -> Optional[str]:
    from routers.email_routes import _get_os_folder_path

    return _get_os_folder_path(ano, os_id)


def _sefoc_dir(ano: int, os_id: int) -> Optional[str]:
    os_path = _get_os_folder_path(ano, os_id)
    if not os_path:
        return None
    sefoc_path = os.path.join(os_path, "Sefoc")
    if not os.path.isdir(sefoc_path):
        return None
    return sefoc_path


def _is_path_under_dir(candidate: str, directory: str) -> bool:
    try:
        real_candidate = os.path.realpath(candidate)
        real_dir = os.path.realpath(directory)
        if not real_dir.endswith(os.sep):
            real_dir = real_dir + os.sep
        return real_candidate.startswith(real_dir)
    except OSError:
        return False


def resolve_proof_pdf_path(ano: int, os_id: int, filename: str) -> str:
    """Resolve caminho físico do PDF de prova dentro de Sefoc/ (somente backend)."""
    safe_name = validate_proof_filename(filename)
    sefoc_path = _sefoc_dir(ano, os_id)
    if not sefoc_path:
        raise HTTPException(
            status_code=404,
            detail="Pasta Sefoc da OS não encontrada ou sem PDFs de prova.",
        )
    full_path = os.path.normpath(os.path.join(sefoc_path, *safe_name.split("/")))
    if not _is_path_under_dir(full_path, sefoc_path):
        raise HTTPException(status_code=400, detail="Nome de arquivo de prova inválido.")
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="PDF de prova não encontrado na pasta Sefoc.")
    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="O arquivo de prova deve ser um PDF.")
    return full_path


def list_proof_pdf_files(ano: int, os_id: int) -> dict[str, Any]:
    """Lista metadados seguros dos PDFs em Sefoc/ (sem caminho UNC)."""
    sefoc_path = _sefoc_dir(ano, os_id)
    files: list[dict[str, Any]] = []
    suggested: Optional[str] = None
    latest_mtime = -1.0

    if sefoc_path:
        pattern = os.path.join(sefoc_path, "*.pdf")
        for pdf_path in glob.glob(pattern):
            if not os.path.isfile(pdf_path):
                continue
            name = os.path.basename(pdf_path)
            try:
                stat = os.stat(pdf_path)
                mtime = stat.st_mtime
                modified_at = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                size = stat.st_size
            except OSError:
                modified_at = None
                mtime = 0.0
                size = 0
            files.append(
                {
                    "name": name,
                    "size": size,
                    "modified_at": modified_at,
                }
            )
            if mtime > latest_mtime:
                latest_mtime = mtime
                suggested = name

    files.sort(key=lambda item: item["name"].lower())

    return {
        "os": os_id,
        "ano": ano,
        "files": files,
        "suggested": suggested,
    }


def latest_proof_pdf_path(ano: int, os_id: int) -> Optional[str]:
    """Fallback legado: PDF mais recente em Sefoc/ (tokens antigos sem ArquivoProva)."""
    sefoc_path = _sefoc_dir(ano, os_id)
    if not sefoc_path:
        return None
    pdfs = glob.glob(os.path.join(sefoc_path, "*.pdf"))
    if not pdfs:
        return None
    return max(pdfs, key=os.path.getmtime)


_TIMBRADO_COR_RE = re.compile(r"timbradoa4digital-cor\.docx$", re.IGNORECASE)
_TIMBRADO_PB_RE = re.compile(r"timbradoa4digital-pb\.docx$", re.IGNORECASE)


def validate_attachment_file_size(path: str, *, label: str = "arquivo") -> None:
    """Bloqueia anexo acima do limite configurável (padrão 50 MB)."""
    try:
        size = os.path.getsize(path)
    except OSError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Não foi possível ler o tamanho do {label}.",
        ) from exc
    limit = _max_attachment_bytes()
    if size > limit:
        mb = limit // (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"O {label} excede o limite de {mb} MB para anexo em e-mail.",
        )


def resolve_timbrado_digital_docx_paths(ano: int, os_id: int) -> dict[str, Any]:
    """
    Localiza os DOCX Cor/PB do Timbrado A4 Digital em Sefoc/.

    Prefere o par mais recente (por mtime do Cor, com PB correspondente).
    """
    sefoc_path = _sefoc_dir(ano, os_id)
    if not sefoc_path:
        raise HTTPException(
            status_code=404,
            detail="Pasta Sefoc da OS não encontrada.",
        )

    cor_candidates: list[tuple[float, str]] = []
    pb_by_prefix: dict[str, str] = {}

    for path in glob.glob(os.path.join(sefoc_path, "*.docx")):
        if not os.path.isfile(path):
            continue
        name = os.path.basename(path)
        if not _is_path_under_dir(path, sefoc_path):
            continue
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            mtime = 0.0
        lower = name.lower()
        if _TIMBRADO_COR_RE.search(lower):
            cor_candidates.append((mtime, path))
        elif _TIMBRADO_PB_RE.search(lower):
            # prefixo até -TimbradoA4Digital
            idx = lower.rfind("-timbradoa4digital-")
            prefix = name[:idx] if idx >= 0 else name
            pb_by_prefix[prefix.lower()] = path

    if not cor_candidates:
        raise HTTPException(
            status_code=404,
            detail="DOCX Timbrado A4 Digital (Cor) não encontrado na pasta Sefoc.",
        )

    cor_candidates.sort(key=lambda item: item[0], reverse=True)
    chosen_cor = None
    chosen_pb = None
    for _mtime, cor_path in cor_candidates:
        cor_name = os.path.basename(cor_path)
        lower = cor_name.lower()
        idx = lower.rfind("-timbradoa4digital-")
        prefix = cor_name[:idx] if idx >= 0 else cor_name
        pb_path = pb_by_prefix.get(prefix.lower())
        if pb_path and os.path.isfile(pb_path):
            chosen_cor = cor_path
            chosen_pb = pb_path
            break

    if not chosen_cor or not chosen_pb:
        # fallback: Cor mais recente + qualquer PB mais recente
        chosen_cor = cor_candidates[0][1]
        pb_all = [
            (os.path.getmtime(p), p)
            for p in pb_by_prefix.values()
            if os.path.isfile(p)
        ]
        if not pb_all:
            raise HTTPException(
                status_code=404,
                detail="DOCX Timbrado A4 Digital (PB) não encontrado na pasta Sefoc.",
            )
        pb_all.sort(key=lambda item: item[0], reverse=True)
        chosen_pb = pb_all[0][1]

    validate_attachment_file_size(chosen_cor, label="DOCX Cor")
    validate_attachment_file_size(chosen_pb, label="DOCX PB")

    return {
        "cor_path": chosen_cor,
        "pb_path": chosen_pb,
        "cor_name": os.path.basename(chosen_cor),
        "pb_name": os.path.basename(chosen_pb),
        "files": [
            {"name": os.path.basename(chosen_cor), "role": "cor"},
            {"name": os.path.basename(chosen_pb), "role": "pb"},
        ],
    }


def resolve_proof_pdf_for_token_row(
    proof_row: dict,
    ano: int,
    os_id: int,
) -> tuple[Optional[str], str]:
    """
    Retorna (caminho_físico, nome_exibição).
    Token de Prova WEB resolve pelo registro tabProvaWeb; caso contrário usa
    ArquivoProva do token e, na ausência dele, o fallback legado (latest).
    """
    if (proof_row.get("TipoProva") or "").strip() == "prova_web":
        from services.prova_web_record_service import resolve_prova_web_pdf

        return resolve_prova_web_pdf(ano, os_id)

    arquivo = (proof_row.get("ArquivoProva") or "").strip()
    if arquivo:
        try:
            path = resolve_proof_pdf_path(ano, os_id, arquivo)
            return path, os.path.basename(arquivo)
        except HTTPException:
            return None, arquivo
    legacy = latest_proof_pdf_path(ano, os_id)
    if legacy:
        return legacy, os.path.basename(legacy)
    return None, ""

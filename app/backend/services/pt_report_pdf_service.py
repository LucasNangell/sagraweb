"""Gera PDF consolidado dos problemas técnicos na pasta Sefoc/AdminDocs da OS."""
from __future__ import annotations

import io
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


def _version_number_label(versao: Optional[str]) -> str:
    return (
        (versao or "")
        .lower()
        .replace("original", "")
        .replace("v", "")
        .replace("(", "")
        .replace(")", "")
        .strip()
    )


def analysis_pdf_filename(versao: Optional[str]) -> str:
    ver_clean = _version_number_label(versao)
    if ver_clean:
        return f"Análise v{ver_clean}.pdf"
    return "Análise.pdf"


def _build_pdf_html_document(prepared_inner_html: str) -> str:
    return (
        '<!DOCTYPE html><html lang="pt-BR"><head>'
        '<meta charset="utf-8"/>'
        f"</head><body>{prepared_inner_html}</body></html>"
    )


def html_to_pdf_bytes(html_document: str) -> bytes:
    import fitz

    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)
    mediabox = fitz.paper_rect("a4")
    story = fitz.Story(html=html_document)
    more = 1
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(mediabox)
        story.draw(dev)
        writer.end_page()
    writer.close()
    return buf.getvalue()


def resolve_admin_docs_dir(ano: int, os_id: int) -> Optional[str]:
    from routers.os_routes import _get_os_folder_path

    os_folder = _get_os_folder_path(ano, os_id)
    if not os_folder or not os.path.isdir(os_folder):
        return None
    admin_docs = os.path.join(os_folder, "Sefoc", "AdminDocs")
    os.makedirs(admin_docs, exist_ok=True)
    return admin_docs


def save_pt_consolidated_pdf(
    ano: int,
    os_id: int,
    inner_html: str,
    *,
    versao: Optional[str] = None,
) -> Optional[str]:
    """
    Gera PDF com todos os problemas técnicos (mesmo HTML do e-mail inline)
    e salva em Sefoc/AdminDocs. Retorna caminho do arquivo ou None em falha.
    """
    admin_docs = resolve_admin_docs_dir(ano, os_id)
    if not admin_docs:
        logger.warning("PDF PT não salvo: pasta da OS não encontrada (%s/%s)", os_id, ano)
        return None

    filename = analysis_pdf_filename(versao)
    dest_path = os.path.join(admin_docs, filename)

    if not (inner_html or "").strip():
        logger.info("PDF PT não gerado: HTML consolidado vazio (OS %s/%s)", os_id, ano)
        if os.path.isfile(dest_path):
            try:
                os.remove(dest_path)
                logger.info("PDF PT removido (sem itens): %s", dest_path)
            except OSError as exc:
                logger.warning("Falha ao remover PDF PT vazio em %s: %s", dest_path, exc)
        return None

    from services.pt_report_html_service import (
        embed_indication_images_for_pdf,
        prepare_pt_inline_email_inner_html,
    )

    prepared = prepare_pt_inline_email_inner_html(inner_html)
    prepared = embed_indication_images_for_pdf(prepared)
    document = _build_pdf_html_document(prepared)

    try:
        pdf_bytes = html_to_pdf_bytes(document)
    except Exception as exc:
        logger.error("Falha ao converter HTML em PDF (OS %s/%s): %s", os_id, ano, exc)
        return None

    try:
        with open(dest_path, "wb") as handle:
            handle.write(pdf_bytes)
    except OSError as exc:
        logger.error("Falha ao gravar PDF PT em %s: %s", dest_path, exc)
        return None

    logger.info("PDF PT consolidado salvo: %s", dest_path)
    return dest_path


def refresh_pt_analysis_pdf(
    ano: int,
    os_id: int,
    *,
    versao: Optional[str] = None,
    id_analise: Optional[int] = None,
    inner_html: Optional[str] = None,
) -> Optional[str]:
    """Reconstrói (ou recebe) o HTML consolidado e grava o PDF em AdminDocs."""
    resolved_versao = (versao or "").strip() or None
    if not resolved_versao:
        from database import db

        if id_analise is not None:
            rows = db.execute_query(
                "SELECT Versao FROM tabAnalises WHERE ID = %s LIMIT 1",
                (id_analise,),
            )
        else:
            rows = db.execute_query(
                "SELECT Versao FROM tabAnalises WHERE OS = %s AND Ano = %s LIMIT 1",
                (os_id, ano),
            )
        if rows and (rows[0].get("Versao") or "").strip():
            resolved_versao = str(rows[0]["Versao"]).strip()

    if inner_html is None:
        from routers.analise_routes import build_consolidated_pt_inner_html

        inner_html = build_consolidated_pt_inner_html(
            ano,
            os_id,
            versao=resolved_versao,
            id_analise=id_analise,
        )

    return save_pt_consolidated_pdf(
        ano,
        os_id,
        inner_html or "",
        versao=resolved_versao,
    )

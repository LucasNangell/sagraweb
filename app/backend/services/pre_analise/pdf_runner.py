"""Abertura/fechamento de PDFs para verificações de pré-análise."""
from __future__ import annotations

import os
from typing import Any, List, Optional, Tuple

from services.pre_analise.pdf_deep import iter_pdf_paths, require_fitz


def open_folder_pdfs(
    folder_path: str, context: Any = None
) -> Tuple[str | None, List[Tuple[str, Any]]]:
    if context is not None:
        from services.pre_analise.folder_session import attach_session

        sess = attach_session(context)
        return sess.open_docs()
    err = require_fitz()
    if err:
        return err, []
    docs: List[Tuple[str, Any]] = []
    for path in iter_pdf_paths(folder_path):
        try:
            import fitz

            docs.append((path, fitz.open(path)))
        except Exception as exc:
            docs.append((path, exc))
    return None, docs


def close_docs(docs: List[Tuple[str, Any]], context: Any = None) -> None:
    if context is not None:
        from services.pre_analise.folder_session import is_shared_docs

        if is_shared_docs(context, docs):
            return
    import fitz

    for _, item in docs:
        if isinstance(item, fitz.Document):
            try:
                item.close()
            except Exception:
                pass


def basename(path: str) -> str:
    return os.path.basename(path)


def session_has_open_docs(context: Any) -> bool:
    """True se o contexto já tem PDFs abertos na sessão compartilhada."""
    sess = getattr(context, "pdf_session", None)
    return sess is not None and bool(getattr(sess, "_docs_open", False))

"""
Cache de PDFs abertos e metadados por pasta — evita reabrir arquivos na rede a cada verificação.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from services.pre_analise.pdf_utils import list_pdfs, pdf_info

logger = logging.getLogger(__name__)

SESSION_TTL_SEC = 120.0
_lock = threading.Lock()
_sessions: Dict[str, "FolderPdfSession"] = {}


def folder_fingerprint(folder_path: str) -> str:
    parts: List[str] = []
    for name in list_pdfs(folder_path):
        path = os.path.join(folder_path, name)
        try:
            parts.append(f"{name}:{int(os.path.getmtime(path))}")
        except OSError:
            parts.append(name)
    return "|".join(parts) or "empty"


@dataclass
class FolderPdfSession:
    folder_path: str
    fingerprint: str
    pdf_names: List[str] = field(default_factory=list)
    pdf_infos: List[Dict[str, Any]] = field(default_factory=list)
    docs: List[Tuple[str, Any]] = field(default_factory=list)
    _infos_loaded: bool = False
    _docs_open: bool = False
    last_used: float = field(default_factory=time.time)

    def touch(self) -> None:
        self.last_used = time.time()

    def load_pdf_infos(self) -> List[Dict[str, Any]]:
        if not self._infos_loaded:
            if self._docs_open and self.docs:
                from services.pre_analise.pdf_utils import pdf_infos_from_open_docs

                self.pdf_infos = pdf_infos_from_open_docs(self.docs)
            else:
                self.pdf_infos = [
                    pdf_info(os.path.join(self.folder_path, name))
                    for name in self.pdf_names
                ]
            self._infos_loaded = True
        return self.pdf_infos

    def open_docs(self) -> Tuple[Optional[str], List[Tuple[str, Any]]]:
        from services.pre_analise.pdf_deep import require_fitz

        err = require_fitz()
        if err:
            return err, []
        if not self._docs_open:
            from services.pre_analise.pdf_deep import iter_pdf_paths

            opened: List[Tuple[str, Any]] = []
            for path in iter_pdf_paths(self.folder_path):
                try:
                    import fitz

                    opened.append((path, fitz.open(path)))
                except Exception as exc:
                    opened.append((path, exc))
            self.docs = opened
            self._docs_open = True
        return None, self.docs

    def close(self) -> None:
        if not self._docs_open:
            return
        import fitz

        for _, item in self.docs:
            if isinstance(item, fitz.Document):
                try:
                    item.close()
                except Exception:
                    pass
        self.docs = []
        self._docs_open = False


def _evict_expired() -> None:
    now = time.time()
    stale = [k for k, s in _sessions.items() if now - s.last_used > SESSION_TTL_SEC]
    for key in stale:
        sess = _sessions.pop(key, None)
        if sess:
            sess.close()


def acquire_session(folder_path: str) -> FolderPdfSession:
    fp = folder_fingerprint(folder_path)
    with _lock:
        _evict_expired()
        sess = _sessions.get(folder_path)
        if sess is not None and sess.fingerprint == fp:
            sess.touch()
            return sess
        if sess is not None:
            sess.close()
        names = list_pdfs(folder_path)
        sess = FolderPdfSession(
            folder_path=folder_path,
            fingerprint=fp,
            pdf_names=names,
        )
        _sessions[folder_path] = sess
        return sess


def release_session(folder_path: str) -> None:
    with _lock:
        sess = _sessions.pop(folder_path, None)
    if sess:
        sess.close()


def attach_session(context: Any) -> FolderPdfSession:
    """Associa sessão ao contexto da pré-análise (cria ou reutiliza)."""
    sess = acquire_session(context.folder_path)
    context.pdf_session = sess
    return sess


def get_pdf_infos(context: Any) -> Tuple[List[str], List[Dict[str, Any]]]:
    sess = context.pdf_session or attach_session(context)
    sess.touch()
    return sess.pdf_names, sess.load_pdf_infos()


def is_shared_docs(context: Any, docs: List[Tuple[str, Any]]) -> bool:
    sess = getattr(context, "pdf_session", None)
    return sess is not None and sess.docs is docs and sess._docs_open

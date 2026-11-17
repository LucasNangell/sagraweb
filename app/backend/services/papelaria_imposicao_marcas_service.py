"""PDFs de marcas da imposição guardados no servidor.

O arquivo enviado pelo usuário fica em ``storage/papelaria_imposicao_marcas``
(pasta persistente entre releases — junction para ``shared\\storage``). O
perfil guarda só o NOME do arquivo (não o caminho absoluto, que muda a cada
release). Na geração, o PDF é copiado para a pasta da OS na rede, e o JDF
aponta para essa cópia: o Apogee não precisa enxergar o disco do servidor.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import unicodedata
from pathlib import Path
from typing import Any, Optional

#: Limite do upload (PDFs de marcas costumam ter poucos MB).
MAX_BYTES = 60 * 1024 * 1024
_SUBDIR = "papelaria_imposicao_marcas"
_NOME_RE = re.compile(r"^[0-9a-f]{16}_[A-Za-z0-9._-]{1,120}\.pdf$")


def storage_dir(create: bool = True) -> Path:
    from config_manager import PROJECT_ROOT

    path = Path(PROJECT_ROOT) / "storage" / _SUBDIR
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def _nome_seguro(original: str) -> str:
    base = os.path.splitext(os.path.basename((original or "").replace("\\", "/")))[0]
    base = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._-") or "marcas"
    return base[:100]


def validar_nome_arquivo(arquivo: str) -> str:
    nome = str(arquivo or "").strip()
    if not _NOME_RE.match(nome):
        raise ValueError("Arquivo de marcas inválido.")
    return nome


def resolver_arquivo(arquivo: str) -> str:
    """Caminho absoluto (no servidor) de um PDF de marcas guardado."""
    nome = validar_nome_arquivo(arquivo)
    path = (storage_dir(create=False) / nome).resolve()
    root = storage_dir(create=False).resolve()
    if path.parent != root:
        raise ValueError("Arquivo de marcas inválido.")
    return str(path)


def _info_pdf(path: str) -> dict[str, Any]:
    from services.papelaria_imposicao_perfil_service import read_pdf_info

    return read_pdf_info(path)


def _gravar(conteudo: bytes, nome_original: str) -> dict[str, Any]:
    if not conteudo:
        raise ValueError("Arquivo vazio.")
    if len(conteudo) > MAX_BYTES:
        raise ValueError(f"PDF de marcas maior que {MAX_BYTES // (1024 * 1024)} MB.")
    if not conteudo.lstrip()[:5].startswith(b"%PDF"):
        raise ValueError("O arquivo enviado não é um PDF.")
    sha = hashlib.sha256(conteudo).hexdigest()
    nome = f"{sha[:16]}_{_nome_seguro(nome_original)}.pdf"
    destino = storage_dir() / nome
    if not destino.is_file():
        tmp = destino.with_suffix(".tmp")
        tmp.write_bytes(conteudo)
        os.replace(tmp, destino)
    info = _info_pdf(str(destino))
    if not info.get("existe") or int(info.get("paginas") or 0) < 1:
        try:
            destino.unlink()
        except OSError:
            pass
        raise ValueError(info.get("erro") or "PDF de marcas sem páginas ou ilegível.")
    return {
        "arquivo": nome,
        "nome_original": os.path.basename((nome_original or "").replace("\\", "/")) or nome,
        "sha256": sha,
        "bytes": len(conteudo),
        "paginas": info.get("paginas"),
        "largura_mm": info.get("largura_mm"),
        "altura_mm": info.get("altura_mm"),
    }


def salvar_upload(conteudo: bytes, nome_original: str) -> dict[str, Any]:
    """Grava o PDF enviado pela tela (deduplica pelo conteúdo)."""
    return _gravar(conteudo, nome_original)


def importar_de_caminho(path: str) -> dict[str, Any]:
    """Copia para o servidor um PDF que hoje é referenciado por caminho de rede."""
    src = str(path or "").strip()
    if not src.lower().endswith(".pdf"):
        raise ValueError("O caminho deve apontar para um arquivo .pdf.")
    if not os.path.isfile(src):
        raise FileNotFoundError(f"PDF não encontrado pelo servidor: {src}")
    size = os.path.getsize(src)
    if size > MAX_BYTES:
        raise ValueError(f"PDF de marcas maior que {MAX_BYTES // (1024 * 1024)} MB.")
    with open(src, "rb") as fh:
        conteudo = fh.read()
    return _gravar(conteudo, os.path.basename(src))


def info_arquivo(arquivo: str) -> dict[str, Any]:
    path = resolver_arquivo(arquivo)
    info = _info_pdf(path)
    info["arquivo"] = validar_nome_arquivo(arquivo)
    info["path"] = None  # não expõe o caminho interno do servidor
    return info


def copiar_para_pasta(arquivo: str, destino_dir: str, nome_destino: str) -> str:
    """Copia o PDF guardado para a pasta da OS (rede) e devolve o caminho."""
    src = resolver_arquivo(arquivo)
    if not os.path.isfile(src):
        raise FileNotFoundError("PDF de marcas não está mais no servidor. Envie o arquivo de novo.")
    os.makedirs(destino_dir, exist_ok=True)
    dest = os.path.normpath(os.path.join(destino_dir, nome_destino))
    shutil.copyfile(src, dest)
    return dest


def sha256_arquivo(path: str) -> Optional[str]:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None

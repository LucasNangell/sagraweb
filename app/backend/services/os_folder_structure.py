"""
Estrutura de pastas da OS na rede (padrão CGraf / Sefoc).

Mesma regra do serviço local folder_opener_service.py (porta 5566).
"""
from __future__ import annotations

import logging
import os
import re
import unicodedata
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

DFS_ROOT = r"\\redecamara\DfsData"

OS_FOLDER_SUBFOLDERS = (
    "Original",
    "Sefoc",
    "Sefoc/Offset",
    "Sefoc/Digital",
    "Sefoc/AdminDocs",
)


def normalize_text_custom(text: str, *, is_product: bool = False) -> str:
    if not text:
        return ""
    s = str(text).strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    if is_product:
        s = re.sub(r"[^A-Za-z0-9]", "", s)
    else:
        s = s.replace(".", "")
        s = re.sub(r"\s+", "", s)
    return s.title()


def compute_os_folder_name(
    nr_os: int,
    solicitante: str,
    produto: str,
    titulo: str = "",
) -> str:
    base = (
        f"{int(nr_os):05d}-"
        f"{normalize_text_custom(solicitante)}-"
        f"{normalize_text_custom(produto, is_product=True)}"
    )
    titulo_snip = normalize_text_custom(titulo or "")[:5]
    if titulo_snip:
        return f"{base}_{titulo_snip}"
    return base


def get_deputados_base_path(ano: int, nr_os: int) -> str:
    year = int(ano)
    if int(nr_os) >= 5000:
        return os.path.join(
            DFS_ROOT,
            "CGraf",
            "Sefoc",
            "Deputados",
            str(year),
            f"Deputados_Papelaria_{year}",
        )
    return os.path.join(
        DFS_ROOT,
        "CGraf",
        "Sefoc",
        "Deputados",
        str(year),
        f"Deputados_{year}",
    )


def create_folder_structure(base_path: str, folder_name: str) -> Tuple[bool, Optional[str], str]:
    try:
        main_folder = Path(base_path) / folder_name
        subfolders = [main_folder]
        for rel in OS_FOLDER_SUBFOLDERS:
            subfolders.append(main_folder / rel.replace("/", os.sep))
        for folder in subfolders:
            folder.mkdir(parents=True, exist_ok=True)
            logger.info("Pasta OS verificada/criada: %s", folder)
        return True, str(main_folder), "OK"
    except Exception as exc:
        msg = f"Erro ao criar estrutura de pastas: {exc}"
        logger.error(msg)
        return False, None, msg


def ensure_os_folder_on_network(
    *,
    nr_os: int,
    ano: int,
    solicitante: str,
    produto: str,
    titulo: str = "",
) -> Tuple[str, str]:
    """
    Garante pasta da OS na rede. Retorna (caminho_absoluto_pasta_os, nome_pasta).
    """
    folder_name = compute_os_folder_name(nr_os, solicitante, produto, titulo)
    base_path = get_deputados_base_path(ano, nr_os)

    from routers.os_routes import _get_os_folder_path

    existing = _get_os_folder_path(ano, nr_os)
    if existing and os.path.isdir(existing):
        return existing, os.path.basename(existing.rstrip("\\/"))

    if not os.path.exists(DFS_ROOT):
        local_test = os.path.abspath(
            os.path.join("storage_test", str(ano), str(nr_os), folder_name)
        )
        os.makedirs(os.path.join(local_test, "Original"), exist_ok=True)
        os.makedirs(os.path.join(local_test, "Sefoc"), exist_ok=True)
        logger.warning(
            "DFS indisponível; pasta de teste local para OS %s/%s: %s",
            nr_os,
            ano,
            local_test,
        )
        return local_test, folder_name

    ok, path_res, err = create_folder_structure(base_path, folder_name)
    if not ok or not path_res:
        raise RuntimeError(err or "Falha ao criar pasta da OS na rede.")
    return path_res, folder_name


def resolve_initial_original_dir(target_os_dir: str) -> Tuple[str, str]:
    """Pasta Original inicial (v1) para arquivos de abertura da OS."""
    from routers.analise_routes import _list_original_folders

    originals = _list_original_folders(target_os_dir)
    if originals:
        name = originals[0]
        return os.path.join(target_os_dir, name), name

    final_dir = os.path.join(target_os_dir, "Original")
    os.makedirs(final_dir, exist_ok=True)
    return final_dir, "Original"


def plan_os_folder(
    *,
    nr_os: int,
    ano: int,
    solicitante: str,
    produto: str,
    titulo: str = "",
) -> dict:
    """Plano de nomenclatura e subpastas (sem criar na rede)."""
    folder_name = compute_os_folder_name(nr_os, solicitante, produto, titulo)
    base_path = get_deputados_base_path(ano, nr_os)

    from routers.os_routes import _get_os_folder_path

    existing = _get_os_folder_path(ano, nr_os)
    exists = bool(existing and os.path.isdir(existing))
    full_path = existing if exists else os.path.join(base_path, folder_name)

    return {
        "exists": exists,
        "folder_name": folder_name,
        "base_path": base_path,
        "full_path": full_path,
        "subfolders": list(OS_FOLDER_SUBFOLDERS),
        "solicitante": solicitante,
        "produto": produto,
        "titulo": titulo,
    }

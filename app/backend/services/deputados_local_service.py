"""
Cadastro local de deputados (tabdadosdeputados) importado de deputado.xls.

Fonte primária para e-mails dep./gab.; a API da Câmara é apenas fallback.
"""
from __future__ import annotations

import logging
import os
import time
import unicodedata
from pathlib import Path
from typing import Any

from database import db
from services.deputados_camara_service import resolver_emails_deputado

logger = logging.getLogger(__name__)

_local_rows_cache: list[dict[str, Any]] | None = None
_local_rows_cache_at: float = 0.0
_LOCAL_ROWS_CACHE_TTL_SEC = 300


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _default_xls_path() -> Path:
    env_path = (os.getenv("SAGRA_DEPUTADOS_XLS_PATH") or "").strip()
    if env_path:
        return Path(env_path)
    return _repo_root() / "deputado.xls"


def normalizar_nome_busca(txt: str) -> str:
    if not txt:
        return ""
    text = unicodedata.normalize("NFD", str(txt))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return " ".join(text.lower().split())


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _ler_linhas_xls(path: Path) -> list[dict[str, str]]:
    import xlrd

    workbook = xlrd.open_workbook(str(path))
    sheet = workbook.sheet_by_index(0)
    if sheet.nrows < 2:
        return []

    headers = [_as_str(sheet.cell_value(0, col)) for col in range(sheet.ncols)]
    header_map = {header.casefold(): idx for idx, header in enumerate(headers)}

    def col(*nomes: str) -> int | None:
        for nome in nomes:
            idx = header_map.get(nome.casefold())
            if idx is not None:
                return idx
        return None

    idx_nome = col("nome parlamentar")
    idx_email = col("correio eletronico", "correio eletrônico")
    idx_nome_sem = col("nome sem acento")
    if idx_nome is None or idx_email is None:
        raise ValueError("Planilha deputado.xls sem colunas obrigatórias (Nome Parlamentar / Correio Eletrônico)")

    idx_partido = col("partido")
    idx_uf = col("uf")
    idx_anexo = col("anexo")
    idx_gabinete = col("gabinete")
    idx_tel = col("telefone")
    idx_fax = col("fax")

    rows: list[dict[str, str]] = []
    for row_idx in range(1, sheet.nrows):
        nome = _as_str(sheet.cell_value(row_idx, idx_nome))
        email_dep = _as_str(sheet.cell_value(row_idx, idx_email)).lower()
        if not nome or not email_dep:
            continue

        email_gab = ""
        if email_dep.startswith("dep."):
            email_gab = f"gab.{email_dep[4:]}"
        elif email_dep.startswith("gab."):
            email_gab = email_dep
            email_dep = f"dep.{email_dep[4:]}"
        else:
            email_dep, email_gab = resolver_emails_deputado(email_dep)

        nome_sem = _as_str(sheet.cell_value(row_idx, idx_nome_sem)) if idx_nome_sem is not None else nome

        rows.append(
            {
                "nome_parlamentar": nome,
                "partido": _as_str(sheet.cell_value(row_idx, idx_partido)) if idx_partido is not None else "",
                "uf": _as_str(sheet.cell_value(row_idx, idx_uf)) if idx_uf is not None else "",
                "anexo": _as_str(sheet.cell_value(row_idx, idx_anexo)) if idx_anexo is not None else "",
                "gabinete": _as_str(sheet.cell_value(row_idx, idx_gabinete)) if idx_gabinete is not None else "",
                "telefone_1": _as_str(sheet.cell_value(row_idx, idx_tel)) if idx_tel is not None else "",
                "telefone_2": _as_str(sheet.cell_value(row_idx, idx_fax)) if idx_fax is not None else "",
                "email_dep": email_dep,
                "email_gab": email_gab,
                "nome_sem_acento": nome_sem,
            }
        )
    return rows


def importar_deputados_xls(path: str | Path | None = None, *, force: bool = False) -> int:
    """Importa deputado.xls para tabdadosdeputados. Retorna quantidade importada."""
    global _local_rows_cache, _local_rows_cache_at

    xls_path = Path(path) if path else _default_xls_path()
    if not xls_path.is_file():
        logger.warning("Arquivo de deputados não encontrado: %s", xls_path)
        return 0

    if not force:
        count_rows = db.execute_query("SELECT COUNT(*) AS total FROM tabdadosdeputados")
        total = int((count_rows or [{}])[0].get("total") or 0)
        if total > 0:
            return total

    linhas = _ler_linhas_xls(xls_path)
    if not linhas:
        logger.warning("Nenhuma linha válida em %s", xls_path)
        return 0

    db.execute_query("DELETE FROM tabdadosdeputados")
    for row in linhas:
        db.execute_query(
            """
            INSERT INTO tabdadosdeputados (
                nome_parlamentar, partido, uf, anexo, gabinete,
                telefone_1, telefone_2, email_dep, email_gab, nome_sem_acento
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                row["nome_parlamentar"],
                row["partido"],
                row["uf"],
                row["anexo"],
                row["gabinete"],
                row["telefone_1"],
                row["telefone_2"],
                row["email_dep"],
                row["email_gab"],
                row["nome_sem_acento"],
            ),
        )

    _local_rows_cache = None
    _local_rows_cache_at = 0.0
    logger.info("Importados %s deputados de %s para tabdadosdeputados", len(linhas), xls_path)
    return len(linhas)


def _carregar_deputados_locais() -> list[dict[str, Any]]:
    global _local_rows_cache, _local_rows_cache_at
    now = time.time()
    if (
        _local_rows_cache is not None
        and (now - _local_rows_cache_at) < _LOCAL_ROWS_CACHE_TTL_SEC
    ):
        return _local_rows_cache

    rows = db.execute_query(
        """
        SELECT nome_parlamentar, nome_sem_acento, email_dep, email_gab, gabinete, telefone_1
        FROM tabdadosdeputados
        WHERE email_dep IS NOT NULL AND email_dep <> ''
        """
    )
    _local_rows_cache = rows or []
    _local_rows_cache_at = now
    return _local_rows_cache


def buscar_emails_local(nome: str) -> dict[str, str] | None:
    """Busca e-mails dep./gab. na tabela local por nome exato normalizado."""
    nome_norm = normalizar_nome_busca(nome)
    if not nome_norm:
        return None

    for row in _carregar_deputados_locais():
        for field in ("nome_sem_acento", "nome_parlamentar"):
            candidato = normalizar_nome_busca(str(row.get(field) or ""))
            if candidato and candidato == nome_norm:
                email_dep = str(row.get("email_dep") or "").strip()
                email_gab = str(row.get("email_gab") or "").strip()
                if not email_gab and email_dep:
                    _, email_gab = resolver_emails_deputado(email_dep)
                return {
                    "email_dep": email_dep,
                    "email_gab": email_gab,
                    "ramal": str(row.get("telefone_1") or "").strip(),
                    "gabinete": str(row.get("gabinete") or "").strip(),
                }
    return None


def importar_deputados_xls_se_necessario() -> int:
    return importar_deputados_xls(force=False)

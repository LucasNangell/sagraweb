"""
Importação idempotente de tabRegistroPT (Access SAT) para tabAnalises / tabAnaliseItens.

Cada linha do Access vira um item de análise (PT registrado na OS), não um item de biblioteca.
HTML_Snapshot é gerado a partir do PDF em PTs Individuais (PyMuPDF), no padrão visual dos PTs atuais.

Uso: deploy/scripts/migrate_sat_registro_pt.py
"""
from __future__ import annotations

import glob
import logging
import os
import re
import shutil
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from config_manager import PROJECT_ROOT
from database import db
from routers.os_routes import _get_os_folder_path
from security.html_sanitize import sanitize_html_snapshot
from services.pdf_html_convert import (
    build_metadata_fallback_html,
    convert_pdf_file_to_pt_html_safe,
)

logger = logging.getLogger(__name__)

DEFAULT_SAT_ACCDB = (
    r"\\redecamara\dfsdata\cgraf\ControleDeTrabalhos\BaseDeDados - SAGRA2"
    r"\BaseDeDados - SAT\Base de dados SAT.accdb"
)

LEGACY_PT_REL_DIRS = (
    os.path.join("Sefoc", "AdminDocs", "Arquivos da Análise", "PTs Individuais"),
    os.path.join("AdminDocs", "Arquivos da Análise", "PTs Individuais"),
)

TITLE_ALIASES: Dict[str, str] = {
    "arquivo com capa e miolo juntos": "arquivo com capa e miolo juntos",
    "arquivo com capa e miolo junto s": "arquivo com capa e miolo juntos",
    "arquivo desmembrado": "arquivo desmembrado",
    "divergencias na op": "divergencias na op",
    "editoracao com problemas - paginacao fora de padrao": "editoracao com problemas - paginacao fora de padrao",
    "cores - textos pretos configurad os em quatro cores": "cores - textos pretos configurados em quatro cores",
    "editoracao com pro blemas": "editoracao com problemas",
    "fontes em tamanho e espessura inadequada para leitura": "fontes em tamanho e espessura inadequada para leitura",
    "acabamento - dobras com medidas inadequadas": "acabamento - dobras com medidas inadequadas",
    "divergencias na os (correcao pela sefoc)": "divergencias na op",
}

TRACKING_DDL = """
CREATE TABLE IF NOT EXISTS `tabMigracaoSatRegistroPT` (
  `SatCodigo` int NOT NULL,
  `ID_AnaliseItem` int NOT NULL,
  `OS` int NOT NULL,
  `Ano` int NOT NULL,
  `VersaoSat` int DEFAULT NULL,
  `ProbTecFileName` varchar(255) DEFAULT NULL,
  `Componente` varchar(100) DEFAULT NULL,
  `ProbTecTitulo` varchar(255) DEFAULT NULL,
  `PdfSourcePath` varchar(1024) DEFAULT NULL,
  `PdfStoragePath` varchar(1024) DEFAULT NULL,
  `ImportadoEm` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`SatCodigo`),
  UNIQUE KEY `uq_migracao_item` (`ID_AnaliseItem`),
  KEY `idx_migracao_os_ano` (`OS`, `Ano`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_migracao_table_checked = False
_migracao_table_exists = False


@dataclass
class MigrationStats:
    scanned: int = 0
    skipped_existing: int = 0
    skipped_invalid: int = 0
    inserted: int = 0
    pdf_converted: int = 0
    pdf_copy: int = 0
    pdf_missing: int = 0
    pdf_convert_failed: int = 0
    padrao_linked: int = 0
    errors: List[str] = field(default_factory=list)


def _norm_title(value: Optional[str]) -> str:
    text = (value or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"\s+", " ", text)
    return TITLE_ALIASES.get(text, text)


def _normalize_componente(value: Optional[str]) -> str:
    raw = (value or "").strip()
    key = raw.lower().replace(".", "").replace(" ", "")
    if key in ("arqunico", "arquivounico"):
        return "Arq. Único"
    if key == "capa":
        return "Capa"
    if key == "miolo":
        return "Miolo"
    return raw or "Outros"


def _legacy_storage_root() -> str:
    root = PROJECT_ROOT / "storage" / "legacy_sat_pt"
    root.mkdir(parents=True, exist_ok=True)
    return str(root)


def migracao_sat_table_exists() -> bool:
    """Verifica se a tabela de rastreio existe (não altera schema em runtime da API)."""
    global _migracao_table_checked, _migracao_table_exists
    if _migracao_table_checked:
        return _migracao_table_exists
    try:
        rows = db.execute_query(
            "SELECT 1 AS ok FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabMigracaoSatRegistroPT' LIMIT 1"
        )
        _migracao_table_exists = bool(rows)
    except Exception:
        _migracao_table_exists = False
    _migracao_table_checked = True
    return _migracao_table_exists


def ensure_tracking_table() -> None:
    db.execute_query(TRACKING_DDL)
    global _migracao_table_checked, _migracao_table_exists
    _migracao_table_checked = True
    _migracao_table_exists = True


def load_imported_sat_codigos() -> Set[int]:
    if not migracao_sat_table_exists():
        return set()
    rows = db.execute_query("SELECT SatCodigo FROM tabMigracaoSatRegistroPT")
    return {int(r["SatCodigo"]) for r in (rows or [])}


def load_padrao_ids_by_title() -> Dict[str, int]:
    """Vínculo opcional ID_ProblemaPadrao — nunca usado como fonte de HTML."""
    rows = db.execute_query("SELECT ID, TituloPT FROM tabProblemasPadrao")
    by_title: Dict[str, int] = {}
    for row in rows or []:
        by_title[_norm_title(row.get("TituloPT"))] = int(row["ID"])
    return by_title


def resolve_padrao_id(prob_tec: str, by_title: Dict[str, int]) -> Optional[int]:
    return by_title.get(_norm_title(prob_tec))


def _pdf_basename(prob_tec_file_name: Optional[str]) -> Optional[str]:
    if not prob_tec_file_name:
        return None
    name = str(prob_tec_file_name).strip()
    if not name:
        return None
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return os.path.basename(name)


def resolve_legacy_pdf_source(ano: int, os_id: int, prob_tec_file_name: Optional[str]) -> Optional[str]:
    pdf_name = _pdf_basename(prob_tec_file_name)
    if not pdf_name or ano <= 0:
        return None
    os_dir = _get_os_folder_path(ano, os_id)
    if not os_dir or not os.path.isdir(os_dir):
        return None
    for rel_dir in LEGACY_PT_REL_DIRS:
        candidate = os.path.join(os_dir, rel_dir, pdf_name)
        if os.path.isfile(candidate):
            return candidate
    pattern = os.path.join(os_dir, "**", "PTs Individuais", pdf_name)
    found = glob.glob(pattern, recursive=True)
    if found:
        return found[0]
    return None


def copy_legacy_pdf(sat_codigo: int, source_path: str) -> str:
    dest = os.path.join(_legacy_storage_root(), f"{sat_codigo}.pdf")
    if os.path.isfile(dest):
        return dest
    shutil.copy2(source_path, dest)
    return dest


def build_item_html_snapshot(
    *,
    titulo: str,
    pdf_path: Optional[str],
    versao_sat: int,
    componente: str,
) -> str:
    """Gera HTML_Snapshot a partir do PDF ou fallback de metadados."""
    versao_label = f"v{versao_sat}"
    if pdf_path:
        raw = convert_pdf_file_to_pt_html_safe(pdf_path, titulo)
        if raw:
            return sanitize_html_snapshot(raw) or raw
    raw = build_metadata_fallback_html(
        titulo=titulo,
        mensagem=(
            "Documento PDF não localizado na pasta da OS (PTs Individuais). "
            "Registro importado apenas com os metadados do SAT."
        ),
        versao_label=versao_label,
        componente=componente,
    )
    return sanitize_html_snapshot(raw) or raw


def ensure_analise_id(os_id: int, ano: int, usuario: str = "migracao-sat") -> int:
    existing = db.execute_query("SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s", (os_id, ano))
    if existing:
        return int(existing[0]["ID"])
    db.execute_query(
        "INSERT INTO tabAnalises (OS, Ano, Usuario, Versao, Componente) VALUES (%s, %s, %s, '', '')",
        (os_id, ano, usuario),
    )
    created = db.execute_query("SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s", (os_id, ano))
    return int(created[0]["ID"])


def _analise_item_versao_column_exists() -> bool:
    rows = db.execute_query(
        "SELECT 1 AS ok FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabAnaliseItens' "
        "AND COLUMN_NAME = 'Versao' LIMIT 1"
    )
    return bool(rows)


def _insert_analise_item(
    *,
    id_analise: int,
    id_padrao: Optional[int],
    componente: str,
    versao: str,
    obs: str,
    html_snapshot: str,
    resolucao_obrigatoria: bool,
) -> int:
    if _analise_item_versao_column_exists():
        db.execute_query(
            """
            INSERT INTO tabAnaliseItens (
                ID_Analise, ID_ProblemaPadrao, Componente, Versao, Obs, HTML_Snapshot, ResolucaoObrigatoria
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                id_analise,
                id_padrao,
                componente,
                versao,
                obs,
                html_snapshot,
                1 if resolucao_obrigatoria else 0,
            ),
        )
    else:
        db.execute_query(
            """
            INSERT INTO tabAnaliseItens (
                ID_Analise, ID_ProblemaPadrao, Componente, Obs, HTML_Snapshot, ResolucaoObrigatoria
            ) VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                id_analise,
                id_padrao,
                componente,
                obs,
                html_snapshot,
                1 if resolucao_obrigatoria else 0,
            ),
        )
    last = db.execute_query(
        "SELECT MAX(ID) AS ID FROM tabAnaliseItens WHERE ID_Analise=%s",
        (id_analise,),
    )
    return int(last[0]["ID"])


def _record_tracking(
    *,
    sat_codigo: int,
    item_id: int,
    os_id: int,
    ano: int,
    versao_sat: int,
    prob_tec_file_name: Optional[str],
    componente: str,
    prob_tec_titulo: str,
    pdf_source: Optional[str],
    pdf_storage: Optional[str],
) -> None:
    db.execute_query(
        """
        INSERT INTO tabMigracaoSatRegistroPT (
            SatCodigo, ID_AnaliseItem, OS, Ano, VersaoSat, ProbTecFileName,
            Componente, ProbTecTitulo, PdfSourcePath, PdfStoragePath
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            sat_codigo,
            item_id,
            os_id,
            ano,
            versao_sat,
            prob_tec_file_name,
            componente,
            prob_tec_titulo,
            pdf_source,
            pdf_storage,
        ),
    )


def fetch_access_rows(accdb_path: str) -> List[Dict[str, Any]]:
    import pyodbc

    conn = pyodbc.connect(f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={accdb_path};")
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT Código, OS, ANO, Versao, ProbTecCatIDfk, ProbTec, ProbTecFileName, Componente, Corrigir
            FROM tabRegistroPT
            ORDER BY ANO, OS, Versao, Código
            """
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()


def migrate_sat_registro_pt(
    *,
    accdb_path: str = DEFAULT_SAT_ACCDB,
    dry_run: bool = True,
    min_ano: int = 2024,
    copy_pdf: bool = True,
    limit: Optional[int] = None,
) -> MigrationStats:
    stats = MigrationStats()
    if not os.path.isfile(accdb_path):
        raise FileNotFoundError(f"Base SAT não encontrada: {accdb_path}")

    ensure_tracking_table()
    imported = load_imported_sat_codigos()
    by_title = load_padrao_ids_by_title()
    rows = fetch_access_rows(accdb_path)

    for row in rows:
        if limit is not None and stats.scanned >= limit:
            break
        stats.scanned += 1

        sat_codigo = int(row.get("Código") or row.get("Codigo") or 0)
        os_id = int(row.get("OS") or 0)
        ano = int(row.get("ANO") or 0)
        versao_sat = int(row.get("Versao") or 1)
        prob_tec = str(row.get("ProbTec") or "").strip()
        prob_file = row.get("ProbTecFileName")
        componente = _normalize_componente(row.get("Componente"))
        corrigir = bool(row.get("Corrigir"))

        if sat_codigo in imported:
            stats.skipped_existing += 1
            continue
        if ano < min_ano or ano <= 0 or os_id <= 0 or not prob_tec:
            stats.skipped_invalid += 1
            continue

        padrao_id = resolve_padrao_id(prob_tec, by_title)
        if padrao_id:
            stats.padrao_linked += 1

        pdf_source = resolve_legacy_pdf_source(ano, os_id, prob_file)
        pdf_storage = None
        if pdf_source:
            if copy_pdf and not dry_run:
                try:
                    pdf_storage = copy_legacy_pdf(sat_codigo, pdf_source)
                    stats.pdf_copy += 1
                except OSError as exc:
                    stats.errors.append(f"Cópia PDF {sat_codigo}: {exc}")
            if dry_run:
                stats.pdf_converted += 1
            else:
                converted = convert_pdf_file_to_pt_html_safe(pdf_source, prob_tec)
                if converted:
                    stats.pdf_converted += 1
                else:
                    stats.pdf_convert_failed += 1
        else:
            stats.pdf_missing += 1

        if dry_run:
            html_snapshot = build_item_html_snapshot(
                titulo=prob_tec,
                pdf_path=pdf_source,
                versao_sat=versao_sat,
                componente=componente,
            )
            stats.inserted += 1
            continue

        html_snapshot = build_item_html_snapshot(
            titulo=prob_tec,
            pdf_path=pdf_source,
            versao_sat=versao_sat,
            componente=componente,
        )
        versao_label = f"v{versao_sat}"
        obs = f"Importado SAT (Código {sat_codigo})"
        if prob_file:
            obs += f" · arquivo {prob_file}"

        try:
            id_analise = ensure_analise_id(os_id, ano)
            item_id = _insert_analise_item(
                id_analise=id_analise,
                id_padrao=padrao_id,
                componente=componente,
                versao=versao_label,
                obs=obs,
                html_snapshot=html_snapshot,
                resolucao_obrigatoria=corrigir,
            )
            _record_tracking(
                sat_codigo=sat_codigo,
                item_id=item_id,
                os_id=os_id,
                ano=ano,
                versao_sat=versao_sat,
                prob_tec_file_name=str(prob_file) if prob_file else None,
                componente=componente,
                prob_tec_titulo=prob_tec,
                pdf_source=pdf_source,
                pdf_storage=pdf_storage,
            )
            imported.add(sat_codigo)
            stats.inserted += 1
        except Exception as exc:
            stats.errors.append(f"Registro {sat_codigo} OS {os_id}/{ano}: {exc}")
            logger.exception("Falha ao importar SAT %s", sat_codigo)

    return stats


def get_legacy_pdf_path(sat_codigo: int) -> Optional[str]:
    if not migracao_sat_table_exists():
        return None
    rows = db.execute_query(
        "SELECT PdfStoragePath, PdfSourcePath FROM tabMigracaoSatRegistroPT WHERE SatCodigo=%s",
        (sat_codigo,),
    )
    if not rows:
        return None
    row = rows[0]
    for key in ("PdfStoragePath", "PdfSourcePath"):
        path = row.get(key)
        if path and os.path.isfile(path):
            return path
    return None

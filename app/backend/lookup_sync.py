"""
Sincronização de tabelas auxiliares (lookup) do MDB Access para o MySQL.

Usado quando tabcategorias, tabPapel ou tabCores existem mas estão vazias no MySQL,
espelhando o esquema do MDB (OS Atual).
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Optional

import pyodbc

from config_manager import config_manager
from database import db

logger = logging.getLogger(__name__)

_LOOKUP_POPULATED_TTL_SEC = 300.0
_lookup_populated_until_monotonic: float = 0.0

_LOOKUP_DDL = {
    "tabcategorias": """
        CREATE TABLE IF NOT EXISTS tabcategorias (
            Categoria TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    "tabPapel": """
        CREATE TABLE IF NOT EXISTS tabPapel (
            CodPapel INT,
            Papel TEXT,
            Seq DOUBLE,
            Formato TEXT,
            Espessura DOUBLE,
            Disponibilidade TEXT,
            Obs TEXT,
            Disponivel TEXT,
            Mostruario TEXT,
            DataMedicao TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    "tabCores": """
        CREATE TABLE IF NOT EXISTS tabCores (
            Cod INT,
            Cor TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    "tabFormatos": """
        CREATE TABLE IF NOT EXISTS tabFormatos (
            CodFormato INT,
            Formato TEXT,
            CabemNoA4 DOUBLE,
            Seq DOUBLE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
}


def _table_exists(table: str) -> bool:
    rows = db.execute_query("SHOW TABLES LIKE %s", (table,))
    return bool(rows)


def _table_empty(table: str) -> bool:
    rows = db.execute_query(f"SELECT COUNT(*) AS n FROM `{table}`")
    return not rows or int(rows[0].get("n") or 0) == 0


def ensure_mysql_lookup_tables() -> None:
    """Garante que as tabelas de lookup existam no MySQL (espelho do MDB)."""
    for table, ddl in _LOOKUP_DDL.items():
        if not _table_exists(table):
            logger.info("Criando tabela MySQL %s a partir do esquema MDB", table)
            db.execute_query(ddl)


def _mdb_connection() -> Optional[pyodbc.Connection]:
    path = config_manager.get_mdb_path_by_nro(1)
    if not path:
        return None
    try:
        conn_str = config_manager.get_mdb_connection_string(path)
        return pyodbc.connect(conn_str)
    except Exception as exc:
        logger.warning("Não foi possível conectar ao MDB para sync de lookups: %s", exc)
        return None


def _fetch_mdb_rows(cursor: pyodbc.Cursor, table: str) -> List[Any]:
    cursor.execute(f"SELECT * FROM [{table}]")
    return cursor.fetchall()


def _sync_tabcategorias(cursor: pyodbc.Cursor) -> None:
    if not _table_empty("tabcategorias"):
        return
    rows = _fetch_mdb_rows(cursor, "tabcategorias")
    for row in rows:
        categoria = row[0]
        if not categoria or not str(categoria).strip():
            continue
        db.execute_query(
            "INSERT INTO tabcategorias (Categoria) VALUES (%s)",
            (str(categoria).strip(),),
        )
    logger.info("Sync tabcategorias: %s registro(s) do MDB", len(rows))


def _sync_tabpapel(cursor: pyodbc.Cursor) -> None:
    if not _table_empty("tabPapel"):
        return
    rows = _fetch_mdb_rows(cursor, "tabPapel")
    for row in rows:
        db.execute_query(
            """
            INSERT INTO tabPapel (
                CodPapel, Papel, Seq, Formato, Espessura, Disponibilidade,
                Obs, Disponivel, Mostruario, DataMedicao
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            tuple(_normalize_mdb_cell(v) for v in row),
        )
    logger.info("Sync tabPapel: %s registro(s) do MDB", len(rows))


def _sync_tabcores(cursor: pyodbc.Cursor) -> None:
    if not _table_empty("tabCores"):
        return
    rows = _fetch_mdb_rows(cursor, "tabCores")
    for row in rows:
        db.execute_query(
            "INSERT INTO tabCores (Cod, Cor) VALUES (%s, %s)",
            (_normalize_mdb_cell(row[0]), _normalize_mdb_cell(row[1])),
        )
    logger.info("Sync tabCores: %s registro(s) do MDB", len(rows))


def _sync_tabformatos(cursor: pyodbc.Cursor) -> None:
    if not _table_empty("tabFormatos"):
        return
    rows = _fetch_mdb_rows(cursor, "tabFormatos")
    for row in rows:
        db.execute_query(
            """
            INSERT INTO tabFormatos (CodFormato, Formato, CabemNoA4, Seq)
            VALUES (%s, %s, %s, %s)
            """,
            tuple(_normalize_mdb_cell(v) for v in row),
        )
    logger.info("Sync tabFormatos: %s registro(s) do MDB", len(rows))


def _normalize_mdb_cell(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    if hasattr(value, "isoformat"):
        return value.isoformat(sep=" ", timespec="seconds")
    return value


def _empty_lookup_tables() -> List[str]:
    return [
        table
        for table in _LOOKUP_DDL
        if not _table_exists(table) or _table_empty(table)
    ]


def _mark_lookups_populated() -> None:
    global _lookup_populated_until_monotonic
    _lookup_populated_until_monotonic = time.monotonic() + _LOOKUP_POPULATED_TTL_SEC


def sync_lookup_tables_from_mdb_if_empty() -> None:
    """
    Preenche tabcategorias, tabPapel, tabCores e tabFormatos no MySQL quando vazias,
    copiando dados do MDB OS Atual.

    Não abre o Access se as tabelas já tiverem dados, se o TTL em memória
    ainda valer, ou se MYSQL_ONLY estiver ativo.
    """
    now = time.monotonic()
    if (
        _lookup_populated_until_monotonic > 0
        and now < _lookup_populated_until_monotonic
    ):
        return

    ensure_mysql_lookup_tables()
    missing = _empty_lookup_tables()
    if not missing:
        _mark_lookups_populated()
        return

    if config_manager.is_mysql_only():
        logger.info(
            "Lookups vazios (%s) em MYSQL_ONLY; não sincroniza MDB",
            ", ".join(missing),
        )
        return

    conn = _mdb_connection()
    if conn is None:
        return
    try:
        cursor = conn.cursor()
        _sync_tabcategorias(cursor)
        _sync_tabpapel(cursor)
        _sync_tabcores(cursor)
        _sync_tabformatos(cursor)
    except Exception as exc:
        logger.warning("Falha ao sincronizar lookups do MDB: %s", exc)
    finally:
        try:
            conn.close()
        except Exception:
            pass

    if not _empty_lookup_tables():
        _mark_lookups_populated()


# --- Espessuras da calculadora de lombada (CalcularLombada2010.mdb) ---

_DEFAULT_LOMBADA_MDB = Path(r"c:\_SAGRA\Bancos Extras\CalcularLombada2010.mdb")
_LOMBADA_ESP_SYNC_TTL_SEC = 300.0
_lombada_esp_last_sync_monotonic: float = 0.0


@dataclass
class LombadaEspessuraSyncReport:
    ok: bool
    mdb_path: str
    updated: list[str] = field(default_factory=list)
    inserted: list[str] = field(default_factory=list)
    unchanged: int = 0
    skipped_null: int = 0
    errors: list[str] = field(default_factory=list)

    def format_text(self) -> str:
        lines = [
            f"MDB: {self.mdb_path}",
            f"Atualizados: {len(self.updated)}",
            f"Inseridos: {len(self.inserted)}",
            f"Iguais: {self.unchanged}",
            f"Sem espessura no MDB (ignorados): {self.skipped_null}",
        ]
        if self.updated:
            lines.append("Mudanças:")
            lines.extend(f"  - {u}" for u in self.updated)
        if self.inserted:
            lines.append("Inseridos:")
            lines.extend(f"  - {i}" for i in self.inserted)
        if self.errors:
            lines.append("Erros:")
            lines.extend(f"  - {e}" for e in self.errors)
        return "\n".join(lines)


def resolve_lombada_mdb_path(explicit: Optional[str] = None) -> Optional[str]:
    """Resolve caminho do CalcularLombada2010.mdb (config / env / default local)."""
    candidates: list[str] = []
    if explicit and str(explicit).strip():
        candidates.append(str(explicit).strip())
    env = (os.getenv("SAGRA_MDB_LOMBADA_PATH") or "").strip()
    if env:
        candidates.append(env)
    cfg = (config_manager.get("mdb_lombada_path") or "").strip()
    if cfg:
        candidates.append(cfg)
    candidates.append(str(_DEFAULT_LOMBADA_MDB))

    for raw in candidates:
        resolved = config_manager.resolve_mdb_path(raw) or raw
        if resolved and Path(resolved).is_file():
            return resolved
        if raw and Path(raw).is_file():
            return str(Path(raw))
    return None


def _norm_papel_name(name: Any) -> str:
    return " ".join(str(name or "").strip().lower().split())


def sync_papel_espessura_from_lombada_mdb(
    *,
    mdb_path: Optional[str] = None,
    dry_run: bool = False,
    force: bool = False,
) -> LombadaEspessuraSyncReport:
    """
    Alinha Espessura (e papéis faltantes) de tabPapel com CalcularLombada2010.mdb.

    Match principal por CodPapel; fallback por nome do papel.
    Insere registros do MDB com Espessura que não existam no MySQL.
    Por padrão aplica throttle de 5 min (force=True ignora).
    """
    global _lombada_esp_last_sync_monotonic
    import time

    now = time.monotonic()
    if (
        not force
        and not dry_run
        and _lombada_esp_last_sync_monotonic > 0
        and (now - _lombada_esp_last_sync_monotonic) < _LOMBADA_ESP_SYNC_TTL_SEC
    ):
        return LombadaEspessuraSyncReport(
            ok=True,
            mdb_path=resolve_lombada_mdb_path(mdb_path) or "",
            unchanged=0,
        )

    path = resolve_lombada_mdb_path(mdb_path)
    report = LombadaEspessuraSyncReport(ok=False, mdb_path=path or "")
    if not path:
        report.errors.append(
            "MDB da lombada não encontrado (configure mdb_lombada_path ou "
            r"c:\_SAGRA\Bancos Extras\CalcularLombada2010.mdb)"
        )
        return report

    ensure_mysql_lookup_tables()

    try:
        conn_str = config_manager.get_mdb_connection_string(path)
        conn = pyodbc.connect(conn_str)
    except Exception as exc:
        report.errors.append(f"Falha ao abrir MDB: {exc}")
        return report

    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT CodPapel, Papel, Seq, Formato, Espessura, Disponibilidade, "
            "Obs, Disponivel, Mostruario, DataMedicao FROM tabPapel"
        )
        mdb_rows = cur.fetchall()
    except Exception as exc:
        report.errors.append(f"Falha ao ler tabPapel do MDB: {exc}")
        return report
    finally:
        try:
            conn.close()
        except Exception:
            pass

    mysql_rows = db.execute_query(
        "SELECT CodPapel, Papel, Espessura FROM tabPapel"
    )
    by_cod: dict[int, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    for row in mysql_rows:
        cod = row.get("CodPapel")
        try:
            cod_i = int(cod) if cod is not None else None
        except (TypeError, ValueError):
            cod_i = None
        if cod_i is not None:
            by_cod[cod_i] = row
        name_key = _norm_papel_name(row.get("Papel"))
        if name_key:
            by_name[name_key] = row

    for row in mdb_rows:
        cod_raw, papel, seq, formato, esp, disp, obs, disponivel, mostruario, data_med = (
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
            row[5],
            row[6],
            row[7],
            row[8],
            row[9],
        )
        if esp is None:
            report.skipped_null += 1
            continue
        try:
            esp_f = float(esp)
        except (TypeError, ValueError):
            report.skipped_null += 1
            continue

        papel_s = str(papel or "").strip()
        if not papel_s:
            continue

        try:
            cod_i = int(cod_raw) if cod_raw is not None else None
        except (TypeError, ValueError):
            cod_i = None

        mysql_row = by_cod.get(cod_i) if cod_i is not None else None
        if mysql_row is None:
            mysql_row = by_name.get(_norm_papel_name(papel_s))

        if mysql_row is None:
            msg = f"INSERT CodPapel={cod_i} Papel={papel_s!r} Espessura={esp_f:g}"
            if dry_run:
                report.inserted.append(msg)
            else:
                try:
                    db.execute_query(
                        """
                        INSERT INTO tabPapel (
                            CodPapel, Papel, Seq, Formato, Espessura, Disponibilidade,
                            Obs, Disponivel, Mostruario, DataMedicao
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            cod_i,
                            papel_s,
                            _normalize_mdb_cell(seq),
                            _normalize_mdb_cell(formato),
                            esp_f,
                            _normalize_mdb_cell(disp),
                            _normalize_mdb_cell(obs),
                            _normalize_mdb_cell(disponivel),
                            _normalize_mdb_cell(mostruario),
                            _normalize_mdb_cell(data_med),
                        ),
                    )
                    report.inserted.append(msg)
                except Exception as exc:
                    report.errors.append(f"{msg}: {exc}")
            continue

        old_esp = mysql_row.get("Espessura")
        try:
            old_f = float(old_esp) if old_esp is not None else None
        except (TypeError, ValueError):
            old_f = None

        old_name = str(mysql_row.get("Papel") or "").strip()
        name_changed = old_name != papel_s
        esp_changed = old_f is None or abs(old_f - esp_f) > 1e-9

        if not esp_changed and not name_changed:
            report.unchanged += 1
            continue

        target_cod = mysql_row.get("CodPapel")
        parts = []
        if esp_changed:
            parts.append(
                f"Espessura {old_f if old_f is not None else 'NULL'}->{esp_f:g}"
            )
        if name_changed:
            parts.append(f"Papel {old_name!r}->{papel_s!r}")
        msg = f"CodPapel={target_cod} ({', '.join(parts)})"

        if dry_run:
            report.updated.append(msg)
            continue

        try:
            db.execute_query(
                """
                UPDATE tabPapel
                SET Espessura = %s, Papel = %s
                WHERE CodPapel = %s
                """,
                (esp_f, papel_s, target_cod),
            )
            report.updated.append(msg)
        except Exception as exc:
            report.errors.append(f"{msg}: {exc}")

    report.ok = not report.errors
    if report.ok and not dry_run:
        _lombada_esp_last_sync_monotonic = time.monotonic()
    logger.info(
        "Sync Espessura lombada: updated=%s inserted=%s unchanged=%s errors=%s path=%s",
        len(report.updated),
        len(report.inserted),
        report.unchanged,
        len(report.errors),
        path,
    )
    return report

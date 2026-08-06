#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_access_mysql.py

Sincroniza (somente) Access (.mdb/.accdb) -> MySQL, com regra IMUTÁVEL de roteamento:
- OS < 5000  -> MDB "OS Atual"
- OS >= 5000 -> MDB "Papelaria Atual"

Comportamento (igual ao original):
- PRIMEIRA execução (first_run): TRUNCATE na tabela alvo MySQL e carga completa (somente anos >= min-year).
- Execuções seguintes: monitora e aplica apenas INSERT/UPDATE (não deleta registros).

IMPORTANTE:
- A tabela MySQL alvo precisa existir e ter chave única/PK nos campos passados em --pk,
  senão "upsert" não funciona corretamente.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import logging
import os
import sys
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)
from config_manager import config_manager
import time
from typing import List, Optional, Sequence, Tuple

import pandas as pd
import pyodbc
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


# -------------------------
# Logging
# -------------------------

def setup_logger(level: str) -> logging.Logger:
    logger = logging.getLogger("sync_access_mysql")
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(message)s"))
    logger.handlers[:] = [handler]
    logger.propagate = False
    return logger


# -------------------------
# Helpers
# -------------------------

def now() -> _dt.datetime:
    return _dt.datetime.now()


def access_conn_str(mdb_path: str, readonly: bool = True) -> str:
    """
    NÃO inclua atributos problemáticos (Mode=..., Persist Security Info=...),
    para evitar "Invalid connection string attribute".
    """
    mdb_path = os.path.abspath(mdb_path)
    parts = [
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};",
        f"DBQ={mdb_path};",
    ]
    # Em alguns ambientes READONLY funciona, em outros é ignorado.
    # Se algum dia isso der erro aí, basta remover a linha abaixo.
    if readonly:
        parts.append("READONLY=1;")
    return "".join(parts)


def retryable_access_call(fn, *, logger: logging.Logger, stage: str, mdb: str,
                          max_attempts: int = 6, base_wait: int = 5):
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except Exception as e:  # noqa
            last_err = e
            wait = base_wait * attempt
            logger.warning(
                f"[ACCESS RETRY] stage={stage} mdb={mdb} attempt={attempt} wait={wait}s err={e!r}"
            )
            time.sleep(wait)
    raise last_err


mysql_cfg = config_manager.get_mysql_config()
default_mdb_os = config_manager.get('mdb_os_atual_path')
default_mdb_sp = config_manager.get('mdb_papelaria_path')

def mysql_engine(host: str, port: int, user: str, password: str, database: str) -> Engine:
    url = f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}?charset=utf8mb4"
    return create_engine(url, pool_pre_ping=True, pool_recycle=3600, future=True)


def mysql_table_columns(engine: Engine, table: str) -> List[str]:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SHOW COLUMNS FROM `{table}`")).fetchall()
    return [r[0] for r in rows]


def infer_cutoff_field(pk_cols: Sequence[str], access_cols: Sequence[str]) -> str:
    candidates = list(pk_cols) + list(access_cols)
    for c in candidates:
        if "nroprotocolo" in c.lower():
            return c
    return pk_cols[0]


def infer_year_field(domain: str, pk_cols: Sequence[str], access_cols: Sequence[str]) -> Optional[str]:
    dom = (domain or "").lower().strip()
    if dom == "protocolos":
        return "AnoProtocolo"
    if dom == "detalhes":
        return "AnoProtocoloLinkDet"
    # fallback
    for c in pk_cols:
        if "ano" in c.lower():
            return c
    for c in access_cols:
        if c.lower().startswith("ano"):
            return c
    return None


def read_access_table(mdb_path: str, table: str, columns: Sequence[str],
                      where_sql: str, params: Tuple, logger: logging.Logger) -> pd.DataFrame:
    cols_sql = ", ".join([f"[{c}]" for c in columns])
    sql = f"SELECT {cols_sql} FROM [{table}] {where_sql}"

    def _do():
        cn = pyodbc.connect(access_conn_str(mdb_path, readonly=True), timeout=30)
        try:
            return pd.read_sql(sql, cn, params=params)
        finally:
            cn.close()

    return retryable_access_call(_do, logger=logger, stage="read_sql", mdb=mdb_path)


def build_where_for_access(cutoff_field: str, cutoff_op: str,
                           year_field: Optional[str], min_year: Optional[int]) -> Tuple[str, Tuple]:
    conds = [f"[{cutoff_field}] {cutoff_op} ?"]
    params: List = [5000]
    if year_field and min_year is not None:
        conds.append(f"[{year_field}] >= ?")
        params.append(int(min_year))
    where = "WHERE " + " AND ".join(conds)
    return where, tuple(params)


def load_access_union(mdb_os: str, mdb_sp: str, table: str,
                      pk_cols: Sequence[str], year_field: Optional[str], min_year: Optional[int],
                      whitelist_cols: Sequence[str], logger: logging.Logger) -> pd.DataFrame:
    cutoff_field = infer_cutoff_field(pk_cols, whitelist_cols)

    where_os, params_os = build_where_for_access(cutoff_field, "<", year_field, min_year)
    where_sp, params_sp = build_where_for_access(cutoff_field, ">=", year_field, min_year)

    df_os = read_access_table(mdb_os, table, whitelist_cols, where_os, params_os, logger)
    df_sp = read_access_table(mdb_sp, table, whitelist_cols, where_sp, params_sp, logger)

    if df_os.empty and df_sp.empty:
        return pd.DataFrame(columns=list(whitelist_cols))

    df = pd.concat([df_os, df_sp], ignore_index=True)
    df = df.where(pd.notnull(df), None)
    return df


def compute_row_hashes(df: pd.DataFrame, cols: Sequence[str]) -> pd.Series:
    if df.empty:
        return pd.Series([], dtype="uint64")
    s = df[cols].astype(object).where(pd.notnull(df[cols]), "").astype(str)
    joined = s.apply(lambda r: "\x1f".join(r.values.tolist()), axis=1)
    return pd.util.hash_pandas_object(joined, index=False)


def mysql_truncate(engine: Engine, table: str):
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE TABLE `{table}`"))


def mysql_upsert(engine: Engine, table: str, df: pd.DataFrame, pk_cols: Sequence[str]):
    if df.empty:
        return

    cols = df.columns.tolist()
    insert_cols = ", ".join([f"`{c}`" for c in cols])
    values_cols = ", ".join([f"%({c})s" for c in cols])

    non_pk = [c for c in cols if c not in pk_cols]
    if non_pk:
        upd = ", ".join([f"`{c}`=VALUES(`{c}`)" for c in non_pk])
        sql = f"INSERT INTO `{table}` ({insert_cols}) VALUES ({values_cols}) ON DUPLICATE KEY UPDATE {upd}"
    else:
        sql = f"INSERT IGNORE INTO `{table}` ({insert_cols}) VALUES ({values_cols})"

    payload = df.to_dict(orient="records")
    with engine.begin() as conn:
        conn.execute(text(sql), payload)


def main():
    ap = argparse.ArgumentParser()

    ap.add_argument("--domain", required=True, help="protocolos | detalhes (apenas para logs/heurísticas)")
    ap.add_argument("--table-source", required=True, help="Tabela no Access (ex: tabprotocolos)")
    ap.add_argument("--table-target", required=True, help="Tabela no MySQL (ex: monitor_protocol_os)")
    ap.add_argument("--pk", nargs="+", required=True, help="Campos PK (na tabela alvo MySQL e na tabela Access)")
    ap.add_argument("--mdb-os", default=default_mdb_os, required=False, help="Caminho do MDB OS Atual")
    ap.add_argument("--mdb-sp", default=default_mdb_sp, required=False, help="Caminho do MDB Papelaria Atual")
    ap.add_argument("--mysql-host", default=mysql_cfg["host"], required=False)
    ap.add_argument("--mysql-port", type=int, default=mysql_cfg["port"])
    ap.add_argument("--mysql-user", default=mysql_cfg["user"], required=False)
    ap.add_argument("--mysql-password", default=mysql_cfg["password"], required=False)
    ap.add_argument("--mysql-database", default=mysql_cfg["database"], required=False)

    ap.add_argument("--min-year", type=int, default=None, help="Ignorar registros com ano < min-year")
    ap.add_argument("--poll-interval", type=int, default=5)
    ap.add_argument("--batch-size", type=int, default=1000)
    ap.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])

    args = ap.parse_args()
    logger = setup_logger(args.log_level)

    logger.info("--- Script Iniciado ---")
    logger.info(f"DOMÍNIO: {args.domain}")
    logger.info(f"Access table_source: {args.table_source}")
    logger.info(f"MySQL table_target: {args.table_target}")
    logger.info(f"PK: {', '.join(args.pk)}")
    logger.info("Regra MDB: OS < 5000 -> OS Atual | OS >= 5000 -> Papelaria Atual (IMUTÁVEL)")

    engine = mysql_engine(
        host=args.mysql_host,
        port=args.mysql_port,
        user=args.mysql_user,
        password=args.mysql_password,
        database=args.mysql_database,
    )

    first_run = True

    mysql_cols = mysql_table_columns(engine, args.table_target)

    # PK deve existir na tabela alvo
    for pk in args.pk:
        if pk not in mysql_cols:
            raise RuntimeError(f"A PK '{pk}' não existe na tabela MySQL '{args.table_target}'. Abortando.")

    # meta colunas: só preenche se existir
    meta_cols = {"sync", "lastupdate"}

    while True:
        try:
            # Descobre colunas do MDB (união OS/SP) para montar whitelist real = (MDB ∩ MySQL)
            def _get_access_cols(mdb_path: str) -> List[str]:
                cn = pyodbc.connect(access_conn_str(mdb_path, readonly=True), timeout=30)
                try:
                    cur = cn.cursor()
                    cur.execute(f"SELECT TOP 1 * FROM [{args.table_source}]")
                    return [d[0] for d in cur.description]
                finally:
                    cn.close()

            access_cols_os = retryable_access_call(lambda: _get_access_cols(args.mdb_os), logger=logger,
                                                   stage="get_access_columns", mdb=args.mdb_os)
            access_cols_sp = retryable_access_call(lambda: _get_access_cols(args.mdb_sp), logger=logger,
                                                   stage="get_access_columns", mdb=args.mdb_sp)

            access_cols_union = set(access_cols_os) | set(access_cols_sp)

            whitelist_cols = [c for c in mysql_cols if (c in access_cols_union and c not in meta_cols)]
            # PK sempre (e no começo)
            for pk in reversed(args.pk):
                if pk not in whitelist_cols:
                    whitelist_cols.insert(0, pk)

            year_field = infer_year_field(args.domain, args.pk, whitelist_cols)

            logger.info(f"Whitelist automática (MDB∩MySQL): {len(whitelist_cols)}")

            df_mdb = load_access_union(
                args.mdb_os, args.mdb_sp,
                args.table_source,
                pk_cols=args.pk,
                year_field=year_field,
                min_year=args.min_year,
                whitelist_cols=whitelist_cols,
                logger=logger
            )

            # --------------------
            # BASELINE / FIRST RUN (igual ao original)
            # --------------------
            if first_run:
                logger.info("[BASELINE] Primeira execução: TRUNCATE + carga completa (sem monitoramento nesse ciclo).")
                mysql_truncate(engine, args.table_target)

                df_full = df_mdb.copy()
                if "lastupdate" in mysql_cols:
                    df_full["lastupdate"] = now()
                if "sync" in mysql_cols:
                    df_full["sync"] = 0

                if not df_full.empty:
                    total = len(df_full)
                    for i in range(0, total, args.batch_size):
                        batch = df_full.iloc[i:i + args.batch_size]
                        mysql_upsert(engine, args.table_target, batch, args.pk)
                    logger.info(f"[BASELINE] Carga completa concluída. Registros: {total}")
                else:
                    logger.info("[BASELINE] Carga completa concluída. Nenhum registro (após filtros).")

                first_run = False
                time.sleep(args.poll_interval)
                continue

            # --------------------
            # MONITORAMENTO (somente INSERT/UPDATE)
            # --------------------
            cols_sql = ", ".join([f"`{c}`" for c in whitelist_cols])

            where = ""
            params = None
            # placeholder %s e params como TUPLA (SQLAlchemy 2.0 não aceita lista de escalares)
            if args.min_year is not None and year_field and year_field in mysql_cols:
                where = f" WHERE `{year_field}` >= %s"
                params = (int(args.min_year),)

            sql = f"SELECT {cols_sql} FROM `{args.table_target}`{where}"
            df_mysql = pd.read_sql(sql, engine, params=params)
            df_mysql = df_mysql.where(pd.notnull(df_mysql), None)

            df_mdb_idx = df_mdb.set_index(list(args.pk), drop=False) if not df_mdb.empty else df_mdb
            df_mysql_idx = df_mysql.set_index(list(args.pk), drop=False) if not df_mysql.empty else df_mysql

            if df_mysql_idx.empty:
                df_new = df_mdb_idx
                df_updated = df_mdb_idx.iloc[0:0]
            else:
                new_idx = df_mdb_idx.index.difference(df_mysql_idx.index)
                df_new = df_mdb_idx.loc[new_idx] if len(new_idx) else df_mdb_idx.iloc[0:0]

                common_idx = df_mdb_idx.index.intersection(df_mysql_idx.index)
                if len(common_idx):
                    cmp_cols = [c for c in whitelist_cols if c not in args.pk]
                    if cmp_cols:
                        left = df_mdb_idx.loc[common_idx, cmp_cols]
                        right = df_mysql_idx.loc[common_idx, cmp_cols]
                        h_left = compute_row_hashes(left, cmp_cols)
                        h_right = compute_row_hashes(right, cmp_cols)
                        changed_mask = (h_left.values != h_right.values)
                        changed_idx = list(common_idx[changed_mask])
                        df_updated = df_mdb_idx.loc[changed_idx] if changed_idx else df_mdb_idx.iloc[0:0]
                    else:
                        df_updated = df_mdb_idx.iloc[0:0]
                else:
                    df_updated = df_mdb_idx.iloc[0:0]

            total_changes = len(df_new) + len(df_updated)
            if total_changes:
                logger.info(f"[FORWARD] Detectadas {total_changes} alterações MDB -> MySQL.")
                df_changes = pd.concat([df_new, df_updated], ignore_index=True)

                if "lastupdate" in mysql_cols:
                    df_changes["lastupdate"] = now()
                if "sync" in mysql_cols:
                    df_changes["sync"] = 0

                total = len(df_changes)
                for i in range(0, total, args.batch_size):
                    batch = df_changes.iloc[i:i + args.batch_size]
                    mysql_upsert(engine, args.table_target, batch, args.pk)
            else:
                logger.info("[FORWARD] Nenhuma alteração detectada.")

            time.sleep(args.poll_interval)

        except KeyboardInterrupt:
            logger.info("Interrompido pelo usuário (Ctrl+C). Encerrando.")
            break
        except Exception as e:  # noqa
            logger.error(f"[CICLO ERRO] stage=main_loop err={e}")
            logger.exception(e)
            time.sleep(max(3, args.poll_interval))


if __name__ == "__main__":
    main()

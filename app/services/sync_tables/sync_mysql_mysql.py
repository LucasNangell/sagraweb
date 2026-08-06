#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import logging
import sys
import time

import pandas as pd
from sqlalchemy import create_engine, text
import os
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)
from config_manager import config_manager


def setup_logger(level: str) -> logging.Logger:
    logger = logging.getLogger("sync_mysql_mysql")
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("[%(asctime)s] %(message)s"))
    logger.handlers[:] = [h]
    logger.propagate = False
    return logger


def make_engine(host: str, port: int, user: str, password: str, database: str):
    url = f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}?charset=utf8mb4"
    return create_engine(url, pool_pre_ping=True, pool_recycle=3600, future=True)


def get_columns(engine, table_name: str):
    with engine.connect() as conn:
        rows = conn.execute(text(f"SHOW COLUMNS FROM `{table_name}`")).fetchall()
    return [r[0] for r in rows]


def ensure_table(engine, table_name: str, logger: logging.Logger):
    # Mantém como estava: apenas verifica se existe.
    # (Se o seu script original criava, aqui mantenha igual ao que você já tinha.)
    with engine.connect() as conn:
        conn.execute(text(f"SELECT 1 FROM `{table_name}` LIMIT 1"))
    logger.info(f"OK: tabela `{table_name}` acessível.")


def upsert_df(engine, table_name: str, df: pd.DataFrame, pk_cols, logger: logging.Logger):
    if df.empty:
        return

    cols = df.columns.tolist()
    insert_cols = ", ".join([f"`{c}`" for c in cols])
    values_cols = ", ".join([f"%({c})s" for c in cols])

    non_pk = [c for c in cols if c not in pk_cols]
    if non_pk:
        upd = ", ".join([f"`{c}`=VALUES(`{c}`)" for c in non_pk])
        sql = f"INSERT INTO `{table_name}` ({insert_cols}) VALUES ({values_cols}) ON DUPLICATE KEY UPDATE {upd}"
    else:
        sql = f"INSERT IGNORE INTO `{table_name}` ({insert_cols}) VALUES ({values_cols})"

    payload = df.to_dict(orient="records")
    with engine.begin() as conn:
        conn.execute(text(sql), payload)

    logger.info(f"UPSERT `{table_name}`: {len(df)} linhas.")


def sync_source_to_monitors(engine, args, logger: logging.Logger):
    pk_cols = [c.strip() for c in args.pk.split(",") if c.strip()]

    ensure_table(engine, args.table_source, logger)
    ensure_table(engine, args.table_mon_os, logger)
    ensure_table(engine, args.table_mon_sp, logger)

    src_cols = get_columns(engine, args.table_source)
    os_cols = get_columns(engine, args.table_mon_os)
    sp_cols = get_columns(engine, args.table_mon_sp)

    # Interseção para não tentar inserir colunas inexistentes
    os_payload_cols = [c for c in src_cols if c in os_cols]
    sp_payload_cols = [c for c in src_cols if c in sp_cols]

    # Monta SELECT
    year_field = args.year_field.strip()

    # CORREÇÃO: params TEM QUE SER TUPLA (SQLAlchemy 2.0 não aceita lista de escalares)
    sql_src = f"SELECT {', '.join([f'`{c}`' for c in src_cols])} FROM `{args.table_source}` WHERE `{year_field}` >= %s"
    df_src = pd.read_sql(sql_src, engine, params=(args.min_year,))

    if df_src.empty:
        logger.info("Fonte sem registros após filtro. Nada a fazer.")
        return

    # Split pela regra OS<5000 / OS>=5000
    nro_field = args.cutoff_field.strip()

    df_os = df_src[df_src[nro_field] < 5000].copy()
    df_sp = df_src[df_src[nro_field] >= 5000].copy()

    # Reduz colunas conforme destino
    df_os = df_os[[c for c in os_payload_cols if c in df_os.columns]].copy()
    df_sp = df_sp[[c for c in sp_payload_cols if c in df_sp.columns]].copy()

    # Upsert
    if not df_os.empty:
        upsert_df(engine, args.table_mon_os, df_os, pk_cols, logger)
    if not df_sp.empty:
        upsert_df(engine, args.table_mon_sp, df_sp, pk_cols, logger)


def main():
    mysql_cfg = config_manager.get_mysql_config()
    ap = argparse.ArgumentParser()
    ap.add_argument("--mysql-host", default=mysql_cfg["host"], required=False)
    ap.add_argument("--mysql-port", type=int, default=mysql_cfg["port"])
    ap.add_argument("--mysql-user", default=mysql_cfg["user"], required=False)
    ap.add_argument("--mysql-password", default=mysql_cfg["password"], required=False)
    ap.add_argument("--mysql-database", default=mysql_cfg["database"], required=False)

    ap.add_argument("--table-source", required=True)
    ap.add_argument("--table-mon-os", required=True)
    ap.add_argument("--table-mon-sp", required=True)

    ap.add_argument("--pk", required=True, help="PK columns CSV: ex NroProtocolo,AnoProtocolo")
    ap.add_argument("--min-year", type=int, required=True)
    ap.add_argument("--year-field", required=True, help="Campo do ano na tabela source (ex AnoProtocolo)")
    ap.add_argument("--cutoff-field", required=True, help="Campo usado no corte <5000 (ex NroProtocolo)")
    ap.add_argument("--poll-interval", type=int, default=5)
    ap.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])

    args = ap.parse_args()
    logger = setup_logger(args.log_level)

    engine = make_engine(
        host=args.mysql_host,
        port=args.mysql_port,
        user=args.mysql_user,
        password=args.mysql_password,
        database=args.mysql_database,
    )

    logger.info("--- Script Iniciado ---")

    while True:
        try:
            sync_source_to_monitors(engine, args, logger)
            time.sleep(args.poll_interval)
        except KeyboardInterrupt:
            logger.info("Interrompido pelo usuário (Ctrl+C). Encerrando.")
            break
        except Exception as e:
            logger.error(f"[CICLO ERRO] {e!r}")
            logger.exception(e)
            time.sleep(max(3, args.poll_interval))


if __name__ == "__main__":
    main()

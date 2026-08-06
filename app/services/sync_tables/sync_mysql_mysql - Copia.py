# =========================
# sync_mysql_mysql.py
# =========================

import argparse
import pandas as pd
from sqlalchemy import create_engine, text
from datetime import datetime
import urllib.parse
import time
import warnings

warnings.filterwarnings("ignore")


def log(msg):
    print(f"[{datetime.now()}] {msg}", flush=True)


def parse_args():
    ap = argparse.ArgumentParser(description="Sync MySQL <-> MySQL (escopo explícito por CLI, whitelist)")

    ap.add_argument("--domain", required=True, help="Nome do domínio (protocolos, detalhes, etc)")
    ap.add_argument("--table-source", required=True, help="Tabela fonte MySQL")
    ap.add_argument("--table-mon-os", required=True, help="Tabela monitor OS")
    ap.add_argument("--table-mon-sp", required=True, help="Tabela monitor SP")

    ap.add_argument("--pk", nargs="+", required=True, help="PK(s)")

    ap.add_argument("--mysql-host", default=mysql_cfg["host"], required=False)
    ap.add_argument("--mysql-port", default=mysql_cfg["port"], required=False)
    ap.add_argument("--mysql-user", default=mysql_cfg["user"], required=False)
    ap.add_argument("--mysql-password", default=mysql_cfg["password"], required=False)
    ap.add_argument("--mysql-database", default=mysql_cfg["database"], required=False)

    ap.add_argument("--min-year", type=int, default=None, help="Ano mínimo (ex: 2024)")
    ap.add_argument("--poll-interval", type=int, default=5)

    ap.add_argument("--allowed-columns", nargs="*", default=None,
                    help="Whitelist explícita (opcional)")

    return ap.parse_args()


mysql_cfg = config_manager.get_mysql_config()

def get_mysql_engine(args):
    url = (
        f"mysql+pymysql://{args.mysql_user}:"
        f"{urllib.parse.quote_plus(args.mysql_password)}@"
        f"{args.mysql_host}:{args.mysql_port}/{args.mysql_database}"
    )
    return create_engine(url, pool_recycle=3600)


def get_mysql_columns(engine, table):
    with engine.connect() as conn:
        res = conn.execute(text(f"SHOW COLUMNS FROM {table}"))
        return [r[0] for r in res.fetchall()]


def get_year_field(domain):
    if domain.lower() == "protocolos":
        return "AnoProtocolo"
    elif domain.lower() == "detalhes":
        return "AnoProtocoloLinkDet"
    else:
        raise RuntimeError(f"Domínio desconhecido para filtro por ano: {domain}")


def validate_pk_exists(cols, pk_cols, domain, table):
    for pk in pk_cols:
        if pk not in cols:
            raise RuntimeError(f"[DOMÍNIO {domain}] PK '{pk}' não existe em '{table}'. Abortando.")


def compute_whitelist_from_tables(source_cols, mon_os_cols, mon_sp_cols, pk_cols):
    ignore = set(pk_cols) | {"sync", "lastupdate", "lastupdatep", "last_seen_hash_p"}
    common = (set(source_cols) & set(mon_os_cols) & set(mon_sp_cols)) - ignore
    wl = sorted(list(common))
    if not wl:
        raise RuntimeError("Whitelist vazia: não há colunas comuns entre source e monitores (OS/SP).")
    return wl


def normalize_floats(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.select_dtypes(include=["float"]).columns:
        s = df[col].dropna()
        if not s.empty and s.apply(lambda x: float(x).is_integer()).all():
            df[col] = df[col].astype("Int64")
    return df


def ensure_monitor_table(engine, monitor_table, df_structure, pk_cols):
    with engine.connect() as conn:
        r = conn.execute(text("SHOW TABLES LIKE :t"), {"t": monitor_table}).fetchone()
        if r:
            return

    df_structure = df_structure.copy()
    df_structure["lastupdate"] = datetime.now()
    df_structure["sync"] = False
    df_structure.head(0).to_sql(monitor_table, engine, if_exists="replace", index=False)

    with engine.connect() as conn:
        pk_sql = ", ".join(pk_cols)
        conn.execute(text(f"ALTER TABLE {monitor_table} ADD PRIMARY KEY ({pk_sql});"))
        conn.commit()


def upsert_monitor(engine, monitor_table, df_batch, pk_cols):
    if df_batch.empty:
        return

    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for _, r in df_batch.iterrows():
                where = " AND ".join([f"{pk} = :p_{pk}" for pk in pk_cols])
                params = {f"p_{pk}": r[pk] for pk in pk_cols}
                conn.execute(text(f"DELETE FROM {monitor_table} WHERE {where}"), params)

            df_batch.to_sql(monitor_table, conn, if_exists="append", index=False)
            trans.commit()
        except Exception:
            trans.rollback()
            raise


def read_table(engine, table, args, pk_cols, whitelist_cols):
    cols = [*pk_cols, *whitelist_cols]

    if args.min_year:
        year_field = get_year_field(args.domain)
        sql = f"SELECT {', '.join(cols)} FROM {table} WHERE {year_field} >= %s"
        df = pd.read_sql(sql, engine, params=[args.min_year])
    else:
        sql = f"SELECT {', '.join(cols)} FROM {table}"
        df = pd.read_sql(sql, engine)

    df = df.infer_objects()
    df = normalize_floats(df)
    return df


def sync_source_to_monitors(engine, args, whitelist_cols):
    df_source = read_table(engine, args.table_source, args, args.pk, whitelist_cols)

    if df_source.empty:
        return

    ensure_monitor_table(engine, args.table_mon_os, df_source, args.pk)
    ensure_monitor_table(engine, args.table_mon_sp, df_source, args.pk)

    if args.min_year:
        year_field = get_year_field(args.domain)

        df_mon_os = pd.read_sql(
            f"SELECT {', '.join([*args.pk, *whitelist_cols])} "
            f"FROM {args.table_mon_os} "
            f"WHERE {year_field} >= %s",
            engine,
            params=[args.min_year]
        )

        df_mon_sp = pd.read_sql(
            f"SELECT {', '.join([*args.pk, *whitelist_cols])} "
            f"FROM {args.table_mon_sp} "
            f"WHERE {year_field} >= %s",
            engine,
            params=[args.min_year]
        )
    else:
        df_mon_os = pd.read_sql(
            f"SELECT {', '.join([*args.pk, *whitelist_cols])} FROM {args.table_mon_os}",
            engine
        )
        df_mon_sp = pd.read_sql(
            f"SELECT {', '.join([*args.pk, *whitelist_cols])} FROM {args.table_mon_sp}",
            engine
        )

    df_mon_os = normalize_floats(df_mon_os.infer_objects())
    df_mon_sp = normalize_floats(df_mon_sp.infer_objects())

    src_idx = df_source.set_index(args.pk, drop=False)
    os_idx = df_mon_os.set_index(args.pk, drop=False) if not df_mon_os.empty else pd.DataFrame(columns=df_source.columns).set_index(args.pk, drop=False)
    sp_idx = df_mon_sp.set_index(args.pk, drop=False) if not df_mon_sp.empty else pd.DataFrame(columns=df_source.columns).set_index(args.pk, drop=False)

    src_comp = src_idx[whitelist_cols].astype(object).fillna("NULL")

    def calc_changes(mon_idx):
        if mon_idx.empty:
            return src_idx.copy()

        mon_comp = mon_idx[whitelist_cols].astype(object).fillna("NULL")
        common_index = src_idx.index.intersection(mon_idx.index)
        new_mask = ~src_idx.index.isin(mon_idx.index)

        diff_mask = (src_comp.loc[common_index] != mon_comp.loc[common_index]).any(axis=1)
        upd = src_idx.loc[common_index].loc[diff_mask].copy()
        ins = src_idx.loc[new_mask].copy()
        return pd.concat([upd, ins], axis=0)

    changes_os = calc_changes(os_idx)
    changes_sp = calc_changes(sp_idx)

    if not changes_os.empty:
        batch_os = changes_os.reset_index(drop=True).copy()
        batch_os["lastupdate"] = datetime.now()
        batch_os["sync"] = False
        upsert_monitor(engine, args.table_mon_os, batch_os, args.pk)
        log(f"[OS] {len(batch_os)} alterações aplicadas em {args.table_mon_os}")

    if not changes_sp.empty:
        batch_sp = changes_sp.reset_index(drop=True).copy()
        batch_sp["lastupdate"] = datetime.now()
        batch_sp["sync"] = False
        upsert_monitor(engine, args.table_mon_sp, batch_sp, args.pk)
        log(f"[SP] {len(batch_sp)} alterações aplicadas em {args.table_mon_sp}")


def main():
    args = parse_args()

    log("--- Script Iniciado ---")
    log(f"DOMÍNIO: {args.domain}")
    log(f"Source: {args.table_source}")
    log(f"Monitor OS: {args.table_mon_os}")
    log(f"Monitor SP: {args.table_mon_sp}")
    log(f"PK: {', '.join(args.pk)}")
    if args.min_year:
        log(f"Filtro: {get_year_field(args.domain)} >= {args.min_year}")

    engine = get_mysql_engine(args)

    source_cols = get_mysql_columns(engine, args.table_source)
    mon_os_cols = get_mysql_columns(engine, args.table_mon_os)
    mon_sp_cols = get_mysql_columns(engine, args.table_mon_sp)

    validate_pk_exists(source_cols, args.pk, args.domain, args.table_source)
    validate_pk_exists(mon_os_cols, args.pk, args.domain, args.table_mon_os)
    validate_pk_exists(mon_sp_cols, args.pk, args.domain, args.table_mon_sp)

    if args.allowed_columns:
        whitelist_cols = [c for c in args.allowed_columns if c in source_cols and c in mon_os_cols and c in mon_sp_cols]
        if not whitelist_cols:
            raise RuntimeError("allowed-columns não contém colunas válidas comuns aos 3 lados.")
    else:
        whitelist_cols = compute_whitelist_from_tables(source_cols, mon_os_cols, mon_sp_cols, args.pk)

    log(f"Whitelist: {len(whitelist_cols)} colunas")

    while True:
        try:
            sync_source_to_monitors(engine, args, whitelist_cols)
            time.sleep(args.poll_interval)
        except Exception as e:
            log(f"ERRO NO CICLO: {e}")
            time.sleep(max(5, args.poll_interval))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Encerrado.")

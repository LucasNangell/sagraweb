# =========================
# sync_access_mysql.py
# =========================

import argparse
import pandas as pd
import pyodbc
from sqlalchemy import create_engine, text
from datetime import datetime
import urllib.parse
import time
import warnings
import traceback

warnings.filterwarnings("ignore")


def log(msg):
    print(f"[{datetime.now()}] {msg}", flush=True)


def parse_args():
    ap = argparse.ArgumentParser(description="Sync Access <-> MySQL (escopo por CLI, whitelist, retry, logs claros)")

    ap.add_argument("--domain", required=True, help="Domínio (protocolos | detalhes)")
    ap.add_argument("--table-source", required=True, help="Tabela Access (ex: tabprotocolos)")
    ap.add_argument("--table-target", required=True, help="Tabela MySQL (ex: monitor_protocol_os)")

    ap.add_argument("--pk", nargs="+", required=True, help="PK(s)")

    ap.add_argument("--mdb-os", default=default_mdb_os, required=False, help="MDB OS Atual")
    ap.add_argument("--mdb-sp", default=default_mdb_sp, required=False, help="MDB Papelaria Atual")

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
default_mdb_os = config_manager.get("mdb_os_atual_path")
default_mdb_sp = config_manager.get("mdb_papelaria_path")

def get_mysql_engine(args):
    url = (
        f"mysql+pymysql://{args.mysql_user}:"
        f"{urllib.parse.quote_plus(args.mysql_password)}@"
        f"{args.mysql_host}:{args.mysql_port}/{args.mysql_database}"
    )
    return create_engine(url, pool_recycle=3600)


# ============================================================
# Campos de ano (por domínio)
# ============================================================

def get_year_field(domain: str) -> str:
    d = domain.lower().strip()
    if d == "protocolos":
        return "AnoProtocolo"
    if d == "detalhes":
        return "AnoProtocoloLinkDet"
    raise RuntimeError(f"Domínio desconhecido para filtro por ano: {domain}")


# ============================================================
# Conexões Access (CORRIGIDO: sem Mode= e com Persist Security Info)
# ============================================================

def _access_conn_str(path: str, readonly: bool) -> str:
    return (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={path};"
        f"ReadOnly={'1' if readonly else '0'};"
        r"Exclusive=0;"
        r"Persist Security Info=False;"
    )


def get_access_conn_read(path: str):
    return pyodbc.connect(_access_conn_str(path, readonly=True))


def get_access_conn_write(path: str):
    return pyodbc.connect(_access_conn_str(path, readonly=False))


# ============================================================
# Detecção de erros transientes do Access (para retry)
# ============================================================

def is_transient_access_error(err: Exception) -> bool:
    s = str(err).lower()
    return (
        "unable to open registry key temporary" in s
        or "placed in a state" in s
        or "prevents it from being opened or locked" in s
        or "-3810" in s
        or "sql_driverconnect" in s
        or "general error" in s
        or "invalid connection string attribute" in s
    )


def is_access_lock_error(err: Exception) -> bool:
    s = str(err).lower()
    return "-1102" in s or "currently locked" in s


def backoff_seconds(attempt: int) -> int:
    if attempt <= 1:
        return 10
    if attempt == 2:
        return 30
    if attempt == 3:
        return 60
    if attempt == 4:
        return 120
    return 300


def with_access_retry(stage: str, mdb_path: str, fn, *args, **kwargs):
    attempt = 0
    while True:
        attempt += 1
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            if is_transient_access_error(e):
                wait = backoff_seconds(attempt)
                log(f"[ACCESS RETRY] stage={stage} mdb={mdb_path} attempt={attempt} wait={wait}s err={e}")
                time.sleep(wait)
                continue
            raise
# ============================================================
# Split MDB por faixa de OS (IMUTÁVEL)
# ============================================================

def choose_mdb_path(nro_os, args):
    """
    REGRA IMUTÁVEL:
    OS < 5000  -> args.mdb_os
    OS >= 5000 -> args.mdb_sp
    """
    try:
        nro = int(nro_os)
    except Exception:
        return args.mdb_os
    return args.mdb_os if nro < 5000 else args.mdb_sp


# ============================================================
# Descoberta de colunas Access + MySQL e whitelist
# ============================================================

def get_access_columns(mdb_path: str, table: str):
    def _do():
        conn = get_access_conn_read(mdb_path)
        try:
            cur = conn.cursor()
            cur.execute(f"SELECT * FROM [{table}] WHERE 1=0")
            return [c[0] for c in cur.description]
        finally:
            conn.close()

    return with_access_retry("get_access_columns", mdb_path, _do)


def get_mysql_columns(engine, table):
    with engine.connect() as conn:
        res = conn.execute(text(f"SHOW COLUMNS FROM {table}"))
        return [r[0] for r in res.fetchall()]


def validate_scope(mysql_cols, pk_cols, domain, table_target):
    for pk in pk_cols:
        if pk not in mysql_cols:
            raise RuntimeError(
                f"[DOMÍNIO {domain}] A PK '{pk}' não existe na tabela MySQL '{table_target}'. "
                f"Escopo inválido. Abortando."
            )


def compute_whitelist(access_cols_os, access_cols_sp, mysql_cols, pk_cols):
    access_cols = set(access_cols_os) & set(access_cols_sp)
    ignore = set(pk_cols) | {"sync", "lastupdate", "lastupdatep", "last_seen_hash_p"}
    common = sorted(list((access_cols & set(mysql_cols)) - ignore))
    if not common:
        raise RuntimeError("Whitelist vazia: nenhuma coluna comum entre MDB(OS/SP) e MySQL.")
    return common


def normalize_floats(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.select_dtypes(include=["float"]).columns:
        s = df[col].dropna()
        if not s.empty and s.apply(lambda x: float(x).is_integer()).all():
            df[col] = df[col].astype("Int64")
    return df


# ============================================================
# Leitura Access unificada (OS + Papelaria) com filtro por ano
# ============================================================

def read_access_table(mdb_path: str, access_table: str, cols_sql: str, args):
    year_field = get_year_field(args.domain)

    def _do():
        conn = get_access_conn_read(mdb_path)
        try:
            if args.min_year:
                sql = f"SELECT {cols_sql} FROM [{access_table}] WHERE [{year_field}] >= ?"
                df = pd.read_sql(sql, conn, params=[args.min_year])
            else:
                sql = f"SELECT {cols_sql} FROM [{access_table}]"
                df = pd.read_sql(sql, conn)
            return df
        finally:
            conn.close()

    df = with_access_retry("read_access_table", mdb_path, _do)
    df = df.infer_objects()
    df = normalize_floats(df)
    return df


def read_access_union(args, access_table, pk_cols, whitelist_cols):
    cols_sql = ", ".join([*pk_cols, *whitelist_cols])

    df_os = read_access_table(args.mdb_os, access_table, cols_sql, args)
    df_os["__mdb_origin"] = "OS"

    df_sp = read_access_table(args.mdb_sp, access_table, cols_sql, args)
    df_sp["__mdb_origin"] = "PAPELARIA"

    out = pd.concat([df_os, df_sp], ignore_index=True)
    return out


# ============================================================
# MySQL setup + upsert
# ============================================================

def setup_mysql_table_from_access(engine, table_target, df_structure, pk_cols):
    df_structure = df_structure.copy()
    df_structure["lastupdate"] = datetime.now()
    df_structure["sync"] = False
    df_structure.head(0).to_sql(table_target, engine, if_exists="replace", index=False)

    with engine.connect() as conn:
        pk_sql = ", ".join(pk_cols)
        conn.execute(text(f"ALTER TABLE {table_target} ADD PRIMARY KEY ({pk_sql});"))
        conn.commit()


def mysql_upsert_batch(engine, table_target, df_batch, pk_cols):
    if df_batch.empty:
        return

    with engine.connect() as conn:
        trans = conn.begin()
        try:
            for _, r in df_batch.iterrows():
                where = " AND ".join([f"{pk} = :p_{pk}" for pk in pk_cols])
                params = {f"p_{pk}": r[pk] for pk in pk_cols}
                conn.execute(text(f"DELETE FROM {table_target} WHERE {where}"), params)

            df_batch.to_sql(table_target, conn, if_exists="append", index=False)
            trans.commit()
        except Exception:
            trans.rollback()
            raise
# ============================================================
# LOOKUP-SAFE: Access update (evita "ficar em branco" via ODBC)
# ============================================================

def is_blank(v):
    return v is None or (isinstance(v, str) and v == "")


def to_str_safe(v):
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    return str(v).replace("\x00", "")


def escape_access_literal(s: str) -> str:
    return s.replace("'", "''")


def access_update_text_with_fallback(cur, table_source, col, pk_cols, pk_vals, value):
    """
    3 tentativas:
      1) SET col = ?
      2) SET col = ('' & ?)
      3) SET col = 'literal'
    Retorna: normal_ok / concat_ok / literal_ok / failed
    """
    where = " AND ".join([f"[{pk}] = ?" for pk in pk_cols])
    check_sql = f"SELECT [{col}] FROM [{table_source}] WHERE {where}"

    val = to_str_safe(value)
    if is_blank(val):
        cur.execute(f"UPDATE [{table_source}] SET [{col}] = ? WHERE {where}", [None] + list(pk_vals))
        return "normal_ok"

    # 1) normal
    cur.execute(f"UPDATE [{table_source}] SET [{col}] = ? WHERE {where}", [val] + list(pk_vals))
    cur.execute(check_sql, list(pk_vals))
    got = cur.fetchone()
    gotv = got[0] if got else None
    if not is_blank(gotv):
        return "normal_ok"

    # 2) concat
    cur.execute(f"UPDATE [{table_source}] SET [{col}] = ('' & ?) WHERE {where}", [val] + list(pk_vals))
    cur.execute(check_sql, list(pk_vals))
    got = cur.fetchone()
    gotv = got[0] if got else None
    if not is_blank(gotv):
        return "concat_ok"

    # 3) literal
    lit = escape_access_literal(val)
    cur.execute(f"UPDATE [{table_source}] SET [{col}] = '{lit}' WHERE {where}", list(pk_vals))
    cur.execute(check_sql, list(pk_vals))
    got = cur.fetchone()
    gotv = got[0] if got else None
    if not is_blank(gotv):
        return "literal_ok"

    return "failed"


def access_update_generic(cur, table_source, col, pk_cols, pk_vals, value, is_text: bool):
    where = " AND ".join([f"[{pk}] = ?" for pk in pk_cols])
    if is_text:
        return access_update_text_with_fallback(cur, table_source, col, pk_cols, pk_vals, value)

    v = None if (isinstance(value, float) and pd.isna(value)) else value
    cur.execute(f"UPDATE [{table_source}] SET [{col}] = ? WHERE {where}", [v] + list(pk_vals))
    return "normal_ok"


# ============================================================
# Lock-safe por registro (para -1102)
# ============================================================

LOCK_BACKOFF = {}  # key=(domain, table_target, pk_tuple) -> {"count":int, "next_try":datetime}


def reverse_sync_mysql_to_access(engine, args, whitelist_cols, mysql_pk_cols, access_table):
    """
    Puxa registros com sync=1 e escreve no Access.
    - Respeita split MDB por faixa OS
    - Loga PK claramente
    - Lock-safe (-1102) com backoff por PK
    - Retry para falhas transientes de conexão Access
    """
    cols_sql = ", ".join([*mysql_pk_cols, *whitelist_cols, "sync"])
    year_field = get_year_field(args.domain)

    if args.min_year:
        sql = f"SELECT {cols_sql} FROM {args.table_target} WHERE sync = 1 AND {year_field} >= %s"
        df = pd.read_sql(sql, engine, params=[args.min_year])
    else:
        sql = f"SELECT {cols_sql} FROM {args.table_target} WHERE sync = 1"
        df = pd.read_sql(sql, engine)

    if df.empty:
        return

    log(f"[REVERSE] {len(df)} registros ({args.table_target} -> {access_table})")

    mysql_conn = engine.connect()
    try:
        for _, row in df.iterrows():
            pk_vals = tuple(row[pk] for pk in mysql_pk_cols)
            pk_disp = "/".join(str(v) for v in pk_vals)

            nro_os = pk_vals[0]  # convenção: 1º campo pk é nro
            mdb_path = choose_mdb_path(nro_os, args)

            backoff_key = (args.domain, args.table_target, pk_vals)
            if backoff_key in LOCK_BACKOFF:
                info = LOCK_BACKOFF[backoff_key]
                if datetime.now() < info["next_try"]:
                    continue

            try:
                def _do_write():
                    conn = get_access_conn_write(mdb_path)
                    try:
                        cur = conn.cursor()
                        field_logs = []

                        for col in whitelist_cols:
                            v = row[col] if col in row.index else None
                            is_text = isinstance(v, str) or (v is not None and not isinstance(v, (int, float, bool)))
                            mode = access_update_generic(cur, access_table, col, mysql_pk_cols, pk_vals, v, is_text=is_text)

                            if mode in ("concat_ok", "literal_ok", "failed"):
                                field_logs.append(f"{col}:{mode}")

                        conn.commit()
                        return field_logs
                    finally:
                        conn.close()

                field_logs = with_access_retry(
                    stage=f"reverse_write pk={pk_disp}",
                    mdb_path=mdb_path,
                    fn=_do_write
                )

                # sucesso -> limpa backoff
                if backoff_key in LOCK_BACKOFF:
                    del LOCK_BACKOFF[backoff_key]

                if field_logs:
                    log(f"[REVERSE OK] PK {pk_disp} mdb={mdb_path} fallback: "
                        f"{', '.join(field_logs[:10])}{' ...' if len(field_logs) > 10 else ''}")
                else:
                    log(f"[REVERSE OK] PK {pk_disp} mdb={mdb_path}")

                # baixa sync no MySQL só após sucesso Access
                where = " AND ".join([f"{pk} = :{pk}" for pk in mysql_pk_cols])
                mysql_conn.execute(
                    text(f"UPDATE {args.table_target} SET sync=0, lastupdate=:now WHERE {where}"),
                    {**{pk: row[pk] for pk in mysql_pk_cols}, "now": datetime.now()},
                )
                mysql_conn.commit()

            except Exception as e:
                log(f"[REVERSE ERRO] PK {pk_disp} mdb={mdb_path} err={e}")

                if is_access_lock_error(e):
                    info = LOCK_BACKOFF.get(backoff_key, {"count": 0, "next_try": datetime.now()})
                    info["count"] += 1
                    wait = backoff_seconds(info["count"])
                    info["next_try"] = datetime.now() + pd.Timedelta(seconds=wait)
                    LOCK_BACKOFF[backoff_key] = info
                    log(f"[LOCK] PK {pk_disp} bloqueado. Tentativa {info['count']}. Nova em {wait}s.")
                continue
    finally:
        try:
            mysql_conn.close()
        except Exception:
            pass


# ============================================================
# MAIN
# ============================================================

def main():
    args = parse_args()

    log("--- Script Iniciado ---")
    log(f"DOMÍNIO: {args.domain}")
    log(f"Access table_source: {args.table_source}")
    log(f"MySQL table_target: {args.table_target}")
    log(f"PK: {', '.join(args.pk)}")
    log("Regra MDB: OS < 5000 -> OS Atual | OS >= 5000 -> Papelaria Atual (IMUTÁVEL)")
    if args.min_year:
        log(f"Filtro: {get_year_field(args.domain)} >= {args.min_year}")

    engine = get_mysql_engine(args)

    access_cols_os = get_access_columns(args.mdb_os, args.table_source)
    access_cols_sp = get_access_columns(args.mdb_sp, args.table_source)

    mysql_cols = get_mysql_columns(engine, args.table_target)
    validate_scope(mysql_cols, args.pk, args.domain, args.table_target)

    if args.allowed_columns:
        wl = []
        for c in args.allowed_columns:
            if c in access_cols_os and c in access_cols_sp and c in mysql_cols and c not in args.pk:
                wl.append(c)
        if not wl:
            raise RuntimeError("allowed-columns informado, mas nenhuma coluna é comum entre MDB(OS/SP) e MySQL.")
        whitelist_cols = sorted(wl)
        log(f"Whitelist explícita aplicada: {len(whitelist_cols)}")
    else:
        whitelist_cols = compute_whitelist(access_cols_os, access_cols_sp, mysql_cols, args.pk)
        log(f"Whitelist automática (MDB∩MySQL): {len(whitelist_cols)}")

    first_run = True

    while True:
        try:
            # Reverse só depois do baseline
            if not first_run:
                reverse_sync_mysql_to_access(
                    engine,
                    args,
                    whitelist_cols=whitelist_cols,
                    mysql_pk_cols=args.pk,
                    access_table=args.table_source
                )

            # Forward
            df_mdb = read_access_union(args, args.table_source, args.pk, whitelist_cols)

            if df_mdb.empty:
                time.sleep(args.poll_interval)
                continue

            if first_run:
                log("Iniciando Baseline (primeira execução)...")
                setup_mysql_table_from_access(engine, args.table_target, df_mdb, args.pk)

                df_init = df_mdb.copy()
                df_init["lastupdate"] = datetime.now()
                df_init["sync"] = False
                df_init.to_sql(args.table_target, engine, if_exists="append", index=False, chunksize=1000)

                log(f"Baseline concluído. Registros: {len(df_init)}")
                first_run = False
                time.sleep(args.poll_interval)
                continue

            cols_sql = ", ".join([*args.pk, *whitelist_cols])
            year_field = get_year_field(args.domain)

            # filtro por ano também no MySQL (evita ruído)
            if args.min_year:
                df_mysql = pd.read_sql(
                    f"SELECT {cols_sql} FROM {args.table_target} WHERE {year_field} >= %s",
                    engine,
                    params=[args.min_year]
                )
            else:
                df_mysql = pd.read_sql(
                    f"SELECT {cols_sql} FROM {args.table_target}",
                    engine
                )

            df_mysql = normalize_floats(df_mysql.infer_objects())

            if df_mysql.empty:
                time.sleep(args.poll_interval)
                continue

            mdb_idx = df_mdb.set_index(args.pk, drop=False)
            mysql_idx = df_mysql.set_index(args.pk, drop=False)

            mdb_comp = mdb_idx[whitelist_cols].astype(object).fillna("NULL")
            mysql_comp = mysql_idx[whitelist_cols].astype(object).fillna("NULL")

            common_index = mdb_idx.index.intersection(mysql_idx.index)
            new_mask = ~mdb_idx.index.isin(mysql_idx.index)
            diff_mask = (mdb_comp.loc[common_index] != mysql_comp.loc[common_index]).any(axis=1)

            upd = mdb_idx.loc[common_index].loc[diff_mask].copy()
            ins = mdb_idx.loc[new_mask].copy()

            changes = pd.concat([upd, ins], axis=0)

            if not changes.empty:
                log(f"[FORWARD] Detectadas {len(changes)} alterações MDB -> MySQL.")
                batch = changes.reset_index(drop=True).copy()
                batch["lastupdate"] = datetime.now()
                batch["sync"] = False
                mysql_upsert_batch(engine, args.table_target, batch, args.pk)
                log("[FORWARD] Sincronização MDB -> MySQL concluída.")

            time.sleep(args.poll_interval)

        except Exception as e:
            log(f"[CICLO ERRO] stage=main_loop err={e}")
            log(traceback.format_exc())
            time.sleep(max(5, args.poll_interval))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Encerrado.")

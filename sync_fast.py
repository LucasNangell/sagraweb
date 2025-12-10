import pyodbc
import pymysql
import sys
import logging
from config_manager import config_manager
import warnings

warnings.filterwarnings("ignore")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

ACCESS_DB_OS = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb"
ACCESS_DB_PAPELARIA = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb"

def get_mysql_conn():
    return pymysql.connect(
        host=config_manager.get("db_host", "10.120.1.125"),
        port=int(config_manager.get("db_port", 3306)),
        user=config_manager.get("db_user", "usr_sefoc"),
        password=config_manager.get("db_password", "sefoc_2018"),
        database=config_manager.get("db_name", "sagrafulldb"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        charset='utf8mb4'
    )

def get_access_conn(db_path):
    conn_str = r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + db_path + ";"
    return pyodbc.connect(conn_str)

def clean_int(val):
    if val is None: return None
    if isinstance(val, int): return val
    try:
        s = str(val).strip()
        if not s: return None
        return int(float(s))
    except:
        return None

def clean_date(val):
    if val is None: return None
    return val

def sync_fast_logic():
    mysql_conn = None
    try:
        mysql_conn = get_mysql_conn()
        logging.info("Connected to MySQL.")
        
        dbs = [
            (ACCESS_DB_OS, "OS Atual"),
            (ACCESS_DB_PAPELARIA, "Papelaria Atual")
        ]
        
        affected_os = set()
        
        # 1. Sync Andamentos Only (Fast Check)
        for db_path, source_name in dbs:
            try:
                acc_conn = get_access_conn(db_path)
                acc_cursor = acc_conn.cursor()
                
                logging.info(f"Checking new Andamentos in {source_name}...")
                
                # Get Existing CodStatus set for fast lookup
                existing_keys = set()
                with mysql_conn.cursor() as cur:
                    cur.execute("SELECT CodStatus FROM tabAndamento")
                    for row in cur.fetchall():
                        existing_keys.add(row['CodStatus'])
                
                # Fetch Access Data
                acc_cursor.execute("SELECT * FROM [tabAndamento]")
                col_names = [column[0] for column in acc_cursor.description]
                col_map = {name: i for i, name in enumerate(col_names)}
                
                rows_to_insert = []
                
                for row in acc_cursor.fetchall():
                    cod_idx = col_map.get('CodStatus')
                    if cod_idx is None: continue
                    key = str(row[cod_idx]).strip()
                    
                    if key and key not in existing_keys:
                        rows_to_insert.append(row)
                        
                        # Track OS for dependency check
                        nro_idx = col_map.get('NroProtocoloLink')
                        ano_idx = col_map.get('AnoProtocoloLink')
                        if nro_idx is not None and ano_idx is not None:
                            nro = clean_int(row[nro_idx])
                            ano = clean_int(row[ano_idx])
                            if nro and ano:
                                affected_os.add((nro, ano))
                
                if rows_to_insert:
                    logging.info(f"  Found {len(rows_to_insert)} new Andamentos. Inserting...")
                    
                    # Insert Logic
                    placeholders = ', '.join(['%s'] * len(col_names))
                    cols_sql = ', '.join([f"`{c}`" for c in col_names])
                    sql = f"INSERT IGNORE INTO `tabAndamento` ({cols_sql}) VALUES ({placeholders})"
                    
                    data_batch = []
                    for r in rows_to_insert:
                        vals = []
                        for i, cell in enumerate(r):
                            # Basic cleaning
                            col = col_names[i]
                            if col in ['Data']: vals.append(clean_date(cell))
                            elif col == 'UltimoStatus': vals.append(0) # Logic will fix later
                            else: vals.append(cell)
                        data_batch.append(vals)
                        
                    with mysql_conn.cursor() as cur:
                        cur.executemany(sql, data_batch)
                else:
                    logging.info("  No new Andamentos found.")
                
                acc_conn.close()

            except Exception as e:
                logging.error(f"Error processing {source_name}: {e}")

        # 2. Check Missing Protocols for Affected OSs
        if affected_os:
            logging.info(f"Verifying {len(affected_os)} affected OSs for missing parent records...")
            
            # Check which are missing in MySQL tabProtocolos
            missing_os = []
            with mysql_conn.cursor() as cur:
                cur.execute("SELECT NroProtocolo, AnoProtocolo FROM tabProtocolos")
                existing_protos = set((r['NroProtocolo'], r['AnoProtocolo']) for r in cur.fetchall())
                
                for os_key in affected_os:
                    if os_key not in existing_protos:
                        missing_os.append(os_key)
            
            if missing_os:
                logging.info(f"  Found {len(missing_os)} missing Protocols. Fetching from Access...")
                
                # Fetch specific OSs from Access
                # Since we don't know which DB has which OS easily without querying, 
                # we query both for the missing ones.
                
                for db_path, source_name in dbs:
                    try:
                        acc_conn = get_access_conn(db_path)
                        acc_cursor = acc_conn.cursor()
                        
                        # Helper to sync specific table
                        def sync_missing_rows(table, key_col_nro, key_col_ano):
                            acc_cursor.execute(f"SELECT * FROM [{table}]")
                            cols = [c[0] for c in acc_cursor.description]
                            col_base_map = {name: i for i, name in enumerate(cols)}
                            
                            idx_n = col_base_map.get(key_col_nro)
                            idx_a = col_base_map.get(key_col_ano)
                            
                            found_rows = []
                            # Iterating all rows in Access is inefficient but safer than constructing generic SQL IN clauses 
                            # for Access driver which can be finicky.
                            # Given "Fast Update", maybe we assume the missing ones are recent? 
                            # Let's iterate. If table is huge, WHERE clause is better.
                            
                            # Construct WHERE clause for efficiency?
                            # WHERE (Nro=X AND Ano=Y) OR ...
                            # Access SQL max length limits apply. 
                            # Let's try iterating if lists are small, or smart fetching.
                            
                            # For robustness here, let's just fetch all and filter in Python. 
                            # If optimization needed later, we switch to SQL generation.
                            
                            rows = acc_cursor.fetchall()
                            for r in rows:
                                n = clean_int(r[idx_n])
                                a = clean_int(r[idx_a])
                                if (n, a) in missing_os:
                                    found_rows.append(r)

                            if found_rows:
                                logging.info(f"    Syncing {len(found_rows)} rows for {table} from {source_name}")
                                pl = ', '.join(['%s'] * len(cols))
                                csql = ', '.join([f"`{c}`" for c in cols])
                                i_sql = f"INSERT IGNORE INTO `{table}` ({csql}) VALUES ({pl})"
                                
                                batch = []
                                for fr in found_rows:
                                    vals = []
                                    for i, cell in enumerate(fr):
                                        if cols[i] in ['DataEntrada', 'EntregData']: 
                                            vals.append(clean_date(cell))
                                        else: 
                                            vals.append(cell)
                                    batch.append(vals)
                                
                                with mysql_conn.cursor() as mc:
                                    mc.executemany(i_sql, batch)

                        sync_missing_rows('tabProtocolos', 'NroProtocolo', 'AnoProtocolo')
                        sync_missing_rows('tabDetalhesServico', 'NroProtocoloLinkDet', 'AnoProtocoloLinkDet')
                        
                        acc_conn.close()
                    except Exception as e:
                        logging.error(f"Error fetching missing OSs from {source_name}: {e}")

        # 3. Recalculate UltimoStatus (Always safe)
        recalculate_ultimo_status(mysql_conn)
        
        logging.info("Fast Update Completed Successfully.")

    except Exception as e:
        logging.error(f"Critical Error: {e}")
    finally:
        if mysql_conn and mysql_conn.open: mysql_conn.close()

def recalculate_ultimo_status(conn):
    try:
        logging.info("Recalculating UltimoStatus (Strategy: MAX(CodStatus))...")
        with conn.cursor() as cursor:
            # 1. Reset all to 0
            cursor.execute("UPDATE tabAndamento SET UltimoStatus = 0")
            
            # 2. Set only the row with MAX(CodStatus) for each OS to 1
            sql_update = """
            UPDATE tabAndamento t
            JOIN (
                SELECT NroProtocoloLink, AnoProtocoloLink, MAX(CodStatus) as MaxCod
                FROM tabAndamento
                GROUP BY NroProtocoloLink, AnoProtocoloLink
            ) m ON t.NroProtocoloLink = m.NroProtocoloLink 
               AND t.AnoProtocoloLink = m.AnoProtocoloLink 
               AND t.CodStatus = m.MaxCod
            SET t.UltimoStatus = 1;
            """
            cursor.execute(sql_update)
            
    except Exception as e:
        logging.error(f"Error recalculating UltimoStatus: {e}")

if __name__ == "__main__":
    sync_fast_logic()

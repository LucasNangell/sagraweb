import time
import yaml
import logging
import sys
import mysql.connector
from datetime import datetime
from mysql.connector import Error

ANO_CORTE = 2024
# --- CONFIGURAÇÃO DE LOGS ---
root = logging.getLogger()
root.setLevel(logging.INFO)

handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(message)s', datefmt='%H:%M:%S')
handler.setFormatter(formatter)
root.addHandler(handler)

# Silencia logs internos do conector
logging.getLogger("mysql.connector").setLevel(logging.WARNING)

def load_config():
    with open('sync_conf.yaml', 'r') as file:
        return yaml.safe_load(file)

class ProtocoloSyncStable:
    def __init__(self, config):
        self.cfg = config['sync_protocolos']
        self.db_config = self.cfg['mysql']
        self.conn = None
        self.cursor = None
        
        self.source_hashes = {}
        self.last_monitor_check = None
        self.data_columns = [] 
        self.hash_query_part = "" 

    def connect(self):
        try:
            if self.conn is None or not self.conn.is_connected():
                self.conn = mysql.connector.connect(**self.db_config)
                self.conn.autocommit = True 
                self.cursor = self.conn.cursor(dictionary=True, buffered=True)
                logging.info(">>> Conexão Reestabelecida")
        except Error as e:
            logging.error(f"Erro de conexão: {e}")
            time.sleep(5)
            self.connect()

    def _fetch_columns(self, table_name):
        try:
            self.cursor.execute(f"SHOW COLUMNS FROM {table_name}")
            return {c['Field'] for c in self.cursor.fetchall()}
        except Error:
            return set()

    def setup_schema(self):
        self.connect()
        source_cols = self._fetch_columns(self.cfg['table_source'])
        mon_os_cols = self._fetch_columns(self.cfg['table_monitor_os'])
        mon_sp_cols = self._fetch_columns(self.cfg['table_monitor_sp'])
        
        common_cols = source_cols.intersection(mon_os_cols).intersection(mon_sp_cols)
        
        ignore = set(self.cfg['control_columns'])
        pks = set(self.cfg['pk_columns']) # <--- CORREÇÃO AQUI: Isolar PKs
        
        # Removemos as colunas de controle E as chaves primárias da lista de dados genéricos
        # As PKs serão tratadas explicitamente nas queries
        self.data_columns = sorted(list(common_cols - ignore - pks))
        
        if not self.data_columns:
            logging.critical("ERRO FATAL: Nenhuma coluna comum encontrada (além das chaves)!")
            exit(1)

        # Hash agora não inclui a PK no cálculo (o que é correto, pois a PK nunca muda para o mesmo registro)
        concat_parts = [f"COALESCE(CAST({col} AS CHAR), '')" for col in self.data_columns]
        concat_string = ", ".join(concat_parts)
        self.hash_query_part = f"MD5(CONCAT_WS('|', {concat_string})) as row_hash"
        
        logging.info(f"Schema OK. Monitorando {len(self.data_columns)} campos de dados.")

    def get_target_table(self, nro_protocolo):
        try:
            return self.cfg['table_monitor_os'] if int(nro_protocolo) < 5000 else self.cfg['table_monitor_sp']
        except:
            return self.cfg['table_monitor_sp']

    def fetch_full_row(self, table, nro, ano):
        # Precisamos adicionar explicitamente as PKs na busca, já que removemos de data_columns
        cols = ", ".join(self.data_columns + ["NroProtocolo", "AnoProtocolo"])
        if table != self.cfg['table_source']:
            cols += ", lastupdate"
        sql = f"SELECT {cols} FROM {table} WHERE NroProtocolo = %s AND AnoProtocolo = %s"
        self.cursor.execute(sql, (nro, ano))
        return self.cursor.fetchone()

    def upsert_monitor(self, table_target, row_data):
        pk_nro, pk_ano = row_data['NroProtocolo'], row_data['AnoProtocolo']
        vals = [row_data[c] for c in self.data_columns]
        
        # update_str não precisa ter PKs, pois PKs não mudam
        update_str = ", ".join([f"{c} = %s" for c in self.data_columns])
        placeholders = ', '.join(['%s'] * len(self.data_columns))
        col_names = ', '.join(self.data_columns)
        
        # Aqui estava o erro: col_names tinha AnoProtocolo e a gente passava AnoProtocolo de novo manualmente
        # Agora col_names só tem os dados, e passamos as PKs manualmente. Perfeito.
        sql = f"""
            INSERT INTO {table_target} ({col_names}, NroProtocolo, AnoProtocolo, lastupdate, sync)
            VALUES ({placeholders}, %s, %s, NOW(), TRUE)
            ON DUPLICATE KEY UPDATE
            {update_str}, lastupdate = NOW(), sync = TRUE
        """
        # A ordem dos params é: [Dados do Insert] + [PK1, PK2] + [Dados do Update]
        params = vals + [pk_nro, pk_ano] + vals
        
        try:
            self.cursor.execute(sql, params)
            logging.info(f"!!! SUCESSO !!! -> Tabela {table_target} atualizada | ID: {pk_nro}/{pk_ano}")
        except Error as e:
            logging.error(f"Erro ao gravar no monitor ({table_target}): {e}")

    def update_source(self, row_data):
        pk_nro, pk_ano = row_data['NroProtocolo'], row_data['AnoProtocolo']
        
        # Como removemos PKs de self.data_columns, não precisamos mais filtrar aqui
        cols_to_update = self.data_columns
        vals = [row_data[c] for c in cols_to_update]
        
        set_clause = ", ".join([f"{c} = %s" for c in cols_to_update])
        
        sql = f"UPDATE {self.cfg['table_source']} SET {set_clause} WHERE NroProtocolo = %s AND AnoProtocolo = %s"
        try:
            self.cursor.execute(sql, vals + [pk_nro, pk_ano])
            logging.info(f"!!! SUCESSO !!! <- Fonte Atualizada | ID: {pk_nro}/{pk_ano}")
        except Error as e:
            logging.error(f"Erro update source: {e}")

    def initial_load(self):
        logging.info("Carregando Hashmap inicial...")
        self.connect()
        self.cursor.execute("SELECT NOW()")
        db_now = self.cursor.fetchone()['NOW()']
        self.last_monitor_check = db_now
        
        sql = f"SELECT NroProtocolo, AnoProtocolo, {self.hash_query_part} FROM {self.cfg['table_source']} WHERE AnoProtocolo >= {ANO_CORTE}"
        self.cursor.execute(sql)
        rows = self.cursor.fetchall()
        
        for r in rows:
            key = (r['NroProtocolo'], r['AnoProtocolo'])
            self.source_hashes[key] = r['row_hash']
            
        logging.info(f"Carga completa. Memória sincronizada com {len(self.source_hashes)} registros.")

    def check_source_changes(self):
        sql = f"SELECT NroProtocolo, AnoProtocolo, {self.hash_query_part} FROM {self.cfg['table_source']} WHERE AnoProtocolo >= {ANO_CORTE}"
        self.cursor.execute(sql)
        current_rows = self.cursor.fetchall()
        
        current_map = {}
        changes_found = 0
        
        for row in current_rows:
            key = (row['NroProtocolo'], row['AnoProtocolo'])
            db_hash = row['row_hash']
            current_map[key] = db_hash
            
            if key not in self.source_hashes:
                logging.info(f"\n[NOVO REGISTRO] ID: {key} detectado na fonte.")
                self.process_change(key, db_hash)
                changes_found += 1
            elif self.source_hashes[key] != db_hash:
                logging.info(f"\n[ALTERAÇÃO] ID: {key}. Hash Antigo: {self.source_hashes[key]} != Novo: {db_hash}")
                self.process_change(key, db_hash)
                changes_found += 1
        
        deleted_keys = set(self.source_hashes.keys()) - set(current_map.keys())
        if deleted_keys:
            # logging.info(f"\n[DELETADOS] {len(deleted_keys)} registros.")
            for k in deleted_keys:
                del self.source_hashes[k]

        return changes_found

    def process_change(self, key, new_hash):
        full_row = self.fetch_full_row(self.cfg['table_source'], key[0], key[1])
        if full_row:
            target = self.get_target_table(key[0])
            self.upsert_monitor(target, full_row)
            self.source_hashes[key] = new_hash

    def check_monitor_changes(self):
        check_time = self.last_monitor_check
        self.cursor.execute("SELECT NOW()")
        new_check_time = self.cursor.fetchone()['NOW()']
        
        monitors = [self.cfg['table_monitor_os'], self.cfg['table_monitor_sp']]
        for tbl in monitors:
            sql = f"SELECT * FROM {tbl} WHERE lastupdate >= %s AND AnoProtocolo >= {ANO_CORTE}"
            self.cursor.execute(sql, (check_time,))
            changed_rows = self.cursor.fetchall()
            
            if changed_rows:
                logging.info(f"\n[MONITOR] {len(changed_rows)} alterações detectadas em {tbl}.")
            
            for row in changed_rows:
                key = (row['NroProtocolo'], row['AnoProtocolo'])
                self.update_source(row)
                
                sql_hash = f"SELECT {self.hash_query_part} FROM {self.cfg['table_source']} WHERE NroProtocolo=%s AND AnoProtocolo=%s"
                self.cursor.execute(sql_hash, (key[0], key[1]))
                res = self.cursor.fetchone()
                if res:
                    self.source_hashes[key] = res['row_hash']

        self.last_monitor_check = new_check_time

    def start(self):
        self.setup_schema()
        self.initial_load()
        logging.info("\n=== MONITORAMENTO INICIADO ===")
        
        while True:
            try:
                sys.stdout.write(".")
                sys.stdout.flush()

                if not self.conn or not self.conn.is_connected():
                    self.connect()

                found_src = self.check_source_changes()
                self.check_monitor_changes()
                
                if found_src > 0:
                    print("") 
                
            except Exception as e:
                print("")
                logging.error(f"Erro no ciclo: {e}")
                time.sleep(2)
                self.connect()
            
            time.sleep(self.cfg['scan_interval_seconds'])

if __name__ == "__main__":
    conf = load_config()
    syncer = ProtocoloSyncStable(conf)
    syncer.start()
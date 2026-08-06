import time
import yaml
import logging
import sys
import mysql.connector
from datetime import datetime
from mysql.connector import Error
import threading
import os
import random

# --- CONFIGURAÇÃO DE LOGS ---
# Removemos o log no root para evitar conflito de formatação entre threads
# Cada thread usará seu próprio método de log

def load_full_config(yaml_file="sync_conf.yaml"):
    if not os.path.exists(yaml_file):
        print(f"ERRO CRÍTICO: Arquivo '{yaml_file}' não encontrado.")
        sys.exit(1)
    with open(yaml_file, 'r') as file:
        return yaml.safe_load(file)

class MySQLSyncWorker(threading.Thread):
    def __init__(self, section_name, config):
        super().__init__()
        self.name = section_name
        self.cfg = config
        self.db_config = self.cfg['mysql']
        self.conn = None
        self.cursor = None
        
        # Configurações dinâmicas
        self.table_source = self.cfg['table_source']
        self.table_mon_os = self.cfg['table_monitor_os']
        self.table_mon_sp = self.cfg['table_monitor_sp']
        self.pk_cols = self.cfg['pk_columns'] # Lista ['Nro...', 'Ano...']
        
        # Validação básica
        if len(self.pk_cols) != 2:
            print(f"[{self.name}] ERRO: Este script espera exatamente 2 chaves primárias (Composite Key).")
            return

        self.pk1_name = self.pk_cols[0] # Ex: NroProtocolo ou NroProtocoloLinkDet
        self.pk2_name = self.pk_cols[1] # Ex: AnoProtocolo ou AnoProtocoloLinkDet
        
        self.source_hashes = {}
        self.last_monitor_check = None
        self.data_columns = [] 
        self.hash_query_part = "" 

    def log(self, msg):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] [{self.name}] {msg}")

    def connect(self):
        try:
            if self.conn is None or not self.conn.is_connected():
                self.conn = mysql.connector.connect(**self.db_config)
                self.conn.autocommit = True 
                self.cursor = self.conn.cursor(dictionary=True, buffered=True)
                # self.log("Conexão estabelecida")
        except Error as e:
            self.log(f"Erro de conexão: {e}")
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
        source_cols = self._fetch_columns(self.table_source)
        mon_os_cols = self._fetch_columns(self.table_mon_os)
        mon_sp_cols = self._fetch_columns(self.table_mon_sp)
        
        common_cols = source_cols.intersection(mon_os_cols).intersection(mon_sp_cols)
        
        ignore = set(self.cfg['control_columns'])
        pks = set(self.pk_cols)
        
        # Removemos controle e PKs da lista de dados genéricos
        self.data_columns = sorted(list(common_cols - ignore - pks))
        
        if not self.data_columns:
            self.log("ERRO FATAL: Nenhuma coluna comum encontrada (além das chaves)!")
            return False

        # Hash calculation (exclui PKs pois elas não mudam)
        concat_parts = [f"COALESCE(CAST({col} AS CHAR), '')" for col in self.data_columns]
        concat_string = ", ".join(concat_parts)
        self.hash_query_part = f"MD5(CONCAT_WS('|', {concat_string})) as row_hash"
        
        self.log(f"Schema OK. Monitorando {len(self.data_columns)} campos.")
        return True

    def get_target_table(self, pk1_value):
        # Lógica: Se o primeiro campo da PK (Nro...) for < 5000, vai para OS, senão SP
        try:
            val = int(pk1_value)
            return self.table_mon_os if val < 5000 else self.table_mon_sp
        except:
            return self.table_mon_sp

    def fetch_full_row(self, table, val_pk1, val_pk2):
        # Constrói query dinâmica baseada nos nomes das PKs
        cols = ", ".join(self.data_columns + [self.pk1_name, self.pk2_name])
        if table != self.table_source:
            cols += ", lastupdate"
            
        sql = f"SELECT {cols} FROM {table} WHERE {self.pk1_name} = %s AND {self.pk2_name} = %s"
        self.cursor.execute(sql, (val_pk1, val_pk2))
        return self.cursor.fetchone()

    def upsert_monitor(self, table_target, row_data):
        val_pk1 = row_data[self.pk1_name]
        val_pk2 = row_data[self.pk2_name]
        
        vals = [row_data[c] for c in self.data_columns]
        
        update_str = ", ".join([f"{c} = %s" for c in self.data_columns])
        placeholders = ', '.join(['%s'] * len(self.data_columns))
        col_names = ', '.join(self.data_columns)
        
        # Query Dinâmica
        sql = f"""
            INSERT INTO {table_target} ({col_names}, {self.pk1_name}, {self.pk2_name}, lastupdate, sync)
            VALUES ({placeholders}, %s, %s, NOW(), TRUE)
            ON DUPLICATE KEY UPDATE
            {update_str}, lastupdate = NOW(), sync = TRUE
        """
        # Params: [Dados...] + [PK1, PK2] + [Dados...]
        params = vals + [val_pk1, val_pk2] + vals
        
        try:
            self.cursor.execute(sql, params)
            self.log(f"Monitor {table_target} atualizado | ID: {val_pk1}/{val_pk2}")
        except Error as e:
            self.log(f"Erro ao gravar no monitor ({table_target}): {e}")

    def update_source(self, row_data):
        val_pk1 = row_data[self.pk1_name]
        val_pk2 = row_data[self.pk2_name]
        
        cols_to_update = self.data_columns
        vals = [row_data[c] for c in cols_to_update]
        
        set_clause = ", ".join([f"{c} = %s" for c in cols_to_update])
        
        sql = f"UPDATE {self.table_source} SET {set_clause} WHERE {self.pk1_name} = %s AND {self.pk2_name} = %s"
        try:
            self.cursor.execute(sql, vals + [val_pk1, val_pk2])
            self.log(f"Fonte Atualizada | ID: {val_pk1}/{val_pk2}")
        except Error as e:
            self.log(f"Erro update source: {e}")

    def initial_load(self):
        self.log("Carregando Hashmap inicial...")
        self.connect()
        self.cursor.execute("SELECT NOW()")
        self.last_monitor_check = self.cursor.fetchone()['NOW()']
        
        sql = f"SELECT {self.pk1_name}, {self.pk2_name}, {self.hash_query_part} FROM {self.table_source}"
        self.cursor.execute(sql)
        rows = self.cursor.fetchall()
        
        for r in rows:
            key = (r[self.pk1_name], r[self.pk2_name])
            self.source_hashes[key] = r['row_hash']
            
        self.log(f"Memória sincronizada: {len(self.source_hashes)} registros.")

    def check_source_changes(self):
        sql = f"SELECT {self.pk1_name}, {self.pk2_name}, {self.hash_query_part} FROM {self.table_source}"
        self.cursor.execute(sql)
        current_rows = self.cursor.fetchall()
        
        current_map = {}
        changes_found = 0
        
        for row in current_rows:
            key = (row[self.pk1_name], row[self.pk2_name])
            db_hash = row['row_hash']
            current_map[key] = db_hash
            
            if key not in self.source_hashes:
                self.log(f"NOVO REGISTRO detectado: {key}")
                self.process_change(key, db_hash)
                changes_found += 1
            elif self.source_hashes[key] != db_hash:
                self.log(f"ALTERAÇÃO detectada: {key}")
                self.process_change(key, db_hash)
                changes_found += 1
        
        # Limpeza de memória de deletados
        deleted_keys = set(self.source_hashes.keys()) - set(current_map.keys())
        if deleted_keys:
            for k in deleted_keys:
                del self.source_hashes[k]

        return changes_found

    def process_change(self, key, new_hash):
        full_row = self.fetch_full_row(self.table_source, key[0], key[1])
        if full_row:
            target = self.get_target_table(key[0])
            self.upsert_monitor(target, full_row)
            self.source_hashes[key] = new_hash

    def check_monitor_changes(self):
        check_time = self.last_monitor_check
        self.cursor.execute("SELECT NOW()")
        new_check_time = self.cursor.fetchone()['NOW()']
        
        monitors = [self.table_mon_os, self.table_mon_sp]
        for tbl in monitors:
            # Pega registros alterados recentemente
            sql = f"SELECT * FROM {tbl} WHERE lastupdate >= %s"
            self.cursor.execute(sql, (check_time,))
            changed_rows = self.cursor.fetchall()
            
            if changed_rows:
                self.log(f"{len(changed_rows)} alterações vindas do Monitor {tbl}.")
            
            for row in changed_rows:
                key = (row[self.pk1_name], row[self.pk2_name])
                self.update_source(row)
                
                # Atualiza hash local para evitar loop
                sql_hash = f"SELECT {self.hash_query_part} FROM {self.table_source} WHERE {self.pk1_name}=%s AND {self.pk2_name}=%s"
                self.cursor.execute(sql_hash, (key[0], key[1]))
                res = self.cursor.fetchone()
                if res:
                    self.source_hashes[key] = res['row_hash']

        self.last_monitor_check = new_check_time

    def run(self):
        # Atraso aleatório para não bater todos no banco simultaneamente
        time.sleep(random.uniform(0.5, 2.0))
        
        if not self.setup_schema():
            return
            
        self.initial_load()
        
        while True:
            try:
                if not self.conn or not self.conn.is_connected():
                    self.connect()

                self.check_source_changes()
                self.check_monitor_changes()
                
            except Exception as e:
                self.log(f"ERRO NO CICLO: {e}")
                time.sleep(5)
                self.connect()
            
            time.sleep(self.cfg.get('scan_interval_seconds', 1))


# --- MASTER RUNNER ---

def main():
    print(f"[{datetime.now()}] --- MYSQL SYNC MASTER INICIADO ---")
    
    config_file = "sync_conf.yaml"
    full_config = load_full_config(config_file)
    
    threads = []
    
    # Procura chaves no YAML que tenham estrutura de sync (MySQL <-> MySQL)
    # Identificamos isso pela presença de 'table_source' e 'table_monitor_os'
    for section, conf_data in full_config.items():
        if isinstance(conf_data, dict) and 'table_monitor_os' in conf_data:
            print(f"-> Iniciando worker para: {section}")
            worker = MySQLSyncWorker(section, conf_data)
            worker.daemon = True
            worker.start()
            threads.append(worker)
            
    print(f"[{datetime.now()}] Total de {len(threads)} processos rodando em paralelo.")
    print("Pressione Ctrl+C para encerrar.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nEncerrando...")

if __name__ == "__main__":
    main()
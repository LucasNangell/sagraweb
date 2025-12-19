#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Monitor simples de arquivos XML - Versão OTIMIZADA e COM SYNC FORÇADO
"""

import os
import time
import hashlib
import xml.etree.ElementTree as ET
import mysql.connector
import re
from datetime import datetime
import sys

# Configuração do Banco de Dados
DB_HOST = 'localhost'
DB_USER = 'root'
DB_PASS = ''
DB_NAME = 'sagrafulldb'

class SimpleFileMonitor:
    def __init__(self, file_paths, interval=2):
        self.file_paths = file_paths
        self.interval = interval
        
        print(f"[{datetime.now()}] Iniciando monitoramento OTIMIZADO (SYNC FORÇADO) a cada {interval} segundos...")
        print(f"Arquivos monitorados: {file_paths}")
            
        # Inicializar banco de dados
        self.init_db()
        
    def log(self, msg):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

    def init_db(self):
        """Cria banco e tabelas no MySQL se não existirem"""
        try:
            # 1. Conectar sem selecionar banco para garantir que ele existe
            conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS)
            cursor = conn.cursor()
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
            conn.commit()
            cursor.close()
            conn.close()
            
            # 2. Conectar ao banco correto e criar tabelas
            conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
            cursor = conn.cursor()
            
            # Tabela de Tickets
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS xpose_tickets (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255),
                    nros VARCHAR(20) DEFAULT '',
                    anoos INT DEFAULT 2025,
                    status VARCHAR(50),
                    created DATETIME,
                    priority VARCHAR(50),
                    machine VARCHAR(255),
                    source_file VARCHAR(255),
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    inicio DATETIME,
                    fim DATETIME,
                    UNIQUE KEY unique_ticket_os (name, nros)
                )
            """)
            
            # Schema Migration Check (Basic)
            try:
                cursor.execute("DESCRIBE xpose_tickets")
                columns = [col[0] for col in cursor.fetchall()]
                missing = []
                if 'nros' not in columns: missing.append("ADD COLUMN nros VARCHAR(20) DEFAULT ''")
                if 'anoos' not in columns: missing.append("ADD COLUMN anoos INT DEFAULT 2025")
                if 'machine' not in columns: missing.append("ADD COLUMN machine VARCHAR(255)")
                if 'source_file' not in columns: missing.append("ADD COLUMN source_file VARCHAR(255)")
                if 'inicio' not in columns: missing.append("ADD COLUMN inicio DATETIME")
                if 'fim' not in columns: missing.append("ADD COLUMN fim DATETIME")
                
                for m in missing:
                    cursor.execute(f"ALTER TABLE xpose_tickets {m}")

                try:
                    cursor.execute("CREATE UNIQUE INDEX unique_ticket_os ON xpose_tickets (name, nros)")
                except:
                    pass
            except Exception as e:
                self.log(f"Aviso migração tickets: {e}")

            # Tabela de Paths
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS xpose_paths (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    ticket_name VARCHAR(255),
                    path_name VARCHAR(255),
                    status VARCHAR(50),
                    colour VARCHAR(20),
                    inicio DATETIME,
                    fim DATETIME,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_path (ticket_name, path_name)
                )
            """)
            
            # Schema Migration Paths
            try:
                cursor.execute("DESCRIBE xpose_paths")
                path_cols = [col[0] for col in cursor.fetchall()]
                if 'inicio' not in path_cols: cursor.execute("ALTER TABLE xpose_paths ADD COLUMN inicio DATETIME")
                if 'fim' not in path_cols: cursor.execute("ALTER TABLE xpose_paths ADD COLUMN fim DATETIME")
            except Exception as e:
                self.log(f"Aviso migração paths: {e}")
            
            conn.commit()
            cursor.close()
            conn.close()
        except mysql.connector.Error as err:
            self.log(f"Erro ao inicializar banco de dados: {err}")
            
    def sync_to_db(self, tickets, source_file):
        """Sincroniza dados com o banco de dados"""
        # Sempre tenta conectar e usar, mesmo se tickets vazio (para limpar)
        try:
            conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
            cursor = conn.cursor()
            
            processed_keys = []
            
            for t in tickets:
                name = t['Name']
                
                # Regex Ano
                match_ano = re.match(r'^(\d{4})(?!\d)', name)
                ano_os = int(match_ano.group(1)) if match_ano else 2025
                
                # Regex NroOS
                raw_nros_list = []
                hyphenated_groups = re.findall(r'\d{5,6}(?:-\d{5,6})+', name)
                if hyphenated_groups:
                    for group in hyphenated_groups:
                        raw_nros_list.extend(group.split('-'))
                else:
                    single_match = re.search(r'\d{5,6}', name)
                    if single_match:
                        raw_nros_list.append(single_match.group(0))
                
                nros_final = []
                for num in raw_nros_list:
                    if len(num) > 5: num = num[-5:]
                    num = num.lstrip('0')
                    if num: nros_final.append(num)
                        
                nros_list = sorted(list(set(nros_final)))
                if not nros_list: nros_list = ['']
                
                # Data
                created_fmt = None
                if t['Created'] != "-":
                    try:
                        created_fmt = t.get('CreatedRaw')
                        if created_fmt and 'T' in created_fmt:
                            dt = datetime.fromisoformat(created_fmt.split('.')[0])
                            created_fmt = dt.strftime('%Y-%m-%d %H:%M:%S')
                    except:
                        pass

                for current_nros in nros_list:
                    processed_keys.append((name, current_nros))

                    # Upsert Ticket - ATUALIZAÇÃO INCONDICIONAL DE CAMPOS CHAVE
                    # last_updated = NOW() para forçar atualização
                    sql_ticket = """
                        INSERT INTO xpose_tickets (name, nros, anoos, status, created, priority, machine, source_file, inicio, fim, last_updated)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, NULL, NOW())
                        ON DUPLICATE KEY UPDATE
                        inicio = CASE 
                                    WHEN status = 'Ready' AND VALUES(status) = 'Printing' AND inicio IS NULL THEN NOW()
                                    ELSE inicio
                                 END,
                        fim = CASE 
                                    WHEN status = 'Printing' AND VALUES(status) = 'Printed' AND fim IS NULL THEN NOW()
                                    ELSE fim
                               END,
                        last_updated = NOW(),
                        status = VALUES(status), 
                        created = VALUES(created), 
                        priority = VALUES(priority), 
                        anoos = VALUES(anoos), 
                        machine = VALUES(machine), 
                        source_file = VALUES(source_file)
                    """
                    cursor.execute(sql_ticket, (name, current_nros, ano_os, t['Status'], created_fmt, t['Priority'], t['Machine'], source_file))
                    
                    # Upsert Paths
                    for p in t['Paths']:
                        sql_path = """
                            INSERT INTO xpose_paths (ticket_name, path_name, status, colour, inicio, fim, last_updated)
                            VALUES (%s, %s, %s, %s, NULL, NULL, NOW())
                            ON DUPLICATE KEY UPDATE
                            inicio = CASE 
                                        WHEN status = 'Ready' AND VALUES(status) = 'Printing' AND inicio IS NULL THEN NOW()
                                        ELSE inicio
                                     END,
                            fim = CASE 
                                        WHEN status = 'Printing' AND VALUES(status) = 'Printed' AND fim IS NULL THEN NOW()
                                        ELSE fim
                                   END,
                            last_updated = NOW(),
                            status = VALUES(status), 
                            colour = VALUES(colour)
                        """
                        cursor.execute(sql_path, (name, p['Name'], p['Status'], p['Colour']))
            
            # --- LIMPEZA ---
            if processed_keys:
                placeholders = ', '.join(['(%s, %s)'] * len(processed_keys))
                flat_params = []
                for pk in processed_keys: flat_params.extend(pk)
                delete_params = [source_file] + flat_params
                
                sql_delete = f"""
                    DELETE FROM xpose_tickets 
                    WHERE source_file = %s 
                    AND status = 'Ready' 
                    AND (name, nros) NOT IN ({placeholders})
                """
                cursor.execute(sql_delete, delete_params)
            else:
                cursor.execute("DELETE FROM xpose_tickets WHERE source_file = %s AND status = 'Ready'", (source_file,))

            # Limpar paths orfaos
            cursor.execute("DELETE FROM xpose_paths WHERE ticket_name NOT IN (SELECT DISTINCT name FROM xpose_tickets)")

            conn.commit()
            cursor.close()
            conn.close()
            
        except mysql.connector.Error as err:
            self.log(f"Erro MySQL: {err}")
        
    def get_file_content(self, file_path):
        """Lê arquivo e retorna raw_data"""
        if not os.path.exists(file_path):
            return None
        
        try:
            with open(file_path, 'rb') as f:
                return f.read().decode('utf-8', errors='replace')
        except Exception as e:
            self.log(f"Erro leitura {file_path}: {e}")
            return None
    
    def parse_xml_content(self, content_str):
        """Analisa string XML e retorna lista de dicts de tickets"""
        if not content_str: return []
        try:
            content_str = re.sub(r' xmlns="[^"]+"', '', content_str, count=1)
            root = ET.fromstring(content_str)
            tickets = []
            
            for ticket in root.findall(".//XPoseTicket"):
                name = ticket.find("Name").text if ticket.find("Name") is not None else "-"
                status = ticket.find("Status").text if ticket.find("Status") is not None else "-"
                created_raw = ticket.find("Created").text if ticket.find("Created") is not None else None
                priority = ticket.find("Priority").text if ticket.find("Priority") is not None else "-"
                machine = ticket.find("MediaName").text if ticket.find("MediaName") is not None else "-"
                
                paths = []
                for p in ticket.findall("Path"):
                    p_name = p.find("Name").text if p.find("Name") is not None else "-"
                    p_status = p.find("Status").text if p.find("Status") is not None else "-"
                    p_colour = p.find("Colour").text if p.find("Colour") is not None else "-"
                    paths.append({ "Name": p_name, "Status": p_status, "Colour": p_colour })

                tickets.append({
                    "Name": name,
                    "Status": status,
                    "Created": created_raw if created_raw else "-", 
                    "CreatedRaw": created_raw, 
                    "Priority": priority,
                    "Machine": machine,
                    "Paths": paths
                })
            return tickets
        except Exception as e:
            self.log(f"XML Parse Error: {e}")
            return []

    def monitor_loop(self):
        """Loop principal de monitoramento - SEMPRE SYNC"""
        self.log("Loop ativado. Verificando a cada 2s...")
        
        try:
            while True:
                for file_path in self.file_paths:
                    content = self.get_file_content(file_path)
                    
                    if content:
                        tickets = self.parse_xml_content(content)
                        self.sync_to_db(tickets, file_path)
                        # self.log(f"Sync forçado OK para {os.path.basename(file_path)}")
                    else:
                        # Se arquivo não existe ou erro, sync vazio p/ limpar? 
                        # Melhor evitar limpar agressivamente se for erro de leitura intermitente.
                        # Só limpa se arquivo REALMENTE não existir.
                        if not os.path.exists(file_path):
                             self.sync_to_db([], file_path)

                time.sleep(self.interval)
                
        except KeyboardInterrupt:
            self.log("Parando monitoramento.")

def main_simple():
    files = [
        r"I:\Apogee_Files\3- PrintQ\PrintQ Jobs\Tickets.Xml",
        r"I:\Apogee_Files\3- PrintQ\PrintQ PrintedJobs\Tickets.Xml"
    ]
    monitor = SimpleFileMonitor(files, interval=2)
    monitor.monitor_loop()

if __name__ == "__main__":
    main_simple()

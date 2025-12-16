"""Script de diagnóstico para verificar estrutura da tabela tabandamento"""

import pyodbc
import mysql.connector
import json

# Carregar config
with open('config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

print("="*70)
print("ESTRUTURA DA TABELA tabandamento")
print("="*70)

# MySQL
print("\n📊 MySQL - sagrafulldb:")
try:
    conn = mysql.connector.connect(
        host=config['db_host'],
        port=config['db_port'],
        user=config['db_user'],
        password=config['db_password'],
        database=config['db_name']
    )
    cursor = conn.cursor()
    cursor.execute("DESCRIBE tabandamento")
    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]}")
    cursor.close()
    conn.close()
except Exception as e:
    print(f"   ❌ Erro: {e}")

# MDB OS Atual
print("\n📊 MDB OS Atual:")
try:
    driver = '{Microsoft Access Driver (*.mdb, *.accdb)}'
    conn_str = f'DRIVER={driver};DBQ={config["mdb_os_atual_path"]};'
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()
    
    # Pegar primeiros 5 registros para ver estrutura
    cursor.execute("SELECT TOP 5 * FROM tabandamento")
    columns = [column[0] for column in cursor.description]
    print("   Colunas:", ", ".join(columns))
    
    print("\n   Exemplo de dados (primeiro registro):")
    cursor.execute("SELECT TOP 1 * FROM tabandamento")
    row = cursor.fetchone()
    if row:
        for i, col in enumerate(columns):
            print(f"      {col}: {row[i]} (tipo: {type(row[i]).__name__})")
    
    cursor.close()
    conn.close()
except Exception as e:
    print(f"   ❌ Erro: {e}")

print("\n" + "="*70)

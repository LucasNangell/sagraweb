"""
Adiciona coluna content_hash à tabela deleted_andamentos
"""
import mysql.connector
import json

# Carregar configuração
with open('config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

print("Conectando ao MySQL...")
conn = mysql.connector.connect(
    host=config['db_host'],
    user=config['db_user'],
    password=config['db_password'],
    database=config['db_name']
)

cursor = conn.cursor()

print("Verificando se coluna content_hash já existe...")
cursor.execute("""
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = %s 
    AND TABLE_NAME = 'deleted_andamentos' 
    AND COLUMN_NAME = 'content_hash'
""", (config['db_name'],))

exists = cursor.fetchone()[0] > 0

if exists:
    print("✅ Coluna content_hash já existe!")
else:
    print("Adicionando coluna content_hash...")
    cursor.execute("""
        ALTER TABLE deleted_andamentos 
        ADD COLUMN content_hash VARCHAR(64) COMMENT 'SHA256 do conteúdo do registro excluído'
    """)
    conn.commit()
    print("✅ Coluna content_hash adicionada com sucesso!")

cursor.close()
conn.close()
print("\n✅ Migração concluída!")

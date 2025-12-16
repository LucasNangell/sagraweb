# Criar OSs de teste que estão faltando

import mysql.connector
import json
from datetime import datetime

with open('config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

conn = mysql.connector.connect(
    host=config.get('db_host', 'localhost'),
    port=config.get('db_port', 3306),
    user=config.get('db_user', 'root'),
    password=config.get('db_password', ''),
    database=config.get('db_name', 'sagrafulldb'),
    charset='utf8mb4'
)

cursor = conn.cursor()

print("="*70)
print("CRIANDO OSs FALTANTES")
print("="*70)

# Criar OS 6565/2025
try:
    cursor.execute("""
        INSERT INTO tabProtocolos 
        (NroProtocolo, AnoProtocolo, NomeUsuario, EntregData, EntregPrazoLink)
        VALUES (6565, 2025, 'TESTE - CGRAF', NOW(), 'Normal')
    """)
    print("✅ OS 6565/2025 criada em tabProtocolos")
except Exception as e:
    print(f"⚠️  Erro criando OS 6565/2025: {e}")

# Criar OS 6566/2025
try:
    cursor.execute("""
        INSERT INTO tabProtocolos 
        (NroProtocolo, AnoProtocolo, NomeUsuario, EntregData, EntregPrazoLink)
        VALUES (6566, 2025, 'TESTE - CGRAF', NOW(), 'Normal')
    """)
    print("✅ OS 6566/2025 criada em tabProtocolos")
except Exception as e:
    print(f"⚠️  Erro criando OS 6566/2025: {e}")

# Criar detalhes para 6565
try:
    cursor.execute("""
        INSERT INTO tabDetalhesServico 
        (NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo, TipoPublicacaoLink)
        VALUES (6565, 2025, 'Teste Dashboard - Saída p/', 'Cartão de Visita')
    """)
    print("✅ Detalhes da OS 6565/2025 criados")
except Exception as e:
    print(f"⚠️  Erro criando detalhes 6565/2025: {e}")

# Criar detalhes para 6566
try:
    cursor.execute("""
        INSERT INTO tabDetalhesServico 
        (NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo, TipoPublicacaoLink)
        VALUES (6566, 2025, 'Teste Dashboard - Saída p/ 2', 'Cartão de Visita')
    """)
    print("✅ Detalhes da OS 6566/2025 criados")
except Exception as e:
    print(f"⚠️  Erro criando detalhes 6566/2025: {e}")

conn.commit()
cursor.close()
conn.close()

print("\n" + "="*70)
print("CONCLUÍDO!")
print("Agora o dashboard deve mostrar as OSs com 'Saída p/'")
print("="*70)

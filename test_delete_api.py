import requests
import time
from database import db

# 1. Criar um andamento de teste
cod_status_test = f"TESTE{int(time.time())}-99"
print(f"Criando andamento de teste: {cod_status_test}")

conn = db.pool.get_connection()
cursor = conn.cursor()
cursor.execute("""
    INSERT INTO tabAndamento (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto)
    VALUES (%s, 9999, 2025, 'Teste API', 'Setor Teste', NOW(), 1, 'Teste de exclusão via API', 'N')
""", (cod_status_test,))
conn.commit()
cursor.close()
db.pool.return_connection(conn)
print("✓ Andamento criado")

# 2. Chamar API de exclusão
print(f"\nChamando DELETE /api/os/2025/9999/history/{cod_status_test}")
response = requests.delete(f"http://localhost:8001/api/os/2025/9999/history/{cod_status_test}")
print(f"Status: {response.status_code}")
print(f"Response: {response.json()if response.status_code == 200 else response.text}")

# 3. Verificar deleted_andamentos
time.sleep(1)
conn = db.pool.get_connection()
cursor = conn.cursor()
cursor.execute("SELECT codstatus, LEFT(content_hash, 8), motivo FROM deleted_andamentos WHERE codstatus = %s", (cod_status_test,))
result = cursor.fetchone()
cursor.close()
db.pool.return_connection(conn)

if result:
    print(f"\n✅ SUCESSO! Hash registrado em deleted_andamentos:")
    print(f"   CodStatus: {result.get('codstatus') if isinstance(result, dict) else result[0]}")
    print(f"   Hash: {result.get('LEFT(content_hash, 8)') if isinstance(result, dict) else result[1]}")
    print(f"   Motivo: {result.get('motivo') if isinstance(result, dict) else result[2]}")
    
    # Limpeza
    conn = db.pool.get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM deleted_andamentos WHERE codstatus = %s", (cod_status_test,))
    conn.commit()
    cursor.close()
    db.pool.return_connection(conn)
    print("\n✓ Limpeza realizada")
else:
    print(f"\n❌ ERRO! Registro NÃO foi gravado em deleted_andamentos!")

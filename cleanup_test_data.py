from database import db

print("=== LIMPANDO REGISTROS DE TESTE ===\n")

conn = db.pool.get_connection()
cursor = conn.cursor()

# Deletar andamentos de teste do MySQL
cursor.execute("DELETE FROM tabAndamento WHERE NroProtocoloLink = 9999 AND AnoProtocoloLink = 2025")
affected1 = cursor.rowcount
print(f"✓ Deletados {affected1} andamentos de teste do MySQL")

# Deletar da tabela deleted_andamentos
cursor.execute("DELETE FROM deleted_andamentos WHERE nro = 9999 AND ano = 2025")
affected2 = cursor.rowcount
print(f"✓ Deletados {affected2} registros de deleted_andamentos")

# Deletar registros com TESTE no codstatus
cursor.execute("DELETE FROM tabAndamento WHERE CodStatus LIKE 'TESTE%'")
affected3 = cursor.rowcount
print(f"✓ Deletados {affected3} andamentos com TESTE no CodStatus")

cursor.execute("DELETE FROM deleted_andamentos WHERE codstatus LIKE 'TESTE%'")
affected4 = cursor.rowcount
print(f"✓ Deletados {affected4} registros de teste em deleted_andamentos")

conn.commit()
cursor.close()
db.pool.return_connection(conn)

print(f"\n=== LIMPEZA CONCLUÍDA ===")
print(f"Total removido: {affected1 + affected2 + affected3 + affected4} registros")

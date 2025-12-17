from database import db

conn = db.pool.get_connection()
cursor = conn.cursor()

# Contar registros
cursor.execute('SELECT COUNT(*) FROM deleted_andamentos')
result = cursor.fetchone()
total = result[0] if isinstance(result, (tuple, list)) else result.get('COUNT(*)', 0)
print(f'Total de registros em deleted_andamentos: {total}')

# Listar últimos registros
cursor.execute('SELECT codstatus, nro, ano, LEFT(content_hash, 8), deleted_at, motivo, origem FROM deleted_andamentos ORDER BY deleted_at DESC LIMIT 10')
rows = cursor.fetchall()

if rows:
    print('\n=== ÚLTIMOS REGISTROS ===')
    for row in rows:
        r = row if isinstance(row, (tuple, list)) else [row.get('codstatus'), row.get('nro'), row.get('ano'), row.get('LEFT(content_hash, 8)'), row.get('deleted_at'), row.get('motivo'), row.get('origem')]
        print(f'{r[0]} | {r[1]}/{r[2]} | hash={r[3]}... | {r[4]} | {r[5]} | {r[6]}')
else:
    print('\n*** TABELA VAZIA - REGISTROS NÃO ESTÃO SENDO GRAVADOS! ***')

cursor.close()
db.pool.return_connection(conn)

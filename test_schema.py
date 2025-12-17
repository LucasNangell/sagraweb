from database import db

conn = db.pool.get_connection()
cursor = conn.cursor()

cursor.execute('SHOW COLUMNS FROM tabAndamento')
print('=== COLUNAS tabAndamento ===')
rows = cursor.fetchall()
for row in rows:
    col_name = row['Field'] if isinstance(row, dict) else row[0]
    print(col_name)

cursor.close()
db.pool.return_connection(conn)

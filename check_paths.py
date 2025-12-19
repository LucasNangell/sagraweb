
import mysql.connector

DB_HOST = 'localhost'
DB_USER = 'root'
DB_PASS = ''
DB_NAME = 'sagrafulldb'

ticket_name = '2025_OS 02480-SM-FrancianeBayer-Livro_Eca'

try:
    conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
    cursor = conn.cursor(dictionary=True)
    
    print(f"--- checking paths for {ticket_name} ---")
    cursor.execute("SELECT id, path_name, status, last_updated FROM xpose_paths WHERE ticket_name = %s", (ticket_name,))
    paths = cursor.fetchall()
    print(f"Found {len(paths)} paths.")
    for row in paths:
        print(row)
        
    cursor.close()
    conn.close()
except Exception as e:
    print(e)

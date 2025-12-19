
import mysql.connector

DB_HOST = 'localhost'
DB_USER = 'root'
DB_PASS = ''
DB_NAME = 'sagrafulldb'

try:
    conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
    cursor = conn.cursor(dictionary=True)
    
    print("--- checking xpose_tickets ---")
    cursor.execute("SELECT id, name, status, created, nros, machine, last_updated FROM xpose_tickets WHERE status LIKE 'Printing%' OR status LIKE 'Ready' ORDER BY last_updated DESC LIMIT 10")
    for row in cursor.fetchall():
        print(row)
        
    print("\n--- checking xpose_paths ---")
    cursor.execute("SELECT * FROM xpose_paths WHERE status LIKE 'Printing%' OR status LIKE 'Ready' ORDER BY last_updated DESC LIMIT 10")
    for row in cursor.fetchall():
        print(row)
        
    cursor.close()
    conn.close()
except Exception as e:
    print(e)

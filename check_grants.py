import pymysql
import sys

host = "10.120.1.125"
user = "root"
password = ""

print(f"Connecting as {user}@{host}...")
try:
    conn = pymysql.connect(host=host, port=3306, user=user, password=password)
    with conn.cursor() as cur:
        cur.execute("SELECT USER(), CURRENT_USER()")
        print(f"Connected users: {cur.fetchone()}")
        
        cur.execute("SHOW GRANTS")
        print("--- GRANTS ---")
        for row in cur.fetchall():
            print(row)
            
    conn.close()
except Exception as e:
    print(f"Error: {e}")

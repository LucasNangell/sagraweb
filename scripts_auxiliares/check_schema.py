import pymysql
import json

# Load config
with open('config.json') as f:
    config = json.load(f)

conn = pymysql.connect(
    host=config['db_host'],
    user=config['db_user'],
    password=config['db_password'],
    database=config['db_name'],
    cursorclass=pymysql.cursors.DictCursor
)

try:
    cursor = conn.cursor()
    
    # Check tabSetor columns
    print("=== tabSetor ===")
    cursor.execute("DESCRIBE tabSetor")
    for row in cursor.fetchall():
        print(f"  {row['Field']}: {row['Type']}")
    
    # Check tabAndamento columns
    print("\n=== tabAndamento ===")
    cursor.execute("DESCRIBE tabAndamento")
    for row in cursor.fetchall():
        print(f"  {row['Field']}: {row['Type']}")
    
    # Sample data from tabSetor
    print("\n=== Sample data from tabSetor ===")
    cursor.execute("SELECT * FROM tabSetor LIMIT 3")
    for row in cursor.fetchall():
        print(row)
    
finally:
    conn.close()

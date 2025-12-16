import mysql.connector
import json

def get_db_connection():
    with open('config.json') as f:
        config = json.load(f)
    return mysql.connector.connect(
        host=config['db_host'],
        user=config['db_user'],
        password=config['db_password'],
        database=config['db_name']
    )

def add_tiragem_column():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Check if column exists
        cursor.execute("SHOW COLUMNS FROM tabCalculosOS LIKE 'tiragem'")
        result = cursor.fetchone()
        if not result:
            print("Adding 'tiragem' column to tabCalculosOS...")
            cursor.execute("ALTER TABLE tabCalculosOS ADD COLUMN tiragem INTEGER DEFAULT 0 AFTER total_paginas")
            conn.commit()
            print("Column added successfully.")
        else:
            print("'tiragem' column already exists.")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    add_tiragem_column()

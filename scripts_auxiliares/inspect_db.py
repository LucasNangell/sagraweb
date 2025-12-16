from database import db

try:
    print("--- tabAnalises Columns ---")
    cols = db.execute_query("SHOW COLUMNS FROM tabAnalises")
    for c in cols:
        print(c)
except Exception as e:
    print(f"Error: {e}")

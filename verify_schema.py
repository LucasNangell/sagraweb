import database
from database import db

def check_schema():
    try:
        # Check if table exists
        res = db.execute_query("SHOW TABLES LIKE 'tabCalculosOS'")
        if not res:
            print("Table tabCalculosOS DOES NOT EXIST.")
            return

        print("Table tabCalculosOS exists.")
        
        # Check columns
        columns = db.execute_query("DESCRIBE tabCalculosOS")
        print("Columns:")
        for col in columns:
            print(f"- {col['Field']} ({col['Type']})")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_schema()

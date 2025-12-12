import database
from database import db
import requests

def check_keys():
    try:
        print("Checking Indexes on tabCalculosOS...")
        indexes = db.execute_query("SHOW INDEX FROM tabCalculosOS")
        for idx in indexes:
            print(f"Key_name: {idx['Key_name']}, Column_name: {idx['Column_name']}, Non_unique: {idx['Non_unique']}")
    except Exception as e:
        print(f"DB Error: {e}")

def check_server():
    try:
        print("\nChecking Server Status...")
        resp = requests.get("http://localhost:8001/docs", timeout=5)
        print(f"Server returned status: {resp.status_code}")
    except Exception as e:
        print(f"Server check failed: {e}")

if __name__ == "__main__":
    check_keys()
    check_server()

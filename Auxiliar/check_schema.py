from database import db
import logging

def check():
    try:
        print("--- tabProtocolos ---")
        res = db.execute_query("DESCRIBE tabProtocolos")
        cols = [r['Field'] for r in res]
        print(cols)
        
        print("\n--- tabAndamento ---")
        res = db.execute_query("DESCRIBE tabAndamento")
        cols = [r['Field'] for r in res]
        print(cols)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check()

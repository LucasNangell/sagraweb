from database import db

def check_data():
    try:
        print("--- Checking FormatoLink Data ---")
        res = db.execute_query("SELECT DISTINCT FormatoLink FROM tabDetalhesServico WHERE FormatoLink IS NOT NULL AND FormatoLink != '' LIMIT 10")
        print(f"Found {len(res)} distinct formats:")
        for r in res:
            print(r)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_data()

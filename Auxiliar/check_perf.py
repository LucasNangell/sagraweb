from database import db
import logging

def check_indexes():
    tables = ['tabAndamento', 'tabProtocolos', 'tabDetalhesServico']
    print("=== Checking Indexes ===")
    for t in tables:
        print(f"\n--- {t} ---")
        try:
            res = db.execute_query(f"SHOW INDEX FROM {t}")
            for r in res:
                print(f"Key: {r['Key_name']} | Col: {r['Column_name']} | Seq: {r['Seq_in_index']}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    check_indexes()

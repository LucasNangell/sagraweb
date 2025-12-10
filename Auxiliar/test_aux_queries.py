from database import db
import logging

logging.basicConfig(level=logging.INFO)

def test_queries():
    queries = [
        ("Situacoes", "SELECT DISTINCT Situacao FROM tabSituacao"),
        ("Setores", "SELECT DISTINCT Setor FROM tabSetor"),
        ("Maquinas", "SELECT DISTINCT MaquinaLink FROM tabDetalhesServico")
    ]

    for name, query in queries:
        print(f"Testing {name}...")
        try:
            res = db.execute_query(query)
            print(f"  Success. Rows: {len(res)}")
        except Exception as e:
            print(f"  FAILED: {e}")

if __name__ == "__main__":
    test_queries()

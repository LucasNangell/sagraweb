import sys
sys.path.insert(0, 'c:\\Users\\P_918713\\Desktop\\Antigravity\\SagraWeb')

from database import db

# Test the endpoint manually
query = "SELECT DISTINCT Setor FROM tabSetor ORDER BY Setor ASC"
try:
    result = db.execute_query(query)
    setores = [row.get("Setor") for row in result if row.get("Setor")]
    print("Result:", setores)
except Exception as e:
    print(f"Error: {e}")

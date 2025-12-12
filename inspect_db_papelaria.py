
from database import db
import json

def inspect_models():
    try:
        query = "SELECT NomeProduto, ConfigCampos FROM tabPapelariaModelos WHERE Ativo = 1"
        results = db.execute_query(query)
        
        print(f"Found {len(results)} active models.")
        for row in results:
            print(f"\n--- {row['NomeProduto']} ---")
            config = row['ConfigCampos']
            if config:
                try:
                    parsed = json.loads(config)
                    print(json.dumps(parsed, indent=2))
                except json.JSONDecodeError:
                    print("INVALID JSON:", config)
            else:
                print("ConfigCampos is NULL or EMPTY")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_models()

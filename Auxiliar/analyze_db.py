from database import db
import logging

logging.basicConfig(level=logging.INFO)

def analyze_table(table_name):
    print(f"\n--- Analyzing {table_name} ---")
    
    # Row Count
    try:
        count = db.execute_query(f"SELECT COUNT(*) as c FROM {table_name}")
        print(f"Row Count: {count[0]['c']}")
    except Exception as e:
        print(f"Error counting rows: {e}")

    # Columns
    print("\nColumns:")
    try:
        columns = db.execute_query(f"DESCRIBE {table_name}")
        for col in columns:
            print(f"  {col['Field']} ({col['Type']})")
    except Exception as e:
        print(f"Error describing table: {e}")

    # Indexes
    print("\nIndexes:")
    try:
        indexes = db.execute_query(f"SHOW INDEX FROM {table_name}")
        for idx in indexes:
            print(f"  {idx['Key_name']}: {idx['Column_name']} (Seq: {idx['Seq_in_index']})")
    except Exception as e:
        print(f"Error showing indexes: {e}")

def main():
    tables = ['tabProtocolos', 'tabAndamento', 'tabDetalhesServico', 'tabSetores', 'tabSituacao']
    for t in tables:
        analyze_table(t)

if __name__ == "__main__":
    main()

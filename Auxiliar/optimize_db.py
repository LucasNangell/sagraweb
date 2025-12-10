from database import db
import logging

logging.basicConfig(level=logging.INFO)

def apply_optimizations():
    print("--- Applying Database Optimizations ---")
    
    # Index on tabAndamento
    try:
        print("Creating index 'idx_andamento_protocolo' on tabAndamento...")
        # Check if index exists first to avoid error? 
        # MySQL CREATE INDEX doesn't support IF NOT EXISTS in all versions, 
        # but we can try and catch the error.
        
        query = """
        CREATE INDEX idx_andamento_protocolo 
        ON tabAndamento (NroProtocoloLink, AnoProtocoloLink)
        """
        db.execute_query(query) # execute_query uses fetchall, but DDL returns nothing. 
                                # It might raise error if we try to fetch results from DDL?
                                # database.py execute_query calls fetchall(). 
                                # Let's use a custom execution or just catch the "no result" error if it happens.
        print("Index created successfully.")
    except Exception as e:
        if "Duplicate key name" in str(e):
            print("Index already exists.")
        else:
            print(f"Error creating index: {e}")

    # Verify
    try:
        indexes = db.execute_query("SHOW INDEX FROM tabAndamento")
        found = False
        for idx in indexes:
            if idx['Key_name'] == 'idx_andamento_protocolo':
                found = True
                break
        
        if found:
            print("VERIFICATION: Index 'idx_andamento_protocolo' is present.")
        else:
            print("VERIFICATION FAILED: Index not found.")
            
    except Exception as e:
        print(f"Error verifying index: {e}")

if __name__ == "__main__":
    apply_optimizations()

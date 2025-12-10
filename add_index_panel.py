from database import db
import logging

def optimize():
    print("Adding composite index for Panel performance...")
    try:
        # Check if exists
        res = db.execute_query("SHOW INDEX FROM tabAndamento WHERE Key_name = 'idx_panel_opt'")
        if res:
            print("Index idx_panel_opt already exists.")
        else:
            # Composite Index: UltimoStatus (1), SituacaoLink (Filter), SetorLink (Filter), Nro/Ano (Join)
            # MySQL can use the leftmost prefix.
            sql = "CREATE INDEX idx_panel_opt ON tabAndamento (UltimoStatus, SituacaoLink(20), SetorLink(10))"
            db.execute_query(sql)
            print("Index idx_panel_opt created successfully.")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    optimize()


import pyodbc
import logging
import sys

# Paths (Copied from sync_db_sagra.py)
ACCESS_DB_OS = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - OS Atual.mdb"
ACCESS_DB_PAPELARIA = r"I:\ControleDeTrabalhos\BaseDeDados - SAGRA2\Sagra Base - Papelaria Atual.mdb"

def get_access_conn(db_path):
    conn_str = r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + db_path + ";"
    return pyodbc.connect(conn_str)

def check_os(os_id):
    db_path = ACCESS_DB_PAPELARIA if os_id > 5000 else ACCESS_DB_OS
    print(f"Checking OS {os_id} in {db_path}...")
    
    try:
        conn = get_access_conn(db_path)
        cursor = conn.cursor()
        
        # Check tabAndamento
        print("--- tabAndamento ---")
        cursor.execute("SELECT * FROM tabAndamento WHERE NroProtocoloLink = ?", (os_id,))
        rows = cursor.fetchall()
        for r in rows:
            # Print simplified row (CodStatus, Obs)
            print(f"  - CodStatus: {r.CodStatus}, Data: {r.Data}, Obs: {r.Observaçao}")
            
        conn.close()
    except Exception as e:
        print(f"Error reading Access: {e}")

if __name__ == "__main__":
    # Check the OS IDs seen in the logs: 2402, 2493
    check_os(2402)
    check_os(2493)

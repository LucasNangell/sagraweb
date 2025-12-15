
import os

log_file = "sync_sagra.log"
if os.path.exists(log_file):
    with open(log_file, "r", encoding="utf-8") as f:
        lines = f.readlines()
        print("--- LAST 50 LINES ---")
        for line in lines[-50:]:
            print(line.strip())
else:
    print("Log file not found.")

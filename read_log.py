
try:
    with open("sync_sagra.log", "r", encoding="utf-8") as f:
        lines = f.readlines()
        print("".join(lines[-30:]))
except Exception as e:
    print(f"Error reading log: {e}")

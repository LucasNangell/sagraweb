import json

config = {
    "db_host": "127.0.0.1",
    "db_port": 3306,
    "db_user": "root",
    "db_password": "",
    "db_name": "sagrafulldb",
    "server_port": 8001
}

with open("config.json", "w") as f:
    json.dump(config, f, indent=4)

print("config.json updated to LOCALHOST defaults (root/empty).")

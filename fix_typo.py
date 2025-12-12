import json

config = {
    "db_host": "10.120.1.125",
    "db_port": 3306,
    "db_user": "usr_sefoc",
    "db_password": "sefoc_2018",
    "db_name": "sagrafulldb",
    "server_port": 8001
}

with open("config.json", "w") as f:
    json.dump(config, f, indent=4)

print("config.json corrected with password 'sefoc_2018'.")

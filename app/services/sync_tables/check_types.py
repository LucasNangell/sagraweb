from sqlalchemy import create_engine, text
import os
import sys
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)
from config_manager import config_manager
import yaml
import sys
import urllib.parse

# Load config
with open('sync_conf.yaml', 'r') as f:
    config = yaml.safe_load(f)

mysql_conf = config_manager.get_mysql_config()
connection_string = f"mysql+pymysql://{mysql_conf['user']}:{urllib.parse.quote_plus(mysql_conf['password'])}@{mysql_conf['host']}:{mysql_conf['port']}/{mysql_conf['database']}"

engine = create_engine(connection_string)

table = config['monitor_detalhes_os']['table_target']
print(f"Checking table: {table}")

cols_to_check = ["FormatoLink", "TipoPublicacaoLink", "MaquinaLink", "PapelLink", "Cores"]

with engine.connect() as conn:
    for col in cols_to_check:
        try:
            res = conn.execute(text(f"SHOW COLUMNS FROM {table} LIKE '{col}'")).fetchone()
            if res:
                print(f"Column: {res[0]} | Type: {res[1]}")
            else:
                print(f"Column: {col} NOT FOUND")
        except Exception as e:
            print(f"Error checking {col}: {e}")

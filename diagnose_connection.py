import pymysql
import sys
from config_manager import config_manager

# Force reload or just print what it has
print("=== CONFIGURAÇÃO CARREGADA PELA APP ===")
host = config_manager.get("db_host")
user = config_manager.get("db_user")
password = config_manager.get("db_password")
dbname = config_manager.get("db_name")

print(f"Host: '{host}'")
print(f"User: '{user}'")
print(f"Pass: '{password}'")
print(f"DB:   '{dbname}'")

def test_conn(host, user, password, dbname, label):
    print(f"\n--- TESTE: {label} ---")
    print(f"Conectando a {user}@{host}/{dbname} ...")
    try:
        conn = pymysql.connect(
            host=host,
            port=3306,
            user=user,
            password=password,
            database=dbname, 
            connect_timeout=5
        )
        conn.close()
        print("✅ SUCESSO COMPLETO!")
        return True
    except Exception as e:
        print(f"❌ FALHA: {e}")
        return False

# Teste com dados da config
test_conn(host, user, password, dbname, "Configuração Atual")

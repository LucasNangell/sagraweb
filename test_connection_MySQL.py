import pymysql
import sys

# Configurações
CONFIG = {
    'host': 'localhost',
    'user': 'root',  # Vamos tentar criar este usuário
    'password': '',
    'database': 'sagrafulldb',
    'port': 3306,
    'connect_timeout': 5
}

def test_connection():
    print(f"Tentando conectar em {CONFIG['host']} com usuário '{CONFIG['user']}'...")
    try:
        conn = pymysql.connect(**CONFIG)
        print("✅ SUCESSO! Conexão estabelecida.")
        
        cursor = conn.cursor()
        cursor.execute("SELECT VERSION()")
        ver = cursor.fetchone()
        print(f"   Versão do Banco: {ver[0]}")
        
        conn.close()
    except Exception as e:
        print(f"❌ FALHA: {e}")
        print("\nVerifique se:")
        print("1. O usuário foi criado no phpMyAdmin.")
        print("2. O IP do seu computador está liberado (ou usuário criado com '%').")
        print("3. O firewall do servidor permite conexão na porta 3306.")

if __name__ == "__main__":
    test_connection()

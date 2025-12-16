"""
Script de Teste e Validação do Sistema de Sincronização
========================================================

Testa conectividade, estrutura das tabelas e funcionalidades básicas
antes de executar o sincronizador completo.

Uso:
    python test_sync_setup.py
"""

import sys
import os
from datetime import datetime

def test_imports():
    """Testa se todas as bibliotecas necessárias estão instaladas"""
    print("\n📦 Testando importação de bibliotecas...")
    
    try:
        import pyodbc
        print(f"   ✅ pyodbc {pyodbc.version} - OK")
    except ImportError as e:
        print(f"   ❌ pyodbc - ERRO: {e}")
        return False
    
    try:
        import mysql.connector
        print(f"   ✅ mysql-connector-python {mysql.connector.__version__} - OK")
    except ImportError as e:
        print(f"   ❌ mysql-connector-python - ERRO: {e}")
        return False
    
    try:
        import json
        print("   ✅ json - OK")
    except ImportError as e:
        print(f"   ❌ json - ERRO: {e}")
        return False
    
    return True


def test_config_file():
    """Testa se o arquivo config.json existe e é válido"""
    print("\n⚙️  Testando arquivo de configuração...")
    
    if not os.path.exists('config.json'):
        print("   ❌ Arquivo config.json não encontrado!")
        print("   💡 Copie config_sync_andamentos.example.json para config.json")
        return False
    
    try:
        import json
        with open('config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        required_keys = [
            'db_host', 'db_port', 'db_user', 'db_password', 'db_name',
            'mdb_os_atual_path', 'mdb_papelaria_path'
        ]
        
        missing = [key for key in required_keys if key not in config]
        if missing:
            print(f"   ❌ Chaves faltando no config.json: {', '.join(missing)}")
            return False
        
        print("   ✅ config.json - OK")
        return True
        
    except Exception as e:
        print(f"   ❌ Erro ao ler config.json: {e}")
        return False


def test_mysql_connection():
    """Testa conexão com MySQL"""
    print("\n🔌 Testando conexão MySQL...")
    
    try:
        import json
        import mysql.connector
        from mysql.connector import Error
        
        with open('config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        conn = mysql.connector.connect(
            host=config.get('db_host', 'localhost'),
            port=config.get('db_port', 3306),
            user=config.get('db_user', 'root'),
            password=config.get('db_password', ''),
            database=config.get('db_name', 'sagradbfull')
        )
        
        if conn.is_connected():
            cursor = conn.cursor()
            cursor.execute("SELECT VERSION()")
            version = cursor.fetchone()
            print(f"   ✅ Conectado ao MySQL {version[0]}")
            
            # Testar se a tabela tabandamento existe
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.tables 
                WHERE table_schema = %s 
                AND table_name = 'tabandamento'
            """, (config.get('db_name'),))
            
            exists = cursor.fetchone()[0]
            if exists:
                print("   ✅ Tabela 'tabandamento' encontrada")
            else:
                print("   ⚠️  Tabela 'tabandamento' não encontrada (será criada?)")
            
            cursor.close()
            conn.close()
            return True
        
    except Exception as e:
        print(f"   ❌ Erro ao conectar ao MySQL: {e}")
        return False


def test_mdb_connections():
    """Testa conexões com bancos Access"""
    print("\n🔌 Testando conexões Access (MDB)...")
    
    try:
        import json
        import pyodbc
        
        with open('config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        # Testar MDB OS Atual
        mdb_os_path = config.get('mdb_os_atual_path')
        if not os.path.exists(mdb_os_path):
            print(f"   ❌ Arquivo MDB OS Atual não encontrado: {mdb_os_path}")
        else:
            try:
                driver = '{Microsoft Access Driver (*.mdb, *.accdb)}'
                conn_str = f'DRIVER={driver};DBQ={mdb_os_path};'
                conn = pyodbc.connect(conn_str)
                
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM tabandamento")
                count = cursor.fetchone()[0]
                print(f"   ✅ MDB OS Atual conectado - {count} andamentos encontrados")
                cursor.close()
                conn.close()
                
            except Exception as e:
                print(f"   ❌ Erro ao conectar MDB OS Atual: {e}")
        
        # Testar MDB Papelaria
        mdb_pap_path = config.get('mdb_papelaria_path')
        if not os.path.exists(mdb_pap_path):
            print(f"   ❌ Arquivo MDB Papelaria não encontrado: {mdb_pap_path}")
        else:
            try:
                driver = '{Microsoft Access Driver (*.mdb, *.accdb)}'
                conn_str = f'DRIVER={driver};DBQ={mdb_pap_path};'
                conn = pyodbc.connect(conn_str)
                
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM tabandamento")
                count = cursor.fetchone()[0]
                print(f"   ✅ MDB Papelaria conectado - {count} andamentos encontrados")
                cursor.close()
                conn.close()
                
            except Exception as e:
                print(f"   ❌ Erro ao conectar MDB Papelaria: {e}")
        
        return True
        
    except Exception as e:
        print(f"   ❌ Erro nos testes MDB: {e}")
        return False


def main():
    """Executa todos os testes"""
    print("""
╔═══════════════════════════════════════════════════════════════════╗
║      TESTE DE CONFIGURAÇÃO - Sistema de Sincronização            ║
║      Validação de dependências e conectividade                   ║
╚═══════════════════════════════════════════════════════════════════╝
    """)
    
    results = []
    
    # Executar testes
    results.append(("Bibliotecas", test_imports()))
    results.append(("Configuração", test_config_file()))
    results.append(("MySQL", test_mysql_connection()))
    results.append(("Access MDB", test_mdb_connections()))
    
    # Sumário
    print("\n" + "="*70)
    print("📊 SUMÁRIO DOS TESTES")
    print("="*70)
    
    all_passed = True
    for test_name, passed in results:
        status = "✅ PASSOU" if passed else "❌ FALHOU"
        print(f"   {test_name:.<30} {status}")
        if not passed:
            all_passed = False
    
    print("="*70)
    
    if all_passed:
        print("\n🎉 Todos os testes passaram! O sistema está pronto para uso.")
        print("\n▶️  Execute: python sync_andamentos_bidirectional.py")
    else:
        print("\n⚠️  Alguns testes falharam. Corrija os problemas antes de continuar.")
        print("\n📖 Consulte: SYNC_ANDAMENTOS_README.md")
    
    print()
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())

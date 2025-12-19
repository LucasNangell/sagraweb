#!/usr/bin/env python3
"""
Script de diagnóstico para a rota /pt-html/{ano}/{os}
"""

import sys
sys.path.insert(0, r'C:\Users\P_918713\Desktop\Antigravity\SagraWeb')

from database import db
import json

print("=" * 70)
print("DIAGNOSTICO: GET /pt-html/{ano}/{os}")
print("=" * 70)

# Parametros de teste
ano = 2025
os_id = 2562

print(f"\nTestando: /pt-html/{ano}/{os_id}")

# Teste 1: Verificar conexão com BD
print("\n[TESTE 1] Verificar conexão com BD...")
try:
    result = db.execute_query("SELECT 1 as test")
    print("[OK] Conexão com BD estabelecida")
except Exception as e:
    print(f"[ERRO] Conexão com BD falhou: {e}")
    sys.exit(1)

# Teste 2: Verificar se OS existe no BD
print(f"\n[TESTE 2] Verificar se OS {os_id}/{ano} existe...")
try:
    query = """
        SELECT NroProtocolo, AnoProtocolo
        FROM tabProtocolos 
        WHERE NroProtocolo = %(os)s AND AnoProtocolo = %(ano)s
    """
    result = db.execute_query(query, {'os': os_id, 'ano': ano})
    
    if result:
        print(f"[OK] OS encontrada: {result[0]}")
    else:
        print("[AVISO] OS não encontrada no BD")
except Exception as e:
    print(f"[ERRO] Query falhou: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Teste 3: Buscar HTML de PT
print(f"\n[TESTE 3] Buscar HTML de PT...")
try:
    query = """
        SELECT email_pt_html, email_pt_versao, email_pt_data
        FROM tabProtocolos 
        WHERE NroProtocolo = %(os)s AND AnoProtocolo = %(ano)s
    """
    result = db.execute_query(query, {'os': os_id, 'ano': ano})
    
    if result and result[0]:
        row = result[0]
        html_tamanho = len(row.get('email_pt_html') or '')
        versao = row.get('email_pt_versao')
        data = row.get('email_pt_data')
        
        print(f"[OK] Dados encontrados:")
        print(f"     - HTML tamanho: {html_tamanho} bytes")
        print(f"     - Versão: {versao}")
        print(f"     - Data: {data}")
        print(f"     - Tipo de Data: {type(data).__name__}")
        
        # Teste serialização
        print(f"\n[TESTE 4] Testar serialização JSON...")
        try:
            import json
            from datetime import datetime
            
            # Simular resposta da API
            response_data = {
                "html": row.get('email_pt_html'),
                "versao": row.get('email_pt_versao') or "1",
                "data": str(row.get('email_pt_data')) if row.get('email_pt_data') else None,
                "type": "pt"
            }
            
            json_str = json.dumps(response_data, default=str, ensure_ascii=False)
            print(f"[OK] Serialização funcionou!")
            print(f"     - Tamanho JSON: {len(json_str)} bytes")
            
        except Exception as e:
            print(f"[ERRO] Serialização falhou: {e}")
            import traceback
            traceback.print_exc()
    else:
        print("[AVISO] Nenhum resultado encontrado")
        
except Exception as e:
    print(f"[ERRO] Teste falhou: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 70)
print("FIM DO DIAGNOSTICO")
print("=" * 70)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste direto da rota /analise/finalize
"""
import requests
import json
from datetime import datetime

API_BASE = "http://localhost:8001"

# Dados da OS que vamos testar
ANO = 2025
OS_ID = 2562

# Fazer POST para /analise/finalize
print(f"\n=== Testando POST /analise/finalize/{ANO}/{OS_ID} ===\n")

url = f"{API_BASE}/analise/finalize/{ANO}/{OS_ID}"
headers = {"Content-Type": "application/json"}
payload = {
    "versao": "1"
}

print(f"URL: {url}")
print(f"Payload: {json.dumps(payload, indent=2)}")
print(f"Headers: {json.dumps(headers, indent=2)}\n")

try:
    response = requests.post(url, json=payload, headers=headers, timeout=30)
    
    print(f"Status Code: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}\n")
    
    if response.status_code == 200:
        data = response.json()
        print("✓ Sucesso!")
        print(f"Response JSON:")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        
        if 'html_preview' in data:
            print(f"\nHTML Preview (primeiros 300 caracteres):")
            print(data['html_preview'][:300])
            
    else:
        print(f"✗ Erro! Status {response.status_code}")
        try:
            print(f"Response: {response.json()}")
        except:
            print(f"Response: {response.text}")
            
except requests.exceptions.ConnectionError:
    print("✗ Erro: Não conseguiu conectar ao servidor!")
    print(f"Verifique se o servidor está rodando em {API_BASE}")
except Exception as e:
    print(f"✗ Erro: {type(e).__name__}: {e}")

# Agora vamos verificar se o HTML foi salvo no banco
print("\n\n=== Verificando BD após POST ===\n")

try:
    from database import Database
    db = Database()
    
    query = """
        SELECT NroProtocolo, AnoProtocolo, 
               CHAR_LENGTH(email_pt_html) as html_size,
               email_pt_versao, email_pt_data
        FROM tabProtocolos 
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
    """
    
    result = db.query(query, (OS_ID, ANO))
    
    if result:
        row = result[0]
        print(f"Protocolo: {row[0]}/{row[1]}")
        print(f"HTML Size: {row[2]} bytes")
        print(f"Versão: {row[3]}")
        print(f"Data: {row[4]}")
        
        if row[2] > 1000:
            print(f"\n✓ HTML foi salvo! ({row[2]} bytes)")
        else:
            print(f"\n⚠ HTML pequeno demais ({row[2]} bytes) - pode ser vazio ou template")
    else:
        print(f"✗ Protocolo não encontrado: {OS_ID}/{ANO}")
        
except Exception as e:
    print(f"Erro ao verificar BD: {e}")

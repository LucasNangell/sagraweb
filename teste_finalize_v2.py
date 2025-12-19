#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste direto da rota /analise/finalize após corrigir includes
"""
import requests
import json
import time

API_BASE = "http://localhost:8001"
ANO = 2025
OS_ID = 2562

print("\n" + "="*60)
print("TESTE: POST /analise/finalize/{ano}/{os_id}")
print("="*60 + "\n")

url = f"{API_BASE}/analise/finalize/{ANO}/{OS_ID}"
headers = {"Content-Type": "application/json"}
payload = {
    "versao": "1"
}

print(f"URL: {url}")
print(f"Method: POST")
print(f"Payload: {json.dumps(payload, indent=2)}\n")

try:
    response = requests.post(url, json=payload, headers=headers, timeout=30)
    
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print("\n✓ SUCESSO!")
        print(f"\nResponse:")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        
        if 'html_preview' in data:
            print(f"\nHTML Preview:")
            print(data['html_preview'][:500])
            
    elif response.status_code == 404:
        print("\n✗ Erro 404: Rota não encontrada")
        print("Possível motivo: router não foi incluído em server.py")
        
    elif response.status_code == 405:
        print("\n✗ Erro 405: Method Not Allowed")
        print("Possível motivo: rota usa GET mas enviamos POST")
        
    else:
        print(f"\n✗ Erro {response.status_code}")
        try:
            error_data = response.json()
            print(f"Response: {json.dumps(error_data, indent=2, ensure_ascii=False)}")
        except:
            print(f"Response: {response.text[:500]}")
            
except requests.exceptions.ConnectionError:
    print("\n✗ Erro: Conexão recusada!")
    print(f"Servidor não está rodando em {API_BASE}")
    print("\nPara iniciar o servidor, execute:")
    print("  python server.py")
    
except Exception as e:
    print(f"\n✗ Erro: {type(e).__name__}: {e}")

print("\n" + "="*60)

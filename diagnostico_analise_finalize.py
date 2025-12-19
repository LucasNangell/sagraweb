#!/usr/bin/env python3
"""
Diagnostico: Verificar se análise está sendo salva corretamente
"""

import sys
sys.path.insert(0, r'C:\Users\P_918713\Desktop\Antigravity\SagraWeb')

from database import db

print("=" * 70)
print("DIAGNOSTICO: ROTA /analise/finalize")
print("=" * 70)

# Parametros de teste
ano = 2025
os_id = 2562

print(f"\nTestando: POST /analise/finalize/{ano}/{os_id}")

# Teste 1: Verificar se análise existe em tabAnalises
print(f"\n[TESTE 1] Verificar se análise existe em tabAnalises...")
try:
    query = "SELECT ID FROM tabAnalises WHERE OS=%s AND Ano=%s"
    result = db.execute_query(query, (os_id, ano))
    
    if result:
        anl_id = result[0]['ID']
        print(f"[OK] Análise encontrada com ID: {anl_id}")
    else:
        print(f"[ERRO] Análise NÃO encontrada para OS {os_id}/{ano}")
        print("      Isso significa que a análise nunca foi gravada!")
        
        # Listar análises existentes
        print("\n[INFO] Análises existentes na tabela:")
        query_all = "SELECT ID, OS, Ano FROM tabAnalises LIMIT 10"
        all_analises = db.execute_query(query_all)
        for a in all_analises:
            print(f"       - ID: {a['ID']}, OS: {a['OS']}, Ano: {a['Ano']}")
        sys.exit(1)
    
except Exception as e:
    print(f"[ERRO] Query falhou: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Teste 2: Buscar itens da análise
print(f"\n[TESTE 2] Buscar itens da análise (ID={anl_id})...")
try:
    query = """
        SELECT i.ID as uniqueId, i.ID_ProblemaPadrao as originalId, i.Obs as obs, 
               i.HTML_Snapshot as html, i.Componente as componenteOrigem, 
               i.ResolucaoObrigatoria as resolucaoObrigatoria, p.TituloPT as titulo
        FROM tabAnaliseItens i 
        LEFT JOIN tabProblemasPadrao p ON i.ID_ProblemaPadrao = p.ID 
        WHERE i.ID_Analise = %s
    """
    items = db.execute_query(query, (anl_id,))
    
    if items:
        print(f"[OK] {len(items)} itens encontrados na análise:")
        for i, item in enumerate(items):
            print(f"\n     [{i+1}] Problema:")
            print(f"         - Titulo: {item.get('titulo', '(sem título)')}")
            print(f"         - Observacao: {item.get('obs', '(vazio)')[:100]}")
            print(f"         - ComponenteOrigem: {item.get('componenteOrigem')}")
            print(f"         - ResolucaoObrigatoria: {item.get('resolucaoObrigatoria')}")
    else:
        print(f"[AVISO] Nenhum item encontrado na análise!")
        print("        Significa que os problemas não foram adicionados à análise.")
        
except Exception as e:
    print(f"[ERRO] Query falhou: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Teste 3: Simular geração de HTML
print(f"\n[TESTE 3] Simular geração de HTML...")
try:
    from routers.email_routes import _generate_problemas_html
    
    problemas_para_html = [
        {
            'titulo': item.get('titulo', f'Problema {i+1}'),
            'obs': item.get('obs', '')
        }
        for i, item in enumerate(items)
    ]
    
    html_problemas = _generate_problemas_html(problemas_para_html)
    print(f"[OK] HTML gerado com {len(html_problemas)} caracteres")
    print(f"\n[PREVIEW] Primeiros 500 caracteres:\n{html_problemas[:500]}")
    
except Exception as e:
    print(f"[ERRO] Geracao de HTML falhou: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Teste 4: Verificar como está no BD agora
print(f"\n[TESTE 4] Verificar HTML atual no BD...")
try:
    query = """
        SELECT email_pt_html, email_pt_versao, email_pt_data
        FROM tabProtocolos 
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
    """
    result = db.execute_query(query, (os_id, ano))
    
    if result and result[0].get('email_pt_html'):
        html_atual = result[0]['email_pt_html']
        print(f"[OK] HTML atual no BD tem {len(html_atual)} caracteres")
        print(f"[VERSAO] {result[0].get('email_pt_versao')}")
        print(f"[DATA] {result[0].get('email_pt_data')}")
        print(f"\n[PREVIEW] Primeiros 500 caracteres do BD:\n{html_atual[:500]}")
    else:
        print(f"[AVISO] Nenhum HTML gravado no BD")
        
except Exception as e:
    print(f"[ERRO] Query falhou: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 70)
print("FIM DO DIAGNOSTICO")
print("=" * 70)

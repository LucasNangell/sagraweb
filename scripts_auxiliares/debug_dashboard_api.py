# Debug: Verificar status das OSs "Saída p/"

import mysql.connector
import json

with open('config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

conn = mysql.connector.connect(
    host=config.get('db_host', 'localhost'),
    port=config.get('db_port', 3306),
    user=config.get('db_user', 'root'),
    password=config.get('db_password', ''),
    database=config.get('db_name', 'sagrafulldb'),
    charset='utf8mb4'
)

cursor = conn.cursor(dictionary=True)

print("="*70)
print("DEBUG: OSs com 'Saída p/' no setor SEFOC")
print("="*70)

# Buscar OSs com "Saída p/"
cursor.execute("""
    SELECT 
        p.NroProtocolo, p.AnoProtocolo,
        a.SituacaoLink, a.SetorLink, a.UltimoStatus,
        p.EntregPrazoLink as prioridade,
        d.Titulo
    FROM tabAndamento a
    INNER JOIN tabProtocolos p ON a.NroProtocoloLink = p.NroProtocolo AND a.AnoProtocoloLink = p.AnoProtocolo
    LEFT JOIN tabDetalhesServico d ON p.NroProtocolo = d.NroProtocoloLinkDet AND p.AnoProtocolo = d.AnoProtocoloLinkDet
    WHERE a.SituacaoLink LIKE 'Saída p/%'
    AND a.SetorLink = 'SEFOC'
    AND a.UltimoStatus = TRUE
""")

results = cursor.fetchall()

print(f"\n✅ Encontradas {len(results)} OSs:\n")

for row in results:
    print(f"OS {row['NroProtocolo']}/{row['AnoProtocolo']}")
    print(f"  Situação: {row['SituacaoLink']}")
    print(f"  Setor: {row['SetorLink']}")
    print(f"  UltimoStatus: {row['UltimoStatus']}")
    print(f"  Prioridade: {row['prioridade']}")
    print(f"  Título: {row['Titulo']}")
    
    # Verificar se a situação está nas exclusões
    if row['SituacaoLink'] in ['Entregue', 'Cancelada', 'Cancelado']:
        print(f"  ⚠️  PROBLEMA: Situação está na lista de exclusão do dashboard!")
    else:
        print(f"  ✅ OK: Situação NÃO está na lista de exclusão")
    
    print()

# Agora vamos fazer exatamente a mesma query que o dashboard faria
print("="*70)
print("SIMULANDO QUERY DO DASHBOARD")
print("="*70)

cursor.execute("""
    SELECT 
        p.NroProtocolo AS nr_os, 
        p.AnoProtocolo AS ano, 
        d.Titulo AS titulo, 
        p.NomeUsuario AS solicitante,
        a.SituacaoLink AS situacao, 
        p.EntregPrazoLink AS prioridade,
        d.TipoPublicacaoLink AS produto,
        a.SetorLink AS setor,
        p.EntregData AS data_entrega,
        a.Data AS last_update
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d ON (p.NroProtocolo = d.NroProtocoloLinkDet) AND (p.AnoProtocolo = d.AnoProtocoloLinkDet)
    LEFT JOIN tabAndamento AS a ON (p.NroProtocolo = a.NroProtocoloLink) AND (p.AnoProtocolo = a.AnoProtocoloLink)
    WHERE a.UltimoStatus = 1
    AND a.SituacaoLink NOT IN ('Entregue', 'Cancelada', 'Cancelado')
    AND a.SetorLink = 'SEFOC'
    ORDER BY 
        CASE 
            WHEN p.EntregPrazoLink LIKE '%Prometido p/%' THEN 0 
            WHEN p.EntregPrazoLink LIKE '%Solicitado p/%' THEN 1 
            ELSE 2 
        END ASC,
        p.EntregData ASC,
        p.AnoProtocolo DESC, 
        p.NroProtocolo DESC
    LIMIT 200
""")

dashboard_results = cursor.fetchall()

print(f"\n✅ API retornaria {len(dashboard_results)} OSs no total\n")

# Filtrar apenas as que começam com "Saída p/"
saida_p_results = [r for r in dashboard_results if r['situacao'].startswith('Saída p/')]

print(f"Dessas, {len(saida_p_results)} começam com 'Saída p/':\n")

for row in saida_p_results:
    print(f"  • OS {row['nr_os']}/{row['ano']} - {row['situacao']}")

if len(saida_p_results) == 0:
    print("\n❌ PROBLEMA: Nenhuma OS 'Saída p/' retornada pela API!")
    print("\nPossíveis causas:")
    print("  1. Filtro de 'include_finished=false' está excluindo")
    print("  2. Situação está em ['Entregue', 'Cancelada', 'Cancelado']")
    print("  3. UltimoStatus não é TRUE")
    print("  4. Erro no LEFT JOIN")

cursor.close()
conn.close()

print("\n" + "="*70)

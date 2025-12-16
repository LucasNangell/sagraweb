# Script de Debug - Dashboard Setor
# Verifica andamentos configurados vs andamentos no banco

import mysql.connector
import json

# Carregar config
with open('config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

# Conectar ao banco
conn = mysql.connector.connect(
    host=config.get('db_host', 'localhost'),
    port=config.get('db_port', 3306),
    user=config.get('db_user', 'root'),
    password=config.get('db_password', ''),
    database=config.get('db_name', 'sagrafulldb'),
    charset='utf8mb4'
)

cursor = conn.cursor()

# Andamentos configurados no dashboard
andamentos_configurados = [
    'Saída p/',
    'Saída parcial p/',
    'Entrada Inicial',
    'Tramit. de Prova p/',
    'Tramit. de Prévia p/',
    'Comentário',
    'Em Execução',
    'Recebido',
    'Problemas Técnicos',
    'Problema Técnico',
    'Encam. de Docum.'
]

print("="*70)
print("VERIFICAÇÃO DE ANDAMENTOS - DASHBOARD SETOR")
print("="*70)

print("\n1️⃣  Verificando andamentos configurados no banco...\n")

for andamento in andamentos_configurados:
    # Buscar andamentos que começam com o filtro (para "Saída p/" pegar "Saída p/ SEFOC")
    cursor.execute("""
        SELECT DISTINCT SituacaoLink, COUNT(*) as total
        FROM tabandamento
        WHERE SituacaoLink LIKE %s
        AND SetorLink = 'SEFOC'
        AND UltimoStatus = TRUE
        GROUP BY SituacaoLink
    """, (f"{andamento}%",))
    
    results = cursor.fetchall()
    
    if results:
        print(f"✅ '{andamento}' → Encontrados:")
        for situacao, count in results:
            print(f"   • {situacao}: {count} OS(s)")
    else:
        print(f"⚠️  '{andamento}' → Nenhuma OS encontrada")

print("\n" + "="*70)
print("\n2️⃣  Verificando TODOS andamentos do setor SEFOC...\n")

cursor.execute("""
    SELECT DISTINCT SituacaoLink, COUNT(*) as total
    FROM tabandamento
    WHERE SetorLink = 'SEFOC'
    AND UltimoStatus = TRUE
    GROUP BY SituacaoLink
    ORDER BY total DESC
""")

all_andamentos = cursor.fetchall()

print("Todos os andamentos ativos em SEFOC:")
for situacao, count in all_andamentos:
    configurado = any(situacao.startswith(cfg) for cfg in andamentos_configurados)
    status = "✅" if configurado else "❌ NÃO CONFIGURADO"
    print(f"{status} {situacao}: {count} OS(s)")

print("\n" + "="*70)
print("\n3️⃣  Diagnóstico Final\n")

# Verificar se há andamentos não configurados
andamentos_nao_configurados = []
for situacao, count in all_andamentos:
    configurado = any(situacao.startswith(cfg) for cfg in andamentos_configurados)
    if not configurado:
        andamentos_nao_configurados.append((situacao, count))

if andamentos_nao_configurados:
    print("⚠️  ATENÇÃO: Existem andamentos NO BANCO que NÃO estão configurados:")
    for situacao, count in andamentos_nao_configurados:
        print(f"   • {situacao}: {count} OS(s)")
    print("\nSugestão: Adicione estes andamentos na configuração do dashboard!")
else:
    print("✅ Todos os andamentos do banco estão configurados no dashboard!")

# Verificar se há configurações sem dados
configurados_sem_dados = []
for cfg in andamentos_configurados:
    tem_dados = any(situacao.startswith(cfg) for situacao, _ in all_andamentos)
    if not tem_dados:
        configurados_sem_dados.append(cfg)

if configurados_sem_dados:
    print(f"\nℹ️  Andamentos configurados SEM OSs no momento:")
    for cfg in configurados_sem_dados:
        print(f"   • {cfg}")

cursor.close()
conn.close()

print("\n" + "="*70)
print("FIM DA VERIFICAÇÃO")
print("="*70)

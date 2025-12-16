# Verificar se OSs com "Saída p/" existem em tabProtocolos

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
print("VERIFICANDO INTEGRIDADE DOS DADOS")
print("="*70)

# Buscar andamentos com "Saída p/"
cursor.execute("""
    SELECT 
        NroProtocoloLink, AnoProtocoloLink, 
        SituacaoLink, SetorLink, UltimoStatus
    FROM tabandamento
    WHERE SituacaoLink LIKE 'Saída p/%'
    AND SetorLink = 'SEFOC'
    AND UltimoStatus = TRUE
""")

andamentos = cursor.fetchall()

print(f"\n1️⃣  Andamentos encontrados em tabandamento: {len(andamentos)}\n")

for and_ in andamentos:
    nro = and_['NroProtocoloLink']
    ano = and_['AnoProtocoloLink']
    
    print(f"Andamento: OS {nro}/{ano} - {and_['SituacaoLink']}")
    
    # Verificar se existe em tabProtocolos
    cursor.execute("""
        SELECT NroProtocolo, AnoProtocolo, NomeUsuario
        FROM tabProtocolos
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
    """, (nro, ano))
    
    protocolo = cursor.fetchone()
    
    if protocolo:
        print(f"  ✅ Existe em tabProtocolos")
        print(f"     Solicitante: {protocolo['NomeUsuario']}")
    else:
        print(f"  ❌ NÃO EXISTE em tabProtocolos!")
        print(f"     PROBLEMA: Este andamento não pode aparecer na API!")
    
    # Verificar detalhes
    cursor.execute("""
        SELECT Titulo, TipoPublicacaoLink
        FROM tabDetalhesServico
        WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s
    """, (nro, ano))
    
    detalhes = cursor.fetchone()
    
    if detalhes:
        print(f"  ✅ Existe em tabDetalhesServico")
        print(f"     Título: {detalhes['Titulo']}")
    else:
        print(f"  ⚠️  NÃO existe em tabDetalhesServico")
    
    print()

cursor.close()
conn.close()

print("="*70)
print("CONCLUSÃO:")
print("Se algum andamento não existe em tabProtocolos,")
print("ele NUNCA aparecerá na API pois o JOIN falhará!")
print("="*70)

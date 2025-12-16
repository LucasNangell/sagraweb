"""
Script de teste: Simula acessos ao sistema para testar o monitor de conexões
Execute com um servidor rodando (PROD ou DEV)
"""
import requests
import time
import random

print("🧪 TESTE DO MONITOR DE CONEXÕES")
print("=" * 60)

# Verificar qual servidor está rodando
server_url = None
for port in [8000, 8001]:
    try:
        response = requests.get(f"http://127.0.0.1:{port}/health", timeout=1)
        if response.status_code == 200:
            server_url = f"http://127.0.0.1:{port}"
            print(f"✅ Servidor encontrado na porta {port}")
            break
    except:
        continue

if not server_url:
    print("❌ Nenhum servidor rodando! Inicie PROD ou DEV primeiro.")
    exit(1)

# Páginas para simular acesso
pages = [
    "/",
    "/index.html",
    "/analise.html",
    "/dashboard_setor.html",
    "/client_pt.html",
    "/gerencia.html",
    "/api/aux/setores",
    "/api/aux/andamentos"
]

print("\n🔄 Simulando acessos (10 requisições)...")
print("Abra o launcher_gui.pyw e vá na aba 'Monitoramento' para ver em tempo real!\n")

for i in range(10):
    page = random.choice(pages)
    try:
        response = requests.get(f"{server_url}{page}", timeout=2)
        status = "✅" if response.status_code == 200 else "⚠️"
        print(f"{status} [{i+1}/10] Acessou: {page}")
    except Exception as e:
        print(f"❌ [{i+1}/10] Erro em {page}: {str(e)[:50]}")
    
    time.sleep(0.5)

print("\n✅ Teste concluído!")
print(f"\n📊 Verificar sessões ativas:")
print(f"   {server_url}/api/system/active-sessions")

try:
    response = requests.get(f"{server_url}/api/system/active-sessions")
    data = response.json()
    print(f"\n🌐 Total de sessões ativas: {data['total']}")
    for session in data['sessions']:
        print(f"   • {session['ip']} → {session['pagina']} ({session['tipo']})")
except Exception as e:
    print(f"❌ Erro ao buscar sessões: {e}")

import requests
from PIL import Image
from io import BytesIO

def consultar_deputado_completo(nome_pesquisa):
    # ---------------------------------------------------------
    # PASSO 1: Buscar o ID do deputado pelo nome
    # ---------------------------------------------------------
    url_busca = "https://dadosabertos.camara.leg.br/api/v2/deputados"
    params = {
        "nome": nome_pesquisa,
        "ordem": "ASC",
        "ordenarPor": "nome"
    }
    
    print(f"🔍 Procurando por '{nome_pesquisa}'...")
    try:
        response = requests.get(url_busca, params=params)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro na conexão de busca: {e}")
        return

    resultados = response.json().get('dados', [])
    
    if not resultados:
        print("❌ Ninguém encontrado com esse nome.")
        return
    
    # Pegamos o primeiro resultado da lista
    resumo_deputado = resultados[0]
    id_deputado = resumo_deputado['id']
    
    # ---------------------------------------------------------
    # PASSO 2: Consultar os detalhes (Gabinete e Telefone)
    # ---------------------------------------------------------
    url_perfil = f"https://dadosabertos.camara.leg.br/api/v2/deputados/{id_deputado}"
    
    print(f"📥 Baixando dados detalhados de {resumo_deputado['nome']}...")
    try:
        resp_perfil = requests.get(url_perfil)
        resp_perfil.raise_for_status()
        dados_completos = resp_perfil.json()['dados']
    except Exception as e:
        print(f"❌ Erro ao pegar detalhes: {e}")
        return

    # Atalho para os dados do gabinete (fica dentro de ultimoStatus)
    status = dados_completos['ultimoStatus']
    gabinete = status.get('gabinete', {})

    # Montando as informações de forma segura (caso algum campo venha vazio)
    info = {
        "Nome Civil": dados_completos['nomeCivil'],
        "Nome Urna": status['nomeEleitoral'],
        "Partido": status['siglaPartido'],
        "Estado": status['siglaUf'],
        "Email": status.get('email', 'Não informado'),
        "Telefone": gabinete.get('telefone', 'Não informado'),
        "Gabinete": f"Prédio {gabinete.get('predio', '?')}, Sala {gabinete.get('sala', '?')}, Andar {gabinete.get('andar', '?')}",
        "Situação": status['situacao'],
        "URL Foto": status['urlFoto']
    }

    # ---------------------------------------------------------
    # PASSO 3: Exibir no Terminal
    # ---------------------------------------------------------
    print("\n" + "="*60)
    print(f"📋 FICHA COMPLETA: {info['Nome Urna'].upper()}")
    print("="*60)
    
    for chave, valor in info.items():
        if chave != "URL Foto": 
            print(f"{chave.ljust(15)}: {valor}")
            print("-" * 60)
            
    print(f"Link da Foto   : {info['URL Foto']}")
    print("="*60)
    
    # ---------------------------------------------------------
    # PASSO 4: Mostrar Imagem
    # ---------------------------------------------------------
    try:
        print("\n📸 Abrindo foto...")
        response_img = requests.get(info['URL Foto'])
        img = Image.open(BytesIO(response_img.content))
        img.show()
        print("✅ Foto exibida.")
    except:
        print("⚠️ Não foi possível abrir a imagem visualmente.")

# --- EXECUÇÃO ---
if __name__ == "__main__":
    nome = input("Digite o nome do deputado: ")
    consultar_deputado_completo(nome)
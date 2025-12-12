from fastapi import APIRouter
from database import db

router = APIRouter(prefix="/aux")

@router.get("/categorias")
def get_categorias():
    return db.execute_query("SELECT DISTINCT Categoria FROM tabcategorias ORDER BY Categoria")

@router.get("/situacoes")
def get_situacoes():
    return db.execute_query("SELECT DISTINCT SituacaoLink as Situacao FROM tabAndamento WHERE SituacaoLink IS NOT NULL ORDER BY SituacaoLink")

@router.get("/setores")
def get_setores():
    return db.execute_query("SELECT DISTINCT SetorLink as Setor FROM tabAndamento WHERE SetorLink IS NOT NULL ORDER BY SetorLink")

@router.get("/maquinas")
def get_maquinas():
    return db.execute_query("SELECT DISTINCT MaquinaLink FROM tabDetalhesServico ORDER BY MaquinaLink")

@router.get("/produtos")
def get_produtos():
    return db.execute_query("SELECT DISTINCT TipoPublicacaoLink as Produto FROM tabDetalhesServico ORDER BY TipoPublicacaoLink")

@router.get("/papeis")
def get_papeis():
    return db.execute_query("SELECT DISTINCT Papel FROM tabPapel ORDER BY Papel")

@router.get("/cores")
def get_cores():
    return db.execute_query("SELECT DISTINCT Cor FROM tabCores ORDER BY Cor")

# --- INTEGRAÇÃO DEPUTADOS ---
import requests
from unicodedata import normalize

def remover_acentos(txt: str) -> str:
    return normalize('NFKD', txt).encode('ASCII', 'ignore').decode('ASCII')

@router.get("/deputado/buscar")
def buscar_deputado(nome: str):
    if not nome or len(nome) < 3: return {}
    
    nome_limpo = remover_acentos(nome).upper().strip()

    # 1. Verifica Cache
    sql_cache = "SELECT * FROM DeputadosCache WHERE Nome = %s"
    res = db.execute_query(sql_cache, (nome_limpo,))
    if res:
        return {
            "nome": res[0]['Nome'],
            "gabinete": res[0]['Gabinete'],
            "andar": res[0]['Andar'],
            "local": res[0]['Local'],
            "ramal": res[0]['Ramal'],
            "foto": res[0]['FotoURL']
        }

    # 2. Consulta API Câmara (Lógica do search_dep.py)
    try:
        url_busca = "https://dadosabertos.camara.leg.br/api/v2/deputados"
        params = {"nome": nome, "ordem": "ASC", "ordenarPor": "nome"}
        resp = requests.get(url_busca, params=params, timeout=5)
        resp.raise_for_status()
        
        dados = resp.json().get('dados', [])
        if not dados: return {}

        # Pega o primeiro
        dep = dados[0]
        id_dep = dep['id']

        # 3. Detalhes
        url_detalhe = f"https://dadosabertos.camara.leg.br/api/v2/deputados/{id_dep}"
        resp_det = requests.get(url_detalhe, timeout=5)
        resp_det.raise_for_status()
        
        d = resp_det.json()['dados']
        status = d['ultimoStatus']
        gab = status.get('gabinete', {})

        resultado = {
            "nome": nome_limpo,
            "gabinete": f"Prédio {gab.get('predio', '?')}, Sala {gab.get('sala', '?')}",
            "andar": gab.get('andar', ''),
            "local": "Câmara dos Deputados",
            "ramal": gab.get('telefone', ''),
            "foto": status['urlFoto']
        }

        # 4. Salvar Cache
        sql_insert = """
            INSERT INTO DeputadosCache (Nome, Gabinete, Andar, Local, Ramal, FotoURL)
            VALUES (%s, %s, %s, %s, %s, %s)
        """
        db.execute_query(sql_insert, (
            resultado['nome'], 
            resultado['gabinete'], 
            resultado['andar'], 
            resultado['local'], 
            resultado['ramal'], 
            resultado['foto']
        ))

        return resultado

    except Exception as e:
        print(f"Erro API Deputados: {e}")
        return {}
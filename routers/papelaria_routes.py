from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, Any
import logging
import os
import uuid
import shutil
import tempfile
import threading
import traceback
from database import db

# Imports para automação Windows (CorelDRAW)
import pythoncom
import win32com.client
from win32com.client import gencache

router = APIRouter(prefix="/papelaria")
logger = logging.getLogger(__name__)

# --- CONFIGURAÇÕES ---

# 1. Caminho dos Modelos na Rede
COREL_MODELS_DIR = r"\\redecamara\dfsdata\cgraf\sefoc\Laboratorio\Modelos\Modelos Corel\Papelaria\CSP"

# 2. Caminho Local para Previews
BASE_DIR = os.getcwd()
PREVIEW_DIR = os.path.join(BASE_DIR, "previews")
os.makedirs(PREVIEW_DIR, exist_ok=True)

# 3. Trava para garantir que apenas uma requisição use o Corel por vez
corel_lock = threading.Lock()

# --- MODELS ---
class PapelariaPayload(BaseModel):
    id_produto: str # Recebendo o NOME do produto (string) como ID, para compatibilidade com Frontend
    dados: Dict[str, Any]

# --- FUNÇÕES AUXILIARES ---

def reset_pywin32_cache():
    """Limpa o cache do PyWin32 para evitar erros de versão de objetos COM"""
    try:
        gen_py_path = os.path.join(tempfile.gettempdir(), "gen_py")
        if os.path.exists(gen_py_path):
            shutil.rmtree(gen_py_path)
    except Exception as e:
        logger.warning(f"Não foi possível limpar cache pywin32: {e}")

def cleanup_file(path: str):
    """Remove arquivo temporário após envio"""
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        logger.error(f"Erro limpando arquivo {path}: {e}")

# --- ENDPOINTS ---

@router.get("/modelos")
def get_modelos():
    """Retorna lista de modelos disponíveis do banco de dados."""
    try:
        # Busca produtos ativos na tabela, ordenados pelo nome
        query = "SELECT NomeProduto FROM tabPapelariaModelos WHERE Ativo = 1 ORDER BY NomeProduto"
        results = db.execute_query(query)
        
        # Mapeia para o formato esperado pelo frontend (id=NomeProduto)
        lista = []
        for row in results:
            lista.append({
                "id": row['NomeProduto'],   # Frontend usa o Nome como valor do option
                "nome": row['NomeProduto']
            })
            
        return lista
    except Exception as e:
        logger.error(f"Erro ao listar modelos: {e}")
        # Fallback caso o banco falhe, para não quebrar totalmente a UI
        return []

@router.post("/preview")
def generate_preview(payload: PapelariaPayload, background_tasks: BackgroundTasks):
    logger.info(f"Iniciando Preview Corel (COM) para: {payload.id_produto}")

    # 1. Identificar o arquivo CDR no Banco de Dados
    # Buscamos pelo NOME do produto, pois é o que o frontend envia como 'id_produto'
    try:
        query = "SELECT NomeArquivo FROM tabPapelariaModelos WHERE NomeProduto = %(nome)s AND Ativo = 1"
        res = db.execute_query(query, {'nome': payload.id_produto})
        
        if not res:
            logger.warning(f"Produto não encontrado no banco: {payload.id_produto}")
            # Tenta fallback usando o próprio ID como arquivo se tiver .cdr
            if payload.id_produto.lower().endswith('.cdr'):
                 filename_cdr = payload.id_produto
            else:
                 raise HTTPException(status_code=404, detail=f"Modelo '{payload.id_produto}' não encontrado no sistema.")
        else:
            filename_cdr = res[0]['NomeArquivo']
            
    except Exception as e_db:
        logger.error(f"Erro de banco de dados: {e_db}")
        raise HTTPException(status_code=500, detail="Erro interno ao buscar configuração do modelo.")

    # 2. Caminhos
    filepath_modelo = os.path.join(COREL_MODELS_DIR, filename_cdr)
    
    # Valida se arquivo existe na rede
    if not os.path.exists(filepath_modelo):
        logger.error(f"Arquivo de modelo não encontrado na rede: {filepath_modelo}")
        raise HTTPException(status_code=404, detail="Arquivo do modelo não encontrado no servidor de arquivos.")

    preview_filename = f"preview_{uuid.uuid4().hex}.pdf"
    preview_path = os.path.join(PREVIEW_DIR, preview_filename)
    abs_preview_path = os.path.abspath(preview_path)

    # 3. Automação do CorelDRAW
    with corel_lock:
        try:
            # Inicializa COM para a Thread atual
            pythoncom.CoInitialize()

            try:
                # Conexão com Corel
                try:
                    corel = gencache.EnsureDispatch("CorelDRAW.Application")
                except Exception:
                    logger.warning("Erro no Dispatch inicial, limpando cache COM...")
                    reset_pywin32_cache()
                    corel = gencache.EnsureDispatch("CorelDRAW.Application")
                
                corel.Visible = True
                
                # Abre documento sem modificar original (OpenDocument cria cópia em memória)
                doc = corel.OpenDocument(filepath_modelo)
                
                # Substituição de Variáveis
                for key, valor in payload.dados.items():
                    if not valor: 
                        valor = " " # Espaço placeholder
                    
                    try:
                        # FindShapes(Name, Type=6 (Texto), Recursive=True=1)
                        shapes = doc.ActivePage.FindShapes(key, 6, 1)
                        
                        if shapes.Count > 0:
                            for i in range(1, shapes.Count + 1):
                                shapes.Item(i).Text.Story.Text = str(valor).strip()
                    except Exception as e_field:
                        logger.warning(f"Erro ao substituir campo '{key}': {e_field}")

                # Exportar PDF
                doc.PublishToPDF(abs_preview_path)
                
                # Fecha da memória
                doc.Close()

            except Exception as e_corel:
                try: 
                    if 'doc' in locals() and doc: doc.Close() 
                except: pass
                raise e_corel
                
        except Exception as e:
            err_msg = traceback.format_exc()
            logger.error(f"Erro Crítico na Automação Corel: {e}")
            logger.error(err_msg)
            
            # Salva em arquivo para garantir que o usuário veja
            try:
                with open("corel_error.log", "w", encoding="utf-8") as f:
                    f.write(f"ERRO: {str(e)}\n\nTRACEBACK:\n{err_msg}")
            except: pass

            raise HTTPException(status_code=500, detail=f"Erro na comunicação com CorelDRAW: {str(e)}")
        finally:
            pythoncom.CoUninitialize()

    # 4. Verifica sucesso
    if not os.path.exists(abs_preview_path):
        logger.error(f"Arquivo não gerado: {abs_preview_path}")
        raise HTTPException(status_code=500, detail="O CorelDRAW falhou ao gerar o arquivo de preview.")

    # 5. Agendar limpeza
    background_tasks.add_task(cleanup_file, abs_preview_path)

    # 6. Retorno Blob (Compatível com Frontend Step 76)
    return FileResponse(
        path=abs_preview_path,
        media_type='application/pdf',
        filename="preview.pdf"
    )
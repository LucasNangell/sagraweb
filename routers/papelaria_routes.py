from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, Any
import logging
import os
import uuid
import shutil
import threading
import traceback
import json
from database import db

# Imports para automação Windows
import pythoncom
import win32com.client

router = APIRouter(prefix="/papelaria")
logger = logging.getLogger(__name__)

# --- CONFIGURAÇÕES ---
COREL_MODELS_DIR = r"\\redecamara\dfsdata\CGraf\Sefoc\Laboratorio\Modelos\Modelos Corel\Papelaria\CSP\WEB"
BASE_DIR = os.getcwd()
PREVIEW_DIR = os.path.join(BASE_DIR, "previews")
os.makedirs(PREVIEW_DIR, exist_ok=True)
corel_lock = threading.Lock()

# --- MODELS ---
class PapelariaPayload(BaseModel):
    id_produto: str 
    dados: Dict[str, Any]

# --- AUXILIARES ---
def cleanup_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        logger.error(f"Erro limpando arquivo {path}: {e}")

# --- ENDPOINTS ---
@router.get("/modelos")
def get_modelos():
    try:
        query = "SELECT NomeProduto FROM tabPapelariaModelos WHERE Ativo = 1 ORDER BY NomeProduto"
        results = db.execute_query(query)
        return [{"id": r['NomeProduto'], "nome": r['NomeProduto']} for r in results]
    except Exception as e:
        logger.error(f"Erro BD: {e}")
        return []

@router.get("/modelos/{nome_produto}")
def get_modelo_details(nome_produto: str):
    try:
        query = "SELECT ConfigCampos FROM tabPapelariaModelos WHERE NomeProduto = %(nome)s"
        res = db.execute_query(query, {'nome': nome_produto})
        if not res: raise HTTPException(404, "Modelo não encontrado")
        
        config = res[0]['ConfigCampos']
        if isinstance(config, str):
            try: config = json.loads(config)
            except: config = []
        return config
    except Exception as e:
        logger.error(f"Erro BD: {e}")
        raise HTTPException(500, "Erro interno.")

@router.post("/preview")
def generate_preview(payload: PapelariaPayload, background_tasks: BackgroundTasks):
    logger.info(f"Iniciando Preview (PDF) para: {payload.id_produto}")

    # 1. Identificar arquivo CDR
    try:
        query = "SELECT NomeArquivo FROM tabPapelariaModelos WHERE NomeProduto = %(nome)s AND Ativo = 1"
        res = db.execute_query(query, {'nome': payload.id_produto})
        if not res:
            if payload.id_produto.lower().endswith('.cdr'):
                 filename_cdr = payload.id_produto
            else:
                 raise HTTPException(404, f"Modelo '{payload.id_produto}' não encontrado.")
        else:
            filename_cdr = res[0]['NomeArquivo']
    except Exception as e:
        raise HTTPException(500, "Erro de banco de dados.")

    filepath_modelo = os.path.join(COREL_MODELS_DIR, filename_cdr)
    if not os.path.exists(filepath_modelo):
        raise HTTPException(404, "Arquivo CDR não encontrado na rede.")

    # 2. Caminho PDF
    preview_filename = f"preview_{uuid.uuid4().hex}.pdf"
    preview_path = os.path.join(PREVIEW_DIR, preview_filename)
    abs_preview_path = os.path.abspath(preview_path)

    # 3. Automação Corel
    with corel_lock:
        try:
            pythoncom.CoInitialize()
            
            # Conexão Padrão (Estável)
            corel = win32com.client.Dispatch("CorelDRAW.Application")
            corel.Visible = True
            
            doc = corel.OpenDocument(filepath_modelo)
            
            # Substituição de Variáveis
            for key, valor in payload.dados.items():
                if not valor: valor = " "
                try:
                    shapes = doc.ActivePage.FindShapes(key, 6, 1)
                    if shapes.Count > 0:
                        for i in range(1, shapes.Count + 1):
                            shapes.Item(i).Text.Story.Text = str(valor).strip()
                except: pass

            # Exportação PDF (Nativa e Robusta)
            doc.PublishToPDF(abs_preview_path)
            doc.Close()

        except Exception as e:
            err_msg = traceback.format_exc()
            logger.error(f"Erro Corel: {e}")
            try: 
                if 'doc' in locals() and doc: doc.Close()
            except: pass
            raise HTTPException(500, f"Erro na geração do PDF: {str(e)}")
        finally:
            pythoncom.CoUninitialize()

    if not os.path.exists(abs_preview_path):
        raise HTTPException(500, "PDF não foi gerado.")

    background_tasks.add_task(cleanup_file, abs_preview_path)

    return FileResponse(
        path=abs_preview_path,
        media_type='application/pdf',
        filename="preview.pdf"
    )
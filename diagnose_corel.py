import os
import sys
import logging
import traceback
import pythoncom
import win32com.client
from win32com.client import gencache
from database import db

# Configuração de Log
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("DiagnoseCorel")

def diagnose():
    logger.info("=== INICIANDO DIAGNÓSTICO DE AUTOMAÇÃO COREL ===")
    
    # 1. Teste de Banco de Dados
    logger.info("1. Testando conexão com Banco de Dados...")
    try:
        modelos = db.execute_query("SELECT NomeProduto, NomeArquivo FROM tabPapelariaModelos WHERE Ativo = 1 LIMIT 1")
        if not modelos:
            logger.error("   [FALHA] Nenhum modelo ativo encontrado no banco.")
            return
        
        produto = modelos[0]
        logger.info(f"   [OK] Modelo encontrado: {produto['NomeProduto']} -> {produto['NomeArquivo']}")
    except Exception as e:
        logger.error(f"   [FALHA] Erro no banco: {e}")
        return

    # 2. Verificação de Arquivo
    logger.info("2. Verificando arquivo na rede...")
    COREL_MODELS_DIR = r"\\redecamara\dfsdata\cgraf\sefoc\Laboratorio\Modelos\Modelos Corel\Papelaria\CSP"
    filepath = os.path.join(COREL_MODELS_DIR, produto['NomeArquivo'])
    
    if os.path.exists(filepath):
        logger.info(f"   [OK] Arquivo existe: {filepath}")
    else:
        logger.error(f"   [FALHA] Arquivo NÃO encontrado: {filepath}")
        return

    # 3. Teste de Automação COM
    logger.info("3. Testando CorelDRAW Automation (COM)...")
    try:
        logger.info("   Tentando pythoncom.CoInitialize()...")
        pythoncom.CoInitialize()
        
        logger.info("   Tentando gencache.EnsureDispatch()...")
        # Força limpeza de cache antes (simulando reset)
        import shutil, tempfile
        try:
            gen_py = os.path.join(tempfile.gettempdir(), "gen_py")
            if os.path.exists(gen_py):
                shutil.rmtree(gen_py)
                logger.info("   Cache pywin32 limpo.")
        except: pass

        corel = gencache.EnsureDispatch("CorelDRAW.Application")
        logger.info("   [OK] CorelDRAW disparado com sucesso.")
        
        corel.Visible = True
        logger.info("   Corel visível.")
        
        logger.info(f"   Abrindo documento: {filepath}")
        doc = corel.OpenDocument(filepath)
        logger.info("   [OK] Documento aberto.")
        
        # Teste de Busca de Shapes
        logger.info("   Testando substituição (FindShapes)...")
        # Tenta buscar algo que provavelmente não existe só para testar a chamada
        shapes = doc.ActivePage.FindShapes("teste_inexistente", 6, 1)
        logger.info(f"   FindShapes executado. Encontrados: {shapes.Count}")
        
        # Teste de Exportação
        test_pdf = os.path.abspath("teste_diagnostico.pdf")
        logger.info(f"   Testando Exportação para PDF: {test_pdf}")
        doc.PublishToPDF(test_pdf)
        
        if os.path.exists(test_pdf):
             logger.info("   [OK] PDF gerado com sucesso.")
        else:
             logger.error("   [FALHA] PDF não foi criado.")
             
        doc.Close()
        logger.info("   Documento fechado.")
        
    except Exception as e:
        logger.error("   [FALHA CRÍTICA NO COREL]:")
        logger.error(traceback.format_exc())
    finally:
        pythoncom.CoUninitialize()
        logger.info("=== DIAGNÓSTICO FINALIZADO ===")

if __name__ == "__main__":
    diagnose()

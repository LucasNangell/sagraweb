import uvicorn
import logging
import os
import sys

# Garante que o diretório atual está no path
sys.path.append(os.getcwd())

# Configuração de Logger agressiva para DEBUG
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger("DebugServer")
logger.info(">>> INICIANDO SERVIDOR EM MODO DEBUG <<<")
logger.info("Por favor, reproduza o erro no site agora e observe este console.")

if __name__ == "__main__":
    try:
        # Importa a app aqui dentro para que o logging config acima pegue desde o início
        from routers.api import app
        
        # Executa o servidor Uvicorn com log level debug
        # Host 127.0.0.1 = APENAS localhost (não acessível de outras máquinas)
        uvicorn.run(app, host="127.0.0.1", port=8001, log_level="debug", access_log=True)
        
    except Exception as e:
        logger.error(f"FATAL ERROR no Debug Server: {e}")
        import traceback
        traceback.print_exc()
        input("Pressione ENTER para sair...")

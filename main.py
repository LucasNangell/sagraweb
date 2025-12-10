import uvicorn
import logging
import os
import sys

# Garante que o diretório atual está no path
sys.path.append(os.getcwd())

# Importa a aplicação definida no pacote routers
from routers.api import app

# Configuração de Logger para o Launcher (Root)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Launcher")

if __name__ == "__main__":
    logger.info("Iniciando servidor SAGRA via main.py (Modular)...")
    try:
        # Executa o servidor Uvicorn
        # Reloader DESATIVADO para garantir captura de logs pelo Launcher
        uvicorn.run("routers.api:app", host="0.0.0.0", port=8001, reload=False)
    except Exception as e:
        logger.error(f"Erro fatal ao iniciar servidor: {e}")
        input("Pressione ENTER para sair...")

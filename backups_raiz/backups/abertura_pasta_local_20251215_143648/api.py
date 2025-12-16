from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import logging
import uvicorn
import time
import os
from datetime import datetime

# Import dos Routers (Módulos)
from routers import os_routes, analise_routes, email_routes, auxiliar_routes, papelaria_routes, settings_routes

# Configurar logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SAGRA API", version="7.0 Modular")

# --- MONITORAMENTO DE IPs ---
connected_ips = {}  # {ip: timestamp}

class ConnectedIPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host
        # Update timestamp
        connected_ips[client_ip] = time.time()
        response = await call_next(request)
        return response

app.add_middleware(ConnectedIPMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ROTAS DE MONITORAMENTO ---
@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/connected-ips")
def get_connected_ips():
    # Limpa IPs inativos (> 60s)
    now = time.time()
    active_ips = {ip: ts for ip, ts in connected_ips.items() if now - ts < 60}
    
    # Atualiza a lista global (side effect para limpeza)
    connected_ips.clear()
    connected_ips.update(active_ips)
    
    # Retorna lista formatada
    return [
        {"ip": ip, "last_seen": datetime.fromtimestamp(ts).strftime('%H:%M:%S')}
        for ip, ts in active_ips.items()
    ]

@app.get("/api/download/folder-opener")
async def download_folder_opener():
    """
    Endpoint para download do executável SAGRA Folder Opener
    
    Permite que usuários baixem o serviço local que possibilita
    a abertura automática de pastas do Windows Explorer.
    
    Returns:
        FileResponse: Executável .exe
    """
    try:
        exe_path = os.path.join("local_services", "dist", "SAGRA-FolderOpener.exe")
        
        if not os.path.exists(exe_path):
            logger.warning(f"Executável não encontrado: {exe_path}")
            from fastapi import HTTPException
            raise HTTPException(
                status_code=404,
                detail="Executável não disponível. Execute o build primeiro: cd local_services && build_executable.bat"
            )
        
        # Caminho sugerido para instalação automática no startup
        suggested_filename = "SAGRA-FolderOpener.exe"
        
        logger.info(f"Download do folder opener iniciado")
        
        return FileResponse(
            path=exe_path,
            media_type="application/octet-stream",
            filename=suggested_filename,
            headers={
                "Content-Disposition": f'attachment; filename="{suggested_filename}"',
                "X-Suggested-Path": "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
            }
        )
    except Exception as e:
        logger.error(f"Erro no download: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e))

# Incluir as Rotas (Modularização)
app.include_router(os_routes.router, prefix="/api")
app.include_router(analise_routes.router, prefix="/api")
app.include_router(email_routes.router, prefix="/api")
app.include_router(auxiliar_routes.router, prefix="/api")
app.include_router(papelaria_routes.router, prefix="/api")
app.include_router(settings_routes.router, prefix="/api")

# Mount static files
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    # reload=False para garantir que logs apareçam no Launcher
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=False, access_log=True)
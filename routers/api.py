from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import logging
import uvicorn

# Import dos Routers (Módulos)
from routers import os_routes, analise_routes, email_routes, auxiliar_routes, papelaria_routes, settings_routes

# Configurar logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SAGRA API", version="7.0 Modular")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
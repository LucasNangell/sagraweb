@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================================
REM SAGRA Web — Inicialização LOCAL (desenvolvimento)
REM Sem Nginx, sem Cloudflare Tunnel, sem --proxy-headers
REM ============================================================================

set "ROOT=%~dp0..\.."
set "BACKEND=%ROOT%\app\backend"
set "ENV_FILE=%ROOT%\config\.env"

call "%~dp0_resolve-dev-tools.cmd"

echo.
echo  SAGRA Web - Modo DESENVOLVIMENTO LOCAL
echo  Raiz do projeto: %ROOT%
echo.

python -c "import sys" >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado ^(stub da Store ou ausente^).
    pause
    exit /b 1
)

if not exist "%ENV_FILE%" (
    echo [ERRO] Arquivo nao encontrado: %ENV_FILE%
    pause
    exit /b 1
)

REM Carregar variaveis do .env para o processo
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
    set "line=%%a"
    if not "!line!"=="" (
        set "%%a=%%b"
    )
)

REM Compatibilidade com config_manager (SAGRA_* + nomes do .env)
if defined DB_HOST set "SAGRA_DB_HOST=!DB_HOST!"
if defined DB_USER set "SAGRA_DB_USER=!DB_USER!"
if defined DB_PASSWORD set "SAGRA_DB_PASSWORD=!DB_PASSWORD!"
if defined DB_NAME set "SAGRA_DB_NAME=!DB_NAME!"
if defined PORT set "SAGRA_SERVER_PORT=!PORT!"
set "ENV=development"
set "SAGRA_ENV=development"

cd /d "%BACKEND%"
set "PYTHONPATH=%BACKEND%;%ROOT%\app\services;%PYTHONPATH%"
if errorlevel 1 (
    echo [ERRO] Nao foi possivel acessar: %BACKEND%
    pause
    exit /b 1
)

title SAGRA-API :8001

echo [1/2] Gerando config_client.js para o frontend...
python -c "from config_manager import config_manager; config_manager.write_client_config_js(); print('OK:', config_manager.get_api_base())"
if errorlevel 1 (
    echo [AVISO] Falha ao gerar config_client.js - verifique python-dotenv: pip install python-dotenv
)

echo.
echo [2/2] Iniciando Uvicorn em http://127.0.0.1:8001 (reload ativo)...
echo        Modo: MYSQL_ONLY - sem sync_andamentos nem dual-write MDB
echo        Frontend: http://127.0.0.1:8001/index.html
echo        API:      http://127.0.0.1:8001/api/
echo        Health:   http://127.0.0.1:8001/health/live
echo.
echo Pressione Ctrl+C para encerrar.
echo.

python -m uvicorn routers.api:app --host 127.0.0.1 --port 8001 --reload

echo.
pause
endlocal

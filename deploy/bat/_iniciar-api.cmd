@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "API_PORT=%~1"
if "%API_PORT%"=="" set "API_PORT=8001"

set "ROOT=%~dp0..\.."
set "BACKEND=%ROOT%\app\backend"
set "ENV_FILE=%ROOT%\config\.env"
set "PYTHONPATH=%BACKEND%;%ROOT%\app\services"

call "%~dp0_resolve-dev-tools.cmd"

if defined SAGRA_PYTHON (
    "%SAGRA_PYTHON%" -c "import sys" >nul 2>&1
) else (
    python -c "import sys" >nul 2>&1
)
if errorlevel 1 (
    echo [ERRO] Python nao encontrado ^(stub da Store ou ausente^).
    echo        Use o launcher "py" ou adicione o python.exe real ao PATH.
    if defined SAGRA_PYTHON echo        Tentativa resolvida: %SAGRA_PYTHON%
    pause
    exit /b 1
)

if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
        set "line=%%a"
        if not "!line!"=="" set "%%a=%%b"
    )
    if defined DB_HOST set "SAGRA_DB_HOST=!DB_HOST!"
    if defined DB_USER set "SAGRA_DB_USER=!DB_USER!"
    if defined DB_PASSWORD set "SAGRA_DB_PASSWORD=!DB_PASSWORD!"
    if defined DB_NAME set "SAGRA_DB_NAME=!DB_NAME!"
    if defined PORT (
        set "API_PORT=!PORT!"
        set "SAGRA_SERVER_PORT=!PORT!"
    )
)

set "ENV=development"
set "SAGRA_ENV=development"
set "SAGRA_SPA_ACCESS_CONTROL=false"

cd /d "%BACKEND%"
if errorlevel 1 (
    echo [ERRO] Pasta backend nao encontrada: %BACKEND%
    pause
    exit /b 1
)

title SAGRA-API :%API_PORT%

echo.
echo  SAGRA API — http://127.0.0.1:%API_PORT%/
echo  Perfil: DEV — conexoes MySQL/MDB de config.development.json
echo  Health: http://127.0.0.1:%API_PORT%/health/live
echo  Ctrl+C para encerrar esta janela.
echo.

if not defined SAGRA_PYTHON set "SAGRA_PYTHON=python"
"%SAGRA_PYTHON%" -c "from config_manager import config_manager; config_manager.write_client_config_js(); print('config_client.js OK')" 2>nul
if errorlevel 1 echo [AVISO] Falha ao gerar config_client.js

"%SAGRA_PYTHON%" -m uvicorn routers.api:app --host 127.0.0.1 --port %API_PORT% --reload --reload-delay 2

pause
endlocal

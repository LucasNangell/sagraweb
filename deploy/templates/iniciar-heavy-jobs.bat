@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem Worker de jobs pesados (Prova WEB / Análise Lab / ZIP) — processo separado da API.
rem Na API, defina SAGRA_INPROCESS_HEAVY_JOBS=0 para não competir pelo mesmo CPU.
rem NÃO use uvicorn --workers na API (WebSocket e caches são in-memory neste processo).

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
pushd "%ROOT%" 2>nul
if errorlevel 1 (
    echo [ERRO] Nao foi possivel acessar a pasta: %ROOT%
    pause
    exit /b 1
)
set "ROOT=%CD%"
set "BACKEND=%ROOT%\app\backend"
set "ENV_FILE=%ROOT%\config\.env"
set "PYTHONPATH=%BACKEND%;%ROOT%\app\services"
if exist "%ROOT%\python_pkgs" (
    set "PYTHONPATH=%ROOT%\python_pkgs;%PYTHONPATH%"
)

where python >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado no PATH.
    popd
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
)

set "SAGRA_INPROCESS_HEAVY_JOBS=1"

echo.
echo === SAGRA Heavy Jobs Worker ===
echo Pasta: %ROOT%
echo Nao use uvicorn --workers na API HTTP.
echo.

cd /d "%BACKEND%"
python -m heavy_jobs_worker
set "RC=!ERRORLEVEL!"
popd
if not "!RC!"=="0" (
    echo.
    echo [ERRO] Worker encerrou com codigo !RC!
    pause
)
endlocal
exit /b %RC%

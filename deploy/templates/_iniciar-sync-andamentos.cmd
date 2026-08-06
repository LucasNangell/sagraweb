@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~1"
if "%ROOT%"=="" (
    set "ROOT=%~dp0"
    if "!ROOT:~-1!"=="\" set "ROOT=!ROOT:~0,-1!"
)

set "BACKEND=%ROOT%\app\backend"
set "SERVICES=%ROOT%\app\services"
set "SYNC_OLD=%ROOT%\sync_andamentos_v2_Old.py"
set "SYNC_NEW=%SERVICES%\sync_andamentos_v2.py"
set "SYNC_TARGET="
set "ENV_FILE=%ROOT%\config\.env"
set "PYTHONPATH=%BACKEND%;%SERVICES%"
if exist "%ROOT%\python_pkgs" (
    set "PYTHONPATH=%ROOT%\python_pkgs;%PYTHONPATH%"
)

if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
        set "line=%%a"
        if not "!line!"=="" set "%%a=%%b"
    )
)

if not defined ENV set "ENV=production"

cd /d "%SERVICES%"
if errorlevel 1 (
    echo [ERRO] Pasta nao encontrada: %SERVICES%
    pause
    exit /b 1
)

if exist "%SYNC_OLD%" (
    set "SYNC_TARGET=%SYNC_OLD%"
) else if exist "%SYNC_NEW%" (
    set "SYNC_TARGET=%SYNC_NEW%"
)

if not defined SYNC_TARGET (
    echo [ERRO] Script nao encontrado:
    echo        - %SYNC_OLD%
    echo        - %SYNC_NEW%
    pause
    exit /b 1
)

if not exist "%ROOT%\logs\sync" mkdir "%ROOT%\logs\sync" 2>nul

echo.
echo  SAGRA sync_andamentos
echo  Raiz: %ROOT%
echo  Script: %SYNC_TARGET%
echo  Log:  %ROOT%\logs\sync\sync_andamentos.log
echo  Ctrl+C para encerrar esta janela.
echo.

python "%SYNC_TARGET%"

echo.
pause
endlocal

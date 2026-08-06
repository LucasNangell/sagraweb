@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================================
REM SAGRA Web — SPA React (Vite) em DISCO LOCAL
REM O pnpm/npm falham em caminhos UNC (\\servidor\...) no postinstall do esbuild.
REM Este script espelha o monorepo em C:\dev\SagraWeb e roda pnpm install + dev.
REM ============================================================================

set "SOURCE=%~dp0..\.."
set "LOCAL=C:\dev\SagraWeb"
set "PNPM=pnpm"

call "%~dp0_resolve-dev-tools.cmd"

echo.
echo  SAGRA Web - Dev SPA (copia local)
echo  Origem : %SOURCE%
echo  Destino: %LOCAL%
echo.

where %PNPM% >nul 2>&1
if errorlevel 1 (
    echo [ERRO] pnpm nao encontrado. Instale: npm install -g pnpm
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    pause
    exit /b 1
)

if not exist "%LOCAL%" mkdir "%LOCAL%"

echo [1/3] Sincronizando arquivos para disco local (robocopy)...
robocopy "%SOURCE%" "%LOCAL%" /MIR /XD node_modules .git dist .turbo /XF *.log /NFL /NDL /NJH /NJS /nc /ns /np
if errorlevel 8 (
    echo [ERRO] Robocopy falhou com codigo !errorlevel!
    pause
    exit /b 1
)

cd /d "%LOCAL%"
if errorlevel 1 (
    echo [ERRO] Nao foi possivel acessar %LOCAL%
    pause
    exit /b 1
)

echo.
echo [2/3] pnpm install em %CD% ...
call %PNPM% install
if errorlevel 1 (
    echo.
    echo [AVISO] install falhou. Tentando limpar node_modules e repetir...
    if exist "node_modules" rmdir /s /q "node_modules"
    call %PNPM% install
    if errorlevel 1 (
        echo [ERRO] pnpm install falhou. Use Node 20 LTS se estiver em v24.
        pause
        exit /b 1
    )
)

echo.
echo [3/3] Iniciando Vite (porta 5173). API esperada em http://127.0.0.1:8001
echo       Feche esta janela ou Ctrl+C para parar.
echo.
call %PNPM% --filter @sagra/web dev

pause
endlocal

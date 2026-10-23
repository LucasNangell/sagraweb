@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

set "WEB_PORT=%~1"
if "%WEB_PORT%"=="" set "WEB_PORT=5173"

set "ROOT=%~dp0..\.."
set "VITE_PKG="

call "%~dp0_resolve-dev-tools.cmd"

cd /d "%ROOT%"
if errorlevel 1 (
    echo [ERRO] Raiz do projeto nao encontrada: %ROOT%
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
    if not exist "%SAGRA_PNPM%" (
        echo [ERRO] pnpm nao encontrado. Instale: npm install -g pnpm
        echo        Ou ative Corepack: corepack enable ^&^& corepack prepare pnpm@9.15.0 --activate
        echo        E garanta %%APPDATA%%\npm no PATH do usuario.
        pause
        exit /b 1
    )
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    pause
    exit /b 1
)

set "VITE_DEV_PORT=%WEB_PORT%"
set "API_PORT=8001"
if exist "%ROOT%\config\.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ROOT%\config\.env") do (
        set "line=%%a"
        if not "!line!"=="" set "%%a=%%b"
    )
)
if defined PORT set "API_PORT=%PORT%"

call :resolve_vite
if errorlevel 1 (
    echo [FRONT] Vite nao encontrado - executando pnpm install...
    call :pnpm_install_or_fail
    if errorlevel 1 exit /b 1
)

title SAGRA-WEB :%WEB_PORT%

echo.
echo  SAGRA Web (Vite) - http://127.0.0.1:%WEB_PORT%/
echo  Proxy /api -^> http://127.0.0.1:%API_PORT%
curl.exe -s -o NUL -w "%%{http_code}" "http://127.0.0.1:%API_PORT%/health/live" 2>nul | findstr /B "200" >nul
if errorlevel 1 (
    echo  [AVISO] API nao responde em http://127.0.0.1:%API_PORT%/health/live
    echo          Confira a janela "SAGRA-API" ou execute: iniciar-api.bat restart
    echo.
) else (
    echo  [OK] API respondendo em http://127.0.0.1:%API_PORT%/health/live
)
echo  Ctrl+C para encerrar esta janela ^(nao encerra a API^).
echo.

REM Sobe Vite via node (nao depende de script-shell/PowerShell do pnpm).
call :start_vite
set "RC=!ERRORLEVEL!"

if not "!RC!"=="0" (
    echo.
    echo [FRONT] Falha ao iniciar Vite - limpando node_modules e reinstalando...
    call :clean_node_modules
    call :pnpm_install_or_fail
    if errorlevel 1 exit /b 1
    call :start_vite
    set "RC=!ERRORLEVEL!"
)

if not "!RC!"=="0" (
    echo.
    echo [ERRO] Falha ao iniciar Vite ^(codigo !RC!^).
    pause
    exit /b !RC!
)

pause
exit /b 0

:resolve_vite
set "VITE_PKG="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\resolve-vite-cli.ps1" -WebRoot "%ROOT%\apps\web"`) do set "VITE_PKG=%%I"
if not defined VITE_PKG exit /b 1
if not exist "!VITE_PKG!" (
    set "VITE_PKG="
    exit /b 1
)
exit /b 0

:start_vite
if not defined VITE_PKG (
    echo [ERRO] Vite nao encontrado.
    exit /b 1
)
if not exist "%VITE_PKG%" (
    echo [ERRO] Vite nao encontrado: %VITE_PKG%
    exit /b 1
)
cd /d "%ROOT%\apps\web"
if errorlevel 1 exit /b 1
node "%VITE_PKG%" --port %WEB_PORT% --host 127.0.0.1
set "RC=!ERRORLEVEL!"
cd /d "%ROOT%"
exit /b !RC!

:clean_node_modules
if exist "node_modules" rmdir /s /q "node_modules"
if exist "apps\web\node_modules" rmdir /s /q "apps\web\node_modules"
if exist "packages\ui\node_modules" rmdir /s /q "packages\ui\node_modules"
if exist "packages\api-types\node_modules" rmdir /s /q "packages\api-types\node_modules"
exit /b 0

:materialize_workspace
node "%ROOT%\scripts\materialize-workspace-packages.mjs"
exit /b 0

:pnpm_install_or_fail
if not defined SAGRA_PNPM set "SAGRA_PNPM=pnpm.cmd"
call "%SAGRA_PNPM%" install
set "PNPM_RC=!ERRORLEVEL!"
call :materialize_workspace
call :resolve_vite
if not errorlevel 1 exit /b 0
if not "!PNPM_RC!"=="0" (
    echo [AVISO] pnpm install falhou. Limpando node_modules e repetindo...
    call :clean_node_modules
    call "%SAGRA_PNPM%" install
    call :materialize_workspace
    call :resolve_vite
    if errorlevel 1 (
        echo [ERRO] Nao foi possivel instalar dependencias do frontend.
        echo        Use Node.js 20 LTS se estiver em v22+ com erros de modulo.
        echo        No Windows 11 25H2, node-linker=hoisted no .npmrc e obrigatorio.
        pause
        exit /b 1
    )
    exit /b 0
)
echo [ERRO] Vite nao encontrado apos pnpm install.
pause
exit /b 1

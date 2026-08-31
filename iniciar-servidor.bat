@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================================
REM SAGRA Web — Desenvolvimento
REM
REM   iniciar-servidor.bat              -> API :8001 + Vite :5173 (padrao dev)
REM   iniciar-servidor.bat restart      -> mata API na porta e reinicia API + Vite
REM   iniciar-servidor.bat --restart    -> idem restart
REM   iniciar-servidor.bat api-only     -> mata API na porta e reinicia so API
REM   iniciar-servidor.bat unificado    -> 1 porta (build SPA + Uvicorn :8001)
REM
REM   Dev:  http://127.0.0.1:5173/        (front com hot reload)
REM         http://127.0.0.1:8001/health (API direta)
REM   Unif: http://127.0.0.1:8001/sagra/ (igual producao no cgrafsysvm)
REM ============================================================================

set "ROOT=%~dp0"
set "BACKEND=%ROOT%app\backend"
set "ENV_FILE=%ROOT%config\.env"
set "API_PORT=8001"
set "WEB_PORT=5173"
set "MODE=dev"
set "RESTART=0"
set "API_ONLY=0"

call "%ROOT%deploy\bat\_resolve-dev-tools.cmd"

if /I "%~1"=="unificado" set "MODE=unificado"
if /I "%~1"=="--unificado" set "MODE=unificado"
if /I "%~1"=="prod" set "MODE=unificado"
if /I "%~1"=="restart" set "RESTART=1"
if /I "%~1"=="--restart" set "RESTART=1"
if /I "%~2"=="restart" set "RESTART=1"
if /I "%~2"=="--restart" set "RESTART=1"
if /I "%~1"=="api-only" (
    set "API_ONLY=1"
    set "RESTART=1"
)
if /I "%~1"=="--api-only" (
    set "API_ONLY=1"
    set "RESTART=1"
)

echo.
echo  SAGRA Web — Desenvolvimento ^(%MODE%^)
echo  Raiz: %ROOT%
if "%RESTART%"=="1" echo  Modo: RESTART ^(encerra API antiga na porta %API_PORT%^)
if "%API_ONLY%"=="1" echo  Modo: API-ONLY ^(reinicia somente API^)
echo.

if defined SAGRA_PYTHON (
    "%SAGRA_PYTHON%" -c "import sys" >nul 2>&1
) else (
    python -c "import sys" >nul 2>&1
)
if errorlevel 1 (
    echo [ERRO] Python nao encontrado ^(ou so ha o atalho da Microsoft Store^).
    echo        Instale Python 3 e/ou use o launcher "py" no PATH.
    if defined SAGRA_PYTHON echo        Tentativa resolvida: %SAGRA_PYTHON%
    pause
    exit /b 1
)

if not "%API_ONLY%"=="1" (
    where pnpm >nul 2>&1
    if errorlevel 1 (
        echo [ERRO] pnpm nao encontrado.
        echo        Opcoes: npm install -g pnpm
        echo                 ou: corepack enable ^&^& corepack prepare pnpm@9.15.0 --activate
        echo        Certifique-se de que %%APPDATA%%\npm esta no PATH do usuario.
        pause
        exit /b 1
    )
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
) else (
    echo [AVISO] %ENV_FILE% nao encontrado — usando porta %API_PORT%.
)

set "SAGRA_ENV=development"
set "ENV=development"

echo  Perfil: DEV ^(ENV=development^) — MySQL/MDB via config.development.json
echo           Producao na VM usa ENV=production + config.json ^(sem overlay^).
echo.

if /I "%MODE%"=="unificado" goto :modo_unificado
goto :modo_dev

:kill_api_on_port
set "KILLED=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%API_PORT% " ^| findstr "LISTENING"') do (
    if not "%%p"=="0" (
        echo [RESTART] Encerrando API antiga na porta %API_PORT% PID=%%p
        taskkill /PID %%p /F >nul 2>&1
        if not errorlevel 1 (
            set "KILLED=1"
            echo [RESTART] API antiga encerrada ^(PID=%%p^)
        ) else (
            echo [AVISO] Nao foi possivel encerrar PID=%%p — execute como administrador se necessario.
        )
    )
)
if "%KILLED%"=="0" (
    echo [RESTART] Nenhum processo escutando na porta %API_PORT%.
) else (
    ping -n 2 127.0.0.1 >nul
)
goto :eof

:is_port_listening
set "PORT_CHECK=%~1"
netstat -ano | findstr ":%PORT_CHECK% " | findstr "LISTENING" >nul 2>&1
exit /b %errorlevel%

:check_api_health
curl.exe -s -o NUL -w "%%{http_code}" "http://127.0.0.1:%API_PORT%/health/live" 2>nul | findstr /B "200" >nul
exit /b %errorlevel%

:wait_api_health
set "TRIES=0"
:wait_api_health_loop
call :check_api_health
if not errorlevel 1 exit /b 0
set /a TRIES+=1
if !TRIES! geq 45 (
    echo [ERRO] Timeout aguardando API em http://127.0.0.1:%API_PORT%/health/live ^(45s^)
    exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto wait_api_health_loop

:ensure_api_running
call :check_api_health
if not errorlevel 1 (
    echo [OK] API respondendo: http://127.0.0.1:%API_PORT%/health/live
    goto :ensure_api_running_ok
)

call :is_port_listening %API_PORT%
if not errorlevel 1 (
    echo [AVISO] Porta %API_PORT% ocupada, mas /health/live nao responde.
    echo          Encerre o processo na porta ou use: iniciar-api.bat restart
    exit /b 1
)

echo [1/2] Abrindo API na janela "SAGRA-API" ^(porta %API_PORT%^)...
echo        Mantenha essa janela aberta — e o backend FastAPI/Uvicorn.
start "SAGRA-API" cmd /k call "%ROOT%deploy\bat\_iniciar-api.cmd" %API_PORT%

call :wait_api_health
if errorlevel 1 (
    echo [ERRO] A API nao iniciou. Verifique erros na janela "SAGRA-API".
    exit /b 1
)
echo [OK] API pronta: http://127.0.0.1:%API_PORT%/health/live

:ensure_api_running_ok
exit /b 0

:modo_dev
echo  Modo DEV — duas janelas: "SAGRA-API" ^(backend^) + esta ^(Vite^)
echo  Front: http://127.0.0.1:%WEB_PORT%/
echo  API:   http://127.0.0.1:%API_PORT%/health/live
echo.

if "%RESTART%"=="1" (
    call :kill_api_on_port
)

call :ensure_api_running
if errorlevel 1 (
    pause
    exit /b 1
)

if "%API_ONLY%"=="1" (
    echo [OK] API reiniciada. Front nao iniciado ^(api-only^).
    echo Verifique log: [SUPPORT WS FIX VERSION] no terminal SAGRA-API
    pause
    exit /b 0
)

call :is_port_listening %WEB_PORT%
if not errorlevel 1 (
    echo [AVISO] Porta %WEB_PORT% ja em uso — Vite pode ja estar rodando.
    echo [OK] API:  http://127.0.0.1:%API_PORT%/health/live
    echo       Front: http://127.0.0.1:%WEB_PORT%/
    pause
    exit /b 0
)

echo [2/2] Iniciando Vite na porta %WEB_PORT% ^(esta janela^)...
echo        A API continua na janela "SAGRA-API" — nao feche ambas.
echo        Verifique console: [SUPPORT FRONT VERSION]
echo.
call "%ROOT%deploy\bat\_iniciar-web.cmd" %WEB_PORT%
exit /b %ERRORLEVEL%

:modo_unificado
echo  Modo UNIFICADO — build SPA + Uvicorn ^(1 porta^)
echo  URL: http://127.0.0.1:%API_PORT%/sagra/
echo.

set "SAGRA_SPA_ACCESS_CONTROL=true"

if "%RESTART%"=="1" call :kill_api_on_port

netstat -ano | findstr ":%API_PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 echo [AVISO] Porta %API_PORT% ja em uso.

echo [1/2] Build SPA (VITE_BASE_PATH=/sagra/) ...
call "%ROOT%deploy\bat\_build-spa.cmd"
if errorlevel 1 (
    echo [ERRO] Falha no build do frontend.
    pause
    exit /b 1
)

echo.
echo [2/2] Uvicorn — http://127.0.0.1:%API_PORT%/sagra/
echo        Ctrl+C para encerrar.
echo.

set "PYTHONPATH=%BACKEND%;%ROOT%app\services"
cd /d "%BACKEND%"
if errorlevel 1 (
    echo [ERRO] Backend nao encontrado: %BACKEND%
    pause
    exit /b 1
)

if not defined SAGRA_PYTHON set "SAGRA_PYTHON=python"
"%SAGRA_PYTHON%" -c "from config_manager import config_manager; config_manager.write_client_config_js(); print('config_client.js OK')" 2>nul
"%SAGRA_PYTHON%" -m uvicorn routers.api:app --host 127.0.0.1 --port %API_PORT% --reload

pause
exit /b 0

@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem Raiz do pacote (mesma pasta deste .bat)
rem pushd: permite executar via UNC (\\cgrafsysvm\...) — CMD nao aceita cd /d em UNC
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
pushd "%ROOT%" 2>nul
if errorlevel 1 (
    echo [ERRO] Nao foi possivel acessar a pasta: %ROOT%
    pause
    exit /b 1
)
set "ROOT=%CD%"

sc.exe query SAGRA-Api >nul 2>&1
if not errorlevel 1 (
    echo [ERRO] Servico SAGRA-Api instalado: use "sc start SAGRA-Api" / Restart-Service SAGRA-Api.
    echo        Um processo solto rodaria com a sua conta e pode nao gravar nos MDBs do DFS.
    popd
    pause
    exit /b 1
)
if exist "%ROOT%\current\app\backend" (
    echo [ERRO] Layout versionado: inicie a API por "%ROOT%\current\iniciar-api.bat", nao pela raiz.
    popd
    pause
    exit /b 1
)

set "BACKEND=%ROOT%\app\backend"
set "ENV_FILE=%ROOT%\config\.env"
set "PYTHONPATH=%BACKEND%;%ROOT%\app\services"
if exist "%ROOT%\python_pkgs" (
    set "PYTHONPATH=%ROOT%\python_pkgs;%PYTHONPATH%"
)
if exist "%BACKEND%\vendor_gdrive" (
    set "PYTHONPATH=%BACKEND%\vendor_gdrive;%PYTHONPATH%"
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
    if defined PORT set "SAGRA_SERVER_PORT=!PORT!"
    if defined ENV set "SAGRA_ENV=!ENV!"
)

if not defined ENV set "ENV=production"
if not defined PORT set "PORT=8050"

cd /d "%BACKEND%"
if errorlevel 1 (
    echo [ERRO] Backend nao encontrado: %BACKEND%
    popd
    pause
    exit /b 1
)

for /f "delims=" %%H in ('python -c "from config_manager import config_manager; print(config_manager.get_server_config()[\"host\"])" 2^>nul') do set "API_HOST=%%H"
if not defined API_HOST set "API_HOST=10.1.1.73"

echo.
echo  SAGRA Web - PRODUCAO (servidor %API_HOST%)
echo  API (local): http://127.0.0.1:%PORT%/
echo  Health: http://127.0.0.1:%PORT%/health
echo  Intranet Nginx: http://%API_HOST%/  (API: /sagra/api/)
echo.

python -c "from config_manager import config_manager; config_manager.write_client_config_js(); print('config_client.js OK')" 2>nul

rem Libera a porta %PORT% (PowerShell — evita loop infinito do WMIC/netstat)
set "FREE_PORT_PS=%ROOT%\liberar-porta-api.ps1"
if not exist "%FREE_PORT_PS%" set "FREE_PORT_PS=%~dp0liberar-porta-api.ps1"
if exist "%FREE_PORT_PS%" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%FREE_PORT_PS%" -Port %PORT%
    set "FREE_RC=!ERRORLEVEL!"
) else (
    set "FREE_RC=1"
    echo [AVISO] liberar-porta-api.ps1 nao encontrado; tentando netstat...
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PORT% " ^| findstr /I "LISTENING OUVINDO"') do (
        echo %%p| findstr /R "^[0-9][0-9]*$" >nul && if not "%%p"=="0" (
            echo Encerrando PID %%p na porta %PORT%...
            taskkill /F /PID %%p /T >nul 2>&1
        )
    )
    ping -n 3 127.0.0.1 >nul
    netstat -ano | findstr /R /C:":%PORT% " | findstr /I "LISTENING OUVINDO" >nul 2>&1
    if errorlevel 1 (set "FREE_RC=0") else (set "FREE_RC=2")
)

rem Exit 2 = processo de servico/outra conta — tenta parar-api.bat com elevacao
if "!FREE_RC!"=="2" (
    echo.
    echo Processo na porta %PORT% exige Administrador. Abrindo parar-api.bat...
    call "%ROOT%\parar-api.bat"
    if errorlevel 1 (
        popd
        pause
        exit /b 1
    )
    powershell -NoProfile -ExecutionPolicy Bypass -File "%FREE_PORT_PS%" -Port %PORT% -TimeoutSec 5
    set "FREE_RC=!ERRORLEVEL!"
)

if not "!FREE_RC!"=="0" (
    echo.
    echo [ERRO] Nao foi possivel liberar a porta %PORT%.
    echo Execute manualmente: parar-api.bat
    popd
    pause
    exit /b 1
)

rem Permissoes em logs\ (evita PermissionError em sagra_api.log)
set "PREP_LOGS_PS=%ROOT%\preparar-logs.ps1"
if exist "%PREP_LOGS_PS%" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PREP_LOGS_PS%" -Root "%ROOT%" -Quiet
)

rem Sync de andamentos NAO inicia com a API.
rem Inicie manualmente: _iniciar-sync-andamentos.cmd  (ou nssm start SAGRA-SyncAndamentos)
rem
rem NÃO adicione --workers ao uvicorn: WS, jobs in-memory e cache Manipular Imagem
rem não cruzam processos. Jobs pesados opcionais: iniciar-heavy-jobs.bat
rem + SAGRA_INPROCESS_HEAVY_JOBS=0 neste .env da API.

rem Escuta em 127.0.0.1: o Nginx repassa o IP real via X-Forwarded-For
python -m uvicorn routers.api:app --host 127.0.0.1 --port %PORT% --proxy-headers --forwarded-allow-ips=127.0.0.1,10.1.1.73

popd
pause
endlocal

@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================================
REM SAGRA Web — Encerra processos nas portas da API e do Vite
REM ============================================================================

set "ROOT=%~dp0"
set "ENV_FILE=%ROOT%config\.env"
set "API_PORT=8001"
set "WEB_PORT=5173"

if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
        set "line=%%a"
        if /I "!line!"=="PORT" if not "%%b"=="" set "API_PORT=%%b"
    )
)

echo.
echo  SAGRA Web — Finalizar servidores
echo  Portas: API=%API_PORT%  SPA=%WEB_PORT%
echo.

REM --- Metodo 1: PowerShell (mais confiavel no Windows 10/11) ---
where powershell >nul 2>&1
if not errorlevel 1 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%deploy\bat\_kill-ports.ps1" %API_PORT% %WEB_PORT%
    goto :verify
)

echo [AVISO] PowerShell nao encontrado. Usando netstat...
goto :netstat_kill

:verify
REM Segunda passagem caso o processo pai libere a porta com atraso
timeout /t 1 /nobreak >nul
set "STILL_BUSY=0"
call :port_in_use %API_PORT%
if not errorlevel 1 set "STILL_BUSY=1"
call :port_in_use %WEB_PORT%
if not errorlevel 1 set "STILL_BUSY=1"
if "!STILL_BUSY!"=="1" (
    echo.
    echo Alguma porta ainda ocupada — segunda tentativa...
    call :netstat_kill
)
goto :done

:netstat_kill
set "KILLED=0"
call :kill_port_netstat %API_PORT% "API"
call :kill_port_netstat %WEB_PORT% "SPA"
if "!KILLED!"=="0" (
    echo Nenhum processo em escuta nas portas %API_PORT% e %WEB_PORT%.
) else (
    echo.
    echo Processos finalizados via netstat.
)
goto :done

:done
REM Fecha janelas cmd iniciadas pelo iniciar-servidor.bat
taskkill /FI "WINDOWTITLE eq SAGRA-API*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SAGRA-WEB*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SAGRA API :*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq SAGRA Web :*" /F >nul 2>&1

echo.
pause
endlocal
exit /b 0

REM --- Verifica se a porta ainda tem listener ---
:port_in_use
set "CHK_PORT=%~1"
netstat -ano | findstr /R /C":%CHK_PORT% " | findstr /I "LISTENING OUVINDO" >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

REM --- Fallback: netstat + taskkill (PT/EN, IPv4 e IPv6) ---
:kill_port_netstat
set "PORT=%~1"
set "LABEL=%~2"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C":%PORT% " ^| findstr /I "LISTENING OUVINDO"') do (
    call :taskkill_pid %%p "%LABEL%" %PORT%
)
exit /b 0

:taskkill_pid
set "PID=%~1"
set "LABEL=%~2"
set "PORT=%~3"
if not defined PID exit /b 0
if "!PID!"=="0" exit /b 0
echo !PID!| findstr /r "^[0-9][0-9]*$" >nul 2>&1
if errorlevel 1 exit /b 0
if defined KILLED_!PID! exit /b 0
set "KILLED_!PID!=1"
echo Encerrando %LABEL% - PID !PID! ^(porta %PORT%^)
taskkill /F /PID !PID! /T >nul 2>&1
if errorlevel 1 (
    echo   [AVISO] taskkill falhou para PID !PID!, tentando novamente...
    taskkill /F /PID !PID! /T
)
set "KILLED=1"
exit /b 0

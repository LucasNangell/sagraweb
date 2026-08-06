@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem Para a API SAGRA (porta 8050). Eleva para Administrador se necessario.
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
pushd "%ROOT%" 2>nul
if errorlevel 1 (
    echo [ERRO] Nao foi possivel acessar a pasta: %ROOT%
    pause
    exit /b 1
)
set "ROOT=%CD%"
set "PS1=%ROOT%\parar-api.ps1"
set "PORT=8050"

if exist "%ROOT%\config\.env" (
    for /f "usebackq tokens=1,* delims==" %%a in (`findstr /R /B /C:"PORT=" "%ROOT%\config\.env" 2^>nul`) do set "PORT=%%b"
)

if not exist "%PS1%" (
    echo [ERRO] parar-api.ps1 nao encontrado em %ROOT%
    popd
    pause
    exit /b 1
)

net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo Solicitando permissoes de Administrador para encerrar a API na porta %PORT%...
    echo ^(UAC: clique Sim^)
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath '%~f0' -ArgumentList '/elevated' -Verb RunAs -PassThru -Wait; exit $p.ExitCode"
    popd
    exit /b %ERRORLEVEL%
)

if /I "%~1"=="/elevated" shift
if /I "%~1"=="/quiet" (
    set "QUIET=1"
    shift
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Port %PORT% %*
set "RC=%ERRORLEVEL%"

popd
if not "%RC%"=="0" if not defined QUIET pause
exit /b %RC%

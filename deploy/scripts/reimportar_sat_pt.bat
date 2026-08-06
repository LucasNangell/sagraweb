@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================================
REM SAGRA Web — Reimportacao SAT (tabRegistroPT -> tabAnaliseItens)
REM Idempotente: insere apenas Codigos SAT ainda nao presentes em
REM tabMigracaoSatRegistroPT.
REM
REM Uso:
REM   reimportar_sat_pt.bat           (grava no MySQL)
REM   reimportar_sat_pt.bat --dry-run (apenas simulacao)
REM ============================================================================

set "ROOT=%~dp0..\.."
set "SCRIPT=%ROOT%\deploy\scripts\migrate_sat_registro_pt.py"
set "LOG=%ROOT%\deploy\scripts\migrate_sat_registro_pt_last.log"
set "MODE=--apply"

if /i "%~1"=="--dry-run" set "MODE=--dry-run"
if /i "%~1"=="/dry-run" set "MODE=--dry-run"

cd /d "%ROOT%"
if errorlevel 1 (
    echo [ERRO] Nao foi possivel acessar a raiz do projeto: %ROOT%
    pause
    exit /b 1
)

echo.
echo  SAGRA Web - Reimportacao de problemas tecnicos (SAT)
echo  Projeto: %ROOT%
echo  Modo:    %MODE%
echo  Log:     %LOG%
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado no PATH.
    pause
    exit /b 1
)

if not exist "%SCRIPT%" (
    echo [ERRO] Script nao encontrado: %SCRIPT%
    pause
    exit /b 1
)

echo [%date% %time%] Inicio reimportacao SAT (%MODE%)>> "%LOG%"
echo.>> "%LOG%"

python "%SCRIPT%" %MODE% 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath '%LOG%' -Append"
set "EXITCODE=%ERRORLEVEL%"

echo.>> "%LOG%"
echo [%date% %time%] Fim (codigo %EXITCODE%)>> "%LOG%"

echo.
if %EXITCODE% equ 0 (
    echo Concluido. Detalhes em:
    echo   %LOG%
) else (
    echo [ERRO] Migracao encerrada com codigo %EXITCODE%.
    echo Consulte o log: %LOG%
)

if not defined NOPAUSE pause
exit /b %EXITCODE%

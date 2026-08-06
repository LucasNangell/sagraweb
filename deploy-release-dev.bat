@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem Deploy por release — etapa DEV (build + copia para releases\)
rem Uso:
rem   deploy-release-dev.bat
rem   deploy-release-dev.bat -SkipBuild
rem   deploy-release-dev.bat -ReleaseName 20260612_153000

cd /d "%~dp0"

call "%~dp0deploy\bat\_resolve-dev-tools.cmd"

where pnpm >nul 2>&1
if errorlevel 1 (
    if not exist "%SAGRA_PNPM%" (
        echo [ERRO] pnpm nao encontrado. Instale Node.js + pnpm.
        pause
        exit /b 1
    )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\scripts\deploy-release-dev.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%

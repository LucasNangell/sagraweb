@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem Atalho na raiz do servidor — deploy PROD (ativar release + reiniciar API)
rem Uso: deploy-release-prod.bat -ReleaseName 20260611_201054 -ConfirmProductionSwitch

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\scripts\deploy-release-prod.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%

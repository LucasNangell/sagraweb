@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem Deploy por release — etapa PROD (ativar + reiniciar API)
rem Executar NO SERVIDOR: C:\Sistemas CGraf\Sagra Web\deploy\scripts\
rem Uso:
rem   deploy-release-prod.bat -ReleaseName 20260612_153000 -ConfirmProductionSwitch

cd /d "%~dp0\..\.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-release-prod.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%

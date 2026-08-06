@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem Publicar release no servidor (script unico PROD)
rem Uso:
rem   publicar-release.bat -ReleaseName 20260611_201054 -ConfirmProductionSwitch

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\scripts\publicar-release-prod.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%

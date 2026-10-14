@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem Publica, a partir do DEV, a release mais recente de releases\ no servidor de producao.
rem Requer WinRM no servidor e conta com privilegio administrativo nele.
rem Na primeira execucao pede a senha e guarda cifrada no perfil do usuario.
rem Uso:
rem   publicar-ultimo-release-remoto.bat
rem   publicar-ultimo-release-remoto.bat -ReleaseName 20260925_122557
rem   publicar-ultimo-release-remoto.bat -Force            (republica mesmo se ja ativa)
rem   publicar-ultimo-release-remoto.bat -ResetCredential  (pede a senha novamente)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\scripts\publicar-ultimo-release-remoto.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo.
    echo [ERRO] A publicacao remota falhou. Codigo: %RC%
    pause
)
exit /b %RC%

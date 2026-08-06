@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================================
rem SAGRA Web — DESENVOLVIMENTO
rem
rem Este batch e o ponto de entrada DEV na raiz do projeto (C:\dev\SagraWeb).
rem NAO use deploy\release\iniciar-api.bat nem o template de producao — eles
rem assumem pacote de release (porta 8050, proxy-headers, sem --reload).
rem
rem Uso (mesmos argumentos de iniciar-servidor.bat):
rem   iniciar-api.bat              -> API :8001 (janela SAGRA-API) + Vite :5173 (esta janela)
rem   iniciar-api.bat restart      -> reinicia API + Vite
rem   iniciar-api.bat api-only     -> somente API (janela SAGRA-API)
rem   iniciar-api.bat unificado    -> build SPA + Uvicorn :8001 (tudo numa janela)
rem
rem IMPORTANTE: no modo dev padrao abrem DUAS janelas — backend e frontend.
rem Esta janela mostra o Vite; a API fica na janela titulo "SAGRA-API".
rem ============================================================================

set "ROOT=%~dp0"
set "LAUNCHER=%ROOT%iniciar-servidor.bat"

if not exist "%LAUNCHER%" (
    echo [ERRO] Launcher DEV nao encontrado: %LAUNCHER%
    pause
    exit /b 1
)

call "%LAUNCHER%" %*
exit /b %ERRORLEVEL%

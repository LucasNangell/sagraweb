@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "ROOT=%~dp0..\.."
set "WEB=%ROOT%\apps\web"
set "DEST=%ROOT%\app\frontend"

call "%~dp0_resolve-dev-tools.cmd"

where pnpm >nul 2>&1
if errorlevel 1 (
    if not exist "%SAGRA_PNPM%" (
        echo [ERRO] pnpm nao encontrado.
        exit /b 1
    )
)

echo [SPA] Build VITE_BASE_PATH=/sagra/
cd /d "%WEB%"
set "VITE_BASE_PATH=/sagra/"
if not defined SAGRA_PNPM set "SAGRA_PNPM=pnpm.cmd"
call "%SAGRA_PNPM%" build
if errorlevel 1 exit /b 1

if not exist "%DEST%" mkdir "%DEST%"
echo [SPA] Copiando dist -^> app\frontend
xcopy /E /Y /I "%WEB%\dist\*" "%DEST%\" >nul
if errorlevel 1 (
    echo [ERRO] Falha ao copiar para %DEST%
    exit /b 1
)

set "REQ_TPL=%ROOT%\app\backend\templates\requisicao.html"
if exist "%REQ_TPL%" (
    copy /Y "%REQ_TPL%" "%DEST%\requisicao.html" >nul
)

echo [SPA] OK — frontend em %DEST%
endlocal
exit /b 0

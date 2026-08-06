@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================================
REM SAGRA Web — Túnel zrok no PC LOCAL (proxy para http://cgrafsysvm)
REM
REM URL FIXA (zrok v2 — nome reservado no namespace public):
REM   1) Uma vez: este script chama "zrok create name" (abaixo).
REM   2) Sempre: "zrok share public ... -n public:NOME" reutiliza o mesmo host.
REM
REM   https://sagra-painel.shares.zrok.io/painel/setor
REM   https://sagra-painel.shares.zrok.io/painel/global
REM
REM Alvo zrok: http://cgrafsysvm  (SEM /sagra/ no final)
REM Doc: https://netfoundry.io/docs/zrok/concepts/namespaces
REM ============================================================================

set "ZROK_EXE=c:\zrok\zrok.exe"
if not exist "%ZROK_EXE%" set "ZROK_EXE=c:\zrok\zrok2.exe"

if not exist "%ZROK_EXE%" (
    echo [ERRO] zrok nao encontrado em c:\zrok\zrok.exe
    pause
    exit /b 1
)

set "SAGRA_TARGET=http://cgrafsysvm"
REM Hostname fixo em *.shares.zrok.io — altere aqui se quiser outro nome
set "ZROK_SHARE_NAME=sagra-painel"

echo.
echo  Testando http://cgrafsysvm/sagra/ ...
curl -s -o nul -w "HTTP %%{http_code}\n" "%SAGRA_TARGET%/sagra/" 2>nul
if errorlevel 1 (
    echo [AVISO] Sem resposta — confira VPN/rede.
)

echo.
echo  Reservando nome fixo (ignora erro se ja existir)...
"%ZROK_EXE%" create name "%ZROK_SHARE_NAME%" 2>nul
if errorlevel 1 (
    echo [INFO] Nome "%ZROK_SHARE_NAME%" provavelmente ja existe — continuando.
)

echo.
echo  URL publica fixa:
echo    https://%ZROK_SHARE_NAME%.shares.zrok.io/painel/setor
echo    https://%ZROK_SHARE_NAME%.shares.zrok.io/painel/global
echo.
echo  Iniciando share (Ctrl+C para encerrar; o nome permanece para a proxima execucao)...
echo.

cd /d "c:\zrok"
"%ZROK_EXE%" share public "%SAGRA_TARGET%" --name-selection "public:%ZROK_SHARE_NAME%" --headless

pause
endlocal

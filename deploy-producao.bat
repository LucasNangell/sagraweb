@echo off

chcp 65001 >nul

setlocal EnableExtensions



rem Deploy SAGRA Web -> \\cgrafsysvm\Sistemas CGraf\Sagra Web

rem Uso:

rem   deploy-producao.bat              build + copia completa

rem   deploy-producao.bat -SkipBuild   so copia deploy\release existente

rem   deploy-producao.bat -DryRun      simula sem copiar

rem   deploy-producao.bat -ForceConfig sobrescreve config.json no servidor



cd /d "%~dp0"



where pnpm >nul 2>&1

if errorlevel 1 (

    echo [ERRO] pnpm nao encontrado. Instale Node.js + pnpm e rode: pnpm install

    pause

    exit /b 1

)



where robocopy >nul 2>&1

if errorlevel 1 (

    echo [ERRO] robocopy nao encontrado ^(Windows^).

    pause

    exit /b 1

)



echo.

echo  ========================================

echo   SAGRA Web - DEPLOY PRODUCAO

echo   Destino: \\cgrafsysvm\Sistemas CGraf\Sagra Web

echo  ========================================

echo.



powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\scripts\deploy-producao.ps1" %*

set "RC=%ERRORLEVEL%"



if not "%RC%"=="0" (

    echo.

    echo [ERRO] Deploy falhou ^(codigo %RC%^).

    pause

    exit /b %RC%

)



echo.

echo Deploy concluido. Reinicie a API no servidor com iniciar-api.bat

echo.

pause

exit /b 0


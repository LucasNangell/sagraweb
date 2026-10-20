@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem Prepara release versionada (testes + build + copia para releases\{nome}).
rem NAO ativa producao. Depois, no servidor:
rem   publicar-release.bat -ReleaseName NOME -ConfirmProductionSwitch
rem
rem Uso:
rem   deploy-producao.bat
rem   deploy-producao.bat -SkipBuild
rem   deploy-producao.bat -SkipTests
rem   deploy-producao.bat -DryRun
rem   deploy-producao.bat -ReleaseName 20261020_153832

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

where robocopy >nul 2>&1
if errorlevel 1 (
    echo [ERRO] robocopy nao encontrado ^(Windows^).
    pause
    exit /b 1
)

echo.
echo  ========================================
echo   SAGRA Web - PREPARAR RELEASE
echo   Destino: \\cgrafsysvm\Sistemas CGraf\Sagra Web\releases\{nome}
echo   current\ NAO e alterado
echo  ========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\scripts\deploy-producao.ps1" %*
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo [ERRO] Preparacao da release falhou ^(codigo %RC%^).
    pause
    exit /b %RC%
)

echo.
echo Release preparada. Nao foi ativada.
echo No servidor: publicar-release.bat -ReleaseName NOME -ConfirmProductionSwitch
echo.
pause
exit /b 0

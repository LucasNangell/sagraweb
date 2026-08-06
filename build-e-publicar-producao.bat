@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================================
REM SAGRA Web - Build + publicacao em producao
REM Uso:
REM   build-e-publicar-producao.bat
REM   build-e-publicar-producao.bat "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
REM   build-e-publicar-producao.bat --dry-run
REM ============================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "SOURCE_RELEASE=%ROOT%\deploy\release"
set "DEST=\\cgrafsysvm\Sistemas CGraf\Sagra Web"
set "DRY_RUN=0"

if /I "%~1"=="--help" goto :help
if /I "%~1"=="-h" goto :help
if /I "%~1"=="/?" goto :help

if not "%~1"=="" (
    if /I "%~1"=="--dry-run" (
        set "DRY_RUN=1"
    ) else (
        set "DEST=%~1"
    )
)

if /I "%~2"=="--dry-run" set "DRY_RUN=1"

echo.
echo  SAGRA Web - Build + publicacao
echo  Projeto: %ROOT%
echo  Destino: %DEST%
if "%DRY_RUN%"=="1" echo  Modo: DRY-RUN ^(sem copiar para o servidor^)
echo.

where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERRO] pnpm nao encontrado no PATH.
    pause
    exit /b 1
)

pushd "%ROOT%"
if errorlevel 1 (
    echo [ERRO] Nao foi possivel acessar a pasta do projeto.
    pause
    exit /b 1
)

echo [1/3] Gerando pacote de release...
call pnpm package:release
if errorlevel 1 (
    echo [ERRO] Falha no build/package.
    popd
    pause
    exit /b 1
)

if "%DRY_RUN%"=="1" (
    echo [2/3] DRY-RUN: copia para producao ignorada.
    echo [3/3] Concluido em modo de validacao.
    popd
    echo.
    pause
    exit /b 0
)

if not exist "%DEST%" (
    echo [ERRO] Destino nao encontrado: %DEST%
    popd
    pause
    exit /b 1
)

echo [2/3] Copiando arquivos para producao...
robocopy "%SOURCE_RELEASE%" "%DEST%" /E /R:2 /W:2 /NJH /NJS /NP /NFL /NDL
set "ROBO_EXIT=%ERRORLEVEL%"
if %ROBO_EXIT% GEQ 8 (
    echo [ERRO] Robocopy falhou com codigo %ROBO_EXIT%.
    popd
    pause
    exit /b %ROBO_EXIT%
)

echo [3/3] Publicacao concluida com sucesso.
echo        Robocopy exit code: %ROBO_EXIT%
popd
echo.
pause
exit /b 0

:help
echo.
echo Uso:
echo   %~n0
echo   %~n0 "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
echo   %~n0 --dry-run
echo.
echo Opcional:
echo   - primeiro argumento: destino UNC
echo   - --dry-run: faz build e empacotamento sem copiar
echo.
exit /b 0

@echo off
REM ========================================
REM Build Script - SAGRA Folder Opener
REM ========================================

echo.
echo ========================================
echo   SAGRA Folder Opener - Build Script
echo ========================================
echo.

REM Verificar se Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado!
    echo Por favor, instale Python 3.8 ou superior.
    pause
    exit /b 1
)

echo [1/4] Python detectado
python --version

REM Instalar dependências
echo.
echo [2/4] Instalando dependencias...
python -m pip install -r requirements.txt

if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias
    pause
    exit /b 1
)

REM Criar executável
echo.
echo [3/4] Criando executavel...
echo Aguarde, isso pode levar alguns minutos...

python -m PyInstaller --onefile ^
            --noconsole ^
            --name "SAGRA-FolderOpener" ^
            folder_opener_service.py

if errorlevel 1 (
    echo [ERRO] Falha ao criar executavel
    pause
    exit /b 1
)

REM Mover executável para pasta dist
echo.
echo [4/4] Finalizando...

if exist "dist\SAGRA-FolderOpener.exe" (
    echo.
    echo ========================================
    echo   BUILD CONCLUIDO COM SUCESSO!
    echo ========================================
    echo.
    echo O executavel foi criado em:
    echo   dist\SAGRA-FolderOpener.exe
    echo.
    echo Para testar:
    echo   1. Execute o arquivo .exe
    echo   2. Acesse o SAGRA e clique em "Abrir Pasta"
    echo.
    echo Para instalar no startup do Windows:
    echo   1. Copie o .exe para:
    echo      C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup
    echo.
) else (
    echo [ERRO] Executavel nao encontrado!
)

pause

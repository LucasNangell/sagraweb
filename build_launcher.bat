@echo off
echo ========================================
echo  BUILD SAGRA LAUNCHER (One-Directory)
echo ========================================
echo.

REM Ativar ambiente virtual
call .venv\Scripts\activate.bat

REM Verificar se PyInstaller está instalado
python -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo [INSTALANDO] PyInstaller...
    pip install pyinstaller
)

echo.
echo [BUILD] Gerando executavel one-directory (mais rapido)...
echo.

REM Limpar builds anteriores
if exist "dist\SAGRA_Launcher" rmdir /s /q "dist\SAGRA_Launcher"
if exist "build" rmdir /s /q build

REM Criar executável one-directory
pyinstaller ^
    --onedir ^
    --windowed ^
    --name "SAGRA_Launcher" ^
    --icon=NONE ^
    --hidden-import customtkinter ^
    --hidden-import requests ^
    --hidden-import subprocess ^
    --hidden-import threading ^
    --hidden-import queue ^
    --hidden-import datetime ^
    --collect-all customtkinter ^
    --noconsole ^
    launcher_gui.pyw

echo.
if exist "dist\SAGRA_Launcher\SAGRA_Launcher.exe" (
    echo ========================================
    echo  BUILD CONCLUIDO COM SUCESSO!
    echo ========================================
    echo.
    echo Executavel criado em: dist\SAGRA_Launcher\
    echo Arquivo principal: SAGRA_Launcher.exe
    echo.
    dir "dist\SAGRA_Launcher" | find "SAGRA_Launcher.exe"
    echo.
    echo Execute: dist\SAGRA_Launcher.exe
    echo.
) else (
    echo ========================================
    echo  ERRO NO BUILD
    echo ========================================
    echo.
    echo Verifique os erros acima.
    echo.
)

pause

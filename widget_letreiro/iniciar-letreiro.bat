@echo off
setlocal
cd /d "%~dp0"

if exist "SAGRA-Letreiro.exe" (
  start "" "SAGRA-Letreiro.exe"
  exit /b 0
)
if exist "dist\SAGRA-Letreiro.exe" (
  start "" "dist\SAGRA-Letreiro.exe"
  exit /b 0
)

where python >nul 2>&1
if errorlevel 1 (
  echo Python nao encontrado e o executavel SAGRA-Letreiro.exe ainda nao foi gerado.
  echo Rode build_exe.ps1 nesta pasta.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Criando ambiente virtual...
  python -m venv .venv
  if errorlevel 1 (
    echo Falha ao criar .venv
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

if not exist "config.yaml" (
  copy /Y "config.example.yaml" "config.yaml" >nul
)

".venv\Scripts\python.exe" letreiro.py
if errorlevel 1 (
  echo.
  echo O letreiro encerrou com erro.
  pause
)
endlocal

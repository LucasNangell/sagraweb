@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo Python nao encontrado no PATH.
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
  echo config.yaml criado a partir do exemplo. Ajuste ponto/API se necessario.
)

".venv\Scripts\python.exe" letreiro.py
if errorlevel 1 (
  echo.
  echo O letreiro encerrou com erro.
  pause
)
endlocal

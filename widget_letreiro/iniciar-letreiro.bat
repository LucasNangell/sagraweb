@echo off
setlocal
cd /d "%~dp0"

set "INSTALLED=%LOCALAPPDATA%\Programs\SAGRA Letreiro\SAGRA-Letreiro.exe"
if exist "%INSTALLED%" (
  start "" "%INSTALLED%"
  exit /b 0
)
if exist "artifacts\publish\SAGRA-Letreiro.exe" (
  start "" "artifacts\publish\SAGRA-Letreiro.exe"
  exit /b 0
)

where dotnet >nul 2>&1
if errorlevel 1 (
  echo .NET SDK nao encontrado e o SAGRA Letreiro ainda nao esta instalado.
  echo Rode installer\build.ps1 ou instale o setup da pasta G:.
  pause
  exit /b 1
)

dotnet run --project "%~dp0src\SagraLetreiro\SagraLetreiro.csproj" -c Release
if errorlevel 1 (
  echo.
  echo O letreiro encerrou com erro.
  pause
)
endlocal

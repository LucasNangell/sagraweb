@echo off
setlocal

REM Compila para .NET Framework 2.0 (compativel com Windows XP)
set CSC=%WINDIR%\Microsoft.NET\Framework\v2.0.50727\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v3.5\csc.exe
if not exist "%CSC%" (
  echo Compilador csc.exe do .NET 2.0/3.5 nao encontrado.
  exit /b 1
)

"%CSC%" /nologo /target:winexe /optimize+ /out:FileMoverXP.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll Main.cs
if errorlevel 1 (
  echo Falha na compilacao.
  exit /b 1
)

echo.
echo OK: FileMoverXP.exe gerado.
echo Requisito no XP: .NET Framework 2.0 ou 3.5 instalado.
echo.
endlocal

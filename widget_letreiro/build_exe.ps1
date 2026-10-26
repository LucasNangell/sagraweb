# Obsoleto: o produto é o instalador WPF (installer\build.ps1).
# Compila SAGRA-Letreiro.exe (onefile portátil) com PyInstaller.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Encerrando letreiro em execucao (se houver)..."
Stop-Process -Name "SAGRA-Letreiro" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = "python"
}

Write-Host "==> Limpando artefatos anteriores..."
if (Test-Path "build") { Remove-Item "build" -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host "==> Instalando dependencias de build..."
& $python -m pip install -r requirements.txt -r requirements-build.txt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Executando testes..."
& $python -m pytest tests/ -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Compilando executavel onefile..."
& $python -m PyInstaller letreiro.spec --noconfirm --clean
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $PSScriptRoot "dist\SAGRA-Letreiro.exe"
if (-not (Test-Path $exe)) {
    Write-Error "Executavel nao gerado: $exe"
}

Copy-Item $exe (Join-Path $PSScriptRoot "SAGRA-Letreiro.exe") -Force

Write-Host ""
Write-Host "Build concluido:"
Write-Host "  $exe"
Write-Host "  $(Join-Path $PSScriptRoot 'SAGRA-Letreiro.exe')"
Write-Host ""
Write-Host "Portatil: copie so o .exe. Na primeira execucao cria config.yaml ao lado."

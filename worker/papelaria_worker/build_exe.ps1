# Compila SAGRA-Papelaria-Worker.exe (onefile) com PyInstaller.
# Requisitos: Python 3.10+, pip install -r requirements.txt -r requirements-build.txt
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Encerrando worker em execucao (se houver)..."
Stop-Process -Name "SAGRA-Papelaria-Worker" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "==> Limpando artefatos anteriores..."
if (Test-Path "build") { Remove-Item "build" -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force -ErrorAction SilentlyContinue }
$pyiCache = Join-Path $env:LOCALAPPDATA "pyinstaller"
if (Test-Path $pyiCache) {
    Write-Host "==> Limpando cache PyInstaller ($pyiCache)..."
    Remove-Item $pyiCache -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "==> Instalando dependencias de build..."
python -m pip install -r requirements.txt -r requirements-build.txt

Write-Host "==> Executando testes..."
python -m pytest tests/ -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Compilando executavel onefile..."
python -m PyInstaller papelaria_worker.spec --noconfirm --clean
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $PSScriptRoot "dist\SAGRA-Papelaria-Worker.exe"
if (-not (Test-Path $exe)) {
    Write-Error "Executavel nao gerado: $exe"
}

Write-Host "==> Teste pos-build (--test-connection)..."
$p = Start-Process -FilePath $exe -ArgumentList "--test-connection" -PassThru -Wait
if ($p.ExitCode -ne 0) {
    Write-Error "Executavel falhou no teste pos-build (exit $($p.ExitCode))"
}

Write-Host ""
Write-Host "Build concluido e validado:"
Write-Host "  $exe"
Write-Host ""
Write-Host "Config embutida a partir de config.yaml. Para alterar, edite config.yaml e recompile."
Write-Host "Deploy: copie apenas SAGRA-Papelaria-Worker.exe para cada maquina com CorelDRAW."
Write-Host "Extracao onefile: pasta TEMP do usuario (%TEMP%\_MEI*)."

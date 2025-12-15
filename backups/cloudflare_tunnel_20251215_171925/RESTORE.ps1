# ==========================================
# SCRIPT: Restaurar v1.2.0 - Cloudflare Tunnel
# ==========================================

param(
    [switch]$Force
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  RESTORE v1.2.0 - Cloudflare Tunnel" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$backupPath = $PSScriptRoot
$rootPath = (Get-Item $backupPath).Parent.Parent.FullName

Write-Host "Backup Path: $backupPath" -ForegroundColor Gray
Write-Host "Root Path: $rootPath" -ForegroundColor Gray
Write-Host ""

if (-not $Force) {
    Write-Host "ATENCAO: Este script vai SOBRESCREVER os arquivos atuais!" -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "Deseja continuar? (S/N)"
    if ($confirm -ne "S" -and $confirm -ne "s") {
        Write-Host "Operacao cancelada." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "Iniciando restore..." -ForegroundColor Cyan
Write-Host ""

# Parar processos
Write-Host "1. Parando processos..." -ForegroundColor Cyan
try {
    Get-Process python -ErrorAction SilentlyContinue | Where-Object {$_.Path -like '*SagraWeb*'} | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "   Processos parados" -ForegroundColor Green
} catch {
    Write-Host "   Aviso: Alguns processos podem nao estar rodando" -ForegroundColor Yellow
}

Write-Host ""

# Restaurar arquivos
Write-Host "2. Restaurando arquivos..." -ForegroundColor Cyan

$files = @(
    @{Source="analise_routes.py"; Dest="routers\analise_routes.py"},
    @{Source="launcher.py"; Dest="launcher.py"},
    @{Source="configure_public_domain.ps1"; Dest="configure_public_domain.ps1"},
    @{Source="start_cloudflare_prod.ps1"; Dest="start_cloudflare_prod.ps1"},
    @{Source="validate_cloudflare.ps1"; Dest="validate_cloudflare.ps1"}
)

$restored = 0
$failed = 0

foreach ($file in $files) {
    $sourcePath = Join-Path $backupPath $file.Source
    $destPath = Join-Path $rootPath $file.Dest
    
    if (Test-Path $sourcePath) {
        try {
            Copy-Item $sourcePath -Destination $destPath -Force
            Write-Host "   OK: $($file.Dest)" -ForegroundColor Green
            $restored++
        } catch {
            Write-Host "   ERRO: $($file.Dest) - $_" -ForegroundColor Red
            $failed++
        }
    } else {
        Write-Host "   AVISO: $($file.Source) nao encontrado no backup" -ForegroundColor Yellow
    }
}

# Restaurar documentacao
Write-Host ""
Write-Host "3. Restaurando documentacao..." -ForegroundColor Cyan
$docFiles = Get-ChildItem -Path $backupPath -Filter "CLOUDFLARE_*.md" -ErrorAction SilentlyContinue
foreach ($doc in $docFiles) {
    try {
        Copy-Item $doc.FullName -Destination $rootPath -Force
        Write-Host "   OK: $($doc.Name)" -ForegroundColor Green
        $restored++
    } catch {
        Write-Host "   ERRO: $($doc.Name) - $_" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Arquivos restaurados: $restored" -ForegroundColor Green
if ($failed -gt 0) {
    Write-Host "Arquivos com erro: $failed" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "PROXIMO PASSO:" -ForegroundColor Yellow
Write-Host "1. Reiniciar backend: python main.py" -ForegroundColor White
Write-Host "2. Configurar dominio: .\configure_public_domain.ps1" -ForegroundColor White
Write-Host "3. Iniciar tunel: .\start_cloudflare_prod.ps1" -ForegroundColor White
Write-Host "4. Validar: .\validate_cloudflare.ps1" -ForegroundColor White
Write-Host ""

pause

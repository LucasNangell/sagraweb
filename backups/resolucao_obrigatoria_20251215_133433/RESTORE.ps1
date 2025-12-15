# =========================================================
# SCRIPT DE RESTAURAÇÃO - Resolução Obrigatória v1.0.0
# Data do Backup: 15/12/2025 13:34:33
# =========================================================

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  RESTAURAÇÃO DE BACKUP" -ForegroundColor Cyan
Write-Host "  Feature: Resolução Obrigatória" -ForegroundColor Cyan
Write-Host "  Data: 15/12/2025 13:34:33" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Obter diretório do script
$backupDir = $PSScriptRoot
$projectRoot = Split-Path -Parent (Split-Path -Parent $backupDir)

Write-Host "Diretório do projeto: $projectRoot" -ForegroundColor Yellow
Write-Host "Diretório do backup: $backupDir" -ForegroundColor Yellow
Write-Host ""

# Confirmar com usuário
$confirm = Read-Host "Deseja REALMENTE restaurar os arquivos do backup? (S/N)"
if ($confirm -ne "S" -and $confirm -ne "s") {
    Write-Host "Operação cancelada pelo usuário." -ForegroundColor Red
    exit
}

Write-Host ""
Write-Host "Iniciando restauração..." -ForegroundColor Green
Write-Host ""

# Parar servidor (se estiver rodando)
Write-Host "[1/6] Parando servidor Python..." -ForegroundColor Yellow
$pythonProcesses = Get-Process -Name python -ErrorAction SilentlyContinue
if ($pythonProcesses) {
    Stop-Process -Name python -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "  ✓ Servidor parado" -ForegroundColor Green
} else {
    Write-Host "  - Nenhum servidor rodando" -ForegroundColor Gray
}

# Criar backup dos arquivos atuais antes de sobrescrever
Write-Host ""
Write-Host "[2/6] Criando backup de segurança dos arquivos atuais..." -ForegroundColor Yellow
$safetyBackupDir = "$projectRoot\backups\pre_restore_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -ItemType Directory -Force -Path $safetyBackupDir | Out-Null

Copy-Item "$projectRoot\setup_db.py" -Destination "$safetyBackupDir\" -ErrorAction SilentlyContinue
Copy-Item "$projectRoot\routers\analise_routes.py" -Destination "$safetyBackupDir\" -ErrorAction SilentlyContinue
Copy-Item "$projectRoot\analise.js" -Destination "$safetyBackupDir\" -ErrorAction SilentlyContinue
Copy-Item "$projectRoot\client_pt.html" -Destination "$safetyBackupDir\" -ErrorAction SilentlyContinue

Write-Host "  ✓ Backup de segurança criado em: $safetyBackupDir" -ForegroundColor Green

# Restaurar arquivos
Write-Host ""
Write-Host "[3/6] Restaurando arquivos do backup..." -ForegroundColor Yellow

$files = @(
    @{Source="setup_db.py"; Dest="$projectRoot\setup_db.py"},
    @{Source="analise_routes.py"; Dest="$projectRoot\routers\analise_routes.py"},
    @{Source="analise.js"; Dest="$projectRoot\analise.js"},
    @{Source="client_pt.html"; Dest="$projectRoot\client_pt.html"}
)

foreach ($file in $files) {
    $sourcePath = Join-Path $backupDir $file.Source
    $destPath = $file.Dest
    
    if (Test-Path $sourcePath) {
        Copy-Item $sourcePath -Destination $destPath -Force
        Write-Host "  ✓ $($file.Source) restaurado" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $($file.Source) não encontrado no backup" -ForegroundColor Red
    }
}

# Informar sobre o banco de dados
Write-Host ""
Write-Host "[4/6] Banco de dados" -ForegroundColor Yellow
Write-Host "  ! ATENÇÃO: Este script NÃO reverte alterações no banco de dados" -ForegroundColor Red
Write-Host "  ! A coluna 'ResolucaoObrigatoria' permanecerá na tabela 'tabAnaliseItens'" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Para reverter o banco de dados, execute manualmente:" -ForegroundColor Cyan
Write-Host "    ALTER TABLE tabAnaliseItens DROP COLUMN ResolucaoObrigatoria;" -ForegroundColor White
Write-Host "    DELETE FROM tabMigracoes WHERE migration_name = 'ResolucaoObrigatoria';" -ForegroundColor White
Write-Host ""

$rollbackDB = Read-Host "Deseja reverter o banco de dados automaticamente? (S/N)"
if ($rollbackDB -eq "S" -or $rollbackDB -eq "s") {
    Write-Host "  Executando rollback do banco..." -ForegroundColor Yellow
    
    # Executar script Python para rollback
    $rollbackScript = @"
from database import db
try:
    db.execute_query("ALTER TABLE tabAnaliseItens DROP COLUMN IF EXISTS ResolucaoObrigatoria")
    db.execute_query("DELETE FROM tabMigracoes WHERE migration_name = 'ResolucaoObrigatoria'")
    print('  ✓ Rollback do banco executado com sucesso')
except Exception as e:
    print(f'  ✗ Erro no rollback: {e}')
"@
    
    $rollbackScript | python
} else {
    Write-Host "  - Rollback do banco ignorado" -ForegroundColor Gray
}

# Verificar integridade
Write-Host ""
Write-Host "[5/6] Verificando integridade dos arquivos..." -ForegroundColor Yellow

$allOk = $true
foreach ($file in $files) {
    if (Test-Path $file.Dest) {
        Write-Host "  ✓ $($file.Source) OK" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $($file.Source) ERRO" -ForegroundColor Red
        $allOk = $false
    }
}

# Reiniciar servidor (opcional)
Write-Host ""
Write-Host "[6/6] Reiniciando servidor..." -ForegroundColor Yellow

$restart = Read-Host "Deseja iniciar o servidor agora? (S/N)"
if ($restart -eq "S" -or $restart -eq "s") {
    Write-Host "  Iniciando servidor..." -ForegroundColor Yellow
    
    # Iniciar servidor em nova janela
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; python main.py"
    
    Start-Sleep -Seconds 2
    Write-Host "  ✓ Servidor iniciado em nova janela" -ForegroundColor Green
} else {
    Write-Host "  - Servidor não iniciado" -ForegroundColor Gray
    Write-Host "  Para iniciar manualmente: cd '$projectRoot'; python main.py" -ForegroundColor Cyan
}

# Relatório final
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  RESTAURAÇÃO CONCLUÍDA" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

if ($allOk) {
    Write-Host "✓ Todos os arquivos foram restaurados com sucesso!" -ForegroundColor Green
} else {
    Write-Host "✗ Alguns arquivos apresentaram problemas. Verifique os logs acima." -ForegroundColor Red
}

Write-Host ""
Write-Host "Backup de segurança criado em:" -ForegroundColor Yellow
Write-Host "  $safetyBackupDir" -ForegroundColor White
Write-Host ""
Write-Host "Pressione qualquer tecla para sair..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

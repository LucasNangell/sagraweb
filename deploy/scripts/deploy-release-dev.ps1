#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy DEV: build (opcional) + copia release para \\cgrafsysvm\...\releases\{nome}.

.USAGE
  powershell -File deploy\scripts\deploy-release-dev.ps1
  powershell -File deploy\scripts\deploy-release-dev.ps1 -SkipBuild
  powershell -File deploy\scripts\deploy-release-dev.ps1 -ReleaseName "20260612_153000"
#>
param(
    [string]$ReleaseName = "",
    [switch]$SkipBuild,
    [string]$ProdPath = "",
    [switch]$WhatIf,
    [switch]$SkipBackup,
    [string]$ReleaseDescription = "",
    [switch]$ForceFullBackup,
    [switch]$SkipTests,
    [switch]$SkipFrontend,
    [switch]$UpdateBaseline
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = $PSScriptRoot
. (Join-Path $ScriptDir "deploy-common.ps1")

$DevRoot = Normalize-DeployPath (Join-Path $ScriptDir "..\..")
if (-not $ReleaseName) {
    $ReleaseName = Get-DeployTimestamp
}

Write-DeployStep "Deploy DEV - SAGRA Web"
Write-Host "Maquina:   DEV"
Write-Host "Repo:      $DevRoot"
Write-Host "Release:   $ReleaseName"
Write-Host ""

if (-not (Test-Path -LiteralPath $DevRoot)) {
    throw "Repo DEV nao encontrado: $DevRoot"
}

# Rastreabilidade: commit + working tree (nao bloqueia; grava no RELEASE.txt)
$gitMeta = @{
    commit = ""
    branch = ""
    dirty_files = 0
    dirty_list = @()
    tests = "unknown"
}
Push-Location $DevRoot
try {
    $ErrorActionPreference = "Continue"
    $gitMeta.commit = (& git rev-parse HEAD 2>$null | Select-Object -First 1)
    $gitMeta.branch = (& git rev-parse --abbrev-ref HEAD 2>$null | Select-Object -First 1)
    $porcelain = @(& git status --porcelain 2>$null)
    $ErrorActionPreference = "Stop"
    if ($gitMeta.commit) { $gitMeta.commit = [string]$gitMeta.commit.Trim() }
    if ($gitMeta.branch) { $gitMeta.branch = [string]$gitMeta.branch.Trim() }
    $gitMeta.dirty_list = @($porcelain | ForEach-Object { "$_".TrimEnd() } | Where-Object { $_ })
    $gitMeta.dirty_files = $gitMeta.dirty_list.Count
} catch {
    Write-DeployWarn "Git indisponivel para metadados da release: $_"
} finally {
    Pop-Location
}
Write-Host ("Commit:    {0}" -f $(if ($gitMeta.commit) { $gitMeta.commit } else { '(desconhecido)' }))
Write-Host ("Branch:    {0}" -f $(if ($gitMeta.branch) { $gitMeta.branch } else { '(desconhecida)' }))
if ($gitMeta.dirty_files -gt 0) {
    Write-DeployWarn ("Working tree com {0} arquivo(s) nao commitado(s) -- serao incluidos no pacote:" -f $gitMeta.dirty_files)
    foreach ($line in ($gitMeta.dirty_list | Select-Object -First 40)) {
        Write-Host "  $line" -ForegroundColor DarkYellow
    }
    if ($gitMeta.dirty_files -gt 40) {
        Write-Host ("  ... e mais {0}" -f ($gitMeta.dirty_files - 40)) -ForegroundColor DarkYellow
    }
} else {
    Write-DeployOk "Working tree limpa"
}

# Exporta metadados para deploy_release.ps1 / Set-ReleaseMetadata
$env:SAGRA_RELEASE_COMMIT = [string]$gitMeta.commit
$env:SAGRA_RELEASE_BRANCH = [string]$gitMeta.branch
$env:SAGRA_RELEASE_DIRTY_FILES = [string]$gitMeta.dirty_files
$env:SAGRA_RELEASE_CHANGES = ($gitMeta.dirty_list -join "`n")

if ($SkipTests) {
    Write-DeployWarn "Gate de testes ignorado (-SkipTests) -- ficara tests=skipped no RELEASE.txt"
    $gitMeta.tests = "skipped"
    $env:SAGRA_RELEASE_TESTS = "skipped"
} else {
    Write-DeployStep "Gate de testes (baseline)"
    $testArgs = @{ Root = $DevRoot }
    if ($UpdateBaseline) { $testArgs.UpdateBaseline = $true }
    if ($SkipFrontend) { $testArgs.SkipFrontend = $true }
    & (Join-Path $ScriptDir "run-release-tests.ps1") @testArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Gate de testes falhou (codigo $LASTEXITCODE)"
    }
    $gitMeta.tests = if ($env:SAGRA_RELEASE_TESTS) { $env:SAGRA_RELEASE_TESTS } else { "ok" }
    $env:SAGRA_RELEASE_TESTS = $gitMeta.tests
}

if (-not $SkipBuild) {
    Write-DeployStep "Build pacote (pnpm package:release)"
    Push-Location $DevRoot
    try {
        # Evita script-shell com argumentos (ENOENT/-4058) herdado de sessoes antigas.
        if ($env:npm_config_script_shell -and $env:npm_config_script_shell -match '\s') {
            Remove-Item Env:\npm_config_script_shell -ErrorAction SilentlyContinue
        }

        # Preferir pnpm.cmd (PowerShell resolve pnpm.ps1 e falha com ExecutionPolicy Restricted).
        $pnpmCmd = Join-Path $env:APPDATA "npm\pnpm.cmd"
        if (-not (Test-Path -LiteralPath $pnpmCmd)) {
            $found = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
            if ($found) {
                $pnpmCmd = $found.Source
            } else {
                $found = Get-Command "pnpm" -ErrorAction Stop
                $pnpmCmd = $found.Source
            }
        }
        Write-Host "Usando: $pnpmCmd"
        & $pnpmCmd package:release
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm package:release falhou (codigo $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
    Write-DeployOk "Pacote gerado em deploy\release"
} else {
    $pkg = Join-Path $DevRoot "deploy\release"
    if (-not (Test-Path -LiteralPath $pkg)) {
        throw "deploy\release inexistente. Rode sem -SkipBuild primeiro."
    }
    Write-DeployWarn "Build ignorado (-SkipBuild)"
}

$deployArgs = @{
    DevPath      = $DevRoot
    ReleaseName  = $ReleaseName
    SkipBuild    = $true
}
# Inclusive com -SkipBuild, nao enviar pacote anterior sem as bibliotecas TIFF.
$packageRoot = Join-Path $DevRoot "deploy\release"
$tiffCheck = Join-Path $packageRoot "check_tiff_runtime.py"
if (-not (Test-Path -LiteralPath $tiffCheck)) {
    throw "Pacote sem validador TIFF. Rode deploy-release-dev.bat sem -SkipBuild."
}
& python $tiffCheck --release-root $packageRoot --package-only
if ($LASTEXITCODE -ne 0) { throw "Pacote TIFF invalido. Refaca o build antes do envio." }
if ($ProdPath) { $deployArgs.ProdPath = $ProdPath }
if ($WhatIf) { $deployArgs.WhatIf = $true }

if (-not $SkipBackup) {
    Write-DeployStep "Backup incremental do DEV"
    $pyArgs = @("deploy\scripts\backup_incremental_release.py", "--release-name", $ReleaseName)
    if ($ReleaseDescription) {
        $pyArgs += @("--description", $ReleaseDescription)
    }
    if ($ForceFullBackup) {
        $pyArgs += @("--force-full")
    }
    if ($WhatIf) {
        $pyArgs += @("--dry-run")
    }
    Write-Host "Executando: python $($pyArgs -join ' ')"
    & python @pyArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Backup incremental falhou (codigo $LASTEXITCODE). Release abortado."
    }
    if ($WhatIf) {
        Write-DeployOk "Simulacao (WhatIf) de backup incremental concluida."
    } else {
        Write-DeployOk "Backup incremental concluido com sucesso."
    }
}

& (Join-Path $ScriptDir "deploy_release.ps1") @deployArgs

Write-Host ""
Write-DeployStep "Proximo passo - NO SERVIDOR (10.1.1.73)"
Write-Host @"

  cd "C:\Sistemas CGraf\Sagra Web"
  publicar-release.bat -ReleaseName "$ReleaseName" -ConfirmProductionSwitch

  (Script completo: deploy\scripts\publicar-release-prod.ps1)

  Ou, daqui mesmo (DEV, via WinRM):
  publicar-ultimo-release-remoto.bat

"@ -ForegroundColor Yellow

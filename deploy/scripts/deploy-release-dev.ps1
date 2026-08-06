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
    [switch]$ForceFullBackup
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

if (-not $SkipBuild) {
    Write-DeployStep "Build pacote (pnpm package:release)"
    Push-Location $DevRoot
    try {
        $pnpm = Get-Command pnpm -ErrorAction Stop
        & pnpm package:release
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

"@ -ForegroundColor Yellow

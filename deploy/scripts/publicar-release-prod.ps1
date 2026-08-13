#Requires -Version 5.1
<#
.SYNOPSIS
  Script unico PROD: junctions, parar API (se necessario), ativar release, corrigir config, subir API, health check.

  Executar NO SERVIDOR 10.1.1.73:

    cd "C:\Sistemas CGraf\Sagra Web"
    .\publicar-release.bat -ReleaseName "20260611_201054" -ConfirmProductionSwitch

.USAGE
  powershell -File deploy\scripts\publicar-release-prod.ps1 `
    -ReleaseName "20260611_201054" -ConfirmProductionSwitch
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseName,
    [string]$ProdPath = "",
    [switch]$ConfirmProductionSwitch,
    [switch]$InteractiveApi,
    [int]$HealthWaitSec = 60
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

if (-not $ConfirmProductionSwitch) {
    throw "Use -ConfirmProductionSwitch (aceita ~1-3 min sem API durante a troca)."
}

$ProdPath = Resolve-DeployProdPath -ProdPath $ProdPath
$layout = Get-ReleaseLayoutPaths $ProdPath
$targetRelease = Join-Path $layout.Releases $ReleaseName
$currentRoot = Join-Path $ProdPath "current"
$port = Get-SagraApiPort -ProdPath $ProdPath
$activeNow = Get-ActiveReleaseName $ProdPath

Write-DeployStep "Publicar release - SAGRA Web (PROD)"
Write-Host "Servidor:       $ProdPath"
Write-Host "Release alvo:   $ReleaseName"
Write-Host "Release ativa:  $(if ($activeNow) { $activeNow } else { '(nenhuma)' })"
Write-Host "Porta API:      $port"
Write-Host ""

if (-not (Test-Path -LiteralPath $targetRelease)) {
    throw "Release nao encontrada: $targetRelease`nRode deploy-release-dev.bat na maquina DEV primeiro."
}

if (-not (Test-IsDeployAdmin)) {
    Write-Host "AVISO: PowerShell nao esta como Administrador." -ForegroundColor Yellow
    Write-Host "        Se parar-api falhar, abra PowerShell como Admin e repita." -ForegroundColor Yellow
    Write-Host ""
}

# 1) Junctions + validacao da release
Write-DeployStep "1/6 Junctions e validacao"
& (Join-Path $PSScriptRoot "finish-release-junctions.ps1") -ProdLocalPath $ProdPath -ReleaseName $ReleaseName
if ($LASTEXITCODE -ne 0) { throw "Junctions falharam" }

# 2) Parar API somente se porta em uso
Write-DeployStep "2/6 Parar API (se necessario)"
if (Test-SagraPortListening -Port $port) {
    Write-Host "Porta $port em uso - parando API..."
    Stop-SagraApiForDeploy -ProdPath $ProdPath -FreePortTimeoutSec 5
    Start-Sleep -Seconds 1
    if (Test-SagraPortListening -Port $port) {
        throw "Porta $port ainda em uso. Execute parar-api.bat como Administrador."
    }
    Write-DeployOk "Porta $port livre"
} else {
    Write-DeployOk "Porta $port ja estava livre - API nao estava rodando"
}

# 3) Ativar current -> release
Write-DeployStep "3/6 Ativar current"
& (Join-Path $PSScriptRoot "activate-release.ps1") `
    -ReleaseName $ReleaseName `
    -ProdPath $ProdPath `
    -ConfirmProductionSwitch `
    -SkipHealthCheck

# 4) Config shared -> release + remover BOM
Write-DeployStep "4/6 Config (shared + sem BOM)"
Connect-ReleaseToShared -ReleasePath $targetRelease -SharedRoot $layout.Shared -ProdLocalPath $ProdPath | Out-Null
Repair-DeployConfigBom -ProdPath $ProdPath -ReleaseName $ReleaseName

# 5) Subir API
Write-DeployStep "5/6 Iniciar API em current\"
Start-SagraApiForDeploy -CurrentRoot $currentRoot -InteractiveApi:$InteractiveApi

# 6) Health check
Write-DeployStep "6/6 Health check"
$health = Wait-SagraHealthCheck -ProdPath $ProdPath -TimeoutSec $HealthWaitSec
if (-not $health.Ok) {
    Write-DeployErr "Health falhou: $($health.Body)"
    Write-Host "  Logs: $currentRoot\logs\api\uvicorn_stderr.log" -ForegroundColor Yellow
    Write-Host "  Rollback: powershell -File deploy\scripts\rollback_release.ps1 -ConfirmProductionSwitch" -ForegroundColor Yellow
    exit 1
}
Write-DeployOk "Health: $($health.Body)"

Write-DeployLog -ProdPath $ProdPath -Message "publicar-release-prod OK: $ReleaseName"
Write-DeployStep "Concluido"
Write-Host "Release publicada: $currentRoot" -ForegroundColor Green
Write-Host "Teste: home, login, /papelaria" -ForegroundColor Green
# Independencia: publicar reinicia so a API - NAO start/stop SAGRA-SyncAndamentos (NSSM).
Write-Host "Sync andamentos (NSSM): intacto - publicar nao toca o servico." -ForegroundColor DarkGray

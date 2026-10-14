#Requires -Version 5.1
<#
.SYNOPSIS
  Ativa release existente no servidor (sem exigir C:\dev\SagraWeb).

.USAGE
  cd "C:\Sistemas CGraf\Sagra Web"
  powershell -File deploy\scripts\activate-release.ps1 -ReleaseName "staging_20260611_193049"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseName,
    [string]$ProdPath = "",
    [switch]$ConfirmProductionSwitch,
    [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

if (-not $ConfirmProductionSwitch) {
    throw "Ativacao bloqueada. Use -ConfirmProductionSwitch."
}

$ProdPath = Resolve-DeployProdPath -ProdPath $ProdPath
Assert-SafeReleaseName -ReleaseName $ReleaseName
$layout = Get-ReleaseLayoutPaths $ProdPath
$targetRelease = Join-Path $layout.Releases $ReleaseName

Write-DeployStep "Ativar release - SAGRA Web"
Write-Host "Producao: $ProdPath"
Write-Host "Release:  $ReleaseName"

if (-not (Test-Path -LiteralPath $targetRelease)) {
    throw "Release inexistente: $targetRelease"
}

Write-DeployStep "Validar release"
$junctionsOk = Connect-ReleaseToShared -ReleasePath $targetRelease -SharedRoot $layout.Shared -ProdLocalPath $ProdPath
Test-ReleaseIntegrity -ReleasePath $targetRelease -RequireSharedLinks:$junctionsOk
if (-not $junctionsOk) {
    Write-DeployWarn "Junctions incompletos - tente: finish-release-junctions.ps1 -ReleaseName $ReleaseName"
}

Write-DeployStep "Atualizar current"
Update-CurrentPointer -ProdPath $ProdPath -ReleaseName $ReleaseName -ConfirmProductionSwitch
Write-DeployLog -ProdPath $ProdPath -Message "Release $ReleaseName ativada via activate-release.ps1"

if (-not $SkipHealthCheck) {
    $health = Invoke-ReleaseHealthCheck
    if ($health.Ok) {
        Write-DeployOk "Health: $($health.Body)"
    } else {
        Write-DeployWarn "Health indisponivel (API pode estar parada): $($health.Body)"
        Write-Host "  Proximo passo: cd current && iniciar-api.bat" -ForegroundColor Yellow
    }
}

Write-DeployStep "Concluido"
Write-Host "Release ativa em: $(Join-Path $ProdPath 'current')" -ForegroundColor Green
# Este script NAO reinicia SAGRA-SyncAndamentos; publicar-release-prod.ps1 o faz no fim, com o lock ativo.
Write-Host "Sync andamentos (NSSM): intacto - activate nao toca o servico." -ForegroundColor DarkGray

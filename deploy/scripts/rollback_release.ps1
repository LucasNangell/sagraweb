#Requires -Version 5.1
<#
.SYNOPSIS
  Rollback para release anterior (exige confirmacao para alterar producao).

.USAGE
  powershell -File deploy/scripts/rollback_release.ps1 -ListReleases
  powershell -File deploy/scripts/rollback_release.ps1 -ToRelease "initial_20260611_120000" -ConfirmProductionSwitch
#>
param(
    [string]$ProdPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web",
    [string]$ToRelease = "",
    [switch]$ListReleases,
    [switch]$ConfirmProductionSwitch,
    [switch]$RestartApi,
    [switch]$ReloadNginx,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

Write-DeployStep "Rollback release - SAGRA Web"
Write-Host "Producao: $ProdPath"

$layout = Get-ReleaseLayoutPaths $ProdPath
$available = Get-AvailableReleases $ProdPath
$current = Get-ActiveReleaseName $ProdPath
$previous = if (Test-Path $layout.PreviousReleaseFile) {
    (Get-Content -LiteralPath $layout.PreviousReleaseFile -Raw).Trim()
} else { $null }

Write-Host ""
Write-Host ("Release ativa (current-release.txt): " + $(if ($current) { $current } else { "(nenhuma - producao legada)" }))
Write-Host "Release anterior: $(if ($previous) { $previous } else { '(nenhuma)' })"
Write-Host ""
Write-Host "Releases disponiveis:"
foreach ($r in $available) {
    $mark = @()
    if ($r -eq $current) { $mark += "ATIVA" }
    if ($r -eq $previous) { $mark += "ANTERIOR" }
    $suffix = if ($mark.Count) { " [" + ($mark -join ", ") + "]" } else { "" }
    Write-Host "  - $r$suffix"
}

if ($ListReleases) {
    exit 0
}

if (-not $ConfirmProductionSwitch) {
    throw "Rollback de producao bloqueado sem -ConfirmProductionSwitch. Use -ListReleases para inspecionar."
}

if (-not $ToRelease) {
    if ($previous) {
        $ToRelease = $previous
        Write-DeployWarn "Usando release anterior: $ToRelease"
    } else {
        throw "Informe -ToRelease ou ative uma release antes (previous-release.txt ausente)."
    }
}

if ($ToRelease -notin $available) {
    throw "Release nao encontrada: $ToRelease"
}

$targetPath = Join-Path $layout.Releases $ToRelease
Write-DeployStep "Validar release alvo: $ToRelease"
Test-ReleaseIntegrity -ReleasePath $targetPath -RequireSharedLinks

if ($WhatIf) {
    Write-DeployWarn "WhatIf: current nao sera alterado"
    exit 0
}

Write-DeployStep "Atualizar current -> $ToRelease"
Update-CurrentPointer -ProdPath $ProdPath -ReleaseName $ToRelease -ConfirmProductionSwitch

Write-DeployLog -ProdPath $ProdPath -Message "Rollback para $ToRelease (de $current)"

if ($RestartApi) {
    Write-DeployWarn "Reinicie API no servidor: $($layout.Current)\iniciar-api.bat"
}
if ($ReloadNginx) {
    Write-DeployWarn "Reload NGINX no servidor apos confirmar nginx -t"
}

$health = Invoke-ReleaseHealthCheck
if ($health.Ok) {
    Write-DeployLog -ProdPath $ProdPath -Message "Health OK pos-rollback: $($health.Body)"
} else {
    Write-DeployLog -ProdPath $ProdPath -Level "WARN" -Message "Health indisponivel (API pode ainda apontar para raiz legada): $($health.Body)"
}

Write-DeployStep "Rollback concluido"

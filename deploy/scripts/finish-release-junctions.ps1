#Requires -Version 5.1
<#
.SYNOPSIS
  Cria junctions release->shared usando caminho LOCAL do servidor (executar NO 10.1.1.73).

.USAGE
  powershell -File "C:\Sistemas CGraf\Sagra Web\deploy\scripts\finish-release-junctions.ps1" -ReleaseName "20260611_180000"
#>
param(
    [string]$ProdLocalPath = "C:\Sistemas CGraf\Sagra Web",
    [string]$ReleaseName = "",
    [switch]$AllPending
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

$releasesDir = Join-Path $ProdLocalPath "releases"
if (-not (Test-Path -LiteralPath $releasesDir)) {
    throw "releases/ nao encontrado em $ProdLocalPath"
}

$toProcess = @()
if ($AllPending) {
    $toProcess = Get-ChildItem -LiteralPath $releasesDir -Directory | Select-Object -ExpandProperty Name
} elseif ($ReleaseName) {
    Assert-SafeReleaseName -ReleaseName $ReleaseName
    $toProcess = @($ReleaseName)
} else {
    throw "Informe -ReleaseName ou -AllPending"
}

foreach ($name in $toProcess) {
    Assert-SafeReleaseName -ReleaseName $name
    $releasePath = Join-Path $releasesDir $name
    if (-not (Test-Path -LiteralPath $releasePath)) {
        Write-DeployWarn "Release ignorada (inexistente): $name"
        continue
    }
    Write-DeployStep "Junctions locais: $name"
    $sharedRoot = Join-Path $ProdLocalPath "shared"
    $ok = Connect-ReleaseToShared -ReleasePath $releasePath -SharedRoot $sharedRoot -ProdLocalPath $ProdLocalPath
    if ($ok) {
        $pending = Join-Path $releasePath "PENDING_JUNCTIONS.json"
        if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue }
        Test-ReleaseIntegrity -ReleasePath $releasePath -RequireSharedLinks
        Write-DeployOk "Release $name pronta com junctions locais"
    } else {
        Write-DeployWarn "Release $name com junctions pendentes - verifique PENDING_JUNCTIONS.json"
        exit 1
    }
}

#Requires -Version 5.1
param(
    [string]$ReleaseName = "initial_20260611_192811"
)
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\deploy-common.ps1"
$ProdPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
$ReleasePath = Join-Path $ProdPath "releases\$ReleaseName"
$SharedRoot = Join-Path $ProdPath "shared"
Write-DeployStep "Reconectar release $ReleaseName"
Connect-ReleaseToShared -ReleasePath $ReleasePath -SharedRoot $SharedRoot
Test-ReleaseIntegrity -ReleasePath $ReleasePath -RequireSharedLinks
Write-DeployOk "Release $ReleaseName validada"

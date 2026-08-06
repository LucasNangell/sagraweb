#Requires -Version 5.1
param([string]$ProdPath = "", [string]$ReleaseName = "")
. "$PSScriptRoot\deploy-common.ps1"
$ProdPath = Resolve-DeployProdPath -ProdPath $ProdPath
Repair-DeployConfigBom -ProdPath $ProdPath -ReleaseName $ReleaseName
Write-DeployStep "Concluido"

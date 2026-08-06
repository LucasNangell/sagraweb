#Requires -Version 5.1
<#
.SYNOPSIS
  Prepara pasta shared/ em producao (sem mover dados legados automaticamente).

.USAGE
  powershell -File deploy/scripts/prepare-shared.ps1
  powershell -File deploy/scripts/prepare-shared.ps1 -ProdPath "\\cgrafsysvm\Sistemas CGraf\Sagra Web" -SeedConfigFromLegacy
#>
param(
    [string]$ProdPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web",
    [switch]$SeedConfigFromLegacy
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

Write-DeployStep "Preparar shared/ - SAGRA Web"
Write-Host "Producao: $ProdPath"

if (-not (Test-Path -LiteralPath $ProdPath)) {
    throw "Pasta de producao inacessivel: $ProdPath"
}
if (-not (Test-DeployPathWritable $ProdPath)) {
    throw "Sem permissao de escrita em: $ProdPath"
}

Initialize-ReleaseLayout -ProdPath $ProdPath | Out-Null
Initialize-SharedLayout -ProdPath $ProdPath -SeedFromLegacyRoot:$SeedConfigFromLegacy | Out-Null

Write-DeployLog -ProdPath $ProdPath -Message "prepare-shared concluido (SeedConfigFromLegacy=$SeedConfigFromLegacy)"
Write-DeployStep "Concluido"
Write-Host ""
Write-Host "shared/config/.env e config.json:" -ForegroundColor Yellow
Write-Host "  Se ainda nao existirem, copie manualmente da raiz legada APOS backup."
Write-Host "  Dados mutaveis (logs, storage, Modelos/papelaria/previews, etc.) ficam em shared/ e sao preservados entre releases."

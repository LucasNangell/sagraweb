#Requires -Version 5.1
<#
.SYNOPSIS
  Cria estrutura releases/current/shared/deploy em producao (nao altera API/nginx ativos).

.USAGE
  powershell -File deploy/scripts/init-release-structure.ps1
#>
param(
    [string]$ProdPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

Write-DeployStep "Inicializar estrutura de releases - SAGRA Web"
Write-Host "Producao: $ProdPath"

if (-not (Test-Path -LiteralPath $ProdPath)) {
    throw "Pasta de producao inacessivel: $ProdPath"
}
if (-not (Test-DeployPathWritable $ProdPath)) {
    throw "Sem permissao de escrita em: $ProdPath"
}

$layout = Initialize-ReleaseLayout -ProdPath $ProdPath
Initialize-SharedLayout -ProdPath $ProdPath -SeedFromLegacyRoot | Out-Null
Copy-DeployScriptsToProd -ProdPath $ProdPath

Write-DeployLog -ProdPath $ProdPath -Message "init-release-structure concluido"
Write-DeployStep "Estrutura criada"
Write-Host "  releases\     -> $([IO.Path]::Combine($layout.Releases))"
Write-Host "  shared\       -> $($layout.Shared)"
Write-Host "  deploy\       -> $($layout.Deploy)"
Write-Host ""
Write-Host "PRODUCAO LEGADA (raiz) permanece ATIVA - nenhum servico foi reiniciado." -ForegroundColor Green

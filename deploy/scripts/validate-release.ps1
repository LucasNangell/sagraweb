#Requires -Version 5.1
<#
.SYNOPSIS
  Valida release e estrutura de deploy sem reiniciar servicos.

.USAGE
  powershell -File deploy/scripts/validate-release.ps1 -ReleaseName "20260611_180000"
  powershell -File deploy/scripts/validate-release.ps1 -StructureOnly
#>
param(
    [string]$ProdPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web",
    [string]$ReleaseName = "",
    [string]$NginxConfPath = "\\cgrafsysvm\nginx\conf\nginx.conf",
    [switch]$StructureOnly,
    [switch]$TestHealthOnLegacy
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

Write-DeployStep "Validacao release - SAGRA Web"
$layout = Get-ReleaseLayoutPaths $ProdPath
$results = @()

function Add-Result([string]$Check, [bool]$Ok, [string]$Detail) {
    $script:results += [PSCustomObject]@{ Check = $Check; Ok = $Ok; Detail = $Detail }
    if ($Ok) { Write-DeployOk ($Check + " - " + $Detail) } else { Write-DeployErr ($Check + " - " + $Detail) }
}

# Estrutura
foreach ($key in @("Releases", "Shared", "DeployScripts", "DeployBackups")) {
    $p = $layout[$key]
    Add-Result "Estrutura $key" (Test-Path -LiteralPath $p) $p
}

$sharedCfg = Join-Path $layout.Shared "config\.env"
Add-Result "shared/config/.env" (Test-Path -LiteralPath $sharedCfg) $(if (Test-Path $sharedCfg) { "presente" } else { "ausente - copiar da raiz legada apos backup" })

# NGINX
if (Test-Path -LiteralPath $NginxConfPath) {
    $ngx = Test-NginxConfigReadable -NginxConfPath $NginxConfPath
    Add-Result "NGINX sagra_backend" $ngx.Ok "porta $($ngx.Port); disk_root=$($ngx.UsesDiskRoot)"
} else {
    Add-Result "NGINX config" $false $NginxConfPath
}

# Caminho current (futuro)
$currentJunction = Test-Path -LiteralPath $layout.Current
if ($currentJunction) {
    $item = Get-Item -LiteralPath $layout.Current -Force
    $isJunction = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
    Add-Result "current junction" $isJunction $(if ($isJunction) { "target: $($item.Target)" } else { "nao e junction" })
} else {
    Add-Result "current junction" $true "ainda nao criado (producao legada ativa - OK nesta etapa)"
}

if ($StructureOnly) {
    Write-DeployStep "Resumo"
    $results | Format-Table -AutoSize
    exit 0
}

if (-not $ReleaseName) {
    $all = Get-AvailableReleases $ProdPath
    if (-not $all.Count) { throw "Nenhuma release em releases/" }
    $ReleaseName = $all[0]
    Write-DeployWarn ("ReleaseName omitido - usando mais recente: " + $ReleaseName)
}

$releasePath = Join-Path $layout.Releases $ReleaseName
if (-not (Test-Path -LiteralPath $releasePath)) {
    throw "Release nao encontrada: $releasePath"
}

try {
    Test-ReleaseIntegrity -ReleasePath $releasePath -RequireSharedLinks:(-not (Test-Path (Join-Path $releasePath "PENDING_JUNCTIONS.json")))
    Add-Result "Integridade release" $true $ReleaseName
} catch {
    Add-Result "Integridade release" $false $_.Exception.Message
}

$versionFile = Join-Path $releasePath "app\frontend\version.json"
Add-Result "frontend/version.json" (Test-Path -LiteralPath $versionFile) $versionFile

$buildIdFile = Join-Path $releasePath "app\frontend\build-id.txt"
Add-Result "frontend/build-id.txt" (Test-Path -LiteralPath $buildIdFile) $buildIdFile

$releaseMeta = Join-Path $releasePath "RELEASE.txt"
Add-Result "RELEASE.txt" (Test-Path -LiteralPath $releaseMeta) $releaseMeta

# Simular caminho que API usara apos migracao
$futureApiBat = Join-Path $releasePath "iniciar-api.bat"
Add-Result "iniciar-api.bat na release" (Test-Path -LiteralPath $futureApiBat) "API futura: $futureApiBat"

Write-DeployStep "NGINX - impacto da migracao"
Write-Host "  O nginx.conf ativo faz proxy_pass para 127.0.0.1:8050 (Uvicorn)." -ForegroundColor DarkGray
Write-Host "  Apos migracao, iniciar-api.bat deve rodar a partir de current\ (junction)." -ForegroundColor DarkGray
Write-Host "  Nenhuma alteracao de root/alias e necessaria no NGINX para o SPA React." -ForegroundColor DarkGray

if ($TestHealthOnLegacy) {
    Write-DeployStep "Health check producao legada (somente leitura)"
    $health = Invoke-ReleaseHealthCheck -Port 8050
    Add-Result "GET /health (legado :8050)" $health.Ok $health.Body
}

Write-DeployStep "Resumo validacao"
$results | Format-Table -AutoSize
$failed = @($results | Where-Object { -not $_.Ok }).Count
if ($failed -gt 0) {
    Write-Host "$failed verificacao(oes) com pendencia." -ForegroundColor Yellow
    exit 1
}
Write-Host "Validacao OK." -ForegroundColor Green

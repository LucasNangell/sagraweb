#Requires -Version 5.1
<#
.SYNOPSIS
  Prepara uma release versionada (testes + pacote + copia para releases\).
  NAO ativa current\ — publique no servidor com publicar-release.bat.

.USAGE
  deploy-producao.bat
  deploy-producao.bat -SkipBuild
  deploy-producao.bat -SkipTests
  deploy-producao.bat -DryRun
  deploy-producao.bat -ReleaseName 20261020_153832
#>
param(
    [switch]$SkipBuild,
    [switch]$DryRun,
    [switch]$ForceConfig,
    [switch]$RestartApi,
    [switch]$SkipTests,
    [switch]$SkipFrontend,
    [switch]$SkipBackup,
    [string]$ReleaseName = "",
    [string]$ReleaseDescription = "",
    [string]$TargetPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step([string]$Msg) {
    Write-Host ""
    Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Write-Warn([string]$Msg) {
    Write-Host "    AVISO: $Msg" -ForegroundColor Yellow
}

Write-Step "SAGRA Web - deploy (layout versionado)"
Write-Host "Este script NAO usa mais robocopy /MIR na raiz de producao"
Write-Host "(isso derrubou a API em 15/10/2026). Prepara releases\{nome} e"
Write-Host "deixa current\ intacto ate voce publicar no servidor."
Write-Host ""

if ($ForceConfig) {
    Write-Warn "-ForceConfig ignorado: config de producao fica em shared\config e nao e sobrescrita."
}
if ($RestartApi) {
    Write-Warn "-RestartApi ignorado: a API so troca no publicar-release.bat no servidor."
}

$devScript = Join-Path $PSScriptRoot "deploy-release-dev.ps1"
if (-not (Test-Path -LiteralPath $devScript -PathType Leaf)) {
    throw "Script versionado ausente: $devScript"
}

$argList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $devScript
)
if ($SkipBuild) { $argList += "-SkipBuild" }
if ($DryRun) { $argList += "-WhatIf" }
if ($SkipTests) { $argList += "-SkipTests" }
if ($SkipFrontend) { $argList += "-SkipFrontend" }
if ($SkipBackup) { $argList += "-SkipBackup" }
if ($ReleaseName) { $argList += @("-ReleaseName", $ReleaseName) }
if ($ReleaseDescription) { $argList += @("-ReleaseDescription", $ReleaseDescription) }
if ($TargetPath) { $argList += @("-ProdPath", $TargetPath) }

Write-Host ("Delegando: powershell {0}" -f ($argList -join " ")) -ForegroundColor DarkGray
& powershell.exe @argList
$code = [int]$LASTEXITCODE
if ($code -ne 0) {
    throw ("deploy-release-dev.ps1 falhou (codigo {0})" -f $code)
}
exit 0

#Requires -Version 5.1
<#
.SYNOPSIS
  Liga OS_SEARCH_PREFER_MATERIALIZED=1 no .env compartilhado (home /os/search).

.DESCRIPTION
  Nao toca SAGRA-SyncAndamentos. Apenas o .env da API; reinicie a API depois.

.USAGE
  powershell -File deploy\scripts\enable-os-search-materialized.ps1
  powershell -File deploy\scripts\enable-os-search-materialized.ps1 -ProdPath "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
#>
param(
    [string]$ProdPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web",
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$envPath = Join-Path $ProdPath "shared\config\.env"
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Arquivo nao encontrado: $envPath"
}

$raw = Get-Content -LiteralPath $envPath -Raw
if ($raw -match '(?m)^\s*OS_SEARCH_PREFER_MATERIALIZED\s*=') {
    Write-Host "OS_SEARCH_PREFER_MATERIALIZED ja definido em $envPath" -ForegroundColor Green
    Select-String -LiteralPath $envPath -Pattern 'OS_SEARCH_PREFER_MATERIALIZED'
} else {
    $block = @(
        ""
        "# Home /os/search: preferir tabela materializada (evita ROW_NUMBER live em tabAndamento)."
        "OS_SEARCH_PREFER_MATERIALIZED=1"
        ""
    ) -join "`r`n"
    if ($WhatIf) {
        Write-Host "WhatIf: adicionaria OS_SEARCH_PREFER_MATERIALIZED=1 em $envPath" -ForegroundColor Yellow
    } else {
        if (-not $raw.EndsWith("`n")) {
            $raw += "`r`n"
        }
        Set-Content -LiteralPath $envPath -Value ($raw + $block) -NoNewline -Encoding UTF8
        Write-Host "Adicionado OS_SEARCH_PREFER_MATERIALIZED=1 em $envPath" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Proximo passo (somente API — nao reinicie o sync):" -ForegroundColor Cyan
Write-Host "  cd `"$ProdPath\current`""
Write-Host "  .\parar-api.bat"
Write-Host "  .\iniciar-api.bat"
Write-Host "  # ou o fluxo iniciar-api-detached.ps1 usado no servidor"

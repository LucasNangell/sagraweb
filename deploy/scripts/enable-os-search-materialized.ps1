#Requires -Version 5.1
<#
.SYNOPSIS
  Liga OS_SEARCH_PREFER_MATERIALIZED=1 no .env compartilhado (home /os/search).

.DESCRIPTION
  Nao toca SAGRA-SyncAndamentos. Atualiza shared\config\.env (canonico) e,
  se existir, current\config\.env (copia lida pela API em execucao).
  Reinicie somente a API depois.

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

function Set-OsSearchMaterializedFlag {
    param(
        [Parameter(Mandatory = $true)][string]$EnvPath,
        [switch]$WhatIf
    )

    if (-not (Test-Path -LiteralPath $EnvPath)) {
        Write-Host "Arquivo nao encontrado (ignorado): $EnvPath" -ForegroundColor Yellow
        return $false
    }

    $raw = Get-Content -LiteralPath $EnvPath -Raw
    if ($raw -match '(?m)^\s*OS_SEARCH_PREFER_MATERIALIZED\s*=') {
        Write-Host "OS_SEARCH_PREFER_MATERIALIZED ja definido em $EnvPath" -ForegroundColor Green
        Select-String -LiteralPath $EnvPath -Pattern 'OS_SEARCH_PREFER_MATERIALIZED'
        return $true
    }

    $block = @(
        ""
        "# Home /os/search: preferir tabela materializada (evita ROW_NUMBER live em tabAndamento)."
        "OS_SEARCH_PREFER_MATERIALIZED=1"
        ""
    ) -join "`r`n"

    if ($WhatIf) {
        Write-Host "WhatIf: adicionaria OS_SEARCH_PREFER_MATERIALIZED=1 em $EnvPath" -ForegroundColor Yellow
        return $true
    }

    if (-not $raw.EndsWith("`n")) {
        $raw += "`r`n"
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($EnvPath, ($raw + $block), $utf8NoBom)
    Write-Host "Adicionado OS_SEARCH_PREFER_MATERIALIZED=1 em $EnvPath" -ForegroundColor Green
    return $true
}

$sharedEnv = Join-Path $ProdPath "shared\config\.env"
$currentEnv = Join-Path $ProdPath "current\config\.env"

$okShared = Set-OsSearchMaterializedFlag -EnvPath $sharedEnv -WhatIf:$WhatIf
if (-not $okShared) {
    throw "Arquivo canonico nao encontrado: $sharedEnv"
}
$null = Set-OsSearchMaterializedFlag -EnvPath $currentEnv -WhatIf:$WhatIf

Write-Host ""
Write-Host "Proximo passo (somente API):" -ForegroundColor Cyan
Write-Host "  parar-api preserva o sync (nao para SAGRA-SyncAndamentos)."
Write-Host "  NAO execute: nssm stop SAGRA-SyncAndamentos"
Write-Host "  cd `"$ProdPath\current`""
Write-Host "  .\parar-api.bat"
Write-Host "  .\iniciar-api.bat"
Write-Host "  # ou o fluxo iniciar-api-detached.ps1 usado no servidor"

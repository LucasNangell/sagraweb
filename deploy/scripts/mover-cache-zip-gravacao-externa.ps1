#Requires -Version 5.1
<#
.SYNOPSIS
  Move o cache de ZIP de Gravação Externa para F: e libera o cache antigo em C:.

.DESCRIPTION
  - Cria F:\SagraWeb\gravacao_externa_zips
  - Atualiza shared\config\.env (canônico) e current\config\.env
  - Remove arquivos antigos em shared\storage\gravacao_externa_zips
  - Exibe espaço livre antes/depois

  Execute NO SERVIDOR (cgrafsysvm), como administrador se necessário.

.USAGE
  powershell -File deploy\scripts\mover-cache-zip-gravacao-externa.ps1
  powershell -File deploy\scripts\mover-cache-zip-gravacao-externa.ps1 -ProdPath "C:\Sistemas CGraf\Sagra Web"
#>
param(
    [string]$ProdPath = "C:\Sistemas CGraf\Sagra Web",
    [string]$ZipDir = "F:\SagraWeb\gravacao_externa_zips",
    [int]$CacheMaxGb = 200,
    [int]$MinFreeGb = 10,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Format-Gb([long]$Bytes) {
    if ($Bytes -le 0) { return "0 GB" }
    return ("{0:N2} GB" -f ($Bytes / 1GB))
}

function Get-VolumeFree([string]$Path) {
    $root = [System.IO.Path]::GetPathRoot($Path)
    if (-not $root) { return $null }
    $drive = Get-PSDrive -Name ($root.TrimEnd(':\')) -ErrorAction SilentlyContinue
    if ($drive) {
        return [pscustomobject]@{
            Volume = $root
            FreeBytes = [long]$drive.Free
            TotalBytes = [long]($drive.Used + $drive.Free)
        }
    }
    return $null
}

function Set-EnvZipVars {
    param(
        [Parameter(Mandatory = $true)][string]$EnvPath,
        [switch]$WhatIf
    )

    if (-not (Test-Path -LiteralPath $EnvPath)) {
        Write-Host "Arquivo nao encontrado (ignorado): $EnvPath" -ForegroundColor Yellow
        return $false
    }

    $vars = @{
        "SAGRA_GE_ZIP_DIR" = $ZipDir
        "SAGRA_GE_ZIP_CACHE_MAX_GB" = [string]$CacheMaxGb
        "SAGRA_GE_ZIP_MIN_FREE_GB" = [string]$MinFreeGb
    }

    $lines = Get-Content -LiteralPath $EnvPath
    $out = New-Object System.Collections.Generic.List[string]
    $seen = @{}

    foreach ($line in $lines) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
            $key = $Matches[1]
            if ($vars.ContainsKey($key)) {
                $out.Add("$key=$($vars[$key])")
                $seen[$key] = $true
                continue
            }
        }
        $out.Add($line)
    }

    if (-not $seen.ContainsKey("SAGRA_GE_ZIP_DIR")) {
        $out.Add("")
        $out.Add("# Cache de ZIP — Gravação Externa (montagem em background)")
        foreach ($pair in $vars.GetEnumerator() | Sort-Object Name) {
            if (-not $seen.ContainsKey($pair.Key)) {
                $out.Add("$($pair.Key)=$($pair.Value)")
            }
        }
        $out.Add("")
    }

    if ($WhatIf) {
        Write-Host "WhatIf: atualizaria $EnvPath" -ForegroundColor Yellow
        $vars.GetEnumerator() | ForEach-Object { Write-Host ("  {0}={1}" -f $_.Key, $_.Value) }
        return $true
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($EnvPath, (($out -join "`r`n") + "`r`n"), $utf8NoBom)
    Write-Host "Atualizado: $EnvPath" -ForegroundColor Green
    return $true
}

Write-Host "=== Mover cache ZIP Gravacao Externa ===" -ForegroundColor Cyan
Write-Host "ProdPath: $ProdPath"
Write-Host "Destino : $ZipDir"
Write-Host ""

$oldCache = Join-Path $ProdPath "shared\storage\gravacao_externa_zips"
$sharedEnv = Join-Path $ProdPath "shared\config\.env"
$currentEnv = Join-Path $ProdPath "current\config\.env"

$beforeC = Get-VolumeFree -Path $ProdPath
$beforeF = Get-VolumeFree -Path $ZipDir
if ($beforeC) {
    Write-Host ("C: livre antes: {0} / {1}" -f (Format-Gb $beforeC.FreeBytes), (Format-Gb $beforeC.TotalBytes))
}
if ($beforeF) {
    Write-Host ("F: livre antes: {0} / {1}" -f (Format-Gb $beforeF.FreeBytes), (Format-Gb $beforeF.TotalBytes))
}

if ($WhatIf) {
    Write-Host "WhatIf: criaria pasta $ZipDir" -ForegroundColor Yellow
} else {
    New-Item -ItemType Directory -Force -Path $ZipDir | Out-Null
    Write-Host "Pasta criada/confirmada: $ZipDir" -ForegroundColor Green
}

$null = Set-EnvZipVars -EnvPath $sharedEnv -WhatIf:$WhatIf
$null = Set-EnvZipVars -EnvPath $currentEnv -WhatIf:$WhatIf

if (Test-Path -LiteralPath $oldCache) {
    $oldFiles = Get-ChildItem -LiteralPath $oldCache -File -ErrorAction SilentlyContinue
    $oldBytes = ($oldFiles | Measure-Object Length -Sum).Sum
    Write-Host ("Cache antigo em C: {0} arquivo(s), {1}" -f $oldFiles.Count, (Format-Gb ([long]$oldBytes)))
    if ($WhatIf) {
        Write-Host "WhatIf: removeria conteudo de $oldCache" -ForegroundColor Yellow
    } else {
        Remove-Item -LiteralPath (Join-Path $oldCache "*") -Force -Recurse -ErrorAction SilentlyContinue
        Write-Host "Cache antigo removido de $oldCache" -ForegroundColor Green
    }
} else {
    Write-Host "Cache antigo nao encontrado: $oldCache" -ForegroundColor Yellow
}

if (-not $WhatIf) {
    $afterC = Get-VolumeFree -Path $ProdPath
    $afterF = Get-VolumeFree -Path $ZipDir
    Write-Host ""
    if ($afterC) {
        Write-Host ("C: livre depois: {0} / {1}" -f (Format-Gb $afterC.FreeBytes), (Format-Gb $afterC.TotalBytes))
    }
    if ($afterF) {
        Write-Host ("F: livre depois: {0} / {1}" -f (Format-Gb $afterF.FreeBytes), (Format-Gb $afterF.TotalBytes))
    }
}

Write-Host ""
Write-Host "Proximo passo (somente API):" -ForegroundColor Cyan
Write-Host "  cd `"$ProdPath\current`""
Write-Host "  .\parar-api.bat"
Write-Host "  .\iniciar-api.bat"
Write-Host ""
Write-Host "Cloudflare Worker: republicar deploy/cloudflare-worker-painel.js (headers Range/If-Range)." -ForegroundColor Cyan
Write-Host ""
Write-Host "ALERTA: disco C: com pouco espaco livre pode afetar MySQL e logs." -ForegroundColor Yellow
Write-Host "Considere limpar releases antigas e logs em shared\logs\sync (~0,7 GB)." -ForegroundColor Yellow

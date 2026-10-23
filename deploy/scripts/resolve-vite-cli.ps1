#Requires -Version 5.1
<#
.SYNOPSIS
  Resolve o CLI fisico do Vite (bin\vite.js), evitando junctions do pnpm no Windows 11.

.USAGE
  powershell -NoProfile -ExecutionPolicy Bypass -File deploy/scripts/resolve-vite-cli.ps1 -WebRoot "C:\dev\SagraWeb\apps\web"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Resolve-SagraViteCli {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WebRoot
    )

    $resolvedWebRoot = [System.IO.Path]::GetFullPath($WebRoot)
    $candidates = New-Object System.Collections.Generic.List[string]

    $vitePackagePath = Join-Path $resolvedWebRoot "node_modules\vite"
    $vitePackage = Get-Item -LiteralPath $vitePackagePath -Force -ErrorAction SilentlyContinue
    if ($vitePackage -and $vitePackage.Target) {
        foreach ($target in @($vitePackage.Target)) {
            if ($target) {
                # Alvo fisico da junction pnpm — Test-Path no caminho da junction falha no Win11 25H2.
                $candidates.Add((Join-Path $target "bin\vite.js")) | Out-Null
            }
        }
    }

    $candidates.Add((Join-Path $vitePackagePath "bin\vite.js")) | Out-Null

    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $resolvedWebRoot "..\.."))
    $candidates.Add((Join-Path $repoRoot "node_modules\vite\bin\vite.js")) | Out-Null
    $pnpmDir = Join-Path $repoRoot "node_modules\.pnpm"
    if (Test-Path -LiteralPath $pnpmDir -PathType Container) {
        Get-ChildItem -LiteralPath $pnpmDir -Directory -Filter "vite@*" -ErrorAction SilentlyContinue |
            ForEach-Object {
                $candidates.Add((Join-Path $_.FullName "node_modules\vite\bin\vite.js")) | Out-Null
            }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }
    return $null
}

$resolved = Resolve-SagraViteCli -WebRoot $WebRoot
if ($resolved) {
    Write-Output $resolved
    exit 0
}
exit 1

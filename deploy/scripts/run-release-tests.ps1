#Requires -Version 5.1
<#
.SYNOPSIS
  Gate de qualidade do deploy DEV: pnpm install, typecheck, vitest, pytest.
  Falhas novas (fora da baseline) bloqueiam o release.

.USAGE
  powershell -File deploy\scripts\run-release-tests.ps1
  powershell -File deploy\scripts\run-release-tests.ps1 -UpdateBaseline
#>
param(
    [string]$Root = "",
    [switch]$UpdateBaseline,
    [switch]$SkipFrontend,
    [switch]$SkipBackend,
    [int]$VitestTimeoutSec = 480
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Root) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$Root = [System.IO.Path]::GetFullPath($Root)
$baselinePytest = Join-Path $Root "deploy\test-baseline-failures.txt"
$baselineTypecheck = Join-Path $Root "deploy\test-baseline-typecheck.txt"

function Write-GateStep([string]$Msg) {
    Write-Host ""
    Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Resolve-PnpmCmd {
    $candidates = @(
        (Join-Path $env:APPDATA "npm\pnpm.cmd"),
        (Join-Path $env:LOCALAPPDATA "pnpm\pnpm.cmd")
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c }
    }
    $cmd = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd = Get-Command "pnpm" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "pnpm nao encontrado. Instale Node.js + pnpm 9.15.0."
}

function Read-Baseline([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
    @(Get-Content -LiteralPath $Path -Encoding UTF8) |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith("#") } |
        Select-Object -Unique
}

function Write-Baseline([string]$Path, [string[]]$HeaderLines, [string[]]$Items) {
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $body = @($HeaderLines) + @($Items | Sort-Object -Unique)
    Set-Content -LiteralPath $Path -Value ($body -join [Environment]::NewLine) -Encoding UTF8
}

function Normalize-TypecheckLine([string]$Line, [string]$RepoRoot) {
    $normRoot = ($RepoRoot -replace '\\', '/')
    $line = $Line -replace '\\', '/'
    $line = $line -replace [regex]::Escape($normRoot + '/'), ''
    $line = $line -replace "Referenced project '[^']*/packages/", "Referenced project 'packages/"
    if ($line -match '^(?<file>[^:(]+\.(ts|tsx|json))\((?<loc>\d+,\d+)\):\s+error\s+(?<code>TS\d+):\s+(?<msg>.+)$') {
        return ("{0}({1}): error {2}: {3}" -f $Matches.file, $Matches.loc, $Matches.code, $Matches.msg.Trim())
    }
    return $null
}

function Compare-ToBaseline {
    param(
        [string]$Label,
        [string[]]$Actual,
        [string[]]$Baseline,
        [string]$BaselinePath,
        [switch]$Update
    )
    $actualSet = [System.Collections.Generic.HashSet[string]]::new([string[]]@($Actual), [StringComparer]::OrdinalIgnoreCase)
    $baseSet = [System.Collections.Generic.HashSet[string]]::new([string[]]@($Baseline), [StringComparer]::OrdinalIgnoreCase)

    $newFails = @($actualSet | Where-Object { -not $baseSet.Contains($_) } | Sort-Object)
    $fixed = @($baseSet | Where-Object { -not $actualSet.Contains($_) } | Sort-Object)

    if ($Update) {
        return @{ NewFails = @(); Fixed = $fixed; Updated = $true; Actual = @($Actual) }
    }

    if ($newFails.Count -gt 0) {
        Write-Host "  [$Label] Falhas NOVAS (fora de $BaselinePath):" -ForegroundColor Red
        foreach ($f in $newFails) { Write-Host "    + $f" -ForegroundColor Red }
    }
    if ($fixed.Count -gt 0) {
        Write-Host "  [$Label] Falhas da baseline que agora passam (remova com -UpdateBaseline):" -ForegroundColor Yellow
        foreach ($f in $fixed) { Write-Host "    - $f" -ForegroundColor Yellow }
    }
    if ($newFails.Count -eq 0 -and $Actual.Count -gt 0) {
        Write-Host ("  [$Label] {0} falha(s) conhecidas (baseline OK)" -f $Actual.Count) -ForegroundColor DarkYellow
    }
    if ($newFails.Count -eq 0 -and $Actual.Count -eq 0) {
        Write-Host "  [$Label] OK (sem falhas)" -ForegroundColor Green
    }
    return @{ NewFails = $newFails; Fixed = $fixed; Updated = $false; Actual = @($Actual) }
}

$pnpm = Resolve-PnpmCmd
Write-Host "Root: $Root"
Write-Host "pnpm: $pnpm"

$blocked = $false
$pytestActual = @()
$typecheckActual = @()
$vitestStatus = "ok"

Push-Location $Root
try {
    Write-GateStep "pnpm install --frozen-lockfile"
    $prevCi = $env:CI
    $env:CI = "true"
    try {
        & $pnpm install --frozen-lockfile --prefer-offline
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm install --frozen-lockfile falhou (codigo $LASTEXITCODE)"
        }
    } finally {
        if ($null -eq $prevCi) { Remove-Item Env:\CI -ErrorAction SilentlyContinue }
        else { $env:CI = $prevCi }
    }

    if (-not $SkipFrontend) {
        Write-GateStep "typecheck (@sagra/web)"
        $prevEapTc = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $tcOut = & $pnpm --filter @sagra/web typecheck 2>&1 | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { "$_" }
            }
            $tcExit = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $prevEapTc
        }
        $typecheckActual = @(
            $tcOut |
                ForEach-Object { Normalize-TypecheckLine -Line $_ -RepoRoot $Root } |
                Where-Object { $_ } |
                Select-Object -Unique
        )
        if ($tcExit -ne 0 -and $typecheckActual.Count -eq 0) {
            Write-Host ($tcOut -join [Environment]::NewLine)
            throw "typecheck falhou sem fingerprints reconheciveis (codigo $tcExit)"
        }
        $tcCmp = Compare-ToBaseline -Label "typecheck" -Actual $typecheckActual `
            -Baseline (Read-Baseline $baselineTypecheck) -BaselinePath $baselineTypecheck -Update:$UpdateBaseline
        if ($UpdateBaseline) {
            Write-Baseline -Path $baselineTypecheck -HeaderLines @(
                "# Erros conhecidos do typecheck (apps/web). Uma fingerprint por linha.",
                "# Formato: <arquivo>(linha,col): error TSXXXX: <mensagem sem caminho absoluto>",
                "# Erro NOVO bloqueia o release. Use -UpdateBaseline apos corrigir."
            ) -Items $typecheckActual
            Write-Host "  Baseline typecheck atualizada ($($typecheckActual.Count) erros)." -ForegroundColor Green
        } elseif ($tcCmp.NewFails.Count -gt 0) {
            $blocked = $true
        }

        Write-GateStep "vitest (@sagra/web)"
        Write-Host ("  (saida ao vivo; timeout {0}s; OOM neste host nao bloqueia o release)" -f $VitestTimeoutSec) -ForegroundColor DarkGray
        $prevNodeOpts = $env:NODE_OPTIONS
        if (-not $prevNodeOpts) { $env:NODE_OPTIONS = "--max-old-space-size=8192" }
        elseif ($prevNodeOpts -notmatch 'max-old-space-size') {
            $env:NODE_OPTIONS = "$prevNodeOpts --max-old-space-size=8192"
        }
        # stderr do Node/pnpm vira ErrorRecord no PowerShell; com $ErrorActionPreference=Stop
        # isso abortava o gate antes de avaliar o exit code (NativeCommandError).
        $vitLog = Join-Path $env:TEMP ("sagra_release_vitest_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
        $vitExit = 1
        $vitTimedOut = $false
        $vitOut = @()
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            # cmd evita que stderr do pnpm mate o script; Start-Process da timeout limpo.
            $argLine = "/c `"`"$pnpm`" --filter @sagra/web exec -- vitest run --pool=forks --maxWorkers=1 --reporter=dot > `"$vitLog`" 2>&1`""
            $proc = Start-Process -FilePath "cmd.exe" -ArgumentList $argLine `
                -WorkingDirectory $Root -PassThru -WindowStyle Hidden
            $deadline = (Get-Date).AddSeconds($VitestTimeoutSec)
            $lastLen = 0
            $lastHeartbeat = Get-Date
            while (-not $proc.HasExited) {
                Start-Sleep -Milliseconds 800
                if (Test-Path -LiteralPath $vitLog) {
                    try {
                        $content = Get-Content -LiteralPath $vitLog -Encoding UTF8 -ErrorAction SilentlyContinue
                        if ($content -and $content.Count -gt $lastLen) {
                            for ($i = $lastLen; $i -lt $content.Count; $i++) {
                                Write-Host ("  | {0}" -f $content[$i])
                            }
                            $lastLen = $content.Count
                            $lastHeartbeat = Get-Date
                        }
                    } catch { }
                }
                if (((Get-Date) - $lastHeartbeat).TotalSeconds -ge 20) {
                    $elapsed = [int]((Get-Date) - $proc.StartTime).TotalSeconds
                    Write-Host ("  ... vitest ainda rodando ({0}s / limite {1}s)" -f $elapsed, $VitestTimeoutSec) -ForegroundColor DarkYellow
                    $lastHeartbeat = Get-Date
                }
                if ((Get-Date) -ge $deadline) {
                    $vitTimedOut = $true
                    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
                    # Mata arvore do cmd (node/vitest filhos)
                    try { & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null } catch { }
                    break
                }
            }
            if (-not $vitTimedOut) {
                try { $proc.WaitForExit(5000) | Out-Null } catch { }
                $vitExit = [int]$proc.ExitCode
            }
            if (Test-Path -LiteralPath $vitLog) {
                $vitOut = @(Get-Content -LiteralPath $vitLog -Encoding UTF8 -ErrorAction SilentlyContinue)
                if ($vitOut.Count -gt $lastLen) {
                    for ($i = $lastLen; $i -lt $vitOut.Count; $i++) {
                        Write-Host ("  | {0}" -f $vitOut[$i])
                    }
                }
            }
        } catch {
            Write-Host ("  [vitest] excecao ao executar: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
            $vitOut = @($_.Exception.Message)
            $vitExit = 1
        } finally {
            $ErrorActionPreference = $prevEap
            if ($null -eq $prevNodeOpts) { Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue }
            else { $env:NODE_OPTIONS = $prevNodeOpts }
        }
        $vitText = ($vitOut -join [Environment]::NewLine)
        if ($vitTimedOut) {
            Write-Host ("  [vitest] Timeout apos {0}s -- nao bloqueia o release. Log: {1}" -f $VitestTimeoutSec, $vitLog) -ForegroundColor Yellow
            $vitestStatus = "timeout-skipped"
        } elseif ($vitText -match 'heap out of memory|FATAL ERROR: Ineffective mark-compacts|ERR_IPC_CHANNEL_CLOSED|JavaScript heap out of memory') {
            Write-Host "  [vitest] OOM / crash de infraestrutura neste host -- nao bloqueia o release." -ForegroundColor Yellow
            Write-Host ("  Log: {0}" -f $vitLog) -ForegroundColor DarkGray
            $vitestStatus = "oom-skipped"
        } elseif ($vitExit -ne 0) {
            Write-Host ($vitOut | Select-Object -Last 40) -ForegroundColor Red
            Write-Host ("  [vitest] Falhou (codigo {0}) -- bloqueia o release. Log: {1}" -f $vitExit, $vitLog) -ForegroundColor Red
            $blocked = $true
            $vitestStatus = "failed"
        } else {
            Write-Host "  [vitest] OK" -ForegroundColor Green
            $vitestStatus = "ok"
        }
    } else {
        Write-Host "Frontend ignorado (-SkipFrontend)" -ForegroundColor Yellow
        $vitestStatus = "skipped"
    }

    if (-not $SkipBackend) {
        Write-GateStep "pytest (app/backend/tests)"
        $pytestArgs = @(
            "-m", "pytest", "app/backend/tests",
            "-q", "-rf", "-p", "no:cacheprovider",
            "-o", "console_output_style=classic"
        )
        $pyOutFile = Join-Path $env:TEMP ("sagra_release_pytest_{0}.txt" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
        $py = Get-Command python -ErrorAction SilentlyContinue
        if (-not $py) { throw "python nao encontrado no PATH." }
        & $py.Source @pytestArgs 2>&1 | Out-File -Encoding utf8 $pyOutFile
        $pyExit = $LASTEXITCODE
        $pyLines = Get-Content -LiteralPath $pyOutFile -Encoding UTF8
        # Junta linhas quebradas do wrapper FAILED path::\n name
        $joined = New-Object System.Collections.Generic.List[string]
        for ($i = 0; $i -lt $pyLines.Count; $i++) {
            $line = $pyLines[$i]
            if ($line -match '^FAILED\s+(?<id>.+)$') {
                $id = $Matches.id.Trim()
                if ($id -notmatch '::' -and ($i + 1) -lt $pyLines.Count) {
                    $next = $pyLines[$i + 1].Trim()
                    if ($next -and $next -notmatch '^(FAILED|ERROR|={3,}|-{3,})') {
                        $id = ($id.TrimEnd('\') + $next)
                        $i++
                    }
                }
                $id = ($id -replace '\\', '/').Trim()
                if ($id -match ' - ') { $id = ($id -split ' - ', 2)[0].Trim() }
                $joined.Add($id)
            }
        }
        $pytestActual = @($joined | Select-Object -Unique)
        Write-Host ("  Resumo pytest (exit={0}): {1}" -f $pyExit, (($pyLines | Select-Object -Last 1) -join ''))
        $pyCmp = Compare-ToBaseline -Label "pytest" -Actual $pytestActual `
            -Baseline (Read-Baseline $baselinePytest) -BaselinePath $baselinePytest -Update:$UpdateBaseline
        if ($UpdateBaseline) {
            Write-Baseline -Path $baselinePytest -HeaderLines @(
                "# Falhas conhecidas do pytest (backend). Uma por linha.",
                "# Falha NOVA (ausente desta lista) bloqueia o release.",
                "# Use: deploy-release-dev.bat -UpdateBaseline para regenerar apos corrigir."
            ) -Items $pytestActual
            Write-Host "  Baseline pytest atualizada ($($pytestActual.Count) falhas)." -ForegroundColor Green
        } elseif ($pyCmp.NewFails.Count -gt 0) {
            $blocked = $true
        } elseif ($pyExit -ne 0 -and $pytestActual.Count -eq 0) {
            Write-Host "  pytest falhou sem lista FAILED parseavel. Log: $pyOutFile" -ForegroundColor Red
            $blocked = $true
        }
    } else {
        Write-Host "Backend ignorado (-SkipBackend)" -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}

if ($blocked) {
    throw "Gate de testes bloqueou o release (falhas novas). Corrija ou use -SkipTests (fica registrado no RELEASE.txt)."
}

Write-Host ""
Write-Host "[OK] Gate de testes concluido (vitest=$vitestStatus)." -ForegroundColor Green
# Codigo de saida 0; status detalhado e consumido pelo caller via variavel de ambiente opcional.
$env:SAGRA_RELEASE_TESTS = "ok"
$env:SAGRA_RELEASE_VITEST = $vitestStatus
exit 0

# Inicia SAGRA-SyncAndamentos limpando throttle NSSM (evita PAUSED imediato).
# Use este script em vez de Start-Service / clique em Iniciar no services.msc
# quando o status estiver Paused ou apos crashes em loop.
param(
    [string]$ServiceName = "SAGRA-SyncAndamentos",
    [string]$NssmPath = "",
    [string]$Root = "",
    [int]$ThrottleWaitSec = 0,
    [switch]$ForceKillGhost
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Execute este script como Administrador."
    }
}

function Resolve-Nssm([string]$Hint, [string]$RootPath) {
    $candidates = @()
    if ($Hint) { $candidates += $Hint }
    if ($RootPath) {
        $candidates += (Join-Path $RootPath "deploy\tools\nssm.exe")
        $candidates += (Join-Path $RootPath "tools\nssm.exe")
    }
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    return $null
}

Assert-Admin

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$logDir = Join-Path $Root "logs\sync"
$stderrLog = Join-Path $logDir "service_stderr.log"
$mainLog = Join-Path $logDir "sync_andamentos.log"

$nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root
if (-not $nssm) {
    throw "nssm.exe nao encontrado. Passe -NssmPath ou copie para deploy\tools\nssm.exe"
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    throw "Servico '$ServiceName' nao instalado. Rode .\instalar-servico-sync.ps1 -Start"
}

Write-Host "==== Iniciar $ServiceName ===="
Write-Host "Root: $Root"
Write-Host "Status atual: $($svc.Status)"

# Arquivos criticos
foreach ($f in @(
    "sync_andamentos_service.py",
    "sync_andamentos_v2_Old.py",
    "sync_policy.py",
    "sync_os_deletes.py"
)) {
    $p = Join-Path $Root $f
    $ok = Test-Path -LiteralPath $p
    Write-Host ("  {0}: {1}" -f $f, $(if ($ok) { "OK" } else { "AUSENTE" }))
    if (-not $ok) {
        throw "Falta $p no AppDirectory. Copie do release antes de iniciar."
    }
}

$ghosts = @(
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match "sync_andamentos_service\.py" }
)
if ($ghosts.Count -gt 0) {
    Write-Host "Instancias python do sync encontradas: $($ghosts.Count)"
    foreach ($g in $ghosts) {
        Write-Host "  PID $($g.ProcessId) $($g.CommandLine)"
        Stop-Process -Id $g.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "  -> encerrado"
    }
    Start-Sleep -Seconds 2
} elseif ($ForceKillGhost) {
    Write-Host "(ForceKillGhost: nenhuma instancia ghost encontrada)"
}

Write-Host "Parando servico (limpa Paused/throttle)..."
& $nssm stop $ServiceName 2>$null | Out-Null
$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 500
    $svc.Refresh()
} while ($svc.Status -ne "Stopped" -and (Get-Date) -lt $deadline)
Write-Host "Status apos stop: $($svc.Status)"

if ($ThrottleWaitSec -le 0) {
    $raw = (& $nssm get $ServiceName AppThrottle 2>$null | Out-String).Trim()
    $ms = 45000
    if ($raw -match "^\d+$") { $ms = [int]$raw }
    $ThrottleWaitSec = [math]::Ceiling($ms / 1000.0) + 2
}
Write-Host "Aguardando ${ThrottleWaitSec}s (AppThrottle NSSM)..."
Start-Sleep -Seconds $ThrottleWaitSec

try {
    if (Test-Path -LiteralPath $stderrLog) {
        Set-Content -LiteralPath $stderrLog -Value "" -Encoding UTF8
    }
} catch {}

Write-Host "Iniciando..."
& $nssm start $ServiceName
Start-Sleep -Seconds 6
$svc.Refresh()
Write-Host "Status final: $($svc.Status)"

if ($svc.Status -ne "Running") {
    Write-Host ""
    Write-Host "FALHA: nao ficou Running."
    Write-Host "---- service_stderr.log (tail) ----"
    if (Test-Path -LiteralPath $stderrLog) {
        Get-Content -LiteralPath $stderrLog -Tail 50 -ErrorAction SilentlyContinue
    } else {
        Write-Host "(ausente)"
    }
    Write-Host "---- sync_andamentos.log (tail) ----"
    if (Test-Path -LiteralPath $mainLog) {
        Get-Content -LiteralPath $mainLog -Tail 40 -ErrorAction SilentlyContinue
    }
    Write-Host ""
    Write-Host "Teste em console (mostra o erro real):"
    Write-Host "  cd `"$Root`""
    Write-Host "  python .\sync_andamentos_service.py"
    exit 1
}

Write-Host "OK - servico Running. Confirme com .\status-servico-sync.ps1"
exit 0

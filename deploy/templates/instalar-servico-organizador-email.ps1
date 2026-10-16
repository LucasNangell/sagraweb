# Instala/atualiza o servico Windows SAGRA-OrganizadorEmailSepim via NSSM.
# Move (nunca apaga) mensagens da caixa sepim.deapa para as subpastas
# Entrada/Saida de Provas e Prob. Tec. conforme o assunto.
# Requer elevacao (Administrador). Idempotente.
param(
    [string]$Root = "",
    [string]$NssmPath = "",
    [string]$PythonExe = "",
    [string]$ServiceName = "SAGRA-OrganizadorEmailSepim",
    [string]$DisplayName = "SAGRA Organizador E-mail SEPIM",
    [string]$Mailbox = "sepim.deapa@camara.leg.br",
    [int]$IntervalSec = 60,
    [switch]$Start,
    [switch]$InstallDeps,
    [switch]$ManualStart
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
    $candidates += (Join-Path $RootPath "deploy\tools\nssm.exe")
    $candidates += (Join-Path $RootPath "tools\nssm.exe")
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    throw "nssm.exe nao encontrado. Copie para deploy\tools\nssm.exe ou passe -NssmPath."
}

function Resolve-Python([string]$Hint) {
    if ($Hint -and (Test-Path -LiteralPath $Hint)) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "python.exe nao encontrado. Passe -PythonExe ou adicione ao PATH."
}

function Test-PythonModuleSystem([string]$PythonExe, [string]$ModuleName) {
    $prev = $env:PYTHONNOUSERSITE
    $env:PYTHONNOUSERSITE = "1"
    try {
        & $PythonExe -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('$ModuleName') else 1)" 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        if ($null -eq $prev) { Remove-Item Env:\PYTHONNOUSERSITE -ErrorAction SilentlyContinue }
        else { $env:PYTHONNOUSERSITE = $prev }
    }
}

function Ensure-EwsPythonDeps([string]$PythonExe, [string]$RootPath, [switch]$InstallDeps) {
    $needed = @(
        [pscustomobject]@{ Module = "requests"; Package = "requests" },
        [pscustomobject]@{ Module = "requests_negotiate_sspi"; Package = "requests-negotiate-sspi" },
        [pscustomobject]@{ Module = "lxml"; Package = "lxml" }
    )
    $missing = @()
    foreach ($item in $needed) {
        if (-not (Test-PythonModuleSystem -PythonExe $PythonExe -ModuleName $item.Module)) {
            $missing += $item
        } else {
            Write-Host "OK: $($item.Module)"
        }
    }
    if ($missing.Count -eq 0) { return }
    $pkgList = @($missing | ForEach-Object { $_.Package }) | Select-Object -Unique
    if (-not $InstallDeps) {
        throw "Python do SISTEMA nao tem: $($pkgList -join ', '). Rode com -InstallDeps."
    }
    $env:PIP_USER = "0"
    $env:PYTHONNOUSERSITE = "1"
    $wheels = Join-Path $RootPath "wheels"
    if (Test-Path -LiteralPath $wheels) {
        & $PythonExe -m pip install --upgrade --no-user --no-index --find-links=$wheels @pkgList
        if ($LASTEXITCODE -ne 0) {
            & $PythonExe -m pip install --upgrade --no-user @pkgList
        }
    } else {
        & $PythonExe -m pip install --upgrade --no-user @pkgList
    }
    if ($LASTEXITCODE -ne 0) { throw "pip install falhou (exit=$LASTEXITCODE)" }
}

Assert-Admin

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)

$scriptName = "organizador_email_sepim_service.py"
$scriptPy = Join-Path $Root $scriptName
if (-not (Test-Path -LiteralPath $scriptPy)) {
    throw "Arquivo nao encontrado: $scriptPy"
}

$nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root
$python = Resolve-Python -Hint $PythonExe
Ensure-EwsPythonDeps -PythonExe $python -RootPath $Root -InstallDeps:$InstallDeps

$logsDir = Join-Path $Root "logs\email_organizer"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$stdoutLog = Join-Path $logsDir "organizador_service_stdout.log"
$stderrLog = Join-Path $logsDir "organizador_service_stderr.log"

$backend = Join-Path $Root "app\backend"
$pythonPath = $backend
$pythonPkgs = Join-Path $Root "python_pkgs"
if (Test-Path -LiteralPath $pythonPkgs) {
    $pythonPath = "$pythonPkgs;$pythonPath"
}

Write-Host "Root:         $Root"
Write-Host "NSSM:         $nssm"
Write-Host "Python:       $python"
Write-Host "Script:       $scriptPy"
Write-Host "ServiceName:  $ServiceName"
Write-Host "Caixa:        $Mailbox"
Write-Host "Logs:         $logsDir"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Servico ja existe - atualizando configuracao NSSM..."
    if ($existing.Status -in @("Running", "Paused", "StartPending", "StopPending")) {
        & $nssm stop $ServiceName
        $deadline = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 500
            $existing.Refresh()
        } while ($existing.Status -ne "Stopped" -and (Get-Date) -lt $deadline)
    }
} else {
    Write-Host "Instalando servico..."
    & $nssm install $ServiceName $python
    if ($LASTEXITCODE -ne 0) {
        throw "nssm install falhou (exit=$LASTEXITCODE)"
    }
}

& $nssm set $ServiceName Application $python
& $nssm set $ServiceName AppParameters $scriptName
& $nssm set $ServiceName AppDirectory $Root
& $nssm set $ServiceName DisplayName $DisplayName
& $nssm set $ServiceName Description "Move (nunca apaga) e-mails de $Mailbox para Entrada/Saida de Provas e Prob. Tec. conforme o assunto. Log em logs\email_organizer."
$nssmStart = if ($ManualStart) { "SERVICE_DEMAND_START" } else { "SERVICE_AUTO_START" }
& $nssm set $ServiceName Start $nssmStart
Write-Host "StartType NSSM: $nssmStart"
& $nssm set $ServiceName AppStdout $stdoutLog
& $nssm set $ServiceName AppStderr $stderrLog
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 10485760
& $nssm set $ServiceName AppExit Default Restart
& $nssm set $ServiceName AppRestartDelay 5000
& $nssm set $ServiceName AppThrottle 20000
& $nssm set $ServiceName AppStopMethodConsole 5000
& $nssm set $ServiceName AppStopMethodSkip 0

$envExtra = @(
    "PYTHONPATH=$pythonPath",
    "ENV=production",
    "PYTHONUTF8=1",
    "PYTHONUNBUFFERED=1",
    "PYTHONNOUSERSITE=1",
    "EMAIL_ORG_MAILBOX=$Mailbox",
    "EMAIL_ORG_INTERVAL_SEC=$IntervalSec"
)
& $nssm set $ServiceName AppEnvironmentExtra @envExtra

& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null

$cim = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
$startName = if ($cim) { $cim.StartName } else { "" }
Write-Host "Conta de logon atual: $startName"
if (-not $startName -or $startName -eq "LocalSystem" -or $startName -eq "NT AUTHORITY\SYSTEM") {
    Write-Host ""
    Write-Host "IMPORTANTE: o EWS autentica com a conta Windows do servico (SSPI)."
    Write-Host "Configure uma conta com Acesso Total a caixa $Mailbox (ex.: REDECAMARA\usr_sefoc):"
    Write-Host "  nssm edit $ServiceName   (aba Log on)"
    Write-Host "Alternativa: definir EWS_USERNAME / EWS_PASSWORD em config\.env (requer requests-ntlm)."
    Write-Host ""
}

try {
    if (Test-Path -LiteralPath $stderrLog) {
        Set-Content -LiteralPath $stderrLog -Value "" -Encoding UTF8
    }
} catch {}

Write-Host "Configuracao aplicada."

if ($Start) {
    Write-Host "Iniciando servico..."
    & $nssm start $ServiceName
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $ServiceName
    Write-Host "Status: $($svc.Status)"
    if ($svc.Status -ne "Running") {
        Write-Host "AVISO: status=$($svc.Status). Veja $stderrLog"
        if (Test-Path -LiteralPath $stderrLog) {
            Get-Content -LiteralPath $stderrLog -Tail 30 -ErrorAction SilentlyContinue
        }
    }
} else {
    $hint = if ($ManualStart) {
        "Servico instalado (Start=Manual). Para iniciar: nssm start $ServiceName ou -Start"
    } else {
        "Servico instalado (Start=Automatic). Sobe com o Windows. Para iniciar agora: -Start"
    }
    Write-Host $hint
}

Write-Host "Movimentos: $logsDir\movimentos_AAAA-MM.log"
Write-Host "Pronto."
exit 0

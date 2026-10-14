# Instala/atualiza o watchdog de disponibilidade como servico Windows (NSSM).
# Requer Administrador. O servico monitora API + SAGRA-SyncAndamentos.
param(
    [string]$Root = "",
    [string]$CurrentRoot = "",
    [string]$NssmPath = "",
    [string]$PythonExe = "",
    [string]$ApiServiceName = "",
    [string]$ServiceName = "SAGRA-SystemWatchdog",
    [string]$SyncServiceName = "SAGRA-SyncAndamentos",
    # Mesma conta do SAGRA-SyncAndamentos (ex.: REDECAMARA\usr_sefoc): a API
    # relancada herda esta conta e precisa acessar os MDBs no DFS.
    [pscredential]$ServiceCredential,
    [switch]$Start
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

function Resolve-Nssm([string]$Hint, [string]$RootPath, [string]$RuntimeRoot, [string]$HostedServiceName) {
    $candidates = @()
    if ($Hint) { $candidates += $Hint }
    $candidates += (Join-Path $RuntimeRoot "deploy\tools\nssm.exe")
    $candidates += (Join-Path $RuntimeRoot "tools\nssm.exe")
    $candidates += (Join-Path $RootPath "deploy\tools\nssm.exe")
    $candidates += (Join-Path $RootPath "tools\nssm.exe")
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    # O servico do sync ja roda sob NSSM: o executavel dele e o nssm em uso.
    $hosted = Get-CimInstance Win32_Service -Filter "Name='$HostedServiceName'" -ErrorAction SilentlyContinue
    if ($hosted -and $hosted.PathName) {
        $binary = ([string]$hosted.PathName).Trim()
        if ($binary.StartsWith('"')) { $binary = $binary.Substring(1, $binary.IndexOf('"', 1) - 1) }
        else { $binary = ($binary -split '\s+')[0] }
        if ((Split-Path $binary -Leaf) -ieq "nssm.exe") { $candidates += $binary }
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "nssm.exe nao encontrado. Copie para deploy\tools\nssm.exe ou passe -NssmPath."
}

function Set-ServiceLogon([string]$Exe, [string]$Name, [pscredential]$Credential) {
    $user = $Credential.UserName
    $password = $Credential.GetNetworkCredential().Password
    # Saida e argumentos nao vao para a excecao: contem a senha.
    $ErrorActionPreference = "Continue"
    $null = & $Exe set $Name ObjectName $user $password 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "nssm set ObjectName falhou para $user (exit=$LASTEXITCODE). Confira usuario/senha e o direito 'Logon as a service'."
    }
}

function Resolve-Python([string]$Hint) {
    if ($Hint -and (Test-Path -LiteralPath $Hint -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        $source = [System.IO.Path]::GetFullPath($cmd.Source)
        foreach ($unsafeRoot in @($env:USERPROFILE, $env:LOCALAPPDATA, $env:TEMP)) {
            if ($unsafeRoot -and $source.StartsWith([System.IO.Path]::GetFullPath($unsafeRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Python do PATH esta em perfil de usuario ($source). Passe -PythonExe explicitamente ou use instalacao system-wide."
            }
        }
        return $source
    }
    throw "python.exe system-wide nao encontrado. Passe -PythonExe explicitamente."
}

function Invoke-Nssm([string]$Exe, [string[]]$Arguments, [string]$TolerateOutput = "") {
    # Com Stop, o PowerShell 5.1 converte qualquer stderr do nssm em erro fatal antes do exit code.
    $ErrorActionPreference = "Continue"
    $output = (& $Exe @Arguments 2>&1 | Out-String) -replace "\x00", ""
    if ($LASTEXITCODE -ne 0 -and -not ($TolerateOutput -and ($output -replace "\s", "") -match $TolerateOutput)) {
        throw "nssm $($Arguments -join ' ') falhou (exit=$LASTEXITCODE): $output"
    }
    return $output
}

function Wait-WatchdogReady([string]$StatusPath, [datetime]$StartedAfter, [int]$TimeoutSec = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        if (Test-Path -LiteralPath $StatusPath -PathType Leaf) {
            try {
                $item = Get-Item -LiteralPath $StatusPath
                $status = Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $checked = [datetime]::Parse([string]$status.checked_at).ToUniversalTime()
                if ($item.LastWriteTimeUtc -ge $StartedAfter.AddSeconds(-2) -and $checked -ge $StartedAfter.AddSeconds(-2)) {
                    return $true
                }
            } catch {}
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Assert-ServiceName([string]$Value, [string]$Label, [switch]$AllowEmpty) {
    if ($AllowEmpty -and [string]::IsNullOrWhiteSpace($Value)) { return }
    if ($Value -notmatch '^[A-Za-z0-9_.-]{1,128}$') {
        throw "$Label invalido."
    }
}

function Assert-NoBroadWriteAcl([string]$Path, [string]$Label) {
    $dangerousSids = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545")
    # Use only atomic permissions here. FullControl, Modify and Write are composite
    # enum values, so testing a rule against them with -band also matches shared
    # non-write bits such as Synchronize.
    $writeMask = [Security.AccessControl.FileSystemRights]::WriteData `
        -bor [Security.AccessControl.FileSystemRights]::AppendData `
        -bor [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes `
        -bor [Security.AccessControl.FileSystemRights]::WriteAttributes `
        -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles `
        -bor [Security.AccessControl.FileSystemRights]::Delete `
        -bor [Security.AccessControl.FileSystemRights]::ChangePermissions `
        -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    # Get-Acl de um junction devolve a ACL do proprio link, que cada deploy recria
    # herdando da raiz; quem decide se da para plantar arquivos e a pasta real.
    $parent = Split-Path $Path -Parent
    $parentItem = Get-Item -LiteralPath $parent -Force -ErrorAction Stop
    if ($parentItem.LinkType -in @("Junction", "SymbolicLink") -and $parentItem.Target) {
        $parent = @($parentItem.Target)[0]
    }
    foreach ($target in @($Path, $parent)) {
        $acl = Get-Acl -LiteralPath $target -ErrorAction Stop
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
            try { $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { continue }
            if ($sid -in $dangerousSids -and (($rule.FileSystemRights -band $writeMask) -ne 0)) {
                throw ("$Label recusado: '$target' permite escrita ampla para $sid ($($rule.FileSystemRights)). " +
                    "Restrinja a pasta (secao 'Permissoes' do RUNBOOK_WATCHDOG_SISTEMA.md).")
            }
        }
    }
}

function Protect-ControlDirectory([string]$Path, [string]$ServiceAccount) {
    $grants = @("*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
    if ($ServiceAccount -and $ServiceAccount -notin @("LocalSystem", "NT AUTHORITY\SYSTEM")) {
        $grants += "${ServiceAccount}:(OI)(CI)M"
    }
    & "$env:SystemRoot\System32\icacls.exe" $Path /inheritance:r /grant:r @grants /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao proteger diretorio de controle: $Path" }
}

Assert-Admin
Assert-ServiceName -Value $ServiceName -Label "ServiceName"
Assert-ServiceName -Value $ApiServiceName -Label "ApiServiceName" -AllowEmpty
Assert-ServiceName -Value $SyncServiceName -Label "SyncServiceName"
if ($ServiceCredential -and $ServiceCredential.UserName -like "System.Management.Automation.PSCredential*") {
    throw ("-ServiceCredential chegou como texto (chamada via 'powershell -File'). " +
        "Rode na sessao atual: & .\instalar-servico-watchdog-sistema.ps1 ... -ServiceCredential (Get-Credential 'DOMINIO\conta')")
}

if (-not $Root) {
    $scriptParent = Split-Path $PSScriptRoot -Parent
    $Root = if ((Split-Path $PSScriptRoot -Leaf) -ieq "current") {
        Split-Path $PSScriptRoot -Parent
    } elseif ((Split-Path $scriptParent -Leaf) -ieq "releases") {
        Split-Path $scriptParent -Parent
    } else {
        $PSScriptRoot
    }
}
$Root = [System.IO.Path]::GetFullPath($Root)
if (-not $CurrentRoot) {
    $candidate = Join-Path $Root "current"
    $CurrentRoot = if (Test-Path -LiteralPath $candidate -PathType Container) {
        $candidate
    } else {
        $PSScriptRoot
    }
}
$CurrentRoot = [System.IO.Path]::GetFullPath($CurrentRoot)
$productionCurrent = [System.IO.Path]::GetFullPath((Join-Path $Root "current"))
if (Test-Path -LiteralPath (Join-Path $Root "releases") -PathType Container) {
    if (-not (Test-Path -LiteralPath $productionCurrent -PathType Container)) {
        throw "Layout de producao sem junction current: $productionCurrent"
    }
    if (-not $CurrentRoot.Equals($productionCurrent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "CurrentRoot deve ser o junction de producao $productionCurrent (nao fixe o servico em uma release)."
    }
}

$scriptName = "system_watchdog_service.py"
$scriptPath = Join-Path $CurrentRoot $scriptName
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "Arquivo nao encontrado: $scriptPath"
}
$launcher = Join-Path $CurrentRoot "iniciar-api-detached.ps1"
if (-not $ApiServiceName -and -not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Launcher da API nao encontrado: $launcher. Passe -ApiServiceName se a API for um servico."
}

$nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root -RuntimeRoot $CurrentRoot -HostedServiceName $SyncServiceName
$python = Resolve-Python -Hint $PythonExe
Assert-NoBroadWriteAcl -Path $nssm -Label "nssm.exe"
Assert-NoBroadWriteAcl -Path $python -Label "python.exe"
Assert-NoBroadWriteAcl -Path $scriptPath -Label "system_watchdog_service.py"
if (-not $ApiServiceName) { Assert-NoBroadWriteAcl -Path $launcher -Label "iniciar-api-detached.ps1" }
$logDir = Join-Path $Root "shared\logs\system"
$runDir = Join-Path $Root "shared\run"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$statusPath = Join-Path $runDir "system_watchdog_status.json"
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$wasRunning = $existing -and $existing.Status -ne "Stopped"
if (-not $existing) {
    $null = Invoke-Nssm -Exe $nssm -Arguments @("install", $ServiceName, $python)
}

$nssmSettings = @(
    @("Application", $python),
    @("AppParameters", $scriptName),
    @("AppDirectory", $CurrentRoot),
    @("DisplayName", "SAGRA - Watchdog do Sistema"),
    @("Description", "Monitora health da API e heartbeat do SyncAndamentos com limiar, cooldown e circuit breaker."),
    @("Start", "SERVICE_DELAYED_AUTO_START"),
    @("AppStdout", (Join-Path $logDir "service_stdout.log")),
    @("AppStderr", (Join-Path $logDir "service_stderr.log")),
    @("AppRotateFiles", "1"),
    @("AppRotateBytes", "10485760"),
    @("AppExit", "Default", "Restart"),
    @("AppRestartDelay", "10000"),
    @("AppThrottle", "30000"),
    @("AppStopMethodConsole", "8000"),
    @("AppStopMethodSkip", "0")
)
foreach ($setting in $nssmSettings) {
    $null = Invoke-Nssm -Exe $nssm -Arguments (@("set", $ServiceName) + $setting)
}

$envExtra = @(
    "SYSTEM_WATCHDOG_ROOT=$Root",
    "SYSTEM_WATCHDOG_CURRENT_ROOT=$CurrentRoot",
    "SYSTEM_WATCHDOG_LOG_DIR=$logDir",
    "SYSTEM_WATCHDOG_MAINTENANCE_FILE=$(Join-Path $runDir 'system-watchdog.maintenance')",
    "SYSTEM_WATCHDOG_NSSM_PATH=$nssm",
    "SYNC_ANDAMENTOS_SERVICE_NAME=$SyncServiceName",
    "PYTHONUTF8=1",
    "PYTHONUNBUFFERED=1",
    "PYTHONNOUSERSITE=1"
)
if ($ApiServiceName) {
    $envExtra += "SYSTEM_WATCHDOG_API_SERVICE_NAME=$ApiServiceName"
}
$null = Invoke-Nssm -Exe $nssm -Arguments (@("set", $ServiceName, "AppEnvironmentExtra") + $envExtra)

if ($ServiceCredential) {
    Set-ServiceLogon -Exe $nssm -Name $ServiceName -Credential $ServiceCredential
    Write-Host "Conta de logon definida: $($ServiceCredential.UserName)"
}

$serviceCim = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
$watchdogAccount = [string]$serviceCim.StartName
Protect-ControlDirectory -Path $runDir -ServiceAccount $watchdogAccount

$syncCim = Get-CimInstance Win32_Service -Filter "Name='$SyncServiceName'" -ErrorAction SilentlyContinue
$systemAccounts = @("LocalSystem", "NT AUTHORITY\SYSTEM")
if ($syncCim -and $syncCim.StartName -and $syncCim.StartName -notin $systemAccounts -and $watchdogAccount -in $systemAccounts) {
    Write-Warning "$SyncServiceName roda como $($syncCim.StartName), mas o watchdog esta como $watchdogAccount."
    Write-Warning "Uma API relancada pelo watchdog ficaria sem acesso aos MDBs no DFS. Reinstale com:"
    Write-Warning "  -ServiceCredential (Get-Credential '$($syncCim.StartName)')"
}
if ($watchdogAccount -notin $systemAccounts) {
    $grantScript = Join-Path $PSScriptRoot "conceder-controle-servico.ps1"
    if (Test-Path -LiteralPath $grantScript -PathType Leaf) {
        & $grantScript -Account $watchdogAccount -ServiceNames @($SyncServiceName)
    } else {
        Write-Warning "conceder-controle-servico.ps1 ausente: conceda start/stop de $SyncServiceName a $watchdogAccount manualmente."
    }
}

& "$env:SystemRoot\System32\sc.exe" failure $ServiceName reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe failure falhou (exit=$LASTEXITCODE)" }
& "$env:SystemRoot\System32\sc.exe" failureflag $ServiceName 1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "sc.exe failureflag falhou (exit=$LASTEXITCODE)" }

Write-Host "Servico configurado: $ServiceName"
Write-Host "  Root:        $Root"
Write-Host "  Runtime:     $CurrentRoot"
Write-Host "  Python:      $python"
Write-Host "  Logs:        $logDir"
Write-Host "  API control: $(if ($ApiServiceName) { "servico $ApiServiceName" } else { 'iniciar-api-detached.ps1' })"
Write-Host "  NSSM:        $nssm"
Write-Host "  Conta:       $watchdogAccount"
Write-Host ""
Write-Host "Seguranca: a API reiniciada herda a conta deste servico."
Write-Host "Para trocar a conta, reinstale com -ServiceCredential (aplica a ACL de shared\run para a nova conta)."

if ($Start -or $wasRunning) {
    $startedAfter = (Get-Date).ToUniversalTime()
    $verb = if ($wasRunning) { "restart" } else { "start" }
    # nssm so reporta RUNNING apos AppThrottle (30s) e o proprio "nssm start" desiste antes,
    # devolvendo erro com SERVICE_START_PENDING; o criterio real e o WaitForStatus abaixo.
    $null = Invoke-Nssm -Exe $nssm -Arguments @($verb, $ServiceName) -TolerateOutput "START_PENDING"
    $check = Get-Service -Name $ServiceName
    try { $check.WaitForStatus("Running", [TimeSpan]::FromSeconds(90)) } catch { }
    $check.Refresh()
    Write-Host "Status: $($check.Status)"
    if ($check.Status -ne "Running" -or -not (Wait-WatchdogReady -StatusPath $statusPath -StartedAfter $startedAfter)) {
        try { $null = Invoke-Nssm -Exe $nssm -Arguments @("stop", $ServiceName) } catch { }
        throw "Watchdog nao produziu status fresco em 60s; servico parado e watchdog legado preservado."
    }
    $legacyTaskName = "SAGRA-SyncAndamentos-Watchdog"
    $legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
    if ($legacyTask -and $legacyTask.State -ne "Disabled") {
        try {
            Disable-ScheduledTask -TaskName $legacyTaskName -ErrorAction Stop | Out-Null
            Write-Host "Tarefa legado desabilitada para evitar dois controladores: $legacyTaskName"
        } catch {
            try { $null = Invoke-Nssm -Exe $nssm -Arguments @("stop", $ServiceName) } catch { }
            throw "Nao foi possivel desabilitar $legacyTaskName; novo watchdog parado para evitar restart race. $_"
        }
    }
} else {
    Write-Host "Para iniciar agora: nssm start $ServiceName"
    Write-Host "A tarefa SAGRA-SyncAndamentos-Watchdog sera preservada ate uma instalacao com -Start validar o novo monitor."
}
exit 0


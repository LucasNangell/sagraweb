#Requires -Version 5.1
<#
  Funções compartilhadas para deploy por releases (SAGRA Web).
  Usado por deploy_release.ps1, rollback_release.ps1, prepare-shared.ps1, validate-release.ps1.
#>

Set-StrictMode -Version Latest

$script:DeployCommonRoot = if ($PSScriptRoot) {
    (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
} else {
    (Get-Location).Path
}

$script:DefaultProdPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
$script:DefaultNginxConf = "\\cgrafsysvm\nginx\conf\nginx.conf"

function Normalize-DeployPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }

    $p = $Path.Trim()
    $p = $p -replace '^Microsoft\.PowerShell\.Core\\FileSystem::', ''
    $p = $p -replace '^FileSystem::', ''

    # Resolve-Path em UNC as vezes retorna \server\share (1 barra) -- robocopy exige \\
    if ($p -match '^\\[^\\]') {
        $p = '\\' + $p.TrimStart('\')
    }

    if (Test-Path -LiteralPath $p) {
        try {
            return (Get-Item -LiteralPath $p).FullName.TrimEnd('\')
        } catch {
            return $p.TrimEnd('\')
        }
    }

    return $p.TrimEnd('\')
}

function Test-SafeReleaseName {
    param([string]$ReleaseName)
    if ([string]::IsNullOrWhiteSpace($ReleaseName)) { return $false }
    if ($ReleaseName -in @(".", "..")) { return $false }
    return ($ReleaseName -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
}

function Assert-SafeReleaseName {
    param([Parameter(Mandatory = $true)][string]$ReleaseName)
    if (-not (Test-SafeReleaseName -ReleaseName $ReleaseName)) {
        throw "Nome de release invalido: use apenas letras, numeros, ponto, sublinhado e hifen."
    }
}

function Resolve-DeployProdPath {
    param([string]$ProdPath = "")
    if ($ProdPath) {
        return (Normalize-DeployPath $ProdPath)
    }
    $fromScript = Normalize-DeployPath (Join-Path $PSScriptRoot "..\..")
    if (Test-Path -LiteralPath (Join-Path $fromScript "releases")) {
        return $fromScript
    }
    return (Normalize-DeployPath $script:DefaultProdPath)
}

function Resolve-DeployNginxConf {
    param([string]$NginxConfPath = "")
    if ($NginxConfPath -and (Test-Path -LiteralPath $NginxConfPath)) {
        return $NginxConfPath
    }
    foreach ($candidate in @(
        "C:\nginx\conf\nginx.conf",
        $script:DefaultNginxConf
    )) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $NginxConfPath
}

# Pastas mutáveis -- NUNCA sobrescrever em deploy; ficam em shared/
$script:SharedDirNames = @(
    "logs",
    "storage",
    "storage_client_uploads",
    "storage_test",
    "Modelos",
    "recovery_temp",
    "temp",
    "cache",
    "generated",
    "email_images",
    # Cache de prévia rápida TIF (gravação pendente/externa)
    "data"
)

$script:SharedConfigFiles = @(
    ".env",
    "config.json",
    "vapid.json"
)

$script:RobocopyExcludeDirs = @(
    "__pycache__", ".git", "node_modules", ".venv", "venv",
    ".pytest_cache", ".cache", ".vite", "releases", "current", "shared", "deploy"
) + $script:SharedDirNames

$script:RobocopyExcludeFiles = @(
    ".env", "*.log", "Thumbs.db", "desktop.ini"
)

$script:ReleaseIntegrityChecks = @(
    @{ Path = "app\frontend\index.html"; Label = "SPA index.html" },
    @{ Path = "app\frontend\manifest.webmanifest"; Label = "PWA manifest" },
    @{ Path = "app\frontend\manifest-painel-os.webmanifest"; Label = "PWA Painel OS manifest" },
    @{ Path = "app\frontend\sw.js"; Label = "PWA service worker" },
    @{ Path = "app\frontend\icons\painel-os-192.png"; Label = "PWA Painel OS icon 192" },
    @{ Path = "app\frontend\assets"; Label = "SPA assets/" },
    @{ Path = "app\backend\routers\api.py"; Label = "api.py" },
    @{ Path = "iniciar-api.bat"; Label = "iniciar-api.bat" },
    @{ Path = "config\config.example.json"; Label = "config.example.json" }
)

function Get-DeployTimestamp {
    return Get-Date -Format "yyyyMMdd_HHmmss"
}

function Write-DeployStep([string]$Msg) {
    Write-Host ""
    Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Write-DeployOk([string]$Msg) {
    Write-Host "    OK: $Msg" -ForegroundColor Green
}

function Write-DeployWarn([string]$Msg) {
    Write-Host "    AVISO: $Msg" -ForegroundColor Yellow
}

function Write-DeployErr([string]$Msg) {
    Write-Host "    ERRO: $Msg" -ForegroundColor Red
}

function Get-DeployLogPath([string]$ProdPath) {
    return Join-Path $ProdPath "deploy\deploy.log"
}

function Write-DeployLog {
    param(
        [string]$ProdPath,
        [string]$Message,
        [ValidateSet("INFO", "WARN", "ERROR")]
        [string]$Level = "INFO"
    )
    $logFile = Get-DeployLogPath $ProdPath
    $parent = Split-Path $logFile -Parent
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    switch ($Level) {
        "WARN" { Write-DeployWarn $Message }
        "ERROR" { Write-DeployErr $Message }
        default { Write-DeployOk $Message }
    }
}

function Get-SystemWatchdogMaintenancePath {
    param([Parameter(Mandatory = $true)][string]$ProdPath)
    return (Join-Path $ProdPath "shared\run\system-watchdog.maintenance")
}

function Enter-SystemWatchdogMaintenance {
    param(
        [Parameter(Mandatory = $true)][string]$ProdPath,
        [string]$Reason = "deploy"
    )
    $path = Get-SystemWatchdogMaintenancePath -ProdPath $ProdPath
    $parent = Split-Path $path -Parent
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $tmp = "$path.$PID.tmp"
    $payload = [ordered]@{
        owner = "deploy"
        reason = $Reason
        pid = $PID
        created_at = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Compress
    Set-Content -LiteralPath $tmp -Value $payload -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $path -Force
    Write-DeployOk "Watchdog suspenso durante manutencao: $path"
    return $path
}

function Exit-SystemWatchdogMaintenance {
    param([Parameter(Mandatory = $true)][string]$ProdPath)
    $path = Get-SystemWatchdogMaintenancePath -ProdPath $ProdPath
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $path) {
        Write-DeployWarn "Lock do watchdog nao pode ser removido; expira automaticamente em ate 30 min: $path"
    } else {
        Write-DeployOk "Watchdog liberado apos manutencao"
    }
}

function Restart-SagraBackgroundServiceForDeploy {
    # Deve rodar com o lock de manutencao ativo: o SystemWatchdog e o monitor
    # ignoram a janela de parada em vez de disputar o restart.
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$TimeoutSec = 45
    )
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-DeployWarn "$Name nao instalado - nada a reiniciar"
        return $false
    }
    try {
        if ($service.Status -eq "Running") {
            Restart-Service -Name $Name -Force -ErrorAction Stop
        } else {
            $service.Refresh()
            if ($service.Status -eq "Stopped") {
                Start-Service -Name $Name -ErrorAction Stop
            }
        }
        $service.WaitForStatus("Running", [TimeSpan]::FromSeconds($TimeoutSec))
        Write-DeployOk "$Name reiniciado com o codigo da nova release"
        return $true
    } catch {
        Write-DeployWarn "Falha ao reiniciar ${Name}: $_ (o SystemWatchdog assume apos o fim do lock)"
        return $false
    }
}

function Wait-SyncHeartbeatRenewed {
    param(
        [Parameter(Mandatory = $true)][string]$HeartbeatPath,
        [Parameter(Mandatory = $true)][datetime]$StartedAfterUtc,
        [int]$TimeoutSec = 120
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $threshold = $StartedAfterUtc.AddSeconds(-2)
    do {
        if (Test-Path -LiteralPath $HeartbeatPath -PathType Leaf) {
            try {
                $hb = Get-Content -LiteralPath $HeartbeatPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($hb.started_at -and $hb.last_cycle_at) {
                    $startedAt = [datetimeoffset]::Parse([string]$hb.started_at).UtcDateTime
                    $lastCycle = [datetimeoffset]::Parse([string]$hb.last_cycle_at).UtcDateTime
                    if ($startedAt -ge $threshold -and $lastCycle -ge $startedAt) {
                        return $true
                    }
                }
            } catch {}
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Test-DeployPathWritable {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }
    try {
        $probe = Join-Path $Path ".deploy_probe_$([guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -ItemType File -Path $probe -Force | Out-Null
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

function Get-ReleaseLayoutPaths {
    param([string]$ProdPath)
    @{
        Root = $ProdPath
        Releases = Join-Path $ProdPath "releases"
        Current = Join-Path $ProdPath "current"
        Shared = Join-Path $ProdPath "shared"
        Deploy = Join-Path $ProdPath "deploy"
        DeployScripts = Join-Path $ProdPath "deploy\scripts"
        DeployBackups = Join-Path $ProdPath "deploy\backups"
        DeployPackages = Join-Path $ProdPath "deploy\packages"
        CurrentReleaseFile = Join-Path $ProdPath "deploy\current-release.txt"
        PreviousReleaseFile = Join-Path $ProdPath "deploy\previous-release.txt"
    }
}

function Initialize-ReleaseLayout {
    param([string]$ProdPath)
    $layout = Get-ReleaseLayoutPaths $ProdPath
    foreach ($key in @("Releases", "Shared", "DeployScripts", "DeployBackups", "DeployPackages")) {
        $dir = $layout[$key]
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-DeployOk "Criado: $dir"
        } else {
            Write-DeployOk "Ja existe: $dir"
        }
    }
    return $layout
}

function Get-SharedSubPaths {
    param([string]$SharedRoot)
    @{
        Config = Join-Path $SharedRoot "config"
        Logs = Join-Path $SharedRoot "logs"
        Storage = Join-Path $SharedRoot "storage"
        StorageClientUploads = Join-Path $SharedRoot "storage_client_uploads"
        StorageTest = Join-Path $SharedRoot "storage_test"
        Modelos = Join-Path $SharedRoot "Modelos"
        Temp = Join-Path $SharedRoot "temp"
        Cache = Join-Path $SharedRoot "cache"
        Generated = Join-Path $SharedRoot "generated"
        RecoveryTemp = Join-Path $SharedRoot "recovery_temp"
        EmailImages = Join-Path $SharedRoot "email_images"
    }
}

function Initialize-SharedLayout {
    param(
        [string]$ProdPath,
        [switch]$SeedFromLegacyRoot
    )
    $layout = Get-ReleaseLayoutPaths $ProdPath
    $shared = Get-SharedSubPaths $layout.Shared

    foreach ($dir in $shared.Values) {
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-DeployOk "shared criado: $dir"
        }
    }

    foreach ($sub in @("api", "sync")) {
        $logSub = Join-Path $shared.Logs $sub
        if (-not (Test-Path -LiteralPath $logSub)) {
            New-Item -ItemType Directory -Path $logSub -Force | Out-Null
        }
    }

    if ($SeedFromLegacyRoot) {
        $legacyConfig = Join-Path $ProdPath "config"
        foreach ($cfgFile in $script:SharedConfigFiles) {
            $src = Join-Path $legacyConfig $cfgFile
            $dest = Join-Path $shared.Config $cfgFile
            if ((Test-Path -LiteralPath $src) -and -not (Test-Path -LiteralPath $dest)) {
                Copy-Item -LiteralPath $src -Destination $dest -Force
                Write-DeployOk "Copiado para shared (sem sobrescrever existente): config\$cfgFile"
            } elseif (Test-Path -LiteralPath $dest) {
                Write-DeployOk ("shared\config\" + $cfgFile + " ja existe - preservado")
            }
        }

        foreach ($dirName in $script:SharedDirNames) {
            $srcDir = Join-Path $ProdPath $dirName
            $destDir = Join-Path $layout.Shared $dirName
            if (-not (Test-Path -LiteralPath $srcDir)) { continue }
            if (-not (Test-Path -LiteralPath $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            $destFiles = @(Get-ChildItem -LiteralPath $destDir -Recurse -File -Force -ErrorAction SilentlyContinue)
            if ($destFiles.Count -eq 0) {
                if (Merge-MutableDirIntoShared -Source $srcDir -Dest $destDir) {
                    Write-DeployOk "shared\$dirName migrado da raiz legada"
                } else {
                    Write-DeployWarn "shared\$dirName vazio e raiz legada sem arquivos em $dirName"
                }
            } else {
                Write-DeployOk "shared\$dirName ja possui conteudo - preservado"
            }
        }
    }

    return $shared
}

function Test-IsDeployReparsePoint {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $item = Get-Item -LiteralPath $Path -Force
        return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
    } catch {
        return $false
    }
}

function Get-SharedDirTargetMap {
    param([string]$SharedRoot)
    $sub = Get-SharedSubPaths $SharedRoot
    @{
        logs                   = $sub.Logs
        storage                = $sub.Storage
        storage_client_uploads = $sub.StorageClientUploads
        storage_test           = $sub.StorageTest
        Modelos                = $sub.Modelos
        recovery_temp          = $sub.RecoveryTemp
        temp                   = $sub.Temp
        cache                  = $sub.Cache
        generated              = $sub.Generated
        email_images           = $sub.EmailImages
    }
}

function Merge-MutableDirIntoShared {
    param(
        [string]$Source,
        [string]$Dest,
        [switch]$WhatIf
    )
    if (-not (Test-Path -LiteralPath $Source)) { return $false }
    if (Test-IsDeployReparsePoint $Source) { return $false }

    $srcFiles = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue)
    if ($srcFiles.Count -lt 1) { return $false }

    if (-not (Test-Path -LiteralPath $Dest)) {
        if ($WhatIf) {
            Write-DeployOk "WhatIf: criaria $Dest"
        } else {
            New-Item -ItemType Directory -Path $Dest -Force | Out-Null
        }
    }

    $leaf = Split-Path $Source -Leaf
    Write-DeployOk "Preservando dados mutaveis: $leaf -> shared\$leaf ($($srcFiles.Count) arquivo(s))"
    if ($WhatIf) { return $true }

    $robocopyArgs = @(
        $Source, $Dest,
        "/E", "/FFT", "/R:2", "/W:3",
        "/NP", "/NDL", "/NJS", "/NJH",
        "/XO"
    )
    & robocopy @robocopyArgs | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        Write-DeployWarn "Robocopy merge falhou (codigo $code): $Source -> $Dest"
        return $false
    }
    return $true
}

function Harvest-MutableDataToShared {
    param(
        [string]$SharedRoot,
        [string[]]$SourceRoots,
        [switch]$WhatIf
    )
    $map = Get-SharedDirTargetMap $SharedRoot
    $merged = 0

    foreach ($dirName in $script:SharedDirNames) {
        $dest = $map[$dirName]
        if (-not $dest) { continue }

        foreach ($root in $SourceRoots) {
            if ([string]::IsNullOrWhiteSpace($root)) { continue }
            if (-not (Test-Path -LiteralPath $root)) { continue }

            $src = Join-Path $root $dirName
            if (Merge-MutableDirIntoShared -Source $src -Dest $dest -WhatIf:$WhatIf) {
                $merged++
            }
        }
    }
    return $merged
}

function Invoke-SafeRobocopy {
    param(
        [string]$Source,
        [string]$Dest,
        [switch]$Mirror,
        [string[]]$ExtraExcludeDirs = @(),
        [string[]]$ExtraExcludeFiles = @(),
        [switch]$WhatIf
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Origem inexistente: $Source"
    }

    $Source = Normalize-DeployPath $Source
    $Dest = Normalize-DeployPath $Dest

    if (-not (Test-Path -LiteralPath $Dest)) {
        New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    }

    $xd = $script:RobocopyExcludeDirs + $ExtraExcludeDirs | Select-Object -Unique
    $xf = $script:RobocopyExcludeFiles + $ExtraExcludeFiles | Select-Object -Unique

    $args = @($Source, $Dest, "/E", "/Z", "/FFT", "/R:3", "/W:5", "/NP", "/NDL", "/NJS", "/NJH", "/XD") + $xd + @("/XF") + $xf
    if ($Mirror) {
        if ((Get-ChildItem -LiteralPath $Dest -Force -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
            throw "Mirror (/MIR) permitido apenas em pasta de release vazia/recém-criada: $Dest"
        }
        $args = @($Source, $Dest, "/MIR", "/Z", "/FFT", "/R:3", "/W:5", "/NP", "/NDL", "/NJS", "/NJH", "/XD") + $xd + @("/XF") + $xf
    }

    Write-Host ("robocopy " + ($args -join " ")) -ForegroundColor DarkGray
    if ($WhatIf) {
        Write-DeployWarn "WhatIf: robocopy nao executado."
        return 0
    }

    & robocopy @args | Out-Host
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw ('Robocopy falhou com codigo {0}: {1} -> {2}' -f $code, $Source, $Dest)
    }
    return $code
}

function Get-PathReparseTarget {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($item.Target) { return $item.Target }
        # PS 5.1 as vezes expoe Target como array
        return ($item | Select-Object -ExpandProperty Target -ErrorAction SilentlyContinue)
    }
    return $null
}

function Normalize-LinkTargetPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    $p = $Path.Trim().TrimEnd('\')
    if (Test-Path -LiteralPath $p) {
        try { return (Get-Item -LiteralPath $p).FullName.TrimEnd('\') } catch { }
    }
    return $p
}

function Test-SameJunctionTarget {
    param(
        [string]$LinkPath,
        [string]$ExpectedTarget
    )
    $current = Get-PathReparseTarget $LinkPath
    if (-not $current) { return $false }
    $a = Normalize-LinkTargetPath $current
    $b = Normalize-LinkTargetPath $ExpectedTarget
    return ($a -ieq $b)
}

function Remove-DeployLinkOrDirectory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $true }

    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        cmd /c "rmdir `"$Path`"" 2>$null | Out-Null
        return -not (Test-Path -LiteralPath $Path)
    }

    if ($item.PSIsContainer) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            return $true
        } catch {
            cmd /c "rmdir /s /q `"$Path`"" 2>$null | Out-Null
            return -not (Test-Path -LiteralPath $Path)
        }
    }

    try {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Remove-ReleaseMutableScaffold {
    param([string]$ReleasePath)
    foreach ($dirName in $script:SharedDirNames) {
        $target = Join-Path $ReleasePath $dirName
        if (Test-Path -LiteralPath $target) {
            $null = Remove-DeployLinkOrDirectory $target
        }
    }
    $cfgDir = Join-Path $ReleasePath "config"
    if (Test-Path -LiteralPath $cfgDir) {
        foreach ($cfgFile in $script:SharedConfigFiles) {
            $f = Join-Path $cfgDir $cfgFile
            if (Test-Path -LiteralPath $f) {
                $null = Remove-DeployLinkOrDirectory $f
            }
        }
    }
}

function New-ReleaseSharedLink {
    param(
        [string]$LinkPath,
        [string]$TargetPath
    )
    $TargetPath = Normalize-DeployPath $TargetPath

    if (Test-SameJunctionTarget -LinkPath $LinkPath -ExpectedTarget $TargetPath) {
        Write-DeployOk ("Junction ja OK: " + (Split-Path $LinkPath -Leaf))
        return $true
    }

    $parent = Split-Path $LinkPath -Parent
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if (Test-Path -LiteralPath $LinkPath) {
        if (-not (Remove-DeployLinkOrDirectory $LinkPath)) {
            Write-DeployWarn "Nao foi possivel remover antes do junction: $LinkPath"
            return $false
        }
    }

    if (-not (Test-Path -LiteralPath $TargetPath)) {
        New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
    }
    $targetFull = Normalize-LinkTargetPath $TargetPath

    try {
        New-Item -ItemType Junction -Path $LinkPath -Target $targetFull -Force | Out-Null
        return $true
    } catch {
        Write-DeployWarn "Junction falhou ($LinkPath): $($_.Exception.Message)"
        return $false
    }
}

function Copy-DeployTextFile {
    param(
        [string]$Source,
        [string]$Dest
    )
    $parent = Split-Path $Dest -Parent
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $text = [System.IO.File]::ReadAllText($Source)
    [System.IO.File]::WriteAllText($Dest, $text, $utf8NoBom)
}

function Connect-ReleaseToShared {
    param(
        [string]$ReleasePath,
        [string]$SharedRoot,
        [string]$ProdLocalPath = "C:\Sistemas CGraf\Sagra Web"
    )
    $shared = Get-SharedSubPaths $SharedRoot
    $pending = @()
    $failed = $false

    $prodRoot = Split-Path $SharedRoot -Parent
    $harvestRoots = [System.Collections.Generic.List[string]]::new()
    foreach ($candidate in @($ReleasePath, $prodRoot, $ProdLocalPath)) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        if ($harvestRoots -notcontains $candidate) { $harvestRoots.Add($candidate) | Out-Null }
    }
    $activeRelease = Get-ActiveReleasePath $prodRoot
    if ($activeRelease -and ($harvestRoots -notcontains $activeRelease)) {
        $harvestRoots.Add($activeRelease) | Out-Null
    }
    $currentPath = Join-Path $prodRoot "current"
    if ((Test-Path -LiteralPath $currentPath) -and ($harvestRoots -notcontains $currentPath)) {
        $harvestRoots.Add($currentPath) | Out-Null
    }
    $harvested = Harvest-MutableDataToShared -SharedRoot $SharedRoot -SourceRoots $harvestRoots.ToArray()
    if ($harvested -gt 0) {
        Write-DeployOk "Dados mutaveis consolidados em shared/ antes dos junctions ($harvested origem(ns))"
    }

    Remove-ReleaseMutableScaffold -ReleasePath $ReleasePath

    $dirMap = Get-SharedDirTargetMap $SharedRoot
    $linkMap = @()
    foreach ($dirName in $script:SharedDirNames) {
        $target = $dirMap[$dirName]
        if (-not $target) { continue }
        $linkMap += @{ Name = $dirName; Target = $target }
    }

    foreach ($entry in $linkMap) {
        $ok = New-ReleaseSharedLink -LinkPath (Join-Path $ReleasePath $entry.Name) -TargetPath $entry.Target
        if (-not $ok) {
            $failed = $true
            $pending += @{ link = $entry.Name; target = $entry.Target }
        }
    }

    $releaseConfigDir = Join-Path $ReleasePath "config"
    if (-not (Test-Path -LiteralPath $releaseConfigDir)) {
        New-Item -ItemType Directory -Path $releaseConfigDir -Force | Out-Null
    }

    foreach ($cfgFile in $script:SharedConfigFiles) {
        $sharedCfg = Join-Path $shared.Config $cfgFile
        if (-not (Test-Path -LiteralPath $sharedCfg)) {
            if ($cfgFile -eq "config.json" -and (Test-Path (Join-Path $releaseConfigDir "config.example.json"))) {
                Copy-Item -LiteralPath (Join-Path $releaseConfigDir "config.example.json") -Destination $sharedCfg -Force
                Write-DeployWarn "shared\config\config.json criado a partir de config.example.json"
            } elseif ($cfgFile -eq ".env" -and (Test-Path (Join-Path $releaseConfigDir ".env.example"))) {
                Copy-Item -LiteralPath (Join-Path $releaseConfigDir ".env.example") -Destination $sharedCfg -Force
                Write-DeployWarn "shared\config\.env criado a partir de .env.example - REVISE antes de producao"
            }
        }
        $releaseCfg = Join-Path $releaseConfigDir $cfgFile
        if (Test-Path -LiteralPath $sharedCfg) {
            Copy-DeployTextFile -Source $sharedCfg -Dest $releaseCfg
            Write-DeployOk "config\$cfgFile vinculado via copia de shared\config\"
        } else {
            $failed = $true
            $pending += @{ link = "config\$cfgFile"; target = $sharedCfg; note = "arquivo ausente em shared" }
        }
    }

    if ($failed) {
        $pendingFile = Join-Path $ReleasePath "PENDING_JUNCTIONS.json"
        @{
            message = 'Junctions devem ser criadas no servidor com caminho local (ex.: C:\Sistemas CGraf\Sagra Web)'
            prod_local_path = $ProdLocalPath
            release_name = Split-Path $ReleasePath -Leaf
            pending = $pending
            finish_script = "deploy\scripts\finish-release-junctions.ps1"
        } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $pendingFile -Encoding UTF8
        Write-DeployWarn ("Alguns junctions falharam - ver " + $pendingFile + " e execute finish-release-junctions.ps1 NO SERVIDOR.")
    }

    return -not $failed
}

function Set-ReleaseMetadata {
    param(
        [string]$ReleasePath,
        [string]$ReleaseName,
        [string]$SourceDescription,
        [string]$Commit = "",
        [string]$Branch = "",
        [int]$DirtyFiles = -1,
        [string]$Tests = "",
        [string]$ChangesText = ""
    )
    if (-not $Commit -and $env:SAGRA_RELEASE_COMMIT) { $Commit = [string]$env:SAGRA_RELEASE_COMMIT }
    if (-not $Branch -and $env:SAGRA_RELEASE_BRANCH) { $Branch = [string]$env:SAGRA_RELEASE_BRANCH }
    if ($DirtyFiles -lt 0 -and $env:SAGRA_RELEASE_DIRTY_FILES -match '^\d+$') {
        $DirtyFiles = [int]$env:SAGRA_RELEASE_DIRTY_FILES
    }
    if ($DirtyFiles -lt 0) { $DirtyFiles = 0 }
    if (-not $Tests -and $env:SAGRA_RELEASE_TESTS) { $Tests = [string]$env:SAGRA_RELEASE_TESTS }
    if (-not $Tests) { $Tests = "unknown" }
    if (-not $ChangesText -and $env:SAGRA_RELEASE_CHANGES) { $ChangesText = [string]$env:SAGRA_RELEASE_CHANGES }

    $deployedAt = Get-Date -Format "o"
    $releaseLines = @(
        "release=$ReleaseName",
        "deployed_at=$deployedAt",
        "source=$SourceDescription",
        "commit=$(if ($Commit) { $Commit } else { '(unknown)' })",
        "branch=$(if ($Branch) { $Branch } else { '(unknown)' })",
        "dirty_files=$DirtyFiles",
        "tests=$Tests"
    )
    # UTF8 sem BOM: health/watchdog leem com utf-8-sig, mas BOM atrapalha parsers simples.
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText(
        (Join-Path $ReleasePath "RELEASE.txt"),
        (($releaseLines -join [Environment]::NewLine) + [Environment]::NewLine),
        $utf8NoBom
    )

    $changesPath = Join-Path $ReleasePath "CHANGES.txt"
    if ($ChangesText) {
        [System.IO.File]::WriteAllText($changesPath, ($ChangesText.TrimEnd() + [Environment]::NewLine), $utf8NoBom)
    } elseif ($DirtyFiles -eq 0) {
        [System.IO.File]::WriteAllText($changesPath, "(working tree limpa)" + [Environment]::NewLine, $utf8NoBom)
    }

    $versionObj = [ordered]@{
        release = $ReleaseName
        deployedAt = $deployedAt
        source = $SourceDescription
        commit = $(if ($Commit) { $Commit } else { $null })
        branch = $(if ($Branch) { $Branch } else { $null })
        dirtyFiles = $DirtyFiles
        tests = $Tests
    }
    $versionJson = $versionObj | ConvertTo-Json -Compress
    $frontendDist = Join-Path $ReleasePath "app\frontend"
    if (Test-Path -LiteralPath $frontendDist) {
        [System.IO.File]::WriteAllText(
            (Join-Path $frontendDist "version.json"),
            $versionJson + [Environment]::NewLine,
            $utf8NoBom
        )
        # Preservar build-id.txt do vite build -- usado pelo client para detectar update.
        # Nao sobrescrever (Join-Path $frontendDist "build-id.txt").
    }
}

function Test-ReleaseIntegrity {
    param(
        [string]$ReleasePath,
        [switch]$RequireSharedLinks
    )
    $failed = $false
    foreach ($c in $script:ReleaseIntegrityChecks) {
        $full = Join-Path $ReleasePath $c.Path
        if (-not (Test-Path -LiteralPath $full)) {
            Write-DeployErr "Ausente: $($c.Label) ($($c.Path))"
            $failed = $true
        } else {
            Write-DeployOk $c.Label
        }
    }

    $apiPath = Join-Path $ReleasePath "app\backend\routers\api.py"
    if (Test-Path -LiteralPath $apiPath) {
        $apiText = Get-Content -LiteralPath $apiPath -Raw -Encoding UTF8
        if ($apiText -notmatch "_register_spa_shell_routes") {
            Write-DeployErr "api.py sem rotas SPA shell"
            $failed = $true
        }
    }

    $assetsDir = Join-Path $ReleasePath "app\frontend\assets"
    if (Test-Path -LiteralPath $assetsDir) {
        $jsFiles = @(Get-ChildItem -LiteralPath $assetsDir -Filter "index-*.js" -ErrorAction SilentlyContinue)
        if ($jsFiles.Count -lt 1) {
            Write-DeployErr "Nenhum index-*.js em app\frontend\assets"
            $failed = $true
        }
    }

    if ($RequireSharedLinks) {
        foreach ($dirName in @("logs", "storage", "Modelos")) {
            $p = Join-Path $ReleasePath $dirName
            if (-not (Test-Path -LiteralPath $p)) {
                Write-DeployErr "Link shared ausente: $dirName"
                $failed = $true
                continue
            }
            $item = Get-Item -LiteralPath $p -Force
            if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                Write-DeployErr "$dirName nao e junction para shared"
                $failed = $true
            }
        }
        $envPath = Join-Path $ReleasePath "config\.env"
        if (-not (Test-Path -LiteralPath $envPath)) {
            Write-DeployErr "config\.env ausente na release"
            $failed = $true
        }
    }

    $manifestPath = Join-Path $ReleasePath "RELEASE-INTEGRITY.json"
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($manifest.algorithm -ne "SHA256" -or $null -eq $manifest.files) {
                throw "formato de manifesto invalido"
            }
            $releaseFull = [System.IO.Path]::GetFullPath($ReleasePath).TrimEnd('\')
            $releasePrefix = $releaseFull + [System.IO.Path]::DirectorySeparatorChar
            foreach ($property in $manifest.files.PSObject.Properties) {
                $relative = [string]$property.Name
                if ([string]::IsNullOrWhiteSpace($relative) -or [System.IO.Path]::IsPathRooted($relative)) {
                    throw "caminho invalido no manifesto: $relative"
                }
                $full = [System.IO.Path]::GetFullPath((Join-Path $releaseFull $relative.Replace('/', '\')))
                if (-not $full.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "caminho fora da release no manifesto: $relative"
                }
                if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                    throw "arquivo do manifesto ausente: $relative"
                }
                $actual = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($actual -ne ([string]$property.Value).ToLowerInvariant()) {
                    throw "hash divergente: $relative"
                }
            }
            Write-DeployOk "Manifesto SHA-256 da release"
        } catch {
            Write-DeployErr "Manifesto de integridade invalido: $_"
            $failed = $true
        }
    } else {
        Write-DeployWarn "Release legada sem RELEASE-INTEGRITY.json"
    }

    if ($failed) {
        throw "Validacao da release falhou em $ReleasePath"
    }
}

function Get-AvailableReleases {
    param([string]$ProdPath)
    $releasesDir = Join-Path $ProdPath "releases"
    if (-not (Test-Path -LiteralPath $releasesDir)) { return @() }
    Get-ChildItem -LiteralPath $releasesDir -Directory |
        Sort-Object Name -Descending |
        Select-Object -ExpandProperty Name
}

function Get-ActiveReleaseName {
    param([string]$ProdPath)
    $layout = Get-ReleaseLayoutPaths $ProdPath
    if (Test-Path -LiteralPath $layout.CurrentReleaseFile) {
        $name = (Get-Content -LiteralPath $layout.CurrentReleaseFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ($name -and (Test-SafeReleaseName -ReleaseName $name)) { return $name }
        if ($name) { Write-DeployWarn "current-release.txt contem nome invalido; valor ignorado" }
    }
    return $null
}

function Get-ActiveReleasePath {
    param([string]$ProdPath)
    $name = Get-ActiveReleaseName $ProdPath
    if (-not $name) { return $null }
    $path = Join-Path (Join-Path $ProdPath "releases") $name
    if (Test-Path -LiteralPath $path) { return $path }
    return $null
}

function Update-CurrentPointer {
    param(
        [string]$ProdPath,
        [string]$ReleaseName,
        [switch]$ConfirmProductionSwitch
    )
    if (-not $ConfirmProductionSwitch) {
        throw "Atualizacao de current exige -ConfirmProductionSwitch (producao nao sera alterada sem confirmacao explicita)."
    }

    Assert-SafeReleaseName -ReleaseName $ReleaseName

    $layout = Get-ReleaseLayoutPaths $ProdPath
    $releasePath = Join-Path $layout.Releases $ReleaseName
    if (-not (Test-Path -LiteralPath $releasePath)) {
        throw "Release inexistente: $ReleaseName"
    }

    $previous = Get-ActiveReleaseName $ProdPath
    if ($previous -and $previous -ne $ReleaseName) {
        Set-Content -LiteralPath $layout.PreviousReleaseFile -Value $previous -Encoding UTF8
    }

    Set-Content -LiteralPath $layout.CurrentReleaseFile -Value $ReleaseName -Encoding UTF8

    if (Test-Path -LiteralPath $layout.Current) {
        $item = Get-Item -LiteralPath $layout.Current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            cmd /c "rmdir `"$($layout.Current)`"" 2>$null | Out-Null
        } else {
            throw "Pasta current existe e nao e junction - abortado por seguranca."
        }
    }

    New-Item -ItemType Junction -Path $layout.Current -Target $releasePath -Force | Out-Null
    Write-DeployOk ("current aponta para releases\" + $ReleaseName)

    $releaseMeta = Join-Path $releasePath "RELEASE.txt"
    if (Test-Path -LiteralPath $releaseMeta) {
        Copy-Item -LiteralPath $releaseMeta -Destination (Join-Path $ProdPath "RELEASE.txt") -Force
    }

    return $releasePath
}

function Get-SagraApiPort {
    param([string]$ProdPath)
    $port = 8050
    foreach ($cfg in @(
        (Join-Path $ProdPath "shared\config\.env"),
        (Join-Path $ProdPath "config\.env"),
        (Join-Path $ProdPath "current\config\.env")
    )) {
        if (-not (Test-Path -LiteralPath $cfg)) { continue }
        $line = Select-String -LiteralPath $cfg -Pattern '^\s*PORT\s*=' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($line) {
            $val = ($line.Line -split '=', 2)[1].Trim()
            if ($val -match '^\d+$') { return [int]$val }
        }
    }
    return $port
}

function Test-IsDeployAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Stop-SagraPortProcess {
    param([int]$Port = 8050)
    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $connections) {
        return $true
    }
    foreach ($conn in @($connections)) {
        $procId = [int]$conn.OwningProcess
        if ($procId -le 0) { continue }
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "Processo $procId finalizado" -ForegroundColor Green
    }
    Start-Sleep -Milliseconds 400
    return -not (Test-SagraPortListening -Port $Port)
}

$SagraApiServiceName = "SAGRA-Api"

function Get-SagraApiService {
    return Get-Service -Name $SagraApiServiceName -ErrorAction SilentlyContinue
}

function Stop-SagraApiForDeploy {
    param(
        [string]$ProdPath,
        [int]$FreePortTimeoutSec = 5
    )
    $port = Get-SagraApiPort -ProdPath $ProdPath
    Write-Host "Porta: $port"

    $apiService = Get-SagraApiService
    if ($apiService -and $apiService.Status -ne "Stopped") {
        Write-Host "Parando servico $SagraApiServiceName..."
        Stop-Service -Name $SagraApiServiceName -Force -ErrorAction Stop
        try { $apiService.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30)) } catch { }
    }

    $deadline = (Get-Date).AddSeconds($FreePortTimeoutSec)
    do {
        if (Stop-SagraPortProcess -Port $port) {
            Write-DeployOk "API parada (porta $port livre)"
            return
        }
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Seconds 1
    } while ($true)

    if ($pararPs1 = @(
        (Join-Path $ProdPath "current\parar-api.ps1"),
        (Join-Path $ProdPath "parar-api.ps1")
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1) {
        if (Test-IsDeployAdmin) {
            & $pararPs1 -Port $port -Quiet
            if ($LASTEXITCODE -eq 0) {
                Write-DeployOk "API parada (parar-api.ps1)"
                return
            }
        }
    }

    $pararBat = Join-Path $ProdPath "parar-api.bat"
    if (Test-Path -LiteralPath $pararBat) {
        Write-Host "Abrindo parar-api.bat (aceite UAC se solicitado)..." -ForegroundColor Yellow
        $proc = Start-Process -FilePath "cmd.exe" `
            -ArgumentList "/c", "`"$pararBat`" /quiet" `
            -WorkingDirectory $ProdPath `
            -Wait -PassThru `
            -WindowStyle Normal
        if ($proc.ExitCode -eq 0 -and -not (Test-SagraPortListening -Port $port)) {
            Write-DeployOk "API parada (parar-api.bat)"
            return
        }
    }

    throw "Nao foi possivel liberar a porta $port em ${FreePortTimeoutSec}s. Execute parar-api.bat como Administrador."
}

function Test-SagraPortListening {
    param([int]$Port = 8050)
    try {
        $conn = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
        return ($conn.Count -gt 0)
    } catch {
        $match = netstat -ano | Select-String ":$Port\s" | Select-String "LISTENING|OUVINDO"
        return ($null -ne $match)
    }
}

function Repair-DeployConfigBom {
    param(
        [string]$ProdPath,
        [string]$ReleaseName = ""
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $relPaths = @(
        "shared\config\config.json",
        "shared\config\.env",
        "current\config\config.json",
        "current\config\.env"
    )
    if ($ReleaseName) {
        $relPaths += @(
            "releases\$ReleaseName\config\config.json",
            "releases\$ReleaseName\config\.env"
        )
    }
    foreach ($rel in $relPaths) {
        $path = Join-Path $ProdPath $rel
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $text = [System.IO.File]::ReadAllText($path)
        [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
        Write-DeployOk "Config sem BOM: $rel"
    }
}

function Start-SagraApiForDeploy {
    param(
        [string]$CurrentRoot,
        [switch]$InteractiveApi
    )
    if (-not (Test-Path -LiteralPath $CurrentRoot)) {
        throw "Pasta current inexistente: $CurrentRoot"
    }

    $prepLogs = Join-Path $CurrentRoot "preparar-logs.ps1"
    if (Test-Path -LiteralPath $prepLogs) {
        & $prepLogs -Root $CurrentRoot -Quiet
    }

    $detached = Join-Path $CurrentRoot "iniciar-api-detached.ps1"
    $interativo = Join-Path $CurrentRoot "iniciar-api.bat"

    # Servico NSSM roda com a conta de rede configurada nele (acesso aos MDBs do DFS),
    # independente de quem executa o deploy.
    $apiService = Get-SagraApiService
    if ($apiService) {
        if ($apiService.Status -eq "Running") {
            Restart-Service -Name $SagraApiServiceName -Force -ErrorAction Stop
        } else {
            Start-Service -Name $SagraApiServiceName -ErrorAction Stop
        }
        try { $apiService.WaitForStatus("Running", [TimeSpan]::FromSeconds(60)) } catch { }
        Write-DeployOk "API iniciada pelo servico $SagraApiServiceName"
        return
    }
    Write-DeployWarn ("Servico $SagraApiServiceName ausente: a API herda a conta de quem executa o deploy. " +
        "Instale com instalar-servico-api.ps1 -ServiceCredential (Get-Credential 'REDECAMARA\usr_sefoc') -Start")

    if ($InteractiveApi -and (Test-Path -LiteralPath $interativo)) {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "`"$interativo`"" -WorkingDirectory $CurrentRoot
        Write-DeployOk "Console iniciar-api.bat aberto"
        return
    }
    if (Test-Path -LiteralPath $detached) {
        & $detached -Root $CurrentRoot
        Write-DeployOk "API iniciada em segundo plano"
        return
    }
    if (Test-Path -LiteralPath $interativo) {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "`"$interativo`"" -WorkingDirectory $CurrentRoot
        Write-DeployOk "Console iniciar-api.bat aberto (detached ausente)"
        return
    }
    throw "Nenhum iniciar-api encontrado em $CurrentRoot"
}

function Wait-SagraHealthCheck {
    param(
        [string]$ProdPath,
        [int]$TimeoutSec = 60,
        [string]$ExpectedRelease = "",
        [switch]$RequireNetworkProcessUser
    )
    $port = Get-SagraApiPort -ProdPath $ProdPath
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $last = @{ Ok = $false; Body = "timeout apos ${TimeoutSec}s"; Url = "http://127.0.0.1:${port}/health" }
    while ((Get-Date) -lt $deadline) {
        $health = Invoke-ReleaseHealthCheck -Port $port `
            -ExpectedRelease $ExpectedRelease `
            -RequireNetworkProcessUser:$RequireNetworkProcessUser
        $last = $health
        if ($health.Ok) {
            return $health
        }
        Start-Sleep -Seconds 2
    }
    return $last
}

function Invoke-ReleaseHealthCheck {
    param(
        [int]$Port = 8050,
        [string]$HostName = "127.0.0.1",
        [int]$TimeoutSec = 5,
        [string]$ExpectedRelease = "",
        [switch]$RequireNetworkProcessUser
    )
    $url = "http://${HostName}:${Port}/health"
    $systemAccounts = @(
        "LocalSystem", "SYSTEM", "NT AUTHORITY\SYSTEM",
        "NT AUTHORITY\LOCAL SERVICE", "NT AUTHORITY\NETWORK SERVICE",
        "LOCAL SERVICE", "NETWORK SERVICE"
    )
    try {
        # Sem headers de proxy: /health so expoe process_user/mdb em loopback direto.
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $TimeoutSec
        $body = [string]$resp.Content
        $ok = ($resp.StatusCode -eq 200)
        $parsed = $null
        $release = $null
        $processUser = $null
        $mdb = $null
        try {
            $parsed = $body | ConvertFrom-Json -ErrorAction Stop
            if ($parsed.PSObject.Properties.Name -contains "release") { $release = [string]$parsed.release }
            if ($parsed.PSObject.Properties.Name -contains "process_user") { $processUser = [string]$parsed.process_user }
            if ($parsed.PSObject.Properties.Name -contains "mdb") { $mdb = [string]$parsed.mdb }
        } catch { }

        $reasons = @()
        if ($ok -and $ExpectedRelease) {
            if (-not $release) {
                $ok = $false
                $reasons += "health sem campo release (API antiga ou nao-loopback?)"
            } elseif ($release -ne $ExpectedRelease) {
                $ok = $false
                $reasons += "release=$release esperado=$ExpectedRelease"
            }
        }
        if ($ok -and $RequireNetworkProcessUser) {
            # Preferir process_user do /health (API nova). Releases empacotadas sem esse
            # campo (pacote stale / SkipBuild) caem no StartName do servico SAGRA-Api.
            if (-not $processUser) {
                $apiSvc = Get-CimInstance Win32_Service -Filter "Name='$SagraApiServiceName'" -ErrorAction SilentlyContinue
                if ($apiSvc -and $apiSvc.State -eq "Running" -and $apiSvc.StartName) {
                    $processUser = [string]$apiSvc.StartName
                }
            }
            if (-not $processUser) {
                $ok = $false
                $reasons += "health sem process_user e servico $SagraApiServiceName ausente/parado"
            } else {
                $userLeaf = ($processUser -split '\\')[-1]
                $isSystem = $false
                foreach ($sa in $systemAccounts) {
                    if ($processUser -ieq $sa -or $userLeaf -ieq (($sa -split '\\')[-1])) {
                        $isSystem = $true
                        break
                    }
                }
                if ($isSystem) {
                    $ok = $false
                    $reasons += "process_user=$processUser (conta de sistema sem credencial DFS)"
                }
            }
        }
        if (-not $ok -and $reasons.Count -gt 0) {
            $body = ($reasons -join "; ") + " | " + $body
        }
        return @{
            Ok = $ok
            StatusCode = $resp.StatusCode
            Body = $body
            Url = $url
            Release = $release
            ProcessUser = $processUser
            Mdb = $mdb
        }
    } catch {
        return @{
            Ok = $false
            StatusCode = 0
            Body = $_.Exception.Message
            Url = $url
            Release = $null
            ProcessUser = $null
            Mdb = $null
        }
    }
}

function Resolve-SagraApiPythonExe {
    param([string]$Hint = "")
    if ($Hint -and (Test-Path -LiteralPath $Hint -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $nssmCandidates = @(
        "C:\nssm\nssm.exe",
        (Join-Path $script:DeployCommonRoot "deploy\tools\nssm.exe")
    )
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $nssmCandidates = @($cmd.Source) + $nssmCandidates }
    foreach ($nssm in $nssmCandidates) {
        if (-not (Test-Path -LiteralPath $nssm -PathType Leaf)) { continue }
        $ErrorActionPreference = "Continue"
        $out = (& $nssm get $SagraApiServiceName Application 2>&1 | Out-String) -replace "\x00", ""
        $ErrorActionPreference = "Stop"
        $exe = ($out -split "`r?`n" | Where-Object { $_ -and $_ -notmatch 'Can.t open|OpenService|ERROR' } | Select-Object -First 1)
        if ($exe) {
            $exe = $exe.Trim().Trim('"')
            if (Test-Path -LiteralPath $exe -PathType Leaf) { return $exe }
        }
    }
    foreach ($fallback in @(
            "${env:ProgramFiles}\Python310\python.exe",
            "${env:ProgramFiles}\Python312\python.exe"
        )) {
        if ($fallback -and (Test-Path -LiteralPath $fallback -PathType Leaf)) { return $fallback }
    }
    $py = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($py -and $py.Source -notmatch 'WindowsApps\\python\.exe$') { return $py.Source }
    throw "Python de producao nao encontrado (SAGRA-Api Application / Program Files\\Python310)."
}

function Assert-SagraApiServiceForPublish {
    param(
        [switch]$AllowNoApiService
    )
    $systemAccounts = @("LocalSystem", "NT AUTHORITY\SYSTEM", "NT AUTHORITY\LocalService", "NT AUTHORITY\NetworkService")
    $svc = Get-SagraApiService
    if (-not $svc) {
        $msg = ("Servico $SagraApiServiceName ausente. Sem ele a publicacao sobe a API com a conta " +
            "de quem publica (risco -1032 nos MDBs). Instale com current\instalar-servico-api.ps1 " +
            "-ServiceCredential (Get-Credential 'REDECAMARA\usr_sefoc') -Start. Escape: -AllowNoApiService.")
        if ($AllowNoApiService) {
            Write-DeployWarn $msg
            return $false
        }
        throw $msg
    }
    $cim = Get-CimInstance Win32_Service -Filter "Name='$SagraApiServiceName'"
    $account = [string]$cim.StartName
    if ($account -in $systemAccounts) {
        throw ("$SagraApiServiceName roda como $account (sem credencial DFS). " +
            "Reconfigure com -ServiceCredential REDECAMARA\usr_sefoc.")
    }
    Write-DeployOk ("$SagraApiServiceName presente (conta=$account)")
    return $true
}

function Test-NginxConfigReadable {
    param([string]$NginxConfPath = $script:DefaultNginxConf)
    if (-not (Test-Path -LiteralPath $NginxConfPath)) {
        return @{ Ok = $false; Message = "nginx.conf nao encontrado: $NginxConfPath" }
    }
    $text = Get-Content -LiteralPath $NginxConfPath -Raw -Encoding UTF8
    $hasUpstream = $text -match "upstream\s+sagra_backend"
    $hasProxy = $text -match "proxy_pass\s+http://sagra_backend"
    $port = "8050"
    if ($text -match "upstream\s+sagra_backend\s*\{[^}]*server\s+127\.0\.0\.1:(\d+)") {
        $port = $Matches[1]
    }
    return @{
        Ok = ($hasUpstream -and $hasProxy)
        Message = "upstream sagra_backend + proxy_pass presentes"
        UsesDiskRoot = ($text -match "root\s+.*[Ss]agra")
        Port = $port
    }
}

function Remove-OldReleases {
    param(
        [string]$ProdPath,
        [int]$Keep = 5,
        [switch]$Cleanup,
        [string]$ActiveRelease,
        [string]$PreviousRelease
    )
    if (-not $Cleanup) { return }
    $all = Get-AvailableReleases $ProdPath
    $protected = @($ActiveRelease, $PreviousRelease) | Where-Object { $_ }
    $candidates = $all | Where-Object { $_ -notin $protected }
    if ($candidates.Count -le $Keep) { return }
    $toRemove = $candidates | Select-Object -Skip $Keep
    foreach ($name in $toRemove) {
        $path = Join-Path (Join-Path $ProdPath "releases") $name
        Write-DeployWarn "Removendo release antiga: $name"
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}

function Copy-ProdRootLaunchers {
    param([string]$ProdPath)
    $tpl = Join-Path $script:DeployCommonRoot "deploy\templates"
    foreach ($f in @("deploy-release-prod.ps1", "deploy-release-prod.bat", "publicar-release.bat", "publicar-release.ps1")) {
        $src = Join-Path $tpl $f
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $ProdPath $f) -Force
        }
    }
}

function Copy-DeployScriptsToProd {
    param(
        [string]$ProdPath,
        [string]$DevRoot = $script:DeployCommonRoot
    )
    $src = Join-Path $DevRoot "deploy\scripts"
    $dest = Join-Path $ProdPath "deploy\scripts"
    $files = @(
        "deploy-common.ps1",
        "prepare-shared.ps1",
        "deploy_release.ps1",
        "rollback_release.ps1",
        "validate-release.ps1",
        "init-release-structure.ps1",
        "finish-release-junctions.ps1",
        "activate-release.ps1",
        "deploy-release-dev.ps1",
        "deploy-release-prod.ps1",
        "deploy-release-prod.bat",
        "fix-config-bom.ps1",
        "publicar-release-prod.ps1",
        "check_release_runtime.py",
        "check_tiff_runtime.py",
        "run-release-tests.ps1"
    )
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    foreach ($f in $files) {
        $from = Join-Path $src $f
        if (Test-Path -LiteralPath $from) {
            Copy-Item -LiteralPath $from -Destination (Join-Path $dest $f) -Force
        }
    }
    Copy-ProdRootLaunchers -ProdPath $ProdPath
}

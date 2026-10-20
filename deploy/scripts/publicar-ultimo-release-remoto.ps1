#Requires -Version 5.1
<#
.SYNOPSIS
  Publica, a partir da estacao DEV, a release mais recente de releases\ no servidor de producao.

.DESCRIPTION
  Conecta via WinRM e executa deploy\scripts\publicar-release-prod.ps1 no servidor dentro de
  uma tarefa agendada (conta informada, RunLevel Highest). Processos iniciados direto na sessao
  WinRM sao encerrados quando ela fecha: a API subiria, passaria no health e morreria em seguida.
  A tarefa roda com senha para manter as credenciais de rede (a API acessa shares DFS).

  A senha e pedida uma vez no console e guardada cifrada (DPAPI, so o usuario atual nesta
  maquina le) em %LOCALAPPDATA%\SagraWeb. A tarefa e removida do servidor ao final.

.USAGE
  powershell -File deploy\scripts\publicar-ultimo-release-remoto.ps1
  powershell -File deploy\scripts\publicar-ultimo-release-remoto.ps1 -ReleaseName "20260925_122557"
  powershell -File deploy\scripts\publicar-ultimo-release-remoto.ps1 -Force
  powershell -File deploy\scripts\publicar-ultimo-release-remoto.ps1 -ResetCredential
#>
param(
    [string]$RemoteHost = "cgrafsysvm",
    [string]$RemoteRoot = "C:\Sistemas CGraf\Sagra Web",
    [string]$ReleaseName = "",
    [switch]$Force,
    [switch]$ResetCredential,
    [int]$TimeoutMin = 15,
    [int]$HeartbeatSec = 15
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$credDir = Join-Path $env:LOCALAPPDATA "SagraWeb"
$credFile = Join-Path $credDir "publicar-remoto-$RemoteHost.xml"

function Write-Step([string]$Msg) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Msg) -ForegroundColor Cyan
}

function Test-DomainPassword([pscredential]$Cred) {
    try {
        Add-Type -AssemblyName System.DirectoryServices.AccountManagement
        $parts = $Cred.UserName -split '\\', 2
        $domain = if ($parts.Count -eq 2) { $parts[0] } else { $env:USERDOMAIN }
        $ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext("Domain", $domain)
        try {
            return $ctx.ValidateCredentials($parts[-1], $Cred.GetNetworkCredential().Password)
        } finally {
            $ctx.Dispose()
        }
    } catch {
        Write-Host "  Aviso: nao foi possivel validar a senha no dominio ($($_.Exception.Message)); seguindo." -ForegroundColor Yellow
        return $true
    }
}

function Get-PublishCredential {
    if ($ResetCredential -and (Test-Path -LiteralPath $credFile)) {
        Remove-Item -LiteralPath $credFile -Force
        Write-Host "  Senha salva removida (-ResetCredential)."
    }
    if (Test-Path -LiteralPath $credFile) {
        Write-Host "  Usando senha salva em $credFile (-ResetCredential para trocar)."
        return Import-Clixml -LiteralPath $credFile
    }

    $defaultUser = "$env:USERDOMAIN\$env:USERNAME"
    Write-Host "  A publicacao roda no servidor com a sua conta; a senha e pedida so desta vez." -ForegroundColor Yellow
    $user = Read-Host "  Usuario [$defaultUser]"
    if (-not $user) { $user = $defaultUser }
    $password = Read-Host "  Senha de $user" -AsSecureString
    if ($password.Length -eq 0) { throw "Senha nao informada." }
    $cred = New-Object System.Management.Automation.PSCredential($user, $password)

    Write-Host "  Validando senha no dominio..."
    if (-not (Test-DomainPassword $cred)) {
        throw "Usuario ou senha incorretos. Nada foi salvo; rode novamente."
    }
    New-Item -ItemType Directory -Path $credDir -Force | Out-Null
    $cred | Export-Clixml -LiteralPath $credFile
    Write-Host "  Senha OK, salva cifrada em $credFile" -ForegroundColor Green
    return $cred
}

$remoteScript = {
    param(
        [string]$ProdRoot,
        [string]$ReleaseName,
        [bool]$Force,
        [pscredential]$TaskCredential,
        [int]$TimeoutMin,
        [int]$HeartbeatSec
    )
    $ErrorActionPreference = "Stop"

    function Write-Step([string]$Msg) {
        Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Msg) -ForegroundColor Cyan
    }

    Write-Host "  Conectado a $env:COMPUTERNAME como $([Security.Principal.WindowsIdentity]::GetCurrent().Name)" -ForegroundColor Green

    Write-Step "3/5 Localizando release"
    $releasesRoot = Join-Path $ProdRoot "releases"
    if (-not (Test-Path -LiteralPath $releasesRoot)) {
        throw "Diretorio de releases nao encontrado: $releasesRoot"
    }

    if (-not $ReleaseName) {
        $latest = Get-ChildItem -LiteralPath $releasesRoot -Directory |
            Where-Object { $_.Name -match '^\d{8}_\d{6}$' } |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if (-not $latest) {
            throw "Nenhuma release no formato AAAAMMDD_HHMMSS encontrada em: $releasesRoot"
        }
        $ReleaseName = $latest.Name
    }

    $releasePath = Join-Path $releasesRoot $ReleaseName
    if (-not (Test-Path -LiteralPath $releasePath)) {
        throw "Release nao encontrada: $releasePath"
    }
    # RELEASE.txt e gravado por deploy_release.ps1 somente apos a copia terminar.
    if (-not (Test-Path -LiteralPath (Join-Path $releasePath "RELEASE.txt"))) {
        throw "Release $ReleaseName incompleta (sem RELEASE.txt) - a copia do DEV pode nao ter terminado."
    }

    $currentFile = Join-Path $ProdRoot "deploy\current-release.txt"
    $active = ""
    if (Test-Path -LiteralPath $currentFile) {
        $active = "$(Get-Content -LiteralPath $currentFile -Raw)".Trim()
    }

    Write-Host "  Release selecionada: $ReleaseName"
    Write-Host "  Release ativa:       $(if ($active) { $active } else { '(nenhuma)' })"

    # Metadados da release (gravados pelo deploy-release-dev)
    $meta = @{
        commit = ""
        branch = ""
        dirty_files = ""
        tests = ""
    }
    $releaseTxt = Join-Path $releasePath "RELEASE.txt"
    if (Test-Path -LiteralPath $releaseTxt) {
        foreach ($line in (Get-Content -LiteralPath $releaseTxt -Encoding UTF8)) {
            $t = $line.Trim()
            if (-not $t -or $t.StartsWith("#")) { continue }
            $eq = $t.IndexOf("=")
            if ($eq -lt 1) { continue }
            $k = $t.Substring(0, $eq).Trim().ToLowerInvariant()
            $v = $t.Substring($eq + 1).Trim()
            if ($meta.ContainsKey($k)) { $meta[$k] = $v }
        }
    }
    Write-Host ("  commit:              {0}" -f $(if ($meta.commit) { $meta.commit } else { '(n/d)' }))
    Write-Host ("  branch:              {0}" -f $(if ($meta.branch) { $meta.branch } else { '(n/d)' }))
    Write-Host ("  dirty_files:         {0}" -f $(if ($meta.dirty_files) { $meta.dirty_files } else { '(n/d)' }))
    Write-Host ("  tests:               {0}" -f $(if ($meta.tests) { $meta.tests } else { '(n/d)' }))
    $changesTxt = Join-Path $releasePath "CHANGES.txt"
    if (Test-Path -LiteralPath $changesTxt) {
        $changeLines = @(Get-Content -LiteralPath $changesTxt -Encoding UTF8 | Select-Object -First 15)
        if ($changeLines.Count -gt 0 -and $changeLines[0] -notmatch 'working tree limpa') {
            Write-Host "  Alteracoes nao commitadas (amostra):" -ForegroundColor DarkYellow
            foreach ($cl in $changeLines) { Write-Host "    $cl" -ForegroundColor DarkYellow }
        }
    }

    if ($meta.tests -eq "skipped" -and -not $Force) {
        throw ("Release $ReleaseName foi gerada com -SkipTests (tests=skipped). " +
            "Regenere com o gate de testes ou publique com -Force se tiver certeza.")
    }

    if ($active -eq $ReleaseName -and -not $Force) {
        Write-Host "  A release $ReleaseName ja esta ativa - nada a fazer (use -Force para republicar)." -ForegroundColor Yellow
        return "ja-ativa"
    }

    $publisher = Join-Path $ProdRoot "deploy\scripts\publicar-release-prod.ps1"
    if (-not (Test-Path -LiteralPath $publisher)) {
        throw "Publicador nao encontrado: $publisher"
    }

    Write-Step "4/5 Registrando tarefa de publicacao no servidor"
    $logDir = Join-Path $ProdRoot "deploy\logs"
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $log = Join-Path $logDir ("publicar-remoto_{0}_{1}.log" -f $ReleaseName, (Get-Date -Format "yyyyMMdd_HHmmss"))

    $taskName = "SAGRA-Publicar-Release"
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.State -eq "Running") {
            throw "Ja existe uma publicacao em andamento (tarefa '$taskName' em execucao no servidor)."
        }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "  Tarefa anterior removida."
    }

    # cmd /c remove as aspas externas; as internas protegem caminhos com espaco.
    $cmdLine = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$publisher`" " +
        "-ReleaseName $ReleaseName -ConfirmProductionSwitch > `"$log`" 2>&1"
    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmdLine`"" -WorkingDirectory $ProdRoot
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes $TimeoutMin)

    try {
        Register-ScheduledTask `
            -TaskName $taskName `
            -Action $action `
            -Settings $settings `
            -User $TaskCredential.UserName `
            -Password $TaskCredential.GetNetworkCredential().Password `
            -RunLevel Highest `
            -Description "Publicacao remota da release $ReleaseName (removida ao final)." | Out-Null
    } catch {
        throw "Falha ao registrar a tarefa de publicacao: $($_.Exception.Message)`nSe a senha mudou, rode novamente com -ResetCredential."
    }
    Write-Host "  Tarefa registrada. Log no servidor: $log"

    Write-Step "5/5 Publicando $ReleaseName (API fica indisponivel por ~1-3 min)"
    Write-Host "  ---------------- saida do servidor ----------------" -ForegroundColor DarkGray

    # 267009 = tarefa em execucao; 267011 = tarefa ainda nao executada.
    $pendingResults = @(267009, 267011)
    $startedAt = Get-Date
    $deadline = $startedAt.AddMinutes($TimeoutMin + 1)
    $lastActivity = $startedAt
    $printed = 0
    $done = $false
    $info = $null
    try {
        Start-ScheduledTask -TaskName $taskName
        do {
            Start-Sleep -Seconds 2
            $state = (Get-ScheduledTask -TaskName $taskName).State
            $info = Get-ScheduledTaskInfo -TaskName $taskName
            $done = ($state -ne "Running") -and ($pendingResults -notcontains $info.LastTaskResult)

            if (Test-Path -LiteralPath $log) {
                $lines = @(Get-Content -LiteralPath $log -Encoding UTF8 -ErrorAction SilentlyContinue)
                # Enquanto roda, a ultima linha pode estar incompleta.
                $upTo = if ($done) { $lines.Count } else { $lines.Count - 1 }
                for ($i = $printed; $i -lt $upTo; $i++) { Write-Host "  | $($lines[$i])" }
                if ($upTo -gt $printed) {
                    $printed = $upTo
                    $lastActivity = Get-Date
                }
            }

            if (-not $done -and ((Get-Date) - $lastActivity).TotalSeconds -ge $HeartbeatSec) {
                $elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
                $what = if ($state -eq "Running") { "processando" } else { "aguardando a tarefa iniciar" }
                Write-Host ("  ... {0} - {1}s decorridos (tarefa: {2}, limite {3} min)" -f $what, $elapsed, $state, $TimeoutMin) -ForegroundColor DarkYellow
                $lastActivity = Get-Date
            }
        } while (-not $done -and (Get-Date) -lt $deadline)
    } finally {
        if ($done) {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        }
    }

    Write-Host "  ---------------------------------------------------" -ForegroundColor DarkGray
    $elapsedTotal = [int]((Get-Date) - $startedAt).TotalSeconds
    if (-not $done) {
        throw "Tempo esgotado ($TimeoutMin min) aguardando a publicacao. Tarefa '$taskName' mantida no servidor; log: $log"
    }
    if ($info.LastTaskResult -ne 0) {
        throw "A publicacao falhou com codigo $($info.LastTaskResult) apos ${elapsedTotal}s. Log no servidor: $log"
    }
    Write-Host "  Publicacao terminou em ${elapsedTotal}s." -ForegroundColor Green
    return "publicada"
}

Write-Host ""
Write-Host " SAGRA Web - Publicacao remota da ultima release" -ForegroundColor Cyan
Write-Host " Servidor: $RemoteHost ($RemoteRoot)"
Write-Host ""

Write-Step "1/5 Credencial"
$cred = Get-PublishCredential
$remoteArgs = @($RemoteRoot, $ReleaseName, $Force.IsPresent, $cred, $TimeoutMin, $HeartbeatSec)

Write-Step "2/5 Conectando em $RemoteHost via WinRM (timeout 30s)"
$sessionOption = New-PSSessionOption -OpenTimeout 30000
try {
    # Negotiate cai em NTLM e o WinRM recusa sem TrustedHosts; Kerberos funciona no dominio.
    $result = Invoke-Command -ComputerName $RemoteHost -Credential $cred -Authentication Kerberos `
        -SessionOption $sessionOption -ScriptBlock $remoteScript -ArgumentList $remoteArgs
} catch [System.Management.Automation.Remoting.PSRemotingTransportException] {
    throw "Falha ao conectar em $RemoteHost via WinRM: $($_.Exception.Message)`nSe a senha mudou, rode novamente com -ResetCredential."
}

Write-Host ""
if ($result -eq "ja-ativa") {
    Write-Host "[OK] Nenhuma alteracao: a release mais recente ja esta ativa." -ForegroundColor Green
} else {
    Write-Host "[OK] Publicacao remota concluida." -ForegroundColor Green
}
exit 0

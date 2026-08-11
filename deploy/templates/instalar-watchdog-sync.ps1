# Instala tarefa agendada SYSTEM que executa watchdog-sync.ps1 a cada 2 minutos.
param(
    [string]$Root = "",
    [string]$TaskName = "SAGRA-SyncAndamentos-Watchdog",
    [int]$IntervalMinutes = 2,
    [int]$StaleSeconds = 180
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

Assert-Admin

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)

$watchdog = Join-Path $Root "watchdog-sync.ps1"
if (-not (Test-Path -LiteralPath $watchdog)) {
    # Em desenvolvimento: script ainda esta em deploy\templates
    $alt = Join-Path $Root "deploy\templates\watchdog-sync.ps1"
    if (Test-Path -LiteralPath $alt) {
        $watchdog = $alt
    } else {
        throw "watchdog-sync.ps1 nao encontrado em $Root"
    }
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdog`" -Root `"$Root`" -StaleSeconds $StaleSeconds"

# [TimeSpan]::MaxValue gera Duration P99999999DT23H59M59S - rejeitado pelo Task Scheduler.
# 10 anos eh suficiente e valido no XML do SCHTASKS.
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa anterior removida."
}

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "Watchdog externo do sync de andamentos SAGRA (reinicia servico se parado ou heartbeat velho)." | Out-Null
} catch {
    Write-Host "Register-ScheduledTask falhou: $_"
    exit 1
}

$check = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $check) {
    Write-Host "ERRO: tarefa '$TaskName' nao ficou registrada."
    exit 1
}

Write-Host "Tarefa '$TaskName' instalada."
Write-Host "  Script:   $watchdog"
Write-Host "  Root:     $Root"
Write-Host "  Interval: a cada $IntervalMinutes min"
Write-Host "  Stale:    $StaleSeconds s"
Write-Host "  Conta:    SYSTEM"
Write-Host "  State:    $($check.State)"
exit 0

param(
    [string]$Root = "",
    [ValidateRange(1, 30)][int]$Minutes = 30,
    [string]$Reason = "manutencao manual"
)
$ErrorActionPreference = "Stop"
if (-not $Root) {
    $scriptParent = Split-Path $PSScriptRoot -Parent
    $Root = if ((Split-Path $PSScriptRoot -Leaf) -ieq "current") {
        Split-Path $PSScriptRoot -Parent
    } elseif ((Split-Path $scriptParent -Leaf) -ieq "releases") {
        Split-Path $scriptParent -Parent
    } else { $PSScriptRoot }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$path = Join-Path $Root "shared\run\system-watchdog.maintenance"
New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
$payload = [ordered]@{
    owner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    reason = $Reason.Substring(0, [Math]::Min(200, $Reason.Length))
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    requested_minutes = $Minutes
} | ConvertTo-Json -Compress
$tmp = "$path.$PID.tmp"
Set-Content -LiteralPath $tmp -Value $payload -Encoding UTF8
Move-Item -LiteralPath $tmp -Destination $path -Force
Write-Host "Watchdog suspenso por ate $Minutes min: $path"
Write-Host "Retome antes com: .\retomar-watchdog-sistema.ps1"
exit 0


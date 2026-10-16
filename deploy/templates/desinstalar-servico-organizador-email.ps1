# Remove o servico Windows SAGRA-OrganizadorEmailSepim (NSSM).
# Os logs de movimentos em logs\email_organizer sao preservados.
param(
    [string]$ServiceName = "SAGRA-OrganizadorEmailSepim",
    [string]$NssmPath = "",
    [string]$Root = ""
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
    throw "nssm.exe nao encontrado. Passe -NssmPath."
}

Assert-Admin

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Servico '$ServiceName' nao existe."
} else {
    Write-Host "Parando e removendo $ServiceName..."
    & $nssm stop $ServiceName 2>$null
    Start-Sleep -Seconds 2
    & $nssm remove $ServiceName confirm
    Write-Host "Servico removido."
}

Write-Host "Pronto."
exit 0

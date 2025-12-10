$hostsPath = "$env:windir\System32\drivers\etc\hosts"
$entry = "127.0.0.1 sagra.app"

if (-not (Select-String -Path $hostsPath -Pattern "sagra.app")) {
    Add-Content -Path $hostsPath -Value "`r`n$entry" -Force
    Write-Host "Adicionado sagra.app ao hosts."
} else {
    Write-Host "sagra.app ja existe no hosts."
}

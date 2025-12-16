# ==========================================
# SCRIPT: Configurar Dominio Publico para Links
# ==========================================
# Configura variavel SAGRA_PUBLIC_DOMAIN para gerar links
# automaticamente com dominio Cloudflare

param(
    [string]$Domain = "https://cgraf.online",
    [switch]$Remove
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  CONFIGURACAO DE DOMINIO PUBLICO" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Verificar se esta rodando como Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERRO: Este script precisa ser executado como Administrador!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Clique com botao direito no PowerShell e selecione 'Executar como Administrador'" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host "Executando como Administrador" -ForegroundColor Green
Write-Host ""

if ($Remove) {
    Write-Host "Removendo configuracao de dominio publico..." -ForegroundColor Yellow
    Write-Host ""
    
    try {
        [System.Environment]::SetEnvironmentVariable("SAGRA_PUBLIC_DOMAIN", $null, "Machine")
        Write-Host "Configuracao removida com sucesso!" -ForegroundColor Green
        Write-Host ""
        Write-Host "O sistema voltara a gerar links com dominio local" -ForegroundColor Cyan
        Write-Host "   Exemplo: http://10.120.1.12:8000/client_pt.html?..." -ForegroundColor Gray
        Write-Host ""
        Write-Host "IMPORTANTE: Reinicie o servidor backend para aplicar!" -ForegroundColor Yellow
    } catch {
        Write-Host "ERRO ao remover configuracao: $_" -ForegroundColor Red
        pause
        exit 1
    }
} else {
    Write-Host "Configurando dominio publico..." -ForegroundColor Cyan
    Write-Host "   Dominio: $Domain" -ForegroundColor White
    Write-Host ""
    
    if ($Domain -notmatch '^https?://') {
        Write-Host "ERRO: Dominio deve comecar com http:// ou https://" -ForegroundColor Red
        Write-Host "   Exemplo correto: https://cgraf.online" -ForegroundColor Yellow
        pause
        exit 1
    }
    
    try {
        [System.Environment]::SetEnvironmentVariable("SAGRA_PUBLIC_DOMAIN", $Domain, "Machine")
        
        Write-Host "Dominio publico configurado com sucesso!" -ForegroundColor Green
        Write-Host ""
        Write-Host "A partir de agora, o sistema gerara links automaticamente com:" -ForegroundColor Cyan
        Write-Host "   $Domain/client_pt.html?..." -ForegroundColor White
        Write-Host ""
        Write-Host "Exemplo de link que sera gerado:" -ForegroundColor Cyan
        Write-Host "   $Domain/client_pt.html?os=1234&ano=2025&token=abc123..." -ForegroundColor White
        Write-Host ""
        Write-Host "IMPORTANTE: Reinicie o servidor backend para aplicar!" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Comandos para reiniciar:" -ForegroundColor Cyan
        Write-Host "   1. Parar: Get-Process python | Where-Object {$_.Path -like '*SagraWeb*'} | Stop-Process" -ForegroundColor Gray
        Write-Host "   2. Iniciar: python main.py" -ForegroundColor Gray
        
    } catch {
        Write-Host "ERRO ao configurar: $_" -ForegroundColor Red
        pause
        exit 1
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "Valor atual da variavel:" -ForegroundColor Cyan
$currentValue = [System.Environment]::GetEnvironmentVariable("SAGRA_PUBLIC_DOMAIN", "Machine")
if ($currentValue) {
    Write-Host "   SAGRA_PUBLIC_DOMAIN = $currentValue" -ForegroundColor Green
} else {
    Write-Host "   SAGRA_PUBLIC_DOMAIN = (nao configurada)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Pressione qualquer tecla para sair..." -ForegroundColor Gray
pause
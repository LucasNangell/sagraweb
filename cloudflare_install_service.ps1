# ==========================================
# SCRIPT: Instalar Cloudflare Tunnel como Serviço Windows
# ==========================================
# Este script instala o túnel SAGRA como serviço permanente
# que inicia automaticamente com o Windows

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  INSTALAÇÃO DO CLOUDFLARE TUNNEL" -ForegroundColor Cyan
Write-Host "  Túnel: sagra" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se está rodando como Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ ERRO: Este script precisa ser executado como Administrador!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Clique com botão direito no PowerShell e selecione 'Executar como Administrador'" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host "✅ Executando como Administrador" -ForegroundColor Green
Write-Host ""

# Verificar se cloudflared está instalado
Write-Host "📦 Verificando instalação do cloudflared..." -ForegroundColor Cyan
try {
    $version = cloudflared --version
    Write-Host "✅ Cloudflared instalado: $version" -ForegroundColor Green
} catch {
    Write-Host "❌ ERRO: cloudflared não encontrado!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Instale o cloudflared primeiro:" -ForegroundColor Yellow
    Write-Host "https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host ""

# Verificar se arquivo de configuração existe
$configPath = "C:\Users\$env:USERNAME\.cloudflared\config.yml"
Write-Host "📄 Verificando arquivo de configuração..." -ForegroundColor Cyan

if (-not (Test-Path $configPath)) {
    Write-Host "❌ ERRO: Arquivo config.yml não encontrado em:" -ForegroundColor Red
    Write-Host "   $configPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Execute primeiro o script de configuração inicial!" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host "✅ Arquivo de configuração encontrado" -ForegroundColor Green
Write-Host ""

# Verificar se serviço já existe
Write-Host "🔍 Verificando se serviço já existe..." -ForegroundColor Cyan
$existingService = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue

if ($existingService) {
    Write-Host "⚠️  Serviço cloudflared já existe!" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Deseja reinstalar? (S/N)"
    
    if ($response -eq "S" -or $response -eq "s") {
        Write-Host ""
        Write-Host "🗑️  Removendo serviço existente..." -ForegroundColor Yellow
        
        # Parar serviço
        if ($existingService.Status -eq "Running") {
            Stop-Service -Name "cloudflared" -Force
            Write-Host "   ✅ Serviço parado" -ForegroundColor Green
        }
        
        # Desinstalar serviço
        cloudflared service uninstall
        Write-Host "   ✅ Serviço desinstalado" -ForegroundColor Green
        Write-Host ""
        Start-Sleep -Seconds 2
    } else {
        Write-Host ""
        Write-Host "❌ Instalação cancelada pelo usuário" -ForegroundColor Red
        Write-Host ""
        pause
        exit 0
    }
}

# Instalar serviço
Write-Host "📦 Instalando túnel como serviço do Windows..." -ForegroundColor Cyan
Write-Host ""

try {
    cloudflared service install
    Write-Host ""
    Write-Host "✅ Serviço instalado com sucesso!" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "❌ ERRO ao instalar serviço: $_" -ForegroundColor Red
    Write-Host ""
    pause
    exit 1
}

Write-Host ""

# Iniciar serviço
Write-Host "🚀 Iniciando serviço..." -ForegroundColor Cyan
try {
    Start-Service -Name "cloudflared"
    Start-Sleep -Seconds 3
    
    $serviceStatus = Get-Service -Name "cloudflared"
    if ($serviceStatus.Status -eq "Running") {
        Write-Host "✅ Serviço iniciado e rodando!" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Serviço instalado mas não está rodando" -ForegroundColor Yellow
        Write-Host "   Status: $($serviceStatus.Status)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  AVISO: Não foi possível iniciar o serviço automaticamente" -ForegroundColor Yellow
    Write-Host "   Inicie manualmente com: Start-Service cloudflared" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ✅ INSTALAÇÃO CONCLUÍDA!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "O túnel SAGRA agora:" -ForegroundColor White
Write-Host "  ✅ Está instalado como serviço Windows" -ForegroundColor Green
Write-Host "  ✅ Inicia automaticamente com o sistema" -ForegroundColor Green
Write-Host "  ✅ Roda em background permanentemente" -ForegroundColor Green
Write-Host ""
Write-Host "Comandos úteis:" -ForegroundColor Cyan
Write-Host "  Get-Service cloudflared              → Ver status" -ForegroundColor White
Write-Host "  Start-Service cloudflared            → Iniciar" -ForegroundColor White
Write-Host "  Stop-Service cloudflared             → Parar" -ForegroundColor White
Write-Host "  Restart-Service cloudflared          → Reiniciar" -ForegroundColor White
Write-Host ""
Write-Host "Logs do serviço:" -ForegroundColor Cyan
Write-Host "  C:\Users\$env:USERNAME\.cloudflared\tunnel.log" -ForegroundColor White
Write-Host ""
Write-Host "Pressione qualquer tecla para sair..." -ForegroundColor Gray
pause

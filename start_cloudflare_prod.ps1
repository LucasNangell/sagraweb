# ==========================================
# SCRIPT: Iniciar Cloudflare Tunnel (PROD)
# ==========================================
# Inicia o túnel sagra para expor cgraf.online
# 
# ATENÇÃO: Este script NÃO:
# - Para servidores
# - Altera DEV
# - Modifica firewall
# - Altera IPs internos

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  CLOUDFLARE TUNNEL - PROD" -ForegroundColor Cyan
Write-Host "  Domínio: cgraf.online" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Verificar se cloudflared está instalado
try {
    $version = cloudflared --version 2>&1
    Write-Host "✅ Cloudflared: $version" -ForegroundColor Green
} catch {
    Write-Host "❌ ERRO: cloudflared não encontrado!" -ForegroundColor Red
    Write-Host "   Instale: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host ""

# Verificar se config existe
$configPath = "C:\Users\$env:USERNAME\.cloudflared\config.yml"
if (-not (Test-Path $configPath)) {
    Write-Host "❌ ERRO: config.yml não encontrado!" -ForegroundColor Red
    Write-Host "   Esperado em: $configPath" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "✅ config.yml encontrado" -ForegroundColor Green
Write-Host ""

# Verificar se servidor PROD está rodando
Write-Host "🔍 Verificando servidor PROD (porta 8000)..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✅ Servidor PROD está rodando" -ForegroundColor Green
} catch {
    Write-Host "⚠️  AVISO: Servidor PROD (porta 8000) não responde" -ForegroundColor Yellow
    Write-Host "   Inicie o servidor PROD antes de executar o túnel" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continuar mesmo assim? (S/N)"
    if ($continue -ne "S" -and $continue -ne "s") {
        exit 0
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  🚀 INICIANDO TÚNEL..." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "ℹ️  O túnel ficará rodando neste terminal" -ForegroundColor Cyan
Write-Host "ℹ️  Pressione Ctrl+C para parar" -ForegroundColor Cyan
Write-Host ""
Write-Host "📊 URLs públicas:" -ForegroundColor Green
Write-Host "   https://cgraf.online/client_pt.html" -ForegroundColor White
Write-Host "   https://cgraf.online/client_proof.html" -ForegroundColor White
Write-Host ""
Write-Host "🔒 URLs bloqueadas:" -ForegroundColor Red
Write-Host "   https://cgraf.online/ (404)" -ForegroundColor Gray
Write-Host "   https://cgraf.online/index.html (404)" -ForegroundColor Gray
Write-Host "   https://cgraf.online/gerencia.html (404)" -ForegroundColor Gray
Write-Host ""
Write-Host "========================================`n" -ForegroundColor Cyan

# Iniciar o túnel
cloudflared tunnel run sagra

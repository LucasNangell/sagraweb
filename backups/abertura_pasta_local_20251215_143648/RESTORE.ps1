# Script de Restauração - SAGRA v1.1.0
# Feature: Abertura Automática de Pasta Local
# Data: 15/12/2025

Write-Host "`n╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                                                        ║" -ForegroundColor Cyan
Write-Host "║  " -NoNewline -ForegroundColor Cyan
Write-Host "📦 SAGRA - Restauração de Backup v1.1.0" -NoNewline -ForegroundColor White
Write-Host "         ║" -ForegroundColor Cyan
Write-Host "║  " -NoNewline -ForegroundColor Cyan
Write-Host "Abertura Automática de Pasta Local" -NoNewline -ForegroundColor Yellow
Write-Host "                 ║" -ForegroundColor Cyan
Write-Host "║                                                        ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$rootDir = "..\.."
$confirm = Read-Host "Deseja restaurar o backup v1.1.0? (S/N)"

if ($confirm -ne "S" -and $confirm -ne "s") {
    Write-Host "`n❌ Restauração cancelada pelo usuário." -ForegroundColor Red
    exit
}

Write-Host "`n🛑 Parando servidor..." -ForegroundColor Yellow
Stop-Process -Name python -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host "✅ Servidor parado" -ForegroundColor Green

Write-Host "`n📂 Restaurando arquivos..." -ForegroundColor Cyan

# Frontend
Write-Host "  → script.js" -ForegroundColor Gray
Copy-Item "script.js" "$rootDir\script.js" -Force

Write-Host "  → index.html" -ForegroundColor Gray
Copy-Item "index.html" "$rootDir\index.html" -Force

# Backend
Write-Host "  → routers\api.py" -ForegroundColor Gray
Copy-Item "api.py" "$rootDir\routers\api.py" -Force

# Documentação
Write-Host "  → Documentação" -ForegroundColor Gray
Copy-Item "FEATURE_ABERTURA_PASTA_LOCAL.md" "$rootDir\" -Force -ErrorAction SilentlyContinue
Copy-Item "QUICK_START_PASTA_LOCAL.md" "$rootDir\" -Force -ErrorAction SilentlyContinue

# Serviço Local
Write-Host "  → local_services\" -ForegroundColor Gray
if (Test-Path "$rootDir\local_services") {
    Remove-Item "$rootDir\local_services" -Recurse -Force
}
Copy-Item -Recurse "local_services" "$rootDir\local_services" -Force

Write-Host "`n✅ Todos os arquivos restaurados!" -ForegroundColor Green

Write-Host "`n🔄 Iniciando servidor..." -ForegroundColor Cyan
cd $rootDir
Start-Process powershell -ArgumentList "-NoExit", "-Command", "python main.py"
Start-Sleep -Seconds 3

Write-Host "`n╔════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                                                        ║" -ForegroundColor Green
Write-Host "║  " -NoNewline -ForegroundColor Green
Write-Host "✅ RESTAURAÇÃO CONCLUÍDA COM SUCESSO!" -NoNewline -ForegroundColor White
Write-Host "            ║" -ForegroundColor Green
Write-Host "║                                                        ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Green

Write-Host "`n📋 Próximos passos:" -ForegroundColor Yellow
Write-Host "  1. Aguarde o servidor inicializar" -ForegroundColor White
Write-Host "  2. Acesse o SAGRA no navegador" -ForegroundColor White
Write-Host "  3. Pressione Ctrl+Shift+R para hard refresh" -ForegroundColor White
Write-Host "  4. Execute no Console: sessionStorage.clear()" -ForegroundColor White
Write-Host "  5. Teste a funcionalidade 'Abrir Pasta'" -ForegroundColor White
Write-Host ""
Write-Host "📚 Documentação:" -ForegroundColor Cyan
Write-Host "  • CHANGELOG.md - Histórico de mudanças" -ForegroundColor Gray
Write-Host "  • README.md - Informações do backup" -ForegroundColor Gray
Write-Host "  • FEATURE_ABERTURA_PASTA_LOCAL.md - Docs técnicas" -ForegroundColor Gray
Write-Host ""

Write-Host "Pressione qualquer tecla para sair..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

@echo off
REM Limpa dados de teste de Gravacao Pendente/Externa no MySQL.
REM Dry-run:  purge_gravacao_test_data.bat
REM Executar: purge_gravacao_test_data.bat --execute --yes
REM Config:   purge_gravacao_test_data.bat --execute --yes --include-config
cd /d "%~dp0.."
py -3 scripts\purge_gravacao_test_data.py %*
if errorlevel 1 python scripts\purge_gravacao_test_data.py %*

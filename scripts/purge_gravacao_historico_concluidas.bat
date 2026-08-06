@echo off
REM Script temporario — apaga historico de gravacoes concluidas no MySQL de producao.
REM Dry-run:  purge_gravacao_historico_concluidas.bat
REM Executar: purge_gravacao_historico_concluidas.bat --execute --yes
cd /d "%~dp0.."
python scripts\purge_gravacao_historico_concluidas.py %*

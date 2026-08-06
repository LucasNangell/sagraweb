@echo off
:: Navega para a pasta dos scripts (o /d garante a troca de unidade se necessario)


echo --- Iniciando o primeiro lote de scripts ---

cd /d "c:\sagraweb\sync_tables"


taskkill /fi "WINDOWTITLE eq Protocolos OS" /f >nul 2>&1
start "Protocolos OS" python sync_tabprotocolos_os.py
timeout /t 1 /nobreak

taskkill /fi "WINDOWTITLE eq Detalhes OS" /f >nul 2>&1
start "Detalhes OS" python sync_tabdetalhes_os.py
timeout /t 1 /nobreak

taskkill /fi "WINDOWTITLE eq Protocolos SP" /f >nul 2>&1
start "Protocolos SP" python sync_tabprotocolos_sp.py
timeout /t 1 /nobreak

taskkill /fi "WINDOWTITLE eq Detalhes SP" /f >nul 2>&1
start "Detalhes SP" python sync_tabdetalhes_sp.py
timeout /t 1 /nobreak
echo.
echo --- Iniciando o segundo lote de scripts ---


taskkill /fi "WINDOWTITLE eq Sync MDB <-> Mysql Protocolos" /f >nul 2>&1
start "Sync MDB <-> Mysql Protocolos" python sync_mdb_mysql_protocolos.py
timeout /t 1 /nobreak
taskkill /fi "WINDOWTITLE eq Sync MDB <-> Mysql Detalhes" /f >nul 2>&1
start "Sync MDB <-> Mysql Detalhes" python sync_mdb_mysql_Detalhes.py
timeout /t 1 /nobreak

echo.
echo Todos os comandos foram disparados e janelas organizadas.
exit
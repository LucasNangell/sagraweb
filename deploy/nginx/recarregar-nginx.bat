@echo off
rem Recarrega Nginx apos alteracoes em \\cgrafsysvm\nginx\conf\
rem Executar como Administrador no servidor cgrafsysvm (10.1.1.73)

set "NGINX=C:\nginx\nginx.exe"
set "CONF=\\cgrafsysvm\nginx\conf\nginx.conf"

echo Testando configuracao...
"%NGINX%" -t -c "%CONF%"
if errorlevel 1 (
    echo ERRO: nginx -t falhou. Nao recarregue.
    exit /b 1
)

echo Recarregando Nginx...
"%NGINX%" -s reload -c "%CONF%"
echo OK.
pause

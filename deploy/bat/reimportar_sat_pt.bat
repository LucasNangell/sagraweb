@echo off
REM Atalho na pasta deploy\bat — delega para o script em deploy\scripts
call "%~dp0..\scripts\reimportar_sat_pt.bat" %*

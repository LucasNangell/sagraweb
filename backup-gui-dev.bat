@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem Atalho para abrir a interface gráfica de Releases & Backups (DEV)
cd /d "%~dp0"
start pythonw "%~dp0deploy\scripts\backup_gui.py"
exit /b 0

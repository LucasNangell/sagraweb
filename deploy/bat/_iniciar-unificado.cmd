@echo off
chcp 65001 >nul
REM Atalho: uma porta, SPA+API, RBAC de paginas no servidor
call "%~dp0..\..\iniciar-servidor.bat" unificado %*
